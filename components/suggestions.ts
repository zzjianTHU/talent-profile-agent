// 「试试这样说」：按阶段和岗位生成，分类展示，让用户知道 Agent 能做哪些事
import type { SessionState } from "@/lib/types";

export type SuggestKind = "search" | "pool" | "ask" | "test" | "start";
export interface Suggestion { text: string; kind: SuggestKind }

export const KIND_META: Record<SuggestKind, { icon: string; label: string }> = {
  search: { icon: "🔍", label: "联网搜" },
  pool: { icon: "📊", label: "查人才库" },
  ask: { icon: "💬", label: "插问" },
  test: { icon: "🔄", label: "改主意" },
  start: { icon: "✍️", label: "说需求" },
};

export function buildSuggestions(o: { state: SessionState; current?: string; web: boolean; replay: boolean }): Suggestion[] {
  const { state, current, web, replay } = o;
  const job = state.meta?.job;
  const title = job?.title?.replace(/（.*?）|\(.*?\)/g, "") ?? "";
  const city = job?.city ?? "";
  const s = (kind: SuggestKind, text: string): Suggestion => ({ kind, text });

  if (replay) return current ? [s("search", "市场上这种人一般多少钱？"), s("pool", "人才库够不够？"), s("ask", "为什么要问这个？")] : [];

  // 需求采集：还没确定岗位
  if (!state.meta) {
    return [
      s("start", "我要招一个大客户销售经理，要能扛指标"),
      ...(web ? [s("search", "帮我搜一下大厂 AI 产品经理一般要求什么"), s("search", "搜一下 2026 年数据分析师的薪资行情")] : []),
      s("ask", "你能帮我做什么？"),
    ];
  }

  const searches = web
    ? [
        s("search", `搜一下${city}${title}的薪资行情`),
        s("search", `搜一下大厂${title}的 JD 都怎么写`),
        s("search", `${title}现在市场上缺哪类人？`),
      ]
    : [];

  if (state.deliverables) {
    return [s("test", "我改主意了，学历还是要硕士"), s("pool", "人才池能再放宽一点吗？"), ...searches.slice(0, 1), s("ask", "这些数据是从哪来的？")];
  }
  if (current === "calibration") {
    return [s("ask", "为什么要先看人？"), s("ask", "这些人是从哪来的？"), ...searches.slice(0, 1)];
  }
  if (current) {
    return [
      ...searches.slice(0, 2),
      s("pool", "人才库里符合的有多少人？"),
      s("test", "其实年轻点的最好"),
      s("ask", "为什么要问这个？"),
    ];
  }
  return [...searches.slice(0, 2), s("pool", "人才库里大概是什么样的人？")];
}
