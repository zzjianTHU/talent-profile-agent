"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentStat } from "@/components/agents";
import { Chat, type AgendaItem, type ChatItem } from "@/components/Chat";
import { Deliverables } from "@/components/Deliverables";
import { JdDialog } from "@/components/JdDialog";
import { ProfilePanel } from "@/components/ProfilePanel";
import { buildSuggestions } from "@/components/suggestions";
import { cx } from "@/components/ui";
import { MANAGER_BRIEF, ORIGINAL_JD } from "@/lib/data/scenario";
import type { AgentEvent, AgentRole, LlmMessage, Phase, SessionState } from "@/lib/types";

const INITIAL: SessionState = { phase: "需求采集", dimensions: [], questions_asked: 0, question_budget: 8, self_check_passed: false };
const PHASES: Phase[] = ["需求采集", "准备", "看人", "澄清", "自检", "交付"];
let uid = 0;
const nid = () => `i${++uid}`;

interface ModeInfo { mode: "llm" | "replay"; model: string | null; vision?: string | null; web?: boolean; search?: string | null; fast?: string | null }

const DEMO_TEXT = `【经理描述】\n${MANAGER_BRIEF}\n\n【岗位 JD】\n${ORIGINAL_JD}\n\n请开始：先读取参考资料、建立初版画像，然后开场。`;

export default function Home() {
  const [started, setStarted] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [state, setState] = useState<SessionState>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"chat" | "deliver">("chat");
  const [mode, setMode] = useState<ModeInfo | null>(null);
  const [agents, setAgents] = useState<Partial<Record<AgentRole, AgentStat>>>({});
  const [activeAgent, setActiveAgent] = useState<AgentRole | undefined>();
  const [jdOpen, setJdOpen] = useState(false);
  const history = useRef<LlmMessage[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    fetch("/api/agent").then((r) => r.json()).then(setMode).catch(() => {});
  }, []);

  async function run(userText: string, display: string, calibration?: { id: string; verdict: string }[]) {
    setBusy(true);
    setActiveAgent("orchestrator");
    setItems((xs) => {
      // 点选项 / 选真人 / 说不确定，才算回答了最近一张卡片；插问不算
      const out = [...xs];
      const isAnswer = /^(选 |我选 |我还不确定|【)/.test(display);
      for (let i = out.length - 1; i >= 0 && isAnswer; i--) {
        const it = out[i];
        if (it.kind === "card") {
          if (!it.answered) out[i] = { ...it, answered: display };
          break;
        }
      }
      return [...out, { id: nid(), kind: "user", text: display }];
    });

    const pushActivity = (text: string, agent: AgentRole) => {
      setActiveAgent(agent);
      setAgents((a) => ({ ...a, [agent]: { count: (a[agent]?.count ?? 0) + 1, last: text } }));
      setItems((xs) => {
        const last = xs[xs.length - 1];
        if (last?.kind === "activity") return [...xs.slice(0, -1), { ...last, lines: [...last.lines, { text, agent }] }];
        return [...xs, { id: nid(), kind: "activity", lines: [{ text, agent }] }];
      });
    };

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.current, state: stateRef.current, userText, calibration }),
      });
      if (!res.body) throw new Error("无响应");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as AgentEvent;
          if (e.t === "activity") pushActivity(e.text, e.agent);
          else if (e.t === "assistant") {
            setActiveAgent("orchestrator");
            setItems((xs) => [...xs, { id: nid(), kind: "assistant", text: e.text }]);
          } else if (e.t === "card") setItems((xs) => [...xs, { id: nid(), kind: "card", card: e.card }]);
          else if (e.t === "state") {
            const had = !!stateRef.current.deliverables;
            stateRef.current = e.state;
            setState(e.state);
            if (e.state.deliverables && !had) setTimeout(() => setView("deliver"), 900);
          } else if (e.t === "error") setItems((xs) => [...xs, { id: nid(), kind: "error", text: e.message }]);
          else if (e.t === "done") history.current = e.messages;
        }
      }
    } catch (err) {
      setItems((xs) => [...xs, { id: nid(), kind: "error", text: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setBusy(false);
      setActiveAgent(undefined);
    }
  }

  function begin(userText: string, display: string, seed?: Partial<Record<AgentRole, AgentStat>>) {
    setStarted(true);
    if (seed) setAgents(seed);
    run(userText, display);
  }

  // 对话中途补传 / 替换 JD：交给后端按「【补充 JD】」接管
  function sendJd(text: string, fromShot: boolean) {
    setJdOpen(false);
    const replacing = !!stateRef.current.jd_override || !!stateRef.current.meta;
    const tag = `${replacing ? "替换" : "补充"} JD${fromShot ? "（由识别 Agent 从截图提取）" : ""}`;
    if (fromShot) setAgents((a) => ({ ...a, vision: { count: (a.vision?.count ?? 0) + 1, last: "识别 JD 截图" } }));
    run(`【${tag}】\n${text}`, `📎 ${replacing ? "替换了" : "提供了"} JD（${fromShot ? "截图识别" : "粘贴"}，${text.length} 字）`);
  }

  function reset() {
    history.current = [];
    setItems([]);
    setState(INITIAL);
    stateRef.current = INITIAL;
    setAgents({});
    setView("chat");
    setStarted(false);
  }

  // 引导式议程：准备阶段识别出的冲突 / 含糊维度，按影响从高到低；低影响项由 Agent 自动处理
  const agenda: AgendaItem[] = state.dimensions
    .filter((d) => d.initial_status === "冲突" || d.initial_status === "含糊")
    .map((d, i) => ({ d, i }))
    .sort((a, b) => b.d.impact - a.d.impact || a.i - b.i)
    .map(({ d }) => ({ id: d.id, name: d.name, auto: d.impact <= 2 }));
  const lastCard = [...items].reverse().find((i) => i.kind === "card");
  const pendingCard = lastCard && lastCard.kind === "card" && !lastCard.answered ? lastCard.card : undefined;
  const current = pendingCard?.dimension_id;
  const currentDims = pendingCard?.kind === "group" ? pendingCard.questions.map((q) => q.dimension_id) : current ? [current] : [];

  const replay = mode?.mode === "replay";
  const suggestions = buildSuggestions({ state, current, web: !!mode?.web, replay });

  return (
    <div className="flex h-screen flex-col">
      <header className="px-4 pt-3">
        <div className="glass flex h-12 items-center gap-4 rounded-full px-3 pl-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[conic-gradient(from_200deg,#5ac8fa,#0071e3,#af52de,#5ac8fa)] text-[11px] font-bold text-white">画</div>
            <span className="text-[14px] font-semibold tracking-tight">人才画像澄清</span>
          </div>
          {started && (
            <>
              {state.meta && (
                <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
                  {state.meta.job.title} · {state.meta.job.department}
                  {state.meta.generated && <span className="rounded-full bg-[#af52de]/10 px-2 py-0.5 text-[10px] text-[#8944ab]">按岗位生成的模拟数据</span>}
                </span>
              )}
              <div className="ml-2 flex items-center gap-0.5 rounded-full glass-tint p-0.5">
                {PHASES.map((p, i) => {
                  const cur = PHASES.indexOf(state.phase);
                  return (
                    <span key={p} className={cx("rounded-full px-3 py-1 text-[12px] transition", i === cur ? "bg-white font-medium text-ink shadow-[0_1px_4px_rgba(0,0,0,.1)]" : i < cur ? "text-good" : "text-ink-3")}>
                      {i < cur ? "✓ " : ""}{p}
                    </span>
                  );
                })}
              </div>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            {state.deliverables && (
              <div className="flex rounded-full glass-tint p-0.5 text-[12px]">
                <button onClick={() => setView("chat")} className={cx("rounded-full px-3 py-1", view === "chat" ? "bg-white font-medium shadow-[0_1px_4px_rgba(0,0,0,.1)]" : "text-ink-2")}>澄清对话</button>
                <button onClick={() => setView("deliver")} className={cx("rounded-full px-3 py-1", view === "deliver" ? "bg-white font-medium shadow-[0_1px_4px_rgba(0,0,0,.1)]" : "text-ink-2")}>交付物</button>
              </div>
            )}
            <ModeBadge mode={mode} />
            {started && <button onClick={reset} className="rounded-full px-3 py-1 text-[12px] text-ink-2 hover:text-ink">重新开始</button>}
          </div>
        </div>
      </header>

      {!started ? (
        <StartScreen onBegin={begin} mode={mode} />
      ) : view === "deliver" && state.deliverables && state.meta ? (
        <main className="min-h-0 flex-1"><Deliverables d={state.deliverables} meta={state.meta} /></main>
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-[1fr_440px] gap-3 overflow-hidden p-3 pt-3">
          <div className="glass min-h-0 overflow-hidden rounded-[30px]">
            <Chat items={items} busy={busy} onSend={(t, cal) => run(t, t, cal)} agenda={agenda} suggestions={suggestions} refs={(state.web_results ?? []).flatMap((q) => q.results)}
              onJd={() => setJdOpen(true)} jdMissing={!state.jd_override && state.meta?.jd_source !== "用户粘贴" && state.meta?.jd_source !== "截图识别"} />
          </div>
          <div className="min-h-0 overflow-hidden">
            <ProfilePanel onJd={() => setJdOpen(true)} state={state} agenda={agenda} current={currentDims} web={!!mode?.web} agents={agents} activeAgent={busy ? activeAgent : undefined} models={{ main: mode?.model, vision: mode?.vision, search: mode?.search, fast: mode?.fast }} />
          </div>
        </main>
      )}
      <JdDialog open={jdOpen} replacing={!!state.jd_override || !!state.meta} onClose={() => setJdOpen(false)} onSubmit={sendJd} />
    </div>
  );
}

function ModeBadge({ mode }: { mode: ModeInfo | null }) {
  if (!mode) return null;
  return mode.mode === "llm" ? (
    <span className="flex items-center gap-1.5 rounded-full glass-tint px-3 py-1 text-[12px] text-ink-2"><span className="h-1.5 w-1.5 rounded-full bg-[#34c759]" />{mode.model}</span>
  ) : (
    <span className="flex items-center gap-1.5 rounded-full bg-[#ff9f0a]/12 px-3 py-1 text-[12px] text-warn" title="未配置 OPENAI_API_KEY / OPENAI_MODEL：只能按预设剧本回放">
      <span className="h-1.5 w-1.5 rounded-full bg-[#ff9f0a]" />演示回放模式
    </span>
  );
}

function StartScreen({ onBegin, mode }: { onBegin: (text: string, display: string, seed?: Partial<Record<AgentRole, AgentStat>>) => void; mode: ModeInfo | null }) {
  const [text, setText] = useState("");
  const [jd, setJd] = useState("");
  const [showJd, setShowJd] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const replay = mode?.mode === "replay";
  const fileRef = useRef<HTMLInputElement>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [ocr, setOcr] = useState<{ state: "idle" | "busy" | "done" | "error"; model?: string; ms?: number; risks?: string[]; error?: string }>({ state: "idle" });
  const [dragging, setDragging] = useState(false);

  // 压缩到长边 1600px 的 JPEG，再交给识别 Agent
  async function recognize(file: File) {
    if (!file.type.startsWith("image/")) return;
    setShowJd(true);
    setOcr({ state: "busy" });
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          const ctx = c.getContext("2d")!;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", 0.88));
          URL.revokeObjectURL(img.src);
        };
        img.onerror = () => reject(new Error("图片无法读取"));
        img.src = URL.createObjectURL(file);
      });
      setShot(dataUrl);
      const res = await fetch("/api/jd-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataUrl }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "识别失败");
      setJd(j.text);
      setOcr({ state: "done", model: j.model, ms: j.ms, risks: j.risks });
    } catch (e) {
      setOcr({ state: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (f && !replay) {
        e.preventDefault();
        recognize(f);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  function toggleVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return alert("当前浏览器不支持语音输入，请用 Chrome");
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = false;
    const base = text ? text + "\n" : "";
    let acc = "";
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) acc += e.results[i][0].transcript;
      setText(base + acc);
    };
    rec.onend = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  }

  function submit(t = text) {
    const v = t.trim();
    if (!v || replay || ocr.state === "busy") return;
    const fromShot = ocr.state === "done" && !!jd.trim();
    const seed = fromShot ? { vision: { count: 1, last: `识别 JD 截图 · ${(ocr.ms! / 1000).toFixed(1)}s${ocr.risks?.length ? ` · 发现 ${ocr.risks.length} 处合规风险` : ""}` } } : undefined;
    onBegin(
      jd.trim() ? `${v}\n\n【现有 JD${fromShot ? "（由识别 Agent 从截图提取）" : ""}】\n${jd.trim()}` : v,
      jd.trim() ? `${v}\n（附现有 JD${fromShot ? " · 来自截图识别" : ""}）` : v,
      seed,
    );
  }

  // 两行反向滚动的示例：第一行偏「说需求」，第二行偏「联网搜 / 提问 / 刁难」
  const rowA = [
    "✍️ 我要招一个大客户销售经理，要能扛指标，最好有同行资源，年轻有冲劲的",
    "✍️ 招个高级前端，3 年左右就行，但得能带团队、主导架构",
    "✍️ 我们缺一个新媒体运营，会做短视频，能加班",
    "✍️ 要个算法工程师做推荐，最好名校硕士，大厂背景",
    "✍️ 招一个 HRBP 支持研发团队，懂业务、能推动",
    "✍️ 想要一个能独立负责项目的游戏策划",
  ];
  const rowB = [
    ...(mode?.web
      ? ["🔍 帮我搜一下大厂 AI 产品经理一般要求什么", "🔍 上海的数据分析师现在好招吗？", "🔍 搜一下 2026 年深圳嵌入式工程师的薪资", "🔍 字节、阿里的增长运营 JD 都怎么写？"]
      : ["💬 数据分析师现在好招吗？"]),
    "💬 你能帮我做什么？",
    "🔄 我就要 25 岁以下的，能写进标准吗？",
    "💬 先看人和直接写 JD 有什么区别？",
  ];
  const caps = [
    { icon: "🔍", title: "联网搜索", desc: mode?.web ? "搜岗位要求、薪资行情、竞对招聘（智谱）" : "未配置搜索服务", on: !!mode?.web },
    { icon: "📷", title: "读 JD 截图", desc: "截图拖进来，自动识别并标出违规条款", on: !!mode?.vision },
    { icon: "📊", title: "查人才库", desc: "按条件统计人数、薪资分布", on: true },
    { icon: "👀", title: "先看人", desc: "刷 8 位候选人，反推你的真实偏好", on: true },
  ];
  const flow = [
    ["主控 + 识别 Agent", "听你说需求、读 JD 截图，追问关键信息"],
    ["数据 + 市场 Agent", "调取内部数据和外部行情"],
    ["主控 Agent", "找出冲突，选择题 + 真人对比"],
    ["审查 + 撰写 Agent", "独立审查，交付标准与 JD"],
  ];

  return (
    <main className="scroll-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-6 pb-12 pt-12">
        <div className="text-center">
          <h1 className="text-[42px] font-semibold leading-tight tracking-[-0.03em] text-ink">想招什么样的人？</h1>
          <p className="mx-auto mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-2">
            像跟 HR 聊需求一样说就行，任何岗位都可以。Agent 会对照内外部数据找出矛盾，陪你一步步把标准定下来。
          </p>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); if (!replay) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f && !replay) recognize(f); }}
          className={cx("glass-strong mt-8 rounded-[30px] p-2 transition", dragging && "ring-2 ring-accent/50")}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={replay}
            rows={4}
            placeholder={replay ? "当前未接入模型，只能体验下方的示例剧本" : "比如：我们组要招一个……主要做……最看重……（也可以先问我问题）"}
            className="w-full resize-none bg-transparent px-4 pt-3 text-[15px] leading-relaxed outline-none placeholder:text-ink-4"
          />
          {showJd && (
            <div className="mx-2 mb-2 rounded-[20px] bg-white/60 p-3 ring-1 ring-black/5">
              <div className="mb-2 flex items-center gap-2 text-[12px]">
                <span className="font-medium text-ink">现有 JD</span>
                {ocr.state === "idle" && <span className="text-ink-3">粘贴文字，或直接把截图拖进来 / ⌘V 粘贴截图</span>}
                {ocr.state === "busy" && <span className="flex items-center gap-1.5 text-[#5856d6]"><span className="h-1.5 w-1.5 animate-ping rounded-full bg-[#5856d6]" />识别 Agent 正在读取截图…</span>}
                {ocr.state === "done" && <span className="text-good">✓ 已从截图识别 · {ocr.model} · {((ocr.ms ?? 0) / 1000).toFixed(1)}s · 可直接修改</span>}
                {ocr.state === "error" && <span className="text-bad">{ocr.error}</span>}
                <button onClick={async () => { const b = await (await fetch("/samples/jd-sample.png")).blob(); recognize(new File([b], "jd-sample.png", { type: "image/png" })); }} className="ml-auto rounded-full glass-tint px-3 py-1 text-[12px] text-ink-2 hover:text-ink">用示例截图</button>
                <button onClick={() => fileRef.current?.click()} className="rounded-full glass-tint px-3 py-1 text-[12px] text-ink-2 hover:text-ink">上传截图</button>
              </div>
              {ocr.state === "done" && !!ocr.risks?.length && (
                <div className="mb-2 rounded-xl bg-[#ff3b30]/8 px-3 py-2 text-[12px] text-bad">⚠️ 识别到可能违规的条款：{ocr.risks.join("；")}　— Agent 会在澄清时处理</div>
              )}
              <div className="flex gap-3">
                {shot && <img src={shot} alt="JD 截图" className="h-40 w-28 shrink-0 rounded-xl object-cover object-top ring-1 ring-black/10" />}
                <textarea value={jd} onChange={(e) => setJd(e.target.value)} rows={7} disabled={ocr.state === "busy"} placeholder="不填则使用该岗位的公司模板 JD"
                  className="flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-ink-2 outline-none" />
              </div>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) recognize(f); e.target.value = ""; }} />
          <div className="flex items-center gap-2 px-2 pb-1">
            <button onClick={toggleVoice} disabled={replay} className={cx("rounded-full px-3.5 py-1.5 text-[12px] transition disabled:opacity-40", listening ? "bg-[#ff3b30] text-white" : "glass-tint text-ink-2 hover:text-ink")}>
              {listening ? "● 录音中，点击结束" : "🎙 语音"}
            </button>
            <button onClick={() => setShowJd(!showJd)} disabled={replay} className="rounded-full glass-tint px-3.5 py-1.5 text-[12px] text-ink-2 transition hover:text-ink disabled:opacity-40">
              {showJd ? "收起 JD" : "＋ 附上现有 JD"}
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={replay} className="rounded-full glass-tint px-3.5 py-1.5 text-[12px] text-ink-2 transition hover:text-ink disabled:opacity-40">
              📷 JD 截图识别
            </button>
            <button onClick={() => submit()} disabled={!text.trim() || replay || ocr.state === "busy"} className="btn-primary ml-auto flex h-10 w-10 items-center justify-center rounded-full" aria-label="开始">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>

        <div className={cx("mt-5 space-y-2", replay && "pointer-events-none opacity-40")}>
          <Marquee items={rowA} onPick={(t) => submit(t.replace(/^\S+\s/, ""))} />
          <Marquee items={rowB} onPick={(t) => submit(t.replace(/^\S+\s/, ""))} reverse />
        </div>

        <button onClick={() => onBegin(DEMO_TEXT, "看示例：商业分析师（预置剧本）")} className="glass mx-auto mt-3 flex items-center gap-3 rounded-[22px] px-5 py-3 text-left transition hover:ring-1 hover:ring-accent/30">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-[16px]">▶</span>
          <span>
            <span className="block text-[14px] font-medium text-ink">看示例：商业分析师</span>
            <span className="block text-[12px] text-ink-3">预置的经理口述 + JD，埋了 7 处冲突{replay ? "（回放模式）" : ""}</span>
          </span>
        </button>

        <div className="mt-12">
          <div className="mb-3 text-center text-[12px] font-medium tracking-wider text-ink-3">它能做什么</div>
          <div className="grid grid-cols-4 gap-2">
            {caps.map((c) => (
              <div key={c.title} className={cx("glass rounded-[22px] p-4", !c.on && "opacity-50")}>
                <div className="text-[13px] font-medium text-ink">{c.icon} {c.title}</div>
                <div className="mt-1 text-[12px] leading-relaxed text-ink-3">{c.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8">
          <div className="mb-3 text-center text-[12px] font-medium tracking-wider text-ink-3">背后的 Agent 协作流程</div>
          <div className="grid grid-cols-4 gap-2">
            {flow.map(([who, what], i) => (
              <div key={i} className="glass rounded-[22px] p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">{i + 1}</span>
                  <span className="text-[13px] font-medium text-ink">{who}</span>
                </div>
                <div className="mt-1.5 text-[12px] leading-relaxed text-ink-3">{what}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-[11px] text-ink-4">演示版：内部人才库、历史招聘与市场行情均为模拟数据；非预置岗位的数据由数据 Agent 按岗位现场生成，首次约需 1 分钟。</p>
        </div>
      </div>
    </main>
  );
}

// 无限滚动的示例条：两份内容首尾相接，悬停暂停，两侧渐隐
function Marquee({ items, onPick, reverse }: { items: string[]; onPick: (t: string) => void; reverse?: boolean }) {
  const dur = Math.max(28, items.join("").length * 0.45);
  return (
    <div className="marquee group relative overflow-hidden py-1">
      <div className={cx("flex w-max gap-2 group-hover:[animation-play-state:paused]", reverse ? "animate-marquee-rev" : "animate-marquee")} style={{ animationDuration: `${dur}s` }}>
        {[...items, ...items].map((t, i) => (
          <button key={i} onClick={() => onPick(t)} tabIndex={i >= items.length ? -1 : 0}
            className={cx("glass shrink-0 rounded-full px-4 py-2 text-[13px] transition hover:-translate-y-0.5 hover:text-accent hover:shadow-[0_8px_24px_-10px_rgba(0,113,227,.45)]", t.startsWith("🔍") ? "text-[#8944ab]" : "text-ink-2")}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
