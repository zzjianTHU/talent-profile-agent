import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "人才画像澄清 Agent",
  description: "帮用人经理把零散、矛盾的用人需求澄清为可执行的筛选标准",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
