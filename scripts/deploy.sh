#!/usr/bin/env bash
# 一键部署到 Ubuntu 服务器：本地构建 → 打包上传 → systemd 常驻
# 应用只监听 127.0.0.1:$APP_PORT（默认 3010），由 Cloudflare Tunnel 对外提供 HTTPS。
# 用法：DEPLOY_HOST=1.2.3.4 DEPLOY_USER=root DEPLOY_KEY=~/.ssh/xxx ACCESS_CODE=123456 bash scripts/deploy.sh
set -euo pipefail
: "${DEPLOY_HOST:?需要 DEPLOY_HOST}"
: "${DEPLOY_USER:=root}"
: "${DEPLOY_KEY:?需要 DEPLOY_KEY}"
: "${ACCESS_CODE:?需要 ACCESS_CODE}"
: "${APP_PORT:=3010}"
APP_DIR=/opt/talent-agent
SSH_OPTS=(-i "$DEPLOY_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
cd "$(dirname "$0")/.."

echo "▶ 本地构建（独立运行包）"
rm -rf .next-deploy dist-deploy dist-deploy.tgz
NEXT_DIST_DIR=.next-deploy npx next build >/dev/null
mkdir -p dist-deploy
cp -r .next-deploy/standalone/. dist-deploy/
cp -r .next-deploy/static dist-deploy/.next-deploy/static
cp -r public dist-deploy/public
# 线上环境变量：沿用 .env.local 的模型 / 搜索配置，加上访问码和监听地址
{
  grep -E '^[A-Z_]+=' .env.local | grep -vE '^(PORT|HOSTNAME|ACCESS_CODE|NODE_ENV)='
  echo "ACCESS_CODE=$ACCESS_CODE"
  echo "PORT=$APP_PORT"
  echo "HOSTNAME=127.0.0.1"
  echo "NODE_ENV=production"
} > dist-deploy/.env.production
COPYFILE_DISABLE=1 tar --no-xattrs -czf dist-deploy.tgz -C dist-deploy .
echo "▶ 上传 $(du -h dist-deploy.tgz | cut -f1)"
scp "${SSH_OPTS[@]}" dist-deploy.tgz "$DEPLOY_USER@$DEPLOY_HOST:/tmp/talent-agent.tgz"

echo "▶ 服务器安装"
ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" APP_DIR="$APP_DIR" APP_PORT="$APP_PORT" 'bash -s' <<'REMOTE'
set -euo pipefail
# 优先复用已有的 Node（≥ 20），都没有才安装
NODE_BIN=""
for c in /usr/bin/node /usr/local/bin/node $(ls -d /root/.nvm/versions/node/v2*/bin/node 2>/dev/null | sort -V | tail -1); do
  if [ -x "$c" ] && [ "$("$c" -v | cut -d. -f1 | tr -d v)" -ge 20 ]; then NODE_BIN="$c"; break; fi
done
if [ -z "$NODE_BIN" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y nodejs >/dev/null && NODE_BIN=/usr/bin/node
fi
echo "  使用 Node: $NODE_BIN ($("$NODE_BIN" -v))"

mkdir -p "$APP_DIR"
rm -rf "${APP_DIR:?}"/* "$APP_DIR/.next-deploy" "$APP_DIR/.env.production"
tar -xzf /tmp/talent-agent.tgz -C "$APP_DIR" && rm -f /tmp/talent-agent.tgz
chmod 600 "$APP_DIR/.env.production"

cat > /etc/systemd/system/talent-agent.service <<UNIT
[Unit]
Description=Talent profile clarification agent (demo)
After=network-online.target

[Service]
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env.production
ExecStart=$NODE_BIN server.js
Restart=always
RestartSec=3
MemoryMax=600M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable talent-agent >/dev/null 2>&1
systemctl restart talent-agent
sleep 3
systemctl is-active talent-agent
curl -s -o /dev/null -w "  本机自检：首页 %{http_code}（307 = 跳转到访问码页，正常）\n" "http://127.0.0.1:$APP_PORT/"
REMOTE

rm -rf dist-deploy dist-deploy.tgz
echo "✔ 部署完成"
