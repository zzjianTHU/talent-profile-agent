// 确定性计算：筛选、漏斗、回测、自检、对照样本、推荐。LLM 不参与任何数字。
import type { BacktestResult, Candidate, Dataset, Dimension, Filter, FunnelResult, HistoryRecord, SessionState } from "./types";

const DEGREE_RANK: Record<string, number> = { 大专: 0, 本科: 1, 硕士: 2, 博士: 3 };
export const LEVEL_LABEL = ["无", "基础", "熟练", "精通"];

const FIELD_LABEL: Record<string, string> = {
  years: "工作年限",
  degree: "学历",
  school: "院校",
  major: "专业",
  background: "背景类型",
  industries: "行业经验",
  mgmt: "团队管理经验",
  mentor: "带新人经验",
  expected_salary: "期望月薪",
};

export const fieldLabel = (f: string) => (f.startsWith("skill:") ? f.slice(6) : FIELD_LABEL[f] ?? f);

function fieldValue(c: Candidate, f: string): unknown {
  if (f === "degree") return DEGREE_RANK[c.degree] ?? 1;
  if (f.startsWith("skill:")) return c.skills?.[f.slice(6)] ?? 0;
  return (c as unknown as Record<string, unknown>)[f];
}

export function matchFilter(c: Candidate, filter: Filter): boolean {
  let v = fieldValue(c, filter.field);
  let target = filter.value;
  if (filter.field === "degree" && typeof target === "string") target = DEGREE_RANK[target] ?? 1;
  const list = Array.isArray(target) ? target.map(String) : [String(target)];
  switch (filter.op) {
    case ">=":
      return Number(v) >= Number(target);
    case "<=":
      return Number(v) <= Number(target);
    case "=":
      if (typeof v === "boolean") return v === (target === true || target === "true");
      return String(v) === String(target);
    case "in":
      return list.includes(String(v));
    case "not_in":
      return !list.includes(String(v));
    case "any":
      if (Array.isArray(v)) return (v as unknown[]).map(String).some((x) => list.includes(x));
      return list.includes(String(v));
  }
  return true;
}

export function describeFilter(f: Filter): string {
  const label = fieldLabel(f.field);
  if (f.field.startsWith("skill:")) {
    const n = Number(f.value);
    return `${label} ${f.op === ">=" ? "≥" : f.op} ${LEVEL_LABEL[n] ?? n}`;
  }
  if (typeof f.value === "boolean" || f.value === "true" || f.value === "false") {
    return `${f.value === true || f.value === "true" ? "需要" : "不需要"}${label}`;
  }
  const val = Array.isArray(f.value) ? f.value.join(" / ") : f.value;
  const ops: Record<string, string> = { ">=": "≥", "<=": "≤", "=": "=", in: "属于", not_in: "不属于", any: "包含任一" };
  const unit = f.field === "years" ? " 年" : f.field === "expected_salary" ? "k" : "";
  return `${label} ${ops[f.op]} ${val}${unit}`;
}

export function activeFilters(dims: Dimension[], mode: "current" | "baseline") {
  const out: { dim: Dimension; filter: Filter }[] = [];
  for (const d of dims) {
    if (mode === "baseline") {
      for (const f of d.jd_filters ?? []) out.push({ dim: d, filter: f });
    } else if (d.level === "硬性" || d.level === "否决") {
      for (const f of d.filters ?? []) out.push({ dim: d, filter: f });
    }
  }
  return out;
}

export function runFunnel(dims: Dimension[], ds: Dataset, mode: "current" | "baseline" = "current"): FunnelResult {
  const pool = ds.pool;
  const filters = activeFilters(dims, mode);
  const steps = [{ label: "人才库全部", remaining: pool.length }];
  let rest = pool;
  for (const { filter } of filters) {
    rest = rest.filter((c) => matchFilter(c, filter));
    steps.push({ label: describeFilter(filter), remaining: rest.length });
  }
  const relax = filters
    .map(({ dim, filter }, i) => {
      const others = filters.filter((_, j) => j !== i);
      const n = pool.filter((c) => others.every((o) => matchFilter(c, o.filter))).length;
      return { dimension: dim.name, label: describeFilter(filter), gain: n - rest.length, final_if_removed: n };
    })
    .filter((r) => r.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 3);
  return { total: pool.length, steps, final: rest.length, ratio: pool.length ? Math.round((rest.length / pool.length) * 1000) / 10 : 0, relax };
}

export const shouldPass = (r: HistoryRecord) => r.kind === "录用" && (r.outcome === "优秀" || r.outcome === "合格");

export function runBacktest(dims: Dimension[], ds: Dataset, mode: "current" | "baseline" = "current"): BacktestResult {
  const filters = activeFilters(dims, mode);
  const rows = ds.history.map((r) => {
    const failed = filters.filter(({ filter }) => !matchFilter(r, filter)).map(({ filter }) => describeFilter(filter));
    const predicted = failed.length === 0;
    const expected = shouldPass(r);
    return {
      id: r.id, name: r.name,
      actual: r.kind === "录用" ? `录用 · ${r.outcome}` : "面试未通过",
      expected_pass: expected, predicted_pass: predicted, match: predicted === expected,
      failed_on: failed, note: r.note,
    };
  });
  const agreement = rows.length ? Math.round((rows.filter((r) => r.match).length / rows.length) * 100) : 0;
  return { agreement, rows };
}

export function recompute(state: SessionState, ds: Dataset): SessionState {
  return {
    ...state,
    funnel: runFunnel(state.dimensions, ds, "current"),
    baseline_funnel: runFunnel(state.dimensions, ds, "baseline"),
    backtest: runBacktest(state.dimensions, ds, "current"),
    baseline_backtest: runBacktest(state.dimensions, ds, "baseline"),
  };
}

// 阻断项必须解决才能交付；提醒项（漏斗、回测）告诉经理，经理接受后随交付物一起记录
export function selfCheck(state: SessionState, ds: Dataset) {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const dims = state.dimensions;
  const unresolved = dims.filter((d) => d.status === "冲突" || d.status === "含糊");
  if (unresolved.length) blocking.push(`仍有 ${unresolved.length} 个维度未澄清：${unresolved.map((d) => d.name).join("、")}`);
  const mustNoFilter = dims.filter((d) => (d.level === "硬性" || d.level === "否决") && !d.filters?.length && d.type === "硬事实");
  if (mustNoFilter.length) blocking.push(`硬事实类硬性条件缺少可执行筛选口径：${mustNoFilter.map((d) => d.name).join("、")}`);
  const mustNoCheck = dims.filter((d) => (d.level === "硬性" || d.level === "否决") && !d.how_to_check);
  if (mustNoCheck.length) blocking.push(`以下硬性 / 否决条件没写判断方法：${mustNoCheck.map((d) => d.name).join("、")}`);
  const byField = new Map<string, Filter[]>();
  for (const { filter } of activeFilters(dims, "current")) byField.set(filter.field, [...(byField.get(filter.field) ?? []), filter]);
  for (const [field, fs] of byField) {
    const lo = Math.max(...fs.filter((f) => f.op === ">=").map((f) => Number(f.value)), -Infinity);
    const hi = Math.min(...fs.filter((f) => f.op === "<=").map((f) => Number(f.value)), Infinity);
    if (lo > hi) blocking.push(`${fieldLabel(field)} 的下限 ${lo} 高于上限 ${hi}，条件互相矛盾`);
  }
  const s = recompute(state, ds);
  if (s.funnel!.ratio < 3) warnings.push(`漏斗过窄：仅剩 ${s.funnel!.final} 人（${s.funnel!.ratio}%），放宽建议：${s.funnel!.relax.map((r) => `${r.label}（+${r.gain} 人）`).join("；") || "无"}`);
  if (s.funnel!.ratio > 60) warnings.push(`漏斗过宽：${s.funnel!.ratio}% 都能通过，硬性条件区分度不足`);
  if (s.backtest!.agreement < 80) {
    const bad = s.backtest!.rows.filter((r) => !r.match);
    warnings.push(
      `回测一致率 ${s.backtest!.agreement}%（< 80%）。不一致：` +
        bad.map((r) => `${r.name}（实际${r.actual}，标准判${r.predicted_pass ? "通过" : "不通过"}${r.failed_on.length ? "，卡在" + r.failed_on.join("、") : ""}；经理评价：${r.note}）`).join("；"),
    );
  }
  return { passed: blocking.length === 0, blocking, warnings, issues: [...blocking, ...warnings], state: s };
}

export function findContrast(ds: Dataset, sideA: Filter[], sideB: Filter[], shared: Filter[] = []) {
  const ok = (c: Candidate, fs: Filter[]) => fs.every((f) => matchFilter(c, f));
  const mid = ds.history.length ? ds.history.reduce((s, r) => s + r.years, 0) / ds.history.length : 3.5;
  const score = (c: Candidate) => Math.abs(c.years - mid) + (/^C\d/.test(c.id) ? -2 : 0);
  const a = ds.pool.filter((c) => ok(c, [...sideA, ...shared])).sort((x, y) => score(x) - score(y)).slice(0, 3);
  const b = ds.pool.filter((c) => ok(c, [...sideB, ...shared])).sort((x, y) => score(x) - score(y)).slice(0, 3);
  return { a, b };
}

export function candidateBrief(c: Candidate) {
  const skills = Object.entries(c.skills ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${LEVEL_LABEL[v] ?? v}`).join(" ");
  return {
    id: c.id, name: c.name, years: c.years,
    degree: `${c.school} ${c.degree} · ${c.major}`,
    background: c.background, industries: c.industries, skills,
    mgmt: c.mgmt, mentor: c.mentor, expected_salary: c.expected_salary,
    current: c.current, highlights: c.highlights,
  };
}

export function examplesFor(dim: Dimension, dims: Dimension[], ds: Dataset) {
  const all = activeFilters(dims, "current");
  const mine = dim.filters ?? [];
  if (!mine.length) return {};
  const others = all.filter((x) => x.dim.id !== dim.id).map((x) => x.filter);
  const pos = ds.pool.find((c) => all.every((x) => matchFilter(c, x.filter)));
  const neg = ds.pool.find((c) => others.every((f) => matchFilter(c, f)) && !mine.every((f) => matchFilter(c, f)));
  const fmt = (c?: Candidate) => (c ? `${c.name}（${c.years} 年 · ${c.background} · ${c.current}）` : undefined);
  return { positive: fmt(pos), negative: fmt(neg) };
}

export function recommend(dims: Dimension[], ds: Dataset, n = 5) {
  const hard = activeFilters(dims, "current").map((x) => x.filter);
  const plus = dims.filter((d) => d.level === "加分" && d.filters?.length);
  return ds.pool
    .filter((c) => hard.every((f) => matchFilter(c, f)))
    .map((c) => ({ candidate: c, plus_hits: plus.filter((d) => d.filters!.every((f) => matchFilter(c, f))).map((d) => d.name) }))
    .sort((a, b) => b.plus_hits.length - a.plus_hits.length || a.candidate.expected_salary - b.candidate.expected_salary)
    .slice(0, n);
}

// 人才库问答：按条件筛选，并按字段分组统计
export function queryPool(ds: Dataset, filters: Filter[] = [], groupBy?: string) {
  const rows = ds.pool.filter((c) => filters.every((f) => matchFilter(c, f)));
  const salaries = rows.map((c) => c.expected_salary).sort((a, b) => a - b);
  const q = (p: number) => (salaries.length ? salaries[Math.min(salaries.length - 1, Math.floor(p * salaries.length))] : null);
  let groups: Record<string, number> | undefined;
  if (groupBy) {
    groups = {};
    for (const c of rows) {
      const v = fieldValue(c, groupBy);
      const keys = Array.isArray(v) ? v.map(String) : [groupBy.startsWith("skill:") ? LEVEL_LABEL[Number(v)] : groupBy === "years" ? `${Math.floor(Number(v))} 年` : String(v)];
      for (const k of keys) groups[k] = (groups[k] ?? 0) + 1;
    }
  }
  return {
    total: ds.pool.length, matched: rows.length,
    salary: { p25: q(0.25), p50: q(0.5), p75: q(0.75) },
    groups,
    samples: rows.slice(0, 3).map(candidateBrief),
  };
}

// ---------- 快速校准：选牌 + 偏好分析 ----------

// 选出 n 位差异尽量大的候选人：覆盖每种背景、年限高低、学历与薪资的不同组合
export function pickDeck(ds: Dataset, n = 8) {
  const pool = [...ds.pool];
  const chosen: Candidate[] = [];
  const dist = (a: Candidate, b: Candidate) =>
    (a.background !== b.background ? 2 : 0) +
    Math.min(3, Math.abs(a.years - b.years) / 1.5) +
    (a.degree !== b.degree ? 1 : 0) +
    Math.min(2, Math.abs(a.expected_salary - b.expected_salary) / 8) +
    Object.keys(a.skills).reduce((s, k) => s + Math.abs((a.skills[k] ?? 0) - (b.skills[k] ?? 0)) * 0.4, 0);
  // 先保证每种背景至少一人（优先手工设计的代表人选）
  for (const bg of ds.vocab.backgrounds) {
    const c = pool.filter((x) => x.background === bg).sort((x, y) => (/^C\d/.test(y.id) ? 1 : 0) - (/^C\d/.test(x.id) ? 1 : 0))[0];
    if (c && chosen.length < n) chosen.push(c);
  }
  // 再按「离已选人最远」贪心补齐
  while (chosen.length < n) {
    const rest = pool.filter((c) => !chosen.includes(c));
    if (!rest.length) break;
    rest.sort((a, b) => Math.min(...chosen.map((c) => dist(b, c))) - Math.min(...chosen.map((c) => dist(a, c))));
    chosen.push(rest[0]);
  }
  // 打乱顺序，避免同类扎堆
  return chosen.sort((a, b) => (a.id.charCodeAt(a.id.length - 1) * 7) % 11 - (b.id.charCodeAt(b.id.length - 1) * 7) % 11);
}

export function analyzeSwipes(ds: Dataset, picks: { id: string; verdict: string }[]) {
  const get = (v: string) => picks.filter((p) => p.verdict === v).map((p) => ds.pool.find((c) => c.id === p.id)).filter(Boolean) as Candidate[];
  const yes = get("想聊"), no = get("不想聊"), unsure = get("说不好");
  const findings: string[] = [];
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  if (!yes.length || !no.length) {
    findings.push(`想聊 ${yes.length} 人、不想聊 ${no.length} 人，样本太少，偏好只能作为弱参考`);
  }
  // 背景类型
  for (const bg of ds.vocab.backgrounds) {
    const y = yes.filter((c) => c.background === bg).length, n = no.filter((c) => c.background === bg).length;
    if (y + n >= 2 && (y === 0 || n === 0)) findings.push(`「${bg}」背景：想聊 ${y} 人、不想聊 ${n} 人 → ${y > n ? "明显偏好" : "明显回避"}`);
  }
  // 年限
  const yy = avg(yes.map((c) => c.years)), ny = avg(no.map((c) => c.years));
  if (Number.isFinite(yy)) findings.push(`想聊的人平均 ${r1(yy)} 年（${r1(Math.min(...yes.map((c) => c.years)))}–${r1(Math.max(...yes.map((c) => c.years)))} 年）${Number.isFinite(ny) ? `，不想聊的平均 ${r1(ny)} 年` : ""}`);
  // 学历
  const hi = (xs: Candidate[]) => xs.filter((c) => c.degree === "硕士" || c.degree === "博士").length;
  if (yes.length) findings.push(`想聊的 ${yes.length} 人中硕士及以上 ${hi(yes)} 人${no.length ? `；不想聊的 ${no.length} 人中 ${hi(no)} 人` : ""}`);
  // 技能：差异最大的两项
  const diffs = ds.vocab.skills
    .map((s) => ({ s, d: avg(yes.map((c) => c.skills[s] ?? 0)) - avg(no.map((c) => c.skills[s] ?? 0)) }))
    .filter((x) => Number.isFinite(x.d) && Math.abs(x.d) >= 0.6)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 2);
  for (const x of diffs) findings.push(`「${x.s}」：想聊的人平均水平${x.d > 0 ? "高" : "低"} ${r1(Math.abs(x.d))} 档`);
  // 薪资 / 管理经验
  const ys = avg(yes.map((c) => c.expected_salary)), ns = avg(no.map((c) => c.expected_salary));
  if (Number.isFinite(ys)) findings.push(`想聊的人期望月薪平均 ${Math.round(ys)}k${Number.isFinite(ns) ? `，不想聊的 ${Math.round(ns)}k` : ""}（预算上限 ${ds.job.budget_max}k）`);
  const ym = yes.filter((c) => c.mgmt).length, nm = no.filter((c) => c.mgmt).length;
  if (ym + nm >= 2) findings.push(`有团队管理经验的：想聊 ${ym} 人、不想聊 ${nm} 人`);
  if (unsure.length) findings.push(`说不好 ${unsure.length} 人：${unsure.map((c) => `${c.name}（${c.background}，${c.years} 年）`).join("、")}，可作为后续追问素材`);
  return { yes: yes.map((c) => c.name), no: no.map((c) => c.name), unsure: unsure.map((c) => c.name), findings };
}
