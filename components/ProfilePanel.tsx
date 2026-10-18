"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentRole, Dimension, MarketData, SessionState } from "@/lib/types";
import { AGENT_ORDER, agentModel, AGENTS, type AgentStat } from "./agents";
import type { AgendaItem } from "./Chat";
import { Bar, cx, LevelChip, StatusChip } from "./ui";

// 引导式自动看板：议程 → 数据来源 → 市场快照 → 画像维度 → 漏斗，随 Agent 工作逐步点亮
export function ProfilePanel({
  state, agenda, current, web, agents, activeAgent, models, onJd,
}: {
  onJd?: () => void; state: SessionState; agenda: AgendaItem[]; current?: string[]; web: boolean; agents: Partial<Record<AgentRole, AgentStat>>; activeAgent?: AgentRole; models?: { main?: string | null; vision?: string | null; search?: string | null; fast?: string | null } }) {
  const meta = state.meta;
  const dims = state.dimensions;
  const done = dims.filter((d) => d.status !== "冲突" && d.status !== "含糊").length;
  const progress = dims.length ? Math.round((done / dims.length) * 100) : 0;
  const anyClarified = dims.some((d) => d.status === "已澄清");

  const prev = useRef<Record<string, string>>({});
  const [changed, setChanged] = useState<Set<string>>(new Set());
  useEffect(() => {
    const next: Record<string, string> = {};
    const diff = new Set<string>();
    const first = !Object.keys(prev.current).length;
    for (const d of dims) {
      const sig = JSON.stringify(d);
      next[d.id] = sig;
      if (!first && prev.current[d.id] !== sig) diff.add(d.id);
    }
    prev.current = next;
    if (diff.size) setChanged(diff);
  }, [dims]);

  return (
    <aside className="scroll-thin h-full space-y-3 overflow-y-auto p-4">
      {/* 概览 */}
      <Panel>
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight">实时看板</h2>
          <span className="text-[11px] text-ink-3">{state.phase}阶段</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Metric label="澄清进度" value={dims.length ? `${progress}%` : "—"} sub={dims.length ? `${done}/${dims.length} 维度` : "准备中"} />
          <Metric label="人才库满足" value={state.funnel && anyClarified ? `${state.funnel.final}` : "—"} unit={state.funnel && anyClarified ? "人" : ""} sub={state.baseline_funnel ? `原 JD ${state.baseline_funnel.final} 人` : ""} />
          <Metric
            label="回测一致率"
            value={state.backtest && anyClarified ? `${state.backtest.agreement}` : "—"}
            unit={state.backtest && anyClarified ? "%" : ""}
            sub={state.baseline_backtest ? `原 JD ${state.baseline_backtest.agreement}%` : ""}
            good={anyClarified && !!state.backtest && state.backtest.agreement >= 80}
          />
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-3">
          <span>问题预算</span>
          <div className="flex flex-1 gap-1">
            {Array.from({ length: state.question_budget }).map((_, i) => (
              <span key={i} className={cx("h-1 flex-1 rounded-full transition", i < state.questions_asked ? "bg-accent" : "bg-[rgba(120,120,128,.16)]")} />
            ))}
          </div>
          <span className="tabular-nums">{state.questions_asked}/{state.question_budget}</span>
        </div>
      </Panel>

      {/* 当前 JD：校准对象 */}
      <Panel title="当前 JD" hint="这次要校准的对象">
        {(() => {
          const src = state.jd_override?.source ?? state.meta?.jd_source;
          const jd = state.jd_override?.text ?? state.meta?.jd;
          const own = src === "用户粘贴" || src === "截图识别";
          return (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <span className={cx("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", own ? "bg-[#34c759]/12 text-good" : jd ? "bg-[#ff9f0a]/14 text-warn" : "glass-tint text-ink-3")}>
                  {own ? `你提供的 · ${src}` : jd ? "公司模板 JD（你还没提供）" : "还没有 JD"}
                </span>
                {jd && <div className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-ink-3">{jd.replace(/\s+/g, " ").slice(0, 120)}</div>}
              </div>
              {onJd && (
                <button onClick={onJd} className={cx("shrink-0 rounded-full px-3 py-1 text-[12px] transition", own ? "glass-tint text-ink-2 hover:text-ink" : "btn-primary")}>
                  {own ? "替换" : "📎 上传 JD"}
                </button>
              )}
            </div>
          );
        })()}
      </Panel>

      {/* Agent 协作 */}
      <Panel title="Agent 协作" hint="谁在做什么">
        <div className="space-y-1">
          {AGENT_ORDER.map((r) => {
            const st = agents[r];
            const on = activeAgent === r;
            return (
              <div key={r} className={cx("flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition", on && "bg-white/70 ring-1 ring-black/[.04]")}>
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  {on && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: AGENTS[r].color }} />}
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: st || on ? AGENTS[r].color : "rgba(120,120,128,.25)" }} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className={cx("text-[12px] font-medium", st || on ? "text-ink" : "text-ink-3")}>{AGENTS[r].name}</span>
                    {st && <span className="text-[10px] tabular-nums text-ink-4">{st.count} 步</span>}
                    {agentModel(r, models) && <span className="ml-auto rounded-full glass-tint px-1.5 py-[1px] text-[9px] text-ink-3">{agentModel(r, models)}</span>}
                  </div>
                  <div className="truncate text-[11px] text-ink-3">{st?.last ?? AGENTS[r].desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* 快速校准结果 */}
      {state.calibration && (
        <Panel title="你的直觉偏好" hint="来自快速校准 · 代码统计">
          <ul className="space-y-1.5">
            {state.calibration.findings.map((f) => <li key={f} className="text-[12px] leading-relaxed text-ink-2">· {f}</li>)}
          </ul>
        </Panel>
      )}

      {/* 澄清议程 */}
      <Panel title="澄清议程" hint="按影响从高到低">
        {!agenda.length ? (
          <Empty text="Agent 读完资料后会排出议程" />
        ) : (
          <ol className="space-y-0.5">
            {agenda.map((a, i) => {
              const d = dims.find((x) => x.id === a.id);
              const ok = d && d.status !== "冲突" && d.status !== "含糊";
              const now = !!current?.includes(a.id) && !ok;
              return (
                <li key={a.id} className={cx("flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition", now && "bg-accent/8")}>
                  <span className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                    ok ? "bg-[#34c759] text-white" : now ? "bg-accent text-white" : "bg-[rgba(120,120,128,.14)] text-ink-3")}>
                    {ok ? "✓" : i + 1}
                  </span>
                  <span className={cx("flex-1 truncate text-[13px]", ok ? "text-ink-3" : "text-ink")}>{d?.name ?? a.name}</span>
                  {a.auto && !ok && <span className="text-[10px] text-ink-4">Agent 自动处理</span>}
                  {now && <span className="text-[10px] font-medium text-accent">进行中</span>}
                  {ok && d?.final && <span className="max-w-[45%] truncate text-[11px] text-ink-3">{d.final}</span>}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      {/* 数据来源 */}
      <Panel title="数据来源" hint="内部 + 外部">
        <div className="grid grid-cols-2 gap-2">
          <Source on={!!state.sources_used?.includes("job")} name="岗位与预算" desc="内部 · HC 系统" />
          <Source on={!!state.sources_used?.includes("history")} name="经理历史招聘" desc={`内部 · ${meta ? meta.counts.history_hired + meta.counts.history_rejected : "-"} 条记录`} />
          <Source on={!!state.sources_used?.includes("similar")} name="同类岗位画像" desc="内部 · 近 12 个月" />
          <Source on={!!state.sources_used?.includes("pool")} name="人才库" desc={`内部 · ${meta?.counts.pool ?? "-"} 人`} />
          <Source on={!!state.sources_used?.includes("market")} name="招聘市场行情" desc="外部 · 模拟数据" external />
          <Source on={!!state.sources_used?.includes("web")} name="联网搜索" desc={web ? `外部 · 真实网页 · ${models?.search ?? ""}` : "外部 · 未配置"} external off={!web} />
        </div>
      </Panel>

      {/* 市场快照 */}
      {!!state.market_topics?.length && meta && (
        <Panel title="外部市场快照" hint={`模拟数据 · ${meta.job.city}`}>
          {state.market_topics.includes("salary") && <SalaryChart market={meta.market} budget={meta.job.budget_max} />}
          {state.market_topics.includes("supply") && (
            <div className="mt-3 space-y-1.5">
              {meta.market.supply.items.map((s) => (
                <div key={s.segment} className="flex items-center justify-between text-[12px]">
                  <span className="text-ink-2">{s.segment}</span>
                  <span className={cx("tabular-nums", s.ratio < 1 ? "text-bad" : s.ratio < 2.5 ? "text-warn" : "text-good")}>{s.ratio}:1 · {s.label}</span>
                </div>
              ))}
            </div>
          )}
          {state.market_topics.includes("competition") && (
            <ul className="mt-3 space-y-1">{meta.market.competition.items.map((x) => <li key={x} className="text-[12px] text-ink-2">· {x}</li>)}</ul>
          )}
        </Panel>
      )}

      {/* 联网搜索结果（真实网页） */}
      {!!state.web_results?.length && (
        <Panel title="联网搜索 · 引用来源" hint={`编号与对话中的角标一致 · ${models?.search ?? ""}`}>
          <div className="space-y-3">
            {state.web_results.slice(-3).map((q) => (
              <div key={q.query}>
                <div className="mb-1 text-[11px] text-ink-3">🔍 {q.query}</div>
                <ul className="space-y-1.5">
                  {q.results.map((r) => (
                    <li key={r.url || r.title} className="rounded-xl bg-white/55 px-2.5 py-1.5 ring-1 ring-black/[.03]">
                      <div className="flex gap-1.5">
                        <span className="shrink-0 text-[11px] font-semibold text-[#8944ab]">[{r.ref}]</span>
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noreferrer" className="line-clamp-1 text-[12px] font-medium text-accent hover:underline">{r.title || r.url}</a>
                        ) : (
                          <div className="line-clamp-1 text-[12px] font-medium text-ink">{r.title}</div>
                        )}
                      </div>
                      <div className="line-clamp-2 text-[11px] leading-relaxed text-ink-3">{r.snippet}</div>
                      <div className="text-[10px] text-ink-4">{[r.source || host(r.url), r.date].filter(Boolean).join(" · ")}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* 画像维度 */}
      {!!dims.length && (
        <Panel title="人才画像" hint="交付物均由此生成">
          <div className="space-y-1.5">
            {[...dims].sort((a, b) => rank(a) - rank(b) || b.impact - a.impact).map((d) => <DimRow key={d.id} d={d} flash={changed.has(d.id)} />)}
          </div>
        </Panel>
      )}

      {/* 漏斗 */}
      {state.funnel && state.funnel.steps.length > 1 && anyClarified && (
        <Panel title="硬性条件漏斗" hint="代码在人才库上实时计算">
          <div className="space-y-2">
            {state.funnel.steps.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_96px_28px] items-center gap-2 text-[11px] text-ink-2">
                <span className="truncate" title={s.label}>{s.label}</span>
                <Bar value={s.remaining} max={state.funnel!.total} />
                <span className="text-right tabular-nums">{s.remaining}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </aside>
  );
}

const rank = (d: Dimension) => ({ 冲突: 0, 含糊: 1, 待面试验证: 2, 已澄清: 3, 明确: 3 })[d.status];

function Panel({ title, hint, children }: { title?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="glass rise rounded-[22px] p-4">
      {title && (
        <div className="mb-2.5 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
          {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl glass-tint px-3 py-4 text-center text-[12px] text-ink-3">{text}</div>;
}

function Metric({ label, value, unit, sub, good }: { label: string; value: string; unit?: string; sub?: string; good?: boolean }) {
  return (
    <div className="rounded-2xl bg-white/55 px-3 py-2.5 ring-1 ring-black/[.03]">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className={cx("mt-0.5 text-[22px] font-semibold leading-tight tracking-tight tabular-nums", good ? "text-good" : "text-ink")}>
        {value}<span className="ml-0.5 text-[12px] font-medium text-ink-3">{unit}</span>
      </div>
      <div className="truncate text-[10px] text-ink-3">{sub}</div>
    </div>
  );
}

function Source({ on, name, desc, external, off }: { on: boolean; name: string; desc: string; external?: boolean; off?: boolean }) {
  return (
    <div className={cx("flex items-center gap-2 rounded-2xl px-2.5 py-2 transition", on ? "bg-white/70 ring-1 ring-black/[.04]" : "glass-tint")}>
      <span className={cx("h-2 w-2 shrink-0 rounded-full transition", on ? (external ? "bg-[#af52de]" : "bg-[#34c759]") : off ? "bg-ink-4/50" : "bg-ink-4")} />
      <div className="min-w-0">
        <div className={cx("truncate text-[12px]", on ? "text-ink" : "text-ink-3")}>{name}</div>
        <div className="truncate text-[10px] text-ink-3">{on ? `已读取 · ${desc.split(" · ")[0]}` : desc}</div>
      </div>
    </div>
  );
}

function SalaryChart({ market, budget }: { market: MarketData; budget: number }) {
  const max = Math.max(budget, ...market.salary.bands.map((b) => b.p75)) * 1.08 || 50;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-3">
        <span>月薪分位 P25–P75（k）</span>
        <span className="text-bad">┆ 预算上限 {budget}k</span>
      </div>
      <div className="relative space-y-2">
        {market.salary.bands.map((b) => (
          <div key={b.years} className="grid grid-cols-[56px_1fr_30px] items-center gap-2 text-[11px]">
            <span className="text-ink-2">{b.years}</span>
            <div className="relative h-2 rounded-full bg-[rgba(120,120,128,.12)]">
              <div className="absolute h-2 rounded-full bg-gradient-to-r from-[#bf5af2] to-[#5e5ce6] opacity-80" style={{ left: `${(b.p25 / max) * 100}%`, width: `${((b.p75 - b.p25) / max) * 100}%` }} />
              <div className="absolute top-[-2px] h-3 w-[2px] rounded bg-ink" style={{ left: `${(b.p50 / max) * 100}%` }} />
              <div className="absolute top-[-4px] h-4 border-l border-dashed border-bad" style={{ left: `${(budget / max) * 100}%` }} />
            </div>
            <span className="text-right tabular-nums text-ink-2">{b.p50}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DimRow({ d, flash }: { d: Dimension; flash: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx("rounded-2xl bg-white/55 ring-1 ring-black/[.03] transition", flash && "flash")}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className="flex-1 truncate text-[13px] font-medium text-ink">{d.name}</span>
        <LevelChip level={d.level} />
        <StatusChip status={d.status} />
      </button>
      {!open && (d.final || d.issue) && <div className="-mt-1 truncate px-3 pb-2 text-[11px] text-ink-3">{d.final ?? d.issue}</div>}
      {open && (
        <div className="space-y-1.5 border-t hairline px-3 py-2.5 text-[12px] text-ink-2">
          {d.sources.manager && <Src k="口述" v={d.sources.manager} />}
          {d.sources.jd && <Src k="JD" v={d.sources.jd} />}
          {d.sources.history && <Src k="数据" v={d.sources.history} />}
          {d.issue && <Src k="问题" v={d.issue} tone="text-bad" />}
          {d.final && <Src k="口径" v={d.final} tone="text-ink font-medium" />}
          {d.how_to_check && <Src k="判断" v={d.how_to_check} />}
          {d.rationale && <Src k="理由" v={d.rationale} />}
          {d.decided_by && <Src k="依据" v={d.decided_by} />}
        </div>
      )}
    </div>
  );
}

function Src({ k, v, tone = "" }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-7 shrink-0 text-ink-4">{k}</span>
      <span className={tone}>{v}</span>
    </div>
  );
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^(www|m)\./, "");
  } catch {
    return "";
  }
}
