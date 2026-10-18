import type { AgentRole } from "@/lib/types";

export const AGENTS: Record<AgentRole, { name: string; desc: string; color: string }> = {
  orchestrator: { name: "主控 · 澄清 Agent", desc: "规划提问、和经理对话、维护画像", color: "#0071e3" },
  vision: { name: "识别 Agent", desc: "把 JD 截图识别成文本（多模态）", color: "#5856d6" },
  data: { name: "数据 Agent", desc: "岗位、经理历史、同类岗位、人才库", color: "#34c759" },
  market: { name: "市场 Agent", desc: "外部薪资行情、供需、联网搜索", color: "#af52de" },
  engine: { name: "计算引擎", desc: "漏斗、回测、一致性检查（纯代码）", color: "#32ade6" },
  reviewer: { name: "审查 Agent", desc: "以 HR 执行视角独立审查标准", color: "#ff9f0a" },
  writer: { name: "撰写 Agent", desc: "优化 JD、面试题、交付物", color: "#ff2d55" },
  guard: { name: "合规护栏", desc: "代码层识别歧视性表述", color: "#ff3b30" },
};

export const AGENT_ORDER: AgentRole[] = ["orchestrator", "vision", "data", "market", "engine", "reviewer", "writer", "guard"];

export interface AgentStat {
  count: number;
  last?: string;
}

// 每个 Agent 背后用的模型（多模型协同）
export function agentModel(r: AgentRole, models?: { main?: string | null; vision?: string | null; search?: string | null; fast?: string | null }) {
  if (r === "engine") return "代码";
  if (r === "guard") return "规则";
  if (r === "vision") return models?.vision ?? "";
  if ((r === "reviewer" || r === "writer") && models?.fast) return models.fast;
  if (r === "market" && models?.search) return `${models.main ?? ""} + 智谱搜索`;
  return models?.main ?? "";
}
