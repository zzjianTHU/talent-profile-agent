// 审查 Agent：独立于主控 Agent，从 HR 执行的视角审一遍标准（代码检查之外的语义问题）
import { chatFast } from "../llm";
import type { Dimension } from "../types";

const REVIEW_PROMPT = `你是资深招聘 HR，负责在标准交给团队执行前做最后审查。你没有参与和经理的沟通，只看标准本身。只输出 JSON：
{ "issues": [ { "severity": "阻断" | "建议", "dimension": "维度名", "text": "问题描述，一句话" } ] }
审查要点：
- 阻断：仍含年龄、性别、婚育、地域等歧视性条件；两条硬性条件语义上互相矛盾；硬性条件无法从简历或面试中判断。
- 建议：判断方法太空泛（如「沟通能力强」）；加分项过多导致排序失焦；某条标准缺少取舍理由。
没有问题就返回空数组。最多 4 条。`;

export async function reviewProfile(dims: Dimension[]) {
  const brief = dims
    .filter((d) => d.level !== "不考察")
    .map((d) => ({ name: d.name, level: d.level, status: d.status, final: d.final, how_to_check: d.how_to_check, rationale: d.rationale }));
  const msg = await chatFast({ json: true, messages: [{ role: "system", content: REVIEW_PROMPT }, { role: "user", content: JSON.stringify(brief) }] });
  try {
    const out = JSON.parse((msg.content ?? "{}").replace(/^```(json)?/m, "").replace(/```\s*$/m, ""));
    return (out.issues ?? []) as { severity: "阻断" | "建议"; dimension: string; text: string }[];
  } catch {
    return [];
  }
}
