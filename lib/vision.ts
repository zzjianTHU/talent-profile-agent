// 识别 Agent：用便宜、快速的多模态模型把 JD 截图转成文本（默认 glm-5.3-flash，失败回退 gpt-5.4-mini）
import { gated } from "./llm";

export interface JdExtract {
  title: string;
  salary: string;
  city: string;
  meta: string;
  responsibilities: string[];
  requirements: string[];
  text: string;
  model: string;
  ms: number;
  risks: string[];
}

const PROMPT = `识别这张招聘 JD 图片（可能是招聘网站截图、内部文档或照片）。只输出 JSON：
{"title":"岗位名","salary":"薪资","city":"城市","meta":"经验/学历/行业等标签","responsibilities":["职责原文"],"requirements":["任职要求原文"]}
逐字保留原文，不要改写或补充；看不清的写「（无法识别）」；图片不是 JD 时返回 {"title":"","requirements":[],"responsibilities":[]}。`;

const SENSITIVE = /(\d{2}\s*岁|年龄|年轻|男性|女性|男生|女生|限男|限女|已婚|未婚|已育|未育|本地户口|户籍)/;

export const visionModels = () => [process.env.VISION_MODEL || "glm-5.3-flash", process.env.VISION_FALLBACK_MODEL || "gpt-5.4-mini"];

async function callVision(model: string, image: string) {
  const base = (process.env.VISION_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VISION_API_KEY || process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url: image } }] }] }),
  });
  if (!res.ok) throw new Error(`识别模型 ${model} 返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const raw = String(data.choices?.[0]?.message?.content ?? "");
  return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
}

export async function extractJd(image: string): Promise<JdExtract> {
  let lastErr: unknown;
  for (const model of visionModels()) {
    const t0 = Date.now();
    try {
      const j = await gated(() => callVision(model, image));
      const responsibilities = (j.responsibilities ?? []).map(String);
      const requirements = (j.requirements ?? []).map(String);
      if (!j.title && !requirements.length && !responsibilities.length) throw new Error("NOT_JD");
      const strip = (x: string) => x.replace(/^\s*\d+[.、．]\s*/, "");
      const text = [
        `【岗位】${j.title ?? ""}${j.salary ? `（${j.salary}）` : ""}`,
        [j.city, j.meta].filter(Boolean).join(" · "),
        "",
        "【岗位职责】",
        ...responsibilities.map((x: string, i: number) => `${i + 1}. ${strip(x)}`),
        "",
        "【任职要求】",
        ...requirements.map((x: string, i: number) => `${i + 1}. ${strip(x)}`),
      ].filter((l, i) => l !== "" || i > 1).join("\n");
      return {
        title: String(j.title ?? ""), salary: String(j.salary ?? ""), city: String(j.city ?? ""), meta: String(j.meta ?? ""),
        responsibilities, requirements, text, model, ms: Date.now() - t0,
        risks: requirements.filter((x: string) => SENSITIVE.test(x)).map(strip),
      };
    } catch (e) {
      if (e instanceof Error && e.message === "NOT_JD") throw new Error("这张图片看起来不是 JD，换一张试试");
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("识别失败");
}
