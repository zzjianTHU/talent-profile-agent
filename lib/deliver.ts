import { examplesFor, recommend } from "./engine";
import { chatFast } from "./llm";
import { WRITER_PROMPT } from "./prompt";
import type { Dataset, Deliverables, Dimension, SessionState } from "./types";

interface WriterOutput {
  summary: string;
  jd: Deliverables["jd"];
  jd_changes: Deliverables["jd_changes"];
  interview_questions: Record<string, string>;
}

function profileForWriter(dims: Dimension[]) {
  return dims.map((d) => ({
    name: d.name, level: d.level, status: d.status, final: d.final, how_to_check: d.how_to_check,
    rationale: d.rationale, sources: d.sources,
  }));
}

export type { WriterOutput };

export async function writeWithLlm(state: SessionState, ds: Dataset): Promise<WriterOutput> {
  const msg = await chatFast({
    json: true,
    messages: [
      { role: "system", content: WRITER_PROMPT },
      { role: "user", content: `【原 JD】\n${ds.jd}\n\n【澄清后的画像】\n${JSON.stringify(profileForWriter(state.dimensions), null, 1)}` },
    ],
  });
  const raw = (msg.content ?? "{}").replace(/^```(json)?/m, "").replace(/```\s*$/m, "");
  return JSON.parse(raw);
}

export function assemble(state: SessionState, ds: Dataset, w: WriterOutput, summaryOverride?: string, risks?: string): Deliverables {
  const dims = state.dimensions;
  const item = (d: Dimension) => ({
    name: d.name,
    final: d.final ?? "",
    how_to_check: d.how_to_check ?? "",
    ...(d.level === "硬性" ? examplesFor(d, dims, ds) : {}),
  });
  return {
    summary: w.summary || summaryOverride || "",
    must: dims.filter((d) => d.level === "硬性").map(item),
    plus: dims.filter((d) => d.level === "加分").map(item),
    veto: dims.filter((d) => d.level === "否决").map(item),
    resolved: dims
      .filter((d) => (d.initial_status === "冲突" || d.initial_status === "含糊") && d.status !== "冲突" && d.status !== "含糊")
      .map((d) => ({
        name: d.name,
        before: [d.sources.manager && `口述：${d.sources.manager}`, d.sources.jd && `JD：${d.sources.jd}`].filter(Boolean).join("；") || d.issue || "",
        after: d.level === "不考察" ? `不考察${d.final ? `（${d.final}）` : ""}` : `${d.level}：${d.final ?? ""}`,
        rationale: d.rationale ?? "",
        decided_by: d.decided_by ?? "",
      })),
    pending: dims
      .filter((d) => d.status === "待面试验证")
      .map((d) => ({ name: d.name, question: d.interview_question || w.interview_questions?.[d.name] || "" })),
    jd: w.jd,
    jd_changes: w.jd_changes ?? [],
    funnel: state.funnel!,
    baseline_funnel: state.baseline_funnel!,
    backtest: state.backtest!,
    baseline_backtest: state.baseline_backtest!,
    recommended: recommend(dims, ds),
    risks,
  };
}
