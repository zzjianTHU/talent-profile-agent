import { getDataset } from "@/lib/agents/data";
import { analyzeSwipes, recompute } from "@/lib/engine";
import { chatCompletion, fastModel, llmConfigured } from "@/lib/llm";
import { statusNote, SYSTEM_PROMPT } from "@/lib/prompt";
import { replayStep } from "@/lib/replay";
import { webSearchConfigured, webSearchProvider } from "@/lib/search";
import { executeTool, TOOL_AGENT, TOOLS } from "@/lib/tools";
import { visionModels } from "@/lib/vision";
import type { AgentEvent, AgentRole, LlmMessage, SessionState } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_STEPS = 18;
const SENSITIVE = /(年轻|岁以下|岁以内|岁左右|男生|女生|男性|女性|已婚|未婚|已育|未育|生育|本地人|户口|外地)/g;

export async function POST(req: Request) {
  const { messages: history, state: initial, userText, replay, calibration } = (await req.json()) as {
    messages: LlmMessage[];
    state: SessionState;
    userText: string;
    replay?: boolean;
    calibration?: { id: string; verdict: "想聊" | "不想聊" | "说不好" }[];
  };
  const mode: "llm" | "replay" = llmConfigured() && !replay ? "llm" : "replay";

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(new TextEncoder().encode(JSON.stringify(e) + "\n"));
      const activity = (text: string, agent: AgentRole) => emit({ t: "activity", text, agent });
      let state = initial;
      const messages: LlmMessage[] = [...history];

      // 合规护栏：代码层识别敏感表述，提示主控 Agent 处理（不依赖模型自觉）
      const hits = [...new Set(userText.match(SENSITIVE) ?? [])];
      let content = userText;
      if (hits.length) {
        content += `\n\n[系统合规提示：检测到可能涉及歧视的表述「${hits.join("」「")}」，不得写入标准，请追问真实诉求并改写]`;
        activity(`识别到敏感表述「${hits.join("」「")}」，已提示主控 Agent 改写`, "guard");
      }
      // JD 由代码直接接管：开场附带或中途补传 / 替换，都写进 jd_override，并让主控 Agent 重新对照
      const jdMatch = userText.match(/【(?:现有|补充|替换)\s*JD([^】]*)】\n([\s\S]+)$/);
      if (jdMatch) {
        const source = /截图/.test(jdMatch[1]) ? "截图识别" : "用户粘贴";
        const replacing = !!state.meta;
        state = { ...state, jd_override: { text: jdMatch[2].trim(), source } };
        if (state.meta) state = { ...state, meta: { ...state.meta, jd: jdMatch[2].trim(), jd_source: source } };
        const ds = getDataset(state);
        if (ds && state.dimensions.length) state = recompute(state, ds);
        activity(`收到${replacing ? "新的" : ""} JD（${source}，${jdMatch[2].trim().length} 字）${replacing ? "，已替换原 JD" : ""}`, "data");
        if (replacing) content += "\n\n[系统：JD 已替换为上面这份。请对照新 JD，用 update_dimension 并行更新各维度的 sources.jd 和 jd_filters（新 JD 字面硬性要求），必要时新增维度，然后 backtest，再用一两句话告诉经理新 JD 带来了哪些新冲突。]";
        emit({ t: "state", state });
      }

      // 快速校准：偏好统计由代码完成，再交给主控 Agent 解读
      if (calibration?.length) {
        const ds = getDataset(state);
        if (ds) {
          const a = analyzeSwipes(ds, calibration);
          state = { ...state, calibration: { picks: calibration, findings: a.findings } };
          content += `\n\n[快速校准结果（代码统计）]\n想聊：${a.yes.join("、") || "无"}\n不想聊：${a.no.join("、") || "无"}\n说不好：${a.unsure.join("、") || "无"}\n偏好分析：\n- ${a.findings.join("\n- ")}`;
          activity(`统计校准结果：想聊 ${a.yes.length} · 不想聊 ${a.no.length} · 说不好 ${a.unsure.length}，提炼 ${a.findings.length} 条偏好`, "engine");
          emit({ t: "state", state });
        }
      }
      messages.push({ role: "user", content });

      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const assistant =
            mode === "llm"
              ? await chatCompletion({
                  messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages, { role: "system", content: statusNote({ ...state, web: webSearchConfigured() }) }],
                  tools: TOOLS,
                })
              : replayStep(messages, state);
          messages.push(assistant);
          if (assistant.content?.trim()) emit({ t: "assistant", text: assistant.content.trim() });
          if (!assistant.tool_calls?.length) break;

          let endTurn = false;
          for (const tc of assistant.tool_calls) {
            let args: Record<string, any> = {};
            try {
              args = JSON.parse(tc.function.arguments || "{}");
            } catch {
              messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "参数不是合法 JSON" }) });
              continue;
            }
            const agent = TOOL_AGENT[tc.function.name] ?? "orchestrator";
            if (tc.function.name === "prepare_dataset") activity(`接到任务：准备「${args.role_title}」的内外部数据`, "data");
            const { state: next, out } = await executeTool(tc.function.name, args, state, { mode, progress: activity });
            state = next;
            activity(out.activity, agent);
            if (out.card) emit({ t: "card", card: out.card });
            messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out.result) });

            emit({ t: "state", state });
            if (out.endTurn) endTurn = true;
          }
          if (endTurn) break;
        }
      } catch (err) {
        emit({ t: "error", message: err instanceof Error ? err.message : String(err) });
      }
      emit({ t: "state", state });
      emit({ t: "done", messages, mode });
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET() {
  return Response.json({ mode: llmConfigured() ? "llm" : "replay", model: process.env.OPENAI_MODEL || null, vision: llmConfigured() ? visionModels()[0] : null, fast: llmConfigured() ? fastModel() : null, web: webSearchConfigured(), search: webSearchProvider() });
}
