"use client";

import { useState } from "react";
import type { BacktestResult, DatasetMeta, DeliverItem, Deliverables as D, FunnelResult } from "@/lib/types";
import { topSkills } from "./Chat";
import { Bar, cx, Pill } from "./ui";

const TABS = ["筛选标准卡", "HR 推荐候选人", "优化后的 JD", "漏斗与回测"] as const;

export function Deliverables({ d, meta }: { d: D; meta: DatasetMeta }) {
  const JOB_META = meta.job;
  const [tab, setTab] = useState<(typeof TABS)[number]>("筛选标准卡");
  const [confirmed, setConfirmed] = useState<string | null>(null);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1080px] px-6 pb-10 pt-4">
        <div className="glass relative overflow-hidden rounded-[30px] p-7">
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,#0a84ff33,transparent_70%)]" />
          <div className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-[radial-gradient(circle,#bf5af22a,transparent_70%)]" />
          <div className="text-[12px] text-ink-3">{JOB_META.department} · {JOB_META.title} · 用人经理 {JOB_META.manager}</div>
          <div className="mt-2 text-[26px] font-semibold leading-snug tracking-tight text-ink">{d.summary}</div>
          {d.risks && <div className="mt-2 inline-flex rounded-full bg-[#ff9f0a]/12 px-3 py-1 text-[12px] text-warn">经理已知悉的风险：{d.risks}</div>}
          <div className="mt-6 grid grid-cols-4 gap-3">
            <Kpi label="硬性要求" value={`${d.must.length}`} unit="条" />
            <Kpi label="已解决的冲突" value={`${d.resolved.length}`} unit="处" />
            <Kpi label="人才库满足" value={`${d.funnel.final}`} unit={`人 · ${d.funnel.ratio}%`} sub={`原 JD：${d.baseline_funnel.final} 人 · ${d.baseline_funnel.ratio}%`} />
            <Kpi label="回测一致率" value={`${d.backtest.agreement}`} unit="%" sub={`原 JD 口径：${d.baseline_backtest.agreement}%`} good={d.backtest.agreement >= 80} />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <div className="glass flex gap-1 rounded-full p-1">
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cx("rounded-full px-4 py-1.5 text-[13px] transition", tab === t ? "bg-white font-medium text-ink shadow-[0_2px_8px_-2px_rgba(0,0,0,.12)]" : "text-ink-2 hover:text-ink")}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => download(d, meta, confirmed)} className="glass rounded-full px-4 py-1.5 text-[13px] text-ink-2 transition hover:text-ink">导出 Markdown</button>
            {confirmed ? (
              <span className="rounded-full bg-[#34c759]/14 px-4 py-1.5 text-[13px] font-medium text-good">✓ {JOB_META.manager}已确认 · {confirmed}</span>
            ) : (
              <button onClick={() => setConfirmed(new Date().toLocaleString("zh-CN", { hour12: false }))} className="btn-primary rounded-full px-5 py-1.5 text-[13px] font-medium">
                确认并交给 HR
              </button>
            )}
          </div>
        </div>

        <div className="mt-4">
          {tab === "筛选标准卡" && <StandardCard d={d} />}
          {tab === "HR 推荐候选人" && <Recommended d={d} />}
          {tab === "优化后的 JD" && <JdView d={d} jd={meta.jd} />}
          {tab === "漏斗与回测" && <FunnelView d={d} />}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, unit, sub, good }: { label: string; value: string; unit?: string; sub?: string; good?: boolean }) {
  return (
    <div className="rounded-[20px] bg-white/55 px-4 py-3 ring-1 ring-black/[.03]">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className={cx("mt-0.5 text-[28px] font-semibold leading-tight tracking-tight tabular-nums", good ? "text-good" : "text-ink")}>
        {value}<span className="ml-1 text-[13px] font-medium text-ink-3">{unit}</span>
      </div>
      {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

function Section({ title, dot, children, hint }: { title: string; dot: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="glass rise rounded-[24px] p-5">
      <div className="mb-3 flex items-baseline gap-2">
        <span className={cx("h-2 w-2 rounded-full", dot)} />
        <h3 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
        {hint && <span className="text-[12px] text-ink-3">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function ItemList({ items, examples }: { items: DeliverItem[]; examples?: boolean }) {
  if (!items.length) return <div className="text-[13px] text-ink-3">无</div>;
  return (
    <ol className="space-y-2">
      {items.map((it, i) => (
        <li key={it.name} className="rounded-[18px] bg-white/60 px-4 py-3 ring-1 ring-black/[.03]">
          <div className="text-[14px] font-medium text-ink">{i + 1}. {it.final || it.name} <span className="ml-1 text-[12px] font-normal text-ink-3">{it.name}</span></div>
          {it.how_to_check && <div className="mt-1 text-[12px] text-ink-2"><span className="text-ink-3">判断方法　</span>{it.how_to_check}</div>}
          {examples && (it.positive || it.negative) && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
              {it.positive && <span className="text-good">✓ 正例：{it.positive}</span>}
              {it.negative && <span className="text-bad">✕ 反例：{it.negative}</span>}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function StandardCard({ d }: { d: D }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <Section title="硬性要求" dot="bg-ink" hint="必须全部满足 · 正反例来自人才库">
          <ItemList items={d.must} examples />
        </Section>
      </div>
      <Section title="加分项" dot="bg-accent" hint="用于排序">
        <ItemList items={d.plus} />
      </Section>
      <Section title="一票否决" dot="bg-[#ff3b30]">
        <ItemList items={d.veto} />
      </Section>
      <div className="col-span-2">
        <Section title="已解决的冲突" dot="bg-[#ff9f0a]" hint="原说法 → 最终口径 → 依据">
          <div className="divide-y divide-black/5">
            {d.resolved.map((r) => (
              <div key={r.name} className="grid grid-cols-[130px_1fr_1fr] gap-4 py-3 text-[13px]">
                <div className="font-medium text-ink">{r.name}</div>
                <div className="text-[12px] leading-relaxed text-ink-3 line-through decoration-black/20">{r.before}</div>
                <div>
                  <div className="text-ink">{r.after}</div>
                  {r.rationale && <div className="mt-0.5 text-[12px] text-ink-3">理由：{r.rationale}</div>}
                  {r.decided_by && <div className="mt-0.5 text-[12px] text-accent">依据：{r.decided_by}</div>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
      {d.pending.length > 0 && (
        <div className="col-span-2">
          <Section title="待面试验证" dot="bg-[#5ac8fa]">
            <ul className="space-y-2 text-[13px]">
              {d.pending.map((p) => (
                <li key={p.name}><span className="font-medium">{p.name}</span><span className="text-ink-2"> — {p.question}</span></li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </div>
  );
}

function Recommended({ d }: { d: D }) {
  return (
    <Section title="按这套标准，HR 今天就能约的人" dot="bg-[#34c759]" hint={`从人才库 ${d.funnel.final} 位合格者中，按命中加分项排序`}>
      <div className="space-y-2">
        {d.recommended.map(({ candidate: c, plus_hits }, i) => (
          <div key={c.id} className="flex items-start gap-4 rounded-[20px] bg-white/60 px-4 py-3.5 ring-1 ring-black/[.03]">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#2a8bff] to-accent text-[13px] font-semibold text-white">{i + 1}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[15px] font-semibold text-ink">{c.name}</span>
                <span className="text-[12px] text-ink-3">{c.years} 年 · {c.current}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {[`${c.school} ${c.degree} · ${c.major}`, c.background, ...topSkills(c), ...c.industries.slice(0, 2), `期望 ${c.expected_salary}k`].map((t) => <Pill key={t}>{t}</Pill>)}
              </div>
              <div className="mt-1.5 text-[12px] text-ink-2">{c.highlights[0]}</div>
            </div>
            <div className="w-[220px] shrink-0 text-right">
              <div className="text-[11px] text-ink-3">硬性全部满足 · 命中加分 {plus_hits.length} 项</div>
              <div className="mt-1 flex flex-wrap justify-end gap-1">
                {plus_hits.map((p) => <span key={p} className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">{p}</span>)}
              </div>
            </div>
          </div>
        ))}
        {!d.recommended.length && <div className="text-[13px] text-ink-3">人才库中暂无完全满足硬性要求的人，建议参考漏斗里的放宽建议。</div>}
      </div>
    </Section>
  );
}

function JdView({ d, jd }: { d: D; jd: string }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Section title="原 JD" dot="bg-ink-4">
        <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-3">{jd}</pre>
      </Section>
      <Section title={`优化后 · ${d.jd.title}`} dot="bg-[#34c759]">
        <div className="space-y-4">
          {d.jd.sections.map((s) => (
            <div key={s.heading}>
              <div className="text-[13px] font-semibold text-ink">{s.heading}</div>
              <ol className="mt-1 space-y-1">
                {s.items.map((it, i) => <li key={i} className="text-[13px] leading-relaxed text-ink-2">{i + 1}. {it}</li>)}
              </ol>
            </div>
          ))}
        </div>
      </Section>
      <div className="col-span-2">
        <Section title="关键改动" dot="bg-[#ff9f0a]" hint="每一处都能追溯到经理的选择或数据证据">
          <div className="divide-y divide-black/5">
            {d.jd_changes.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1.2fr] gap-4 py-2.5 text-[13px]">
                <div className="text-ink-3 line-through decoration-black/20">{c.before}</div>
                <div className="text-ink">{c.after}</div>
                <div className="text-[12px] leading-relaxed text-ink-3">{c.reason}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function FunnelCol({ title, f, tone }: { title: string; f: FunnelResult; tone: "accent" | "muted" }) {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-ink-2">{title}</span>
        <span className="text-[15px] font-semibold tabular-nums text-ink">{f.final} 人 · {f.ratio}%</span>
      </div>
      <div className="space-y-2">
        {f.steps.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_130px_30px] items-center gap-2 text-[12px] text-ink-2">
            <span className="truncate" title={s.label}>{s.label}</span>
            <Bar value={s.remaining} max={f.total} tone={tone} />
            <span className="text-right tabular-nums">{s.remaining}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BacktestTable({ title, b }: { title: string; b: BacktestResult }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-ink-2">{title}</span>
        <span className={cx("text-[22px] font-semibold tabular-nums", b.agreement >= 80 ? "text-good" : "text-bad")}>{b.agreement}%</span>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-ink-3">
            <th className="py-1 font-normal">历史记录</th>
            <th className="py-1 font-normal">实际结果</th>
            <th className="py-1 font-normal">标准判断</th>
            <th className="py-1 font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {b.rows.map((r) => (
            <tr key={r.id} className="border-t border-black/5" title={r.note}>
              <td className="py-1.5 text-ink">{r.name}</td>
              <td className="py-1.5 text-ink-2">{r.actual}</td>
              <td className="py-1.5 text-ink-2">{r.predicted_pass ? "通过" : `不通过${r.failed_on[0] ? `（${r.failed_on[0]}）` : ""}`}</td>
              <td className="py-1.5 text-right">{r.match ? <span className="text-good">✓</span> : <span className="text-bad">✕</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FunnelView({ d }: { d: D }) {
  return (
    <div className="space-y-4">
      <Section title="人才库漏斗" dot="bg-accent" hint={`人才库 ${d.funnel.total} 人 · 数字由代码在人才库上实际计算`}>
        <div className="grid grid-cols-2 gap-10">
          <FunnelCol title="原 JD 口径" f={d.baseline_funnel} tone="muted" />
          <FunnelCol title="澄清后标准" f={d.funnel} tone="accent" />
        </div>
        {d.funnel.relax.length > 0 && (
          <div className="mt-4 rounded-2xl glass-tint px-4 py-2.5 text-[12px] text-ink-2">
            若需扩大人才池：{d.funnel.relax.map((r) => `放宽「${r.label}」可多 ${r.gain} 人`).join("；")}
          </div>
        )}
      </Section>
      <Section title="回测：标准 vs 经理过往的真实判断" dot="bg-[#34c759]" hint="录用且表现合格以上应通过；试用期淘汰 / 面试未通过应不通过">
        <div className="grid grid-cols-2 gap-10">
          <BacktestTable title="原 JD 口径" b={d.baseline_backtest} />
          <BacktestTable title="澄清后标准" b={d.backtest} />
        </div>
      </Section>
    </div>
  );
}

function download(d: D, meta: DatasetMeta, confirmed: string | null) {
  const JOB_META = meta.job;
  const li = (xs: DeliverItem[]) => xs.map((x, i) => `${i + 1}. **${x.final || x.name}**${x.how_to_check ? `\n   - 判断方法：${x.how_to_check}` : ""}${x.positive ? `\n   - 正例：${x.positive}` : ""}${x.negative ? `\n   - 反例：${x.negative}` : ""}`).join("\n");
  const md = `# ${JOB_META.title} · 人才画像与筛选标准

> ${d.summary}
>
> ${JOB_META.department} · 用人经理 ${JOB_META.manager}${confirmed ? ` · 已确认 ${confirmed}` : " · 待确认"}

## 硬性要求
${li(d.must)}

## 加分项
${li(d.plus)}

## 一票否决
${li(d.veto) || "无"}

## 已解决的冲突
| 维度 | 原说法 | 最终口径 | 理由 / 依据 |
|---|---|---|---|
${d.resolved.map((r) => `| ${r.name} | ${r.before} | ${r.after} | ${r.rationale} / ${r.decided_by} |`).join("\n")}
${d.pending.length ? `\n## 待面试验证\n${d.pending.map((p) => `- **${p.name}**：${p.question}`).join("\n")}\n` : ""}
## HR 推荐候选人
${d.recommended.map((r, i) => `${i + 1}. ${r.candidate.name}（${r.candidate.years} 年 · ${r.candidate.current}）— 命中加分：${r.plus_hits.join("、") || "无"}`).join("\n")}

## 优化后的 JD：${d.jd.title}
${d.jd.sections.map((s) => `### ${s.heading}\n${s.items.map((x, i) => `${i + 1}. ${x}`).join("\n")}`).join("\n\n")}

## 人才库漏斗
- 原 JD 口径：${d.baseline_funnel.final} / ${d.baseline_funnel.total} 人（${d.baseline_funnel.ratio}%）
- 澄清后标准：${d.funnel.final} / ${d.funnel.total} 人（${d.funnel.ratio}%）

## 回测一致率
- 原 JD 口径：${d.baseline_backtest.agreement}%
- 澄清后标准：${d.backtest.agreement}%
`;
  const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${JOB_META.title}-筛选标准.md`;
  a.click();
  URL.revokeObjectURL(url);
}
