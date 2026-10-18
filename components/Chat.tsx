"use client";

import { useEffect, useRef, useState } from "react";
import type { AbCard, AgentRole, Candidate, Card, ChoiceCard, DeckCard, GroupCard, Verdict, WebRef } from "@/lib/types";
import { AGENTS } from "./agents";
import { KIND_META, type Suggestion } from "./suggestions";
import { cx, Pill, Spinner } from "./ui";

export type ChatItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "activity"; lines: { text: string; agent: AgentRole }[] }
  | { id: string; kind: "card"; card: Card; answered?: string }
  | { id: string; kind: "error"; text: string };

export interface AgendaItem {
  id: string;
  name: string;
  auto: boolean;
}

const LEVEL = ["无", "基础", "熟练", "精通"];

export function Chat({
  items, busy, onSend, disabled, agenda, suggestions, refs = [], onJd, jdMissing,
}: {
  refs?: WebRef[];
  onJd?: () => void;
  jdMissing?: boolean;
  items: ChatItem[];
  busy: boolean;
  onSend: (text: string, calibration?: { id: string; verdict: Verdict }[]) => void;
  disabled?: boolean;
  agenda: AgendaItem[];
  suggestions: Suggestion[];
}) {
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items, busy]);

  const lastCardIdx = items.map((i) => i.kind).lastIndexOf("card");
  const asked = agenda.filter((a) => !a.auto);
  const stepOf = (dim: string) => {
    const i = asked.findIndex((a) => a.id === dim);
    return i >= 0 ? `第 ${i + 1} / ${asked.length} 步 · ${asked[i].name}` : "补充确认";
  };

  const send = (t: string, cal?: { id: string; verdict: Verdict }[]) => {
    const v = t.trim();
    if (!v || busy) return;
    onSend(v, cal);
    setText("");
  };
  const groupIds = items.filter((i) => i.kind === "card" && i.card.kind === "group" && !i.card.repeat).map((i) => i.id);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-7 py-6">
        <div className="mx-auto max-w-[720px] space-y-4">
          {items.map((it, idx) => {
            if (it.kind === "user")
              return (
                <div key={it.id} className="rise flex justify-end">
                  <div className="max-w-[78%] whitespace-pre-wrap rounded-[20px] rounded-br-[6px] bg-gradient-to-b from-[#2a8bff] to-accent px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-[0_6px_18px_-8px_rgba(0,113,227,.6)]">{it.text}</div>
                </div>
              );
            if (it.kind === "assistant")
              return (
                <div key={it.id} className="rise flex gap-3">
                  <Avatar />
                  <div className="glass-strong max-w-[84%] rounded-[20px] rounded-tl-[6px] px-4 py-2.5 text-[14px] leading-relaxed text-ink">
                    <div className="whitespace-pre-wrap">{rich(it.text, refs)}</div>
                    <Sources text={it.text} refs={refs} />
                  </div>
                </div>
              );
            if (it.kind === "activity") return <ActivityLog key={it.id} lines={it.lines} live={busy && idx === items.length - 1} />;
            if (it.kind === "error")
              return <div key={it.id} className="glass-strong rounded-2xl px-4 py-2.5 text-sm text-bad">{it.text}</div>;
            const active = idx === lastCardIdx && !it.answered && !busy && !disabled;
            const step = stepOf(it.card.dimension_id);
            if (it.card.kind === "deck") return <DeckView key={it.id} card={it.card} active={active} answered={it.answered} onSubmit={send} />;
            if (it.card.kind === "group") {
              const n = groupIds.indexOf(it.id);
              return <GroupView key={it.id} card={it.card} step={n >= 0 ? `第 ${n + 1} 组 · ${it.card.title}` : it.card.title} active={active} answered={it.answered} onSubmit={send} />;
            }
            return it.card.kind === "choice" ? (
              <ChoiceView key={it.id} card={it.card} step={step} active={active} answered={it.answered} onPick={send} />
            ) : (
              <AbView key={it.id} card={it.card} step={step} active={active} answered={it.answered} onPick={send} />
            );
          })}
          {busy && items[items.length - 1]?.kind !== "activity" && (
            <div className="flex items-center gap-3 pl-11">
              <div className="typing glass-strong flex gap-1 rounded-full px-3 py-2">
                {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-ink-3" />)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-7 pb-5 pt-2">
        <div className="mx-auto max-w-[720px]">
          {!busy && !disabled && suggestions.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-ink-3">试试这样说：</span>
              {suggestions.map((s) => (
                <button key={s.text} onClick={() => send(s.text)} title={KIND_META[s.kind].label} className={cx("glass flex items-center gap-1 rounded-full px-3 py-1 text-[12px] transition hover:text-accent", s.kind === "search" ? "text-[#8944ab]" : "text-ink-2")}>
                  <span>{KIND_META[s.kind].icon}</span>{s.text}
                </button>
              ))}
            </div>
          )}
          <div className="glass-strong flex items-end gap-2 rounded-[24px] p-1.5 pl-2">
            {onJd && (
              <button onClick={onJd} disabled={busy} title={jdMissing ? "还没有 JD：粘贴或上传截图" : "替换 JD"}
                className={cx("relative flex h-[38px] shrink-0 items-center gap-1 rounded-full px-3 text-[12px] transition disabled:opacity-40", jdMissing ? "bg-accent/10 text-accent hover:bg-accent/15" : "glass-tint text-ink-2 hover:text-ink")}>
                📎 JD
                {jdMissing && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#ff3b30]" />}
              </button>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(text);
                }
              }}
              rows={1}
              disabled={disabled}
              placeholder="回答、补充、反驳，或让我联网搜一下岗位信息…（Enter 发送）"
              className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent py-2 text-[14px] outline-none placeholder:text-ink-4"
            />
            <button
              onClick={() => send(text)}
              disabled={busy || !text.trim() || disabled}
              className="btn-primary flex h-[38px] w-[38px] items-center justify-center rounded-full transition"
              aria-label="发送"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[conic-gradient(from_200deg,#5ac8fa,#0071e3,#af52de,#5ac8fa)] p-[2px]">
      <div className="flex h-full w-full items-center justify-center rounded-full bg-white/85 text-[11px] font-semibold text-accent">AI</div>
    </div>
  );
}

function ActivityLog({ lines, live }: { lines: { text: string; agent: AgentRole }[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = open || live ? lines : lines.slice(-1);
  return (
    <div className="rise ml-11">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-[12px] text-ink-3 transition hover:text-ink-2">
        {live ? <Spinner /> : <span className="text-[10px]">●</span>}
        {live ? "Agent 正在工作" : `Agent 完成了 ${lines.length} 步`}
        {!live && lines.length > 1 && <span className={cx("transition", open && "rotate-90")}>›</span>}
      </button>
      <ol className="mt-1 space-y-0.5 border-l hairline pl-3">
        {shown.map((l, i) => (
          <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-ink-3">
            <span className="shrink-0 font-medium" style={{ color: AGENTS[l.agent]?.color }}>{AGENTS[l.agent]?.name.replace("主控 · ", "")}</span>
            <span>{l.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Why({ text }: { text: string }) {
  return (
    <div className="mt-2.5 rounded-2xl bg-[#ff9f0a]/8 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-2">
      <span className="font-medium text-warn">为什么问这个　</span>{text}
    </div>
  );
}

function CardShell({ children, answered, step, tag }: { children: React.ReactNode; answered?: string; step: string; tag?: string }) {
  return (
    <div className={cx("rise ml-11 rounded-[24px] p-5 transition", answered ? "glass opacity-80" : "glass-strong")}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-medium tracking-wide text-accent">{step}</span>
        {tag && <Pill>{tag}</Pill>}
      </div>
      {children}
      {answered && <div className="mt-3 text-[12px] text-good">✓ {answered}</div>}
    </div>
  );
}

function ChoiceView({ card, active, answered, onPick, step }: { card: ChoiceCard; active: boolean; answered?: string; onPick: (t: string) => void; step: string }) {
  return (
    <CardShell answered={answered} step={step} tag={card.repeat ? "回到刚才的问题" : undefined}>
      <div className="text-[16px] font-semibold tracking-tight text-ink">{card.question}</div>
      <Why text={card.why} />
      <div className="mt-3 space-y-2">
        {card.options.map((o) => {
          const picked = answered?.includes(`${o.key}：`);
          return (
            <button
              key={o.key}
              disabled={!active}
              onClick={() => onPick(`选 ${o.key}：${o.label}`)}
              className={cx(
                "group flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition",
                picked ? "bg-accent/10 ring-1 ring-accent/40" : active ? "glass-tint hover:bg-accent/8 hover:ring-1 hover:ring-accent/30" : "glass-tint opacity-60",
              )}
            >
              <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold", picked ? "bg-accent text-white" : "bg-white/80 text-ink-2")}>{o.key}</span>
              <span className="flex-1">
                <span className="block text-[14px] text-ink">{o.label}</span>
                {o.detail && <span className="block text-[12px] text-ink-3">{o.detail}</span>}
              </span>
              {active && <span className="text-ink-4 transition group-hover:translate-x-0.5 group-hover:text-accent">›</span>}
            </button>
          );
        })}
      </div>
      {active && <UnsureButton onPick={onPick} />}
    </CardShell>
  );
}

function UnsureButton({ onPick }: { onPick: (t: string) => void }) {
  return (
    <button onClick={() => onPick("我还不确定，能不能给我看看具体的人？")} className="mt-3 rounded-full px-1 text-[12px] text-ink-3 transition hover:text-accent">
      我还不确定，给我看看具体的人 →
    </button>
  );
}

function AbView({ card, active, answered, onPick, step }: { card: AbCard; active: boolean; answered?: string; onPick: (t: string) => void; step: string }) {
  return (
    <CardShell answered={answered} step={step} tag={card.repeat ? "回到刚才的对比" : "真人对比 · 内部人才库"}>
      <div className="text-[16px] font-semibold tracking-tight text-ink">{card.question}</div>
      <Why text={card.why} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        {(["a", "b"] as const).map((side) => {
          const s = card[side];
          const picked = answered?.includes(s.label);
          return (
            <div key={side} className={cx("flex flex-col rounded-[20px] p-3.5 transition", picked ? "bg-accent/10 ring-1 ring-accent/40" : "bg-white/60 ring-1 ring-black/5")}>
              <div className="text-[11px] font-medium text-accent">{side.toUpperCase()} · {s.label}</div>
              <CandidateBody c={s.candidate} />
              <button
                disabled={!active}
                onClick={() => onPick(`我选 ${side.toUpperCase()}：${s.label}（${s.candidate.name}）`)}
                className="btn-primary mt-3 rounded-full py-2 text-[13px] font-medium transition"
              >
                约 TA 面试
              </button>
            </div>
          );
        })}
      </div>
      {active && <UnsureButton onPick={onPick} />}
    </CardShell>
  );
}

function CandidateBody({ c }: { c: Candidate }) {
  return (
    <div className="mt-1.5 flex-1">
      <div className="text-[15px] font-semibold text-ink">{c.name} <span className="text-[13px] font-normal text-ink-3">· {c.years} 年</span></div>
      <div className="text-[12px] text-ink-3">{c.current}</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {[`${c.school} ${c.degree} · ${c.major}`, c.background, ...topSkills(c), ...c.industries.slice(0, 2), `期望 ${c.expected_salary}k`].map((t) => (
          <Pill key={t}>{t}</Pill>
        ))}
      </div>
      <ul className="mt-2 space-y-1">
        {c.highlights.map((h) => (
          <li key={h} className="text-[12px] leading-relaxed text-ink-2">· {h}</li>
        ))}
      </ul>
    </div>
  );
}

export function topSkills(c: Candidate, n = 3) {
  return Object.entries(c.skills ?? {})
    .filter(([, v]) => v >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ${LEVEL[v]}`);
}

const VERDICTS: { v: Verdict; label: string; on: string }[] = [
  { v: "想聊", label: "想聊", on: "bg-[#34c759] text-white" },
  { v: "说不好", label: "说不好", on: "bg-ink-3 text-white" },
  { v: "不想聊", label: "不想聊", on: "bg-[#ff3b30] text-white" },
];

function DeckView({ card, active, answered, onSubmit }: { card: DeckCard; active: boolean; answered?: string; onSubmit: (t: string, cal?: { id: string; verdict: Verdict }[]) => void }) {
  const [picks, setPicks] = useState<Record<string, Verdict>>({});
  const done = Object.keys(picks).length;
  const total = card.candidates.length;
  const submit = () => {
    const list = card.candidates.filter((c) => picks[c.id]).map((c) => ({ id: c.id, verdict: picks[c.id] }));
    const count = (v: Verdict) => list.filter((x) => x.verdict === v).length;
    onSubmit(`【快速校准】想聊 ${count("想聊")} 位 · 不想聊 ${count("不想聊")} 位 · 说不好 ${count("说不好")} 位`, list);
  };
  return (
    <CardShell answered={answered} step="先看人 · 快速校准" tag="内部人才库 · 8 位差异最大的人">
      <div className="text-[16px] font-semibold tracking-tight text-ink">{card.title}</div>
      <Why text={card.why} />
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {card.candidates.map((c) => {
          const v = picks[c.id];
          return (
            <div key={c.id} className={cx("flex flex-col rounded-[18px] p-3 ring-1 transition", v === "想聊" ? "bg-[#34c759]/8 ring-[#34c759]/40" : v === "不想聊" ? "bg-[#ff3b30]/6 ring-[#ff3b30]/30" : v ? "bg-black/[.03] ring-black/10" : "bg-white/60 ring-black/5")}>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[14px] font-semibold text-ink">{c.name}</span>
                <span className="text-[12px] text-ink-3">{c.years} 年 · 期望 {c.expected_salary}k</span>
              </div>
              <div className="truncate text-[11px] text-ink-3">{c.current}</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {[c.background, `${c.school} ${c.degree}`, ...topSkills(c, 2)].map((t) => <Pill key={t}>{t}</Pill>)}
              </div>
              <div className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-ink-2">{c.highlights[0]}</div>
              <div className="mt-2 flex gap-1">
                {VERDICTS.map((x) => (
                  <button key={x.v} disabled={!active} onClick={() => setPicks((p) => ({ ...p, [c.id]: x.v }))}
                    className={cx("flex-1 rounded-full py-1 text-[12px] transition", v === x.v ? x.on : "glass-tint text-ink-2 hover:text-ink", !active && "opacity-60")}>
                    {x.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {active && (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-[12px] text-ink-3">已标 {done}/{total}，凭第一直觉就好</span>
          <button onClick={submit} disabled={done < Math.min(5, total)} className="btn-primary ml-auto rounded-full px-5 py-2 text-[13px] font-medium">
            {done < total ? `先提交这 ${done} 位` : "提交"}
          </button>
        </div>
      )}
    </CardShell>
  );
}

function GroupView({ card, active, answered, onSubmit, step }: { card: GroupCard; active: boolean; answered?: string; onSubmit: (t: string) => void; step: string }) {
  const [sel, setSel] = useState<Record<number, string>>({});
  const all = card.questions.every((_, i) => sel[i]);
  const submit = () => {
    const lines = card.questions.map((q, i) => {
      const k = sel[i];
      const o = q.options.find((x) => x.key === k);
      return `${i + 1}. ${q.question.replace(/[？?]$/, "")}：${k === "?" ? "我还不确定" : `选 ${k}：${o?.label ?? ""}`}`;
    });
    onSubmit(`【${card.title}】\n${lines.join("\n")}`);
  };
  return (
    <CardShell answered={answered} step={step} tag={card.repeat ? "回到刚才的问题" : `${card.questions.length} 题一起答`}>
      <Why text={card.why} />
      <div className="mt-3 space-y-4">
        {card.questions.map((q, i) => (
          <div key={i}>
            <div className="mb-1.5 text-[14px] font-semibold text-ink">{i + 1}. {q.question}</div>
            <div className="flex flex-wrap gap-1.5">
              {[...q.options, { key: "?", label: "不确定" }].map((o) => {
                const on = sel[i] === o.key || (!!answered && answered.includes(`${i + 1}.`) && answered.split("\n").find((l) => l.startsWith(`${i + 1}.`))?.includes(o.key === "?" ? "不确定" : `选 ${o.key}：`));
                return (
                  <button key={o.key} disabled={!active} onClick={() => setSel((s) => ({ ...s, [i]: o.key }))}
                    className={cx("rounded-2xl px-3 py-2 text-left transition", on ? "bg-accent/12 ring-1 ring-accent/50" : active ? "glass-tint hover:bg-accent/8" : "glass-tint opacity-60", o.key === "?" && !on && "text-ink-3")}>
                    <span className="block text-[13px] text-ink">{o.key !== "?" && <span className="mr-1 font-semibold text-accent">{o.key}</span>}{o.label}</span>
                    {"detail" in o && o.detail && <span className="block text-[11px] text-ink-3">{o.detail}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {active && (
        <div className="mt-4 flex items-center gap-3">
          <span className="text-[12px] text-ink-3">拿不准的选「不确定」，我会单独拿真人给你对比</span>
          <button onClick={submit} disabled={!all} className="btn-primary ml-auto rounded-full px-5 py-2 text-[13px] font-medium">提交这一组</button>
        </div>
      )}
    </CardShell>
  );
}

// 只支持 **加粗** 和引用编号 [n]，其余保持纯文本
const CITE = /((?:\[\d+(?:\s*[,，、]\s*\d+)*\])+)/g;

function citedNumbers(text: string) {
  const out: number[] = [];
  for (const m of text.matchAll(CITE)) for (const n of m[0].match(/\d+/g) ?? []) if (!out.includes(+n)) out.push(+n);
  return out;
}

function rich(text: string, refs: WebRef[] = []) {
  return text.split(/(\*\*[^*]+\*\*)/g).flatMap((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return [<strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>];
    return part.split(CITE).map((seg, j) => {
      if (!/^\[\d/.test(seg)) return seg;
      const nums = (seg.match(/\d+/g) ?? []).map(Number);
      return (
        <span key={`${i}-${j}`} className="whitespace-nowrap">
          {nums.map((n) => {
            const r = refs.find((x) => x.ref === n);
            return r?.url ? (
              <a key={n} href={r.url} target="_blank" rel="noreferrer" title={`${r.title}${r.source ? ` · ${r.source}` : ""}${r.date ? ` · ${r.date}` : ""}`}
                className="mx-[1px] inline-flex h-[16px] min-w-[16px] -translate-y-[1px] items-center justify-center rounded-full bg-[#af52de]/12 px-1 align-middle text-[10px] font-semibold text-[#8944ab] no-underline hover:bg-[#af52de]/25">{n}</a>
            ) : (
              <span key={n} title={r ? r.title : "未找到对应来源"} className={cx("mx-[1px] inline-flex h-[16px] min-w-[16px] -translate-y-[1px] items-center justify-center rounded-full px-1 align-middle text-[10px] font-semibold", r ? "bg-[#af52de]/12 text-[#8944ab]" : "bg-[#ff3b30]/10 text-bad")}>{n}</span>
            );
          })}
        </span>
      );
    });
  });
}

function Sources({ text, refs }: { text: string; refs: WebRef[] }) {
  const list = citedNumbers(text).map((n) => refs.find((r) => r.ref === n)).filter(Boolean) as WebRef[];
  if (!list.length) return null;
  return (
    <div className="mt-2.5 border-t hairline pt-2">
      <div className="mb-1 text-[11px] text-ink-3">🔍 引用来源（真实网页，点击核实）</div>
      <ol className="space-y-0.5">
        {list.map((r) => (
          <li key={r.ref} className="flex gap-1.5 text-[12px] leading-relaxed">
            <span className="shrink-0 font-semibold text-[#8944ab]">[{r.ref}]</span>
            {r.url ? (
              <a href={r.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-accent hover:underline">{r.title || r.url}</a>
            ) : (
              <span className="min-w-0 truncate text-ink-2">{r.title}</span>
            )}
            <span className="shrink-0 text-ink-4">{[r.source || hostOf(r.url), r.date?.slice(0, 10)].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^(www|m)\./, "");
  } catch {
    return "";
  }
}
