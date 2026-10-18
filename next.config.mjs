/** @type {import('next').NextConfig} */
const nextConfig = {
  // 评测时用独立目录构建，避免和开发服务器互相覆盖
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // 部署用：产出不依赖 node_modules 的独立运行包
  output: "standalone",
};
export default nextConfig;
