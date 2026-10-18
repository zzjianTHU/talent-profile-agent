// 直连 OpenAI 兼容的 Chat Completions 接口（不依赖 SDK，换模型只改环境变量）
import type { LlmMessage } from "./types";

export function llmConfigured() {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
}

export function modelName() {
  return process.env.OPENAI_MODEL || "未配置";
}

// 进程内并发闸门：Key 有并发上限（当前 5），超出时排队而不是直接失败
const MAX_CONCURRENT = Number(process.env.LLM_MAX_CONCURRENT || 4);
let running = 0;
const waiting: (() => void)[] = [];
async function acquire() {
  if (running < MAX_CONCURRENT) { running++; return; }
  await new Promise<void>((r) => waiting.push(r));
  running++;
}
function release() {
  running--;
  waiting.shift()?.();
}

export async function chatCompletion(opts: Parameters<typeof callOnce>[0]) {
  return gated(() => callOnce(opts));
}

// 通用的排队 + 重试（视觉识别等其他调用也走这里）
export async function gated<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await acquire();
    try {
      return await fn();
    } catch (e) {
      const retryable = e instanceof Error && /返回 (429|5\d\d)|fetch failed|ECONNRESET/.test(e.message);
      if (!retryable || attempt >= 4) throw e;
    } finally {
      release();
    }
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
  }
}

async function callOnce(opts: {
  messages: LlmMessage[];
  tools?: unknown[];
  json?: boolean;
  model?: string;
}): Promise<Extract<LlmMessage, { role: "assistant" }>> {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const body: Record<string, unknown> = {
    model: opts.model || process.env.OPENAI_MODEL,
    messages: opts.messages,
  };
  if (opts.tools) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  if (opts.json) body.response_format = { type: "json_object" };

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`模型接口返回 ${res.status}：${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error("模型接口返回为空");
  return { role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls?.length ? msg.tool_calls : undefined };
}

// 撰写 / 审查这类「一次性产出 JSON」的子任务用更快的模型；失败时回退主模型
export const fastModel = () => process.env.FAST_MODEL || "glm-5.3-flash";

export async function chatFast(opts: Omit<Parameters<typeof callOnce>[0], "model">) {
  try {
    return await chatCompletion({ ...opts, model: fastModel() });
  } catch {
    return await chatCompletion(opts);
  }
}
