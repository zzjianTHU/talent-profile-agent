// 数据 Agent：为任意岗位现场生成一套结构一致的模拟数据（经理历史、同类岗位、人才库、市场行情）
import { BA_DATASET, matchPreset, PRESETS } from "../data/ba";
import { chatCompletion } from "../llm";
import type { Candidate, Dataset, DatasetMeta, Degree, HistoryRecord, SessionState } from "../types";

export function getDataset(state: SessionState): Dataset | null {
  if (!state.meta) return null;
  const ds = !state.meta.generated ? PRESETS[state.meta.id] ?? BA_DATASET : state.dataset;
  if (!ds) return null;
  return state.jd_override ? { ...ds, jd: state.jd_override.text } : ds;
}

export function metaOf(ds: Dataset, jdSource: DatasetMeta["jd_source"] = "公司模板"): DatasetMeta {
  return {
    id: ds.id, generated: ds.generated, job: ds.job, jd: ds.jd, market: ds.market, jd_source: jdSource,
    counts: {
      history_hired: ds.history.filter((r) => r.kind === "录用").length,
      history_rejected: ds.history.filter((r) => r.kind !== "录用").length,
      pool: ds.pool.length,
      similar: ds.similar.scope,
    },
  };
}

export interface RoleSpec {
  role_title: string;
  department?: string;
  business?: string;
  city?: string;
  budget_hint?: string;
  manager_brief: string;
  jd?: string;
}

const SKELETON_PROMPT = `你是招聘数据模拟器，为招聘 demo 生成「看起来真实、内部一致」的模拟数据骨架。只输出 JSON，内容精炼。
{
  "job": { "title", "department", "manager": "X经理", "budget": "如 25–35k × 14 薪（月薪上限 35k）", "budget_max": 数字(k/月), "urgency", "business": "一句话", "city" },
  "jd": "公司现有的该岗位 JD 模板（用户提供了 JD 就原样返回）。分职责和任职要求，约 8 行；任职要求里要有 1–2 条偏高或与经理口述矛盾的硬要求",
  "vocab": { "skills": [4–5 个关键技能，短词], "industries": [6 个行业], "majors": [6 个专业] },
  "profiles": [5 种该岗位常见的候选人背景类型 { "background": "短词", "title": "常见职位名", "skills": {技能名: 0-3 的典型水平}, "salary_premium": -0.2 到 0.3, "highlights": [2 条典型经历，每条 ≤ 25 字] }],
  "conflicts": [3 条：经理口述的偏好 与 实际招聘效果 之间可能存在的矛盾，每条一句话，例如「经理想要同行大厂背景，但这类人试用期常因不适应小团队离开」]
}
要求：profiles 至少有一种是「经理口述想要的类型」，至少有一种是「实际更适合的类型」。`;

const MARKET_PROMPT = `你是招聘数据模拟器。根据岗位生成同类岗位画像和外部市场行情（模拟），只输出 JSON，内容精炼：
{ "similar": { "scope": "公司内同类岗位，过去 12 个月录用 N 人、淘汰 M 人", "hired_profile": [3 条], "probation": [2 条，含某类背景试用期通过率偏低], "rejected_reasons": [3 条带百分比], "success_traits": [3 条] },
  "market": { "source": "外部招聘市场（模拟数据 · 多平台聚合 · <城市> · 近 90 天）",
    "salary": { "title": "<岗位>月薪分位（k）", "bands": [4 个年限段 {years: "1–3 年" 这类, p25, p50, p75}], "notes": [2 条] },
    "supply": { "title": "供需比（活跃求职者 : 在招岗位）", "items": [4 个细分 {segment, ratio, label}] },
    "competition": { "title": "同类岗位竞争", "items": [3 条] },
    "trend": { "title": "技能需求趋势", "items": [3 条] } } }`;

const HISTORY_PROMPT = `你是招聘数据模拟器。生成该用人经理过去 2 年的招聘记录，只输出 JSON：{ "history": [...] }
每条：{ "name": "X同学", "years", "degree": "大专|本科|硕士|博士", "school": "985|211|海外名校|普通", "major", "background", "industries": [1 个], "skills": {技能名: 0-3}, "mgmt": bool, "mentor": bool, "expected_salary", "kind": "录用|面试未通过", "outcome": "优秀|合格|试用期淘汰|面试未通过", "note": "经理评价或淘汰原因，≤ 25 字" }
取值必须来自给定的词表和背景类型。记录要体现给定的冲突：经理口述偏好的类型里出现试用期淘汰，表现优秀的人不完全符合口述或 JD。`;

function num(v: unknown, d: number) {
  const n = Number(String(v ?? "").replace(/[^\d.\-]/g, "") || NaN);
  return Number.isFinite(n) ? n : d;
}

// 月薪统一成 k：模型偶尔会写成元（28000）
const k = (v: unknown, d: number) => {
  const n = num(v, d);
  return n > 300 ? Math.round(n / 1000) : n;
};

function normCandidate(raw: any, id: string, ds: Pick<Dataset, "vocab">): Candidate {
  const skills: Record<string, number> = {};
  for (const s of ds.vocab.skills) skills[s] = Math.max(0, Math.min(3, Math.round(num(raw?.skills?.[s], 0))));
  const degree = (["大专", "本科", "硕士", "博士"].includes(raw?.degree) ? raw.degree : "本科") as Degree;
  return {
    id,
    name: String(raw?.name ?? id),
    years: Math.max(0, Math.round(num(raw?.years, 3) * 2) / 2),
    degree,
    school: ["985", "211", "海外名校", "普通"].includes(raw?.school) ? raw.school : "普通",
    major: String(raw?.major ?? "其他"),
    background: String(raw?.background ?? ds.vocab.backgrounds[0]),
    industries: Array.isArray(raw?.industries) ? raw.industries.map(String).slice(0, 3) : [],
    skills,
    mgmt: !!raw?.mgmt,
    mentor: !!raw?.mentor,
    expected_salary: Math.round(k(raw?.expected_salary, 25)),
    current: String(raw?.current ?? ""),
    highlights: Array.isArray(raw?.highlights) ? raw.highlights.map(String).slice(0, 2) : [],
  };
}

async function json(system: string, user: string): Promise<any> {
  const msg = await chatCompletion({ json: true, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
  const raw = (msg.content ?? "{}").replace(/^```(json)?/m, "").replace(/```\s*$/m, "");
  return JSON.parse(raw);
}

export async function prepareDataset(spec: RoleSpec, onProgress: (text: string) => void): Promise<Dataset> {
  const preset = matchPreset(spec.role_title);
  if (preset) {
    onProgress(`识别为预置岗位「${preset.job.title}」，加载精编数据集`);
    return spec.jd ? { ...preset, jd: spec.jd } : preset;
  }

  const roleText = `岗位：${spec.role_title}\n部门：${spec.department ?? "未说明"}\n业务：${spec.business ?? "未说明"}\n城市：${spec.city ?? "北京"}\n预算线索：${spec.budget_hint ?? "未说明"}\n经理口述：${spec.manager_brief}\n${spec.jd ? `用户提供的 JD：\n${spec.jd}` : "用户未提供 JD"}`;

  onProgress(`为「${spec.role_title}」设计数据骨架：岗位信息、JD 模板、候选人背景类型、冲突假设…`);
  const p = await json(SKELETON_PROMPT, roleText);
  const profiles: Profile[] = (p.profiles ?? []).slice(0, 6).map((x: any) => ({
    background: String(x.background), title: String(x.title ?? x.background),
    skills: x.skills ?? {}, salary_premium: num(x.salary_premium, 0), highlights: (x.highlights ?? []).map(String).slice(0, 2),
  }));
  const vocab = {
    backgrounds: profiles.map((x) => x.background),
    skills: (p.vocab?.skills ?? Object.keys(profiles[0]?.skills ?? {})).map(String).slice(0, 6),
    industries: (p.vocab?.industries ?? []).map(String).slice(0, 8),
    majors: (p.vocab?.majors ?? []).map(String).slice(0, 8),
  };
  const conflicts: string[] = (p.conflicts ?? []).map(String);
  onProgress(`骨架完成：${profiles.length} 种背景类型、${vocab.skills.length} 项关键技能；并行生成经理历史与市场行情…`);

  const ctx = `${roleText}\n\n词表：${JSON.stringify(vocab)}\n背景类型：${profiles.map((x) => x.background).join("、")}\n冲突假设：${conflicts.join("；")}\n预算上限：${k(p.job?.budget_max, 40)}k`;
  const [m, h1, h2] = await Promise.all([
    json(MARKET_PROMPT, roleText),
    json(HISTORY_PROMPT, `${ctx}\n\n生成 6 条：5 条 kind=录用（outcome：2 优秀、1 合格、2 试用期淘汰）+ 1 条面试未通过（原因：薪资超预算）。`),
    json(HISTORY_PROMPT, `${ctx}\n\n生成 6 条：3 条 kind=录用（outcome：1 优秀、2 合格）+ 3 条面试未通过（原因分别是：关键技能不足、经验太浅、只会执行缺少思考）。`),
  ]);
  const history: HistoryRecord[] = [...(h1.history ?? []), ...(h2.history ?? [])].slice(0, 14).map((r: any, i: number) => ({
    ...normCandidate({ ...r, current: r.current ?? `入职时：${r.background}`, highlights: r.highlights ?? [r.note] }, `H${i + 1}`, { vocab }),
    kind: r.kind === "录用" ? "录用" : "面试未通过",
    outcome: ["优秀", "合格", "试用期淘汰", "面试未通过"].includes(r.outcome) ? r.outcome : r.kind === "录用" ? "合格" : "面试未通过",
    note: String(r.note ?? ""),
  }));
  const bands = (m.market?.salary?.bands ?? []).map((x: any) => ({ years: String(x.years), p25: k(x.p25, 0), p50: k(x.p50, 0), p75: k(x.p75, 0) }));
  const pool = synthPool(profiles, vocab, bands, k(p.job?.budget_max, 40), spec.role_title.length * 7919 + Date.now() % 1000);
  onProgress(`经理历史 ${history.length} 条、市场行情 4 类、人才库 ${pool.length} 人已就绪`);
  m.market = m.market ?? {};
  const similar = m.similar ?? {};
  const job = p.job ?? {};
  return {
    id: `gen_${Date.now()}`,
    generated: true,
    job: {
      title: String(job.title ?? spec.role_title),
      department: String(job.department ?? spec.department ?? "业务部门"),
      manager: String(job.manager ?? "李经理"),
      headcount: 1,
      budget: String(job.budget ?? "面议"),
      budget_max: k(job.budget_max, 40),
      urgency: String(job.urgency ?? "尽快到岗"),
      business: String(job.business ?? spec.business ?? ""),
      city: String(job.city ?? spec.city ?? "北京"),
    },
    jd: spec.jd || String(p.jd ?? ""),
    similar: {
      scope: String(similar.scope ?? "公司内同类岗位（模拟）"),
      hired_profile: (similar.hired_profile ?? []).map(String),
      probation: (similar.probation ?? []).map(String),
      rejected_reasons: (similar.rejected_reasons ?? []).map(String),
      success_traits: (similar.success_traits ?? []).map(String),
    },
    history,
    pool,
    market: {
      source: String(m.market.source ?? "外部招聘市场（模拟数据）"),
      salary: { title: String(m.market.salary?.title ?? "月薪分位（k）"), bands, notes: (m.market.salary?.notes ?? []).map(String) },
      supply: { title: String(m.market.supply?.title ?? "供需比"), items: (m.market.supply?.items ?? []).map((x: any) => ({ segment: String(x.segment), ratio: num(x.ratio, 1), label: String(x.label ?? "") })) },
      competition: { title: String(m.market.competition?.title ?? "同类岗位竞争"), items: (m.market.competition?.items ?? []).map(String) },
      trend: { title: String(m.market.trend?.title ?? "技能需求趋势"), items: (m.market.trend?.items ?? []).map(String) },
    },
    vocab,
  };
}

// ---- 人才库由代码按骨架即时合成（模型只负责骨架，省掉大段输出） ----
interface Profile { background: string; title: string; skills: Record<string, number>; salary_premium: number; highlights: string[] }

const SURNAMES = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐韩冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段雷钱汤尹黎易常武乔贺赖龚文".split("");
const GIVEN = ["子涵", "思远", "雨桐", "浩然", "欣怡", "一凡", "梓萱", "嘉懿", "若溪", "俊杰", "诗琪", "明哲", "可欣", "宇航", "佳琪", "晨曦", "泽宇", "安然", "书瑶", "皓轩", "逸飞", "语嫣", "景行", "沐阳", "知远", "以宁", "嘉禾", "清越", "亦辰", "星野"];

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bandFor(bands: { years: string; p50: number }[], years: number) {
  for (const b of bands) {
    const nums = (b.years.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    if (nums.length >= 2 && years >= nums[0] && years <= nums[1]) return b.p50;
    if (nums.length === 1 && /以上|\+/.test(b.years) && years >= nums[0]) return b.p50;
  }
  return null;
}

function synthPool(profiles: Profile[], vocab: Dataset["vocab"], bands: { years: string; p50: number }[], budgetMax: number, seed: number): Candidate[] {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const out: Candidate[] = [];
  const N = 40;
  for (let i = 0; i < N; i++) {
    const pf = profiles[i % profiles.length];
    const years = Math.round((1 + Math.pow(r(), 1.3) * 9) * 2) / 2;
    const skills: Record<string, number> = {};
    for (const s of vocab.skills) {
      const base = num(pf.skills?.[s], 1) + (years >= 5 ? 0.4 : years <= 2 ? -0.5 : 0);
      skills[s] = Math.max(0, Math.min(3, Math.round(base + (r() - 0.5) * 1.6)));
    }
    const degree = (r() < 0.62 ? "本科" : r() < 0.85 ? "硕士" : r() < 0.6 ? "大专" : "博士") as Degree;
    const p50 = bandFor(bands, years) ?? budgetMax * (0.55 + years * 0.07);
    const ind = [pick(vocab.industries)];
    if (r() < 0.3) ind.push(pick(vocab.industries));
    out.push({
      id: `P${String(i + 1).padStart(2, "0")}`,
      name: pick(SURNAMES) + pick(GIVEN),
      years,
      degree,
      school: pick(["985", "211", "211", "海外名校", "普通", "普通", "普通"]),
      major: pick(vocab.majors.length ? vocab.majors : ["其他"]),
      background: pf.background,
      industries: [...new Set(ind)].filter(Boolean),
      skills,
      mgmt: years >= 5 && r() < 0.45,
      mentor: years >= 3 && r() < 0.45,
      expected_salary: Math.max(8, Math.round(p50 * (1 + pf.salary_premium) * (0.88 + r() * 0.24))),
      current: `某${ind[0] ?? ""}公司 · ${years >= 6 ? "资深" : ""}${pf.title}`,
      highlights: pf.highlights,
    });
  }
  return out;
}
