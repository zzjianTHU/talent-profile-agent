# 人才画像澄清 Agent（Demo）

线上演示：https://hr.coveai.uk（访问码另行提供）

## 它怎么工作

1. **说需求**：文字、语音都行；JD 可以粘贴，也可以直接拖截图进来，识别 Agent 会转成文字并标出违规条款。中途随时可以通过「📎 JD」补传或替换。
2. **先看人**：数据就绪后先刷 8 位差异很大的候选人（想聊 / 不想聊 / 说不好），代码统计出经理的真实偏好。
3. **找冲突**：把「口述 / JD / 直觉选择 / 历史招聘 / 外部行情」逐维度对齐，点出「说的」和「选的」不一致的地方。
4. **分组澄清**：相关的 2–3 个问题一组一次答完；拿不准的那一题单独升级为真人对比。过程中可以随时插问、改主意、让它联网搜（结果带可点击的引用编号）。
5. **交付**：审查 Agent 与撰写 Agent 并行工作，产出筛选标准卡、优化 JD、HR 推荐候选人、漏斗与历史回测。

帮用人经理把零散、互相矛盾的用人需求，澄清成 HR 可以直接拿去筛人的标准。产品方案见 [方案.md](方案.md)。

## 运行

```bash
npm install
npm run dev        # http://localhost:3000
```

> 本机全局 npm 源不可用时，项目里的 `.npmrc` 已指向 npm 官方源。

## 接入模型

复制 `.env.example` 为 `.env.local`，填写：

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=<GPT-6.1 Sol 的准确 model id>
OPENAI_BASE_URL=https://api.openai.com/v1   # 任何兼容 OpenAI 协议的地址都可以
TAVILY_API_KEY=...                          # 可选：开启联网搜索
VISION_MODEL=glm-5.3-flash                  # 识别 Agent：JD 截图识别
VISION_FALLBACK_MODEL=gpt-5.4-mini          # 识别失败时的备用模型
```

当前选型（实测，同一代理地址）：

| 角色 | 模型 | 理由 |
|---|---|---|
| 主控 / 数据 / 市场 Agent | deepseek-v4.1-flash | 工具调用稳定，约 150 token/s，是 GPT-6.1 Sol 的 3 倍 |
| 审查 / 撰写 Agent | glm-5.3-flash | 一次性产出 JSON 的子任务；写 JD 实测 12.7s（DeepSeek 46s），失败自动回退主模型 |
| 联网搜索 | 智谱 Web Search（search_pro_quark） | 实测 0.76s、结果带链接 |
| 识别 Agent（JD 截图） | glm-5.3-flash | 7 个多模态候选中最快（1.6–2.9s），关键信息 6/6 全对；flash 档成本最低 |
| 识别备用 | gpt-5.4-mini | 准确但约 7s |

不配置 Key 时，会自动进入**演示回放模式**：按预设剧本产出工具调用，走的是和真实模型同一条执行链路，界面右上角会明确标注。这个模式只用于开发自测和断网兜底，不理解自由输入。

## 3 分钟演示路径

1. **开场页**：经理描述和 JD 已预填，可以改，也可以用语音输入。右侧列出 Agent 会参考的内部数据（岗位、经理历史、同类岗位、人才库）和外部数据（招聘市场行情、联网搜索）。
2. **准备**：工作日志展示 Agent 自主读取内外部资料、拆出维度。右侧看板上的数据来源逐个点亮，并排出澄清议程。开场直接点出"原 JD 口径回测一致率只有 58%"。
3. **澄清**：
   - 年限：选择题，选项附带人才库人数。可以先点"市场上这种人一般多少钱？"演示插问（Agent 先查数据回答，再回到原题，不占预算）；再点"我还不确定"演示升级（Agent 从人才库找两个只差年限的真人做对比）。
   - 背景类型：**真人 AB**。经理嘴上说"要咨询背景"，面对真人时却选了业务分析型，Agent 当场指出差异。
   - 技术深度：取舍题。
   - "年轻"：合规拦截，代码预检和 Agent 追问双保险。
   - 学历：用漏斗数据说服。
4. **自检**：Agent 自主补齐低影响项（并告诉经理可推翻），再跑一致性、漏斗、回测三项检查。
5. **交付**：筛选标准卡（含正反例）、HR 推荐候选人 Top 5、JD 并排对比和改动理由、漏斗和回测的前后对比，最后由经理确认并导出。

## 结构

```
app/api/agent/route.ts   Agent 循环：模型 ↔ 工具，NDJSON 流式推送事件
lib/prompt.ts            系统提示词：决策边界、流程、澄清方式选择、问题预算
lib/tools.ts             12 个工具的定义与执行，含护栏（预算拦截、未澄清不许交付）
lib/engine.ts            确定性计算：筛选、漏斗、回测、自检、对照样本（LLM 不碰数字）
lib/deliver.ts           交付物组装 + JD 改写（单独一次模型调用）
lib/replay.ts            演示回放剧本
lib/vision.ts            识别 Agent：JD 截图 → 文本，并标出违规条款
lib/agents/              数据 Agent（按岗位生成模拟数据）、审查 Agent
scripts/eval.mjs         自动评测：模型扮演 5 类难缠经理完整对话
lib/search.ts            可插拔联网搜索（Tavily，未配置时 Agent 改用市场数据）
lib/data/                mock 数据：剧本、经理历史、人才库、外部市场
components/              对话区、实时画像面板、交付页
```

## 部署

当前部署在一台首尔的 Ubuntu 服务器上：应用由 systemd 常驻，只监听 `127.0.0.1:3010`，经已有的 Cloudflare Tunnel 对外提供 `https://hr.coveai.uk`；访问码由 `ACCESS_CODE` 控制。

```bash
DEPLOY_HOST=<服务器IP> DEPLOY_USER=root DEPLOY_KEY=~/.ssh/<密钥> ACCESS_CODE=<访问码> bash scripts/deploy.sh
```

脚本会在本地构建独立运行包（约 67MB）后上传，复用服务器上已有的 Node（≥ 20），线上运行约占 90MB 内存。首次部署后，需要在 Cloudflare 后台给 Tunnel 加一条 `hr.<你的域名> → http://localhost:3010` 的路由。
