import type { Candidate } from "../types";
import { legacyToCandidate, type Background, type Degree, type LegacyCandidate, type School } from "./legacy";

// 人才库（mock）：8 个手工设计的"冲突两端"代表 + 52 个按固定种子生成的候选人

const CRAFTED: LegacyCandidate[] = [
  {
    id: "C01", name: "顾以宁", years: 3, degree: "本科", school: "985", major: "管理", background: "咨询",
    industries: ["咨询服务", "零售"], sql: 1, python: 0, causal: false, abtest: false, mgmt: false, mentor: false,
    expected_salary: 38, current: "某头部战略咨询公司 · 高级顾问",
    highlights: ["主导 6 个零售 / 本地生活战略项目，擅长结构化拆解和高层汇报", "数据由客户提供，未独立写过 SQL"],
  },
  {
    id: "C02", name: "方嘉禾", years: 3, degree: "本科", school: "211", major: "经济", background: "业务分析",
    industries: ["本地生活"], sql: 3, python: 1, causal: false, abtest: true, mgmt: false, mentor: false,
    expected_salary: 28, current: "某本地生活平台 · 经营分析",
    highlights: ["独立搭建到店商户经营看板，SQL 自助取数", "定位商户流失的关键因子，推动运营策略落地，月 GMV +4%"],
  },
  {
    id: "C03", name: "沈知远", years: 4, degree: "硕士", school: "985", major: "统计", background: "数据科学",
    industries: ["电商"], sql: 3, python: 3, causal: true, abtest: true, mgmt: false, mentor: false,
    expected_salary: 36, current: "某电商平台 · 数据科学家",
    highlights: ["用因果推断评估补贴效果，参与搭建实验平台指标体系", "直接面向业务汇报的经验较少"],
  },
  {
    id: "C04", name: "林小满", years: 2.5, degree: "本科", school: "普通", major: "市场营销", background: "运营转分析",
    industries: ["本地生活"], sql: 3, python: 1, causal: false, abtest: false, mgmt: false, mentor: false,
    expected_salary: 24, current: "某本地生活平台 · 运营分析",
    highlights: ["做了 1 年商户运营后转分析，熟悉到店商户运营全流程", "每周独立输出城市经营周报"],
  },
  {
    id: "C05", name: "季然", years: 1, degree: "本科", school: "985", major: "数学", background: "数据分析",
    industries: ["内容社区"], sql: 2, python: 2, causal: false, abtest: false, mgmt: false, mentor: false,
    expected_salary: 20, current: "某内容平台 · 数据分析",
    highlights: ["数学竞赛背景，学习速度快", "业务分析项目经验有限"],
  },
  {
    id: "C06", name: "贺明川", years: 6.5, degree: "硕士", school: "985", major: "计算机", background: "数据分析",
    industries: ["本地生活", "出行"], sql: 3, python: 3, causal: true, abtest: true, mgmt: true, mentor: true,
    expected_salary: 46, current: "某出行平台 · 数据分析经理（带 5 人）",
    highlights: ["搭建并管理 5 人分析团队", "主导城市供需策略分析"],
  },
  {
    id: "C07", name: "陶语", years: 4, degree: "本科", school: "985", major: "经济", background: "业务分析",
    industries: ["咨询服务", "本地生活"], sql: 3, python: 1, causal: false, abtest: true, mgmt: false, mentor: true,
    expected_salary: 31, current: "某本地生活平台 · 高级经营分析（前咨询顾问 2 年）",
    highlights: ["咨询 2 年后转做互联网经营分析，汇报能力和独立取数兼具", "带过 2 名新人"],
  },
  {
    id: "C08", name: "严哲", years: 3, degree: "本科", school: "211", major: "计算机", background: "BI报表",
    industries: ["快消"], sql: 3, python: 1, causal: false, abtest: false, mgmt: false, mentor: false,
    expected_salary: 25, current: "某快消企业 · BI 开发",
    highlights: ["维护 40+ 张经营报表，ETL 熟练", "较少输出分析结论和业务建议"],
  },
];

// ---- 确定性随机 ----
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}

const SURNAMES = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐韩冯于董萧程曹袁邓许傅".split("");
const GIVEN = ["子涵", "思远", "雨桐", "浩然", "欣怡", "一凡", "梓萱", "嘉懿", "若溪", "俊杰", "诗琪", "明哲", "可欣", "宇航", "佳琪", "晨曦", "泽宇", "安然", "书瑶", "皓轩", "逸飞", "语嫣", "景行", "沐阳"];
const INDUSTRIES = ["本地生活", "电商", "金融", "出行", "快消", "游戏", "内容社区"];

const HIGHLIGHTS: Record<Background, string[]> = {
  咨询: ["参与多个行业战略 / 运营咨询项目，擅长高层汇报", "数据分析多依赖客户或团队内数据同学"],
  业务分析: ["负责业务线经营分析，自助取数并输出策略建议", "推动分析结论在业务侧落地并复盘"],
  数据分析: ["负责核心指标监控与专题分析", "参与 AB 实验设计与效果评估"],
  数据科学: ["建模与因果推断经验丰富", "偏方法研究，业务汇报相对较少"],
  运营转分析: ["一线运营出身，熟悉业务细节", "转岗分析后独立输出经营周报"],
  BI报表: ["负责报表开发与数据口径维护", "较少直接输出业务结论"],
};

const TITLES: Record<Background, string> = {
  咨询: "咨询顾问",
  业务分析: "业务分析",
  数据分析: "数据分析师",
  数据科学: "数据科学家",
  运营转分析: "运营分析",
  BI报表: "BI 工程师",
};

function generate(): LegacyCandidate[] {
  const rand = mulberry32(20261018);
  const out: LegacyCandidate[] = [];
  for (let i = 0; i < 52; i++) {
    const background = pick<Background>(rand, [
      ["咨询", 12], ["业务分析", 25], ["数据分析", 25], ["数据科学", 13], ["运营转分析", 15], ["BI报表", 10],
    ]);
    const years = Math.round((1 + rand() * 6.5) * 2) / 2;
    const degree = pick<Degree>(rand, [["本科", 60], ["硕士", 35], ["博士", 5]]);
    const school = pick<School>(rand, [["985", 25], ["211", 25], ["海外名校", 15], ["普通", 35]]);
    const major = pick(rand, [
      ["统计", 15], ["数学", 10], ["计算机", 15], ["经济", 20], ["金融", 12], ["管理", 13], ["市场营销", 8], ["其他", 7],
    ] as [string, number][]);
    const sql = (
      background === "咨询" ? pick(rand, [[1, 60], [2, 35], [3, 5]] as [number, number][]) :
      background === "BI报表" || background === "数据分析" || background === "数据科学" ? pick(rand, [[2, 15], [3, 85]] as [number, number][]) :
      pick(rand, [[2, 40], [3, 60]] as [number, number][])
    ) as 1 | 2 | 3;
    const python = (
      background === "数据科学" ? 3 :
      background === "数据分析" ? pick(rand, [[1, 30], [2, 40], [3, 30]] as [number, number][]) :
      pick(rand, [[0, 40], [1, 40], [2, 20]] as [number, number][])
    ) as 0 | 1 | 2 | 3;
    const causal = background === "数据科学" ? rand() < 0.7 : background === "数据分析" ? rand() < 0.2 : rand() < 0.03;
    const abtest = ["数据科学", "数据分析", "业务分析"].includes(background) ? rand() < 0.55 : rand() < 0.1;
    const mgmt = years >= 5 && rand() < 0.4;
    const mentor = years >= 3 && rand() < 0.4;
    const ind1 = INDUSTRIES[Math.floor(rand() * INDUSTRIES.length)];
    const industries = background === "咨询" ? ["咨询服务", ind1] : rand() < 0.3 ? [ind1, INDUSTRIES[Math.floor(rand() * INDUSTRIES.length)]].filter((v, k, a) => a.indexOf(v) === k) : [ind1];
    const salary = Math.round(
      14 + years * 3.6 + (background === "咨询" ? 8 : 0) + (background === "数据科学" ? 5 : 0) +
      (degree !== "本科" ? 3 : 0) + (mgmt ? 6 : 0) + (rand() - 0.5) * 6,
    );
    const name = SURNAMES[Math.floor(rand() * SURNAMES.length)] + GIVEN[Math.floor(rand() * GIVEN.length)];
    const company = background === "咨询" ? "某咨询公司" : `某${industries[0]}${industries[0] === "快消" ? "企业" : "平台"}`;
    out.push({
      id: `P${String(i + 1).padStart(2, "0")}`,
      name, years, degree, school, major, background, industries, sql, python, causal, abtest, mgmt, mentor,
      expected_salary: salary,
      current: `${company} · ${mgmt ? "分析经理" : TITLES[background]}`,
      highlights: HIGHLIGHTS[background],
    });
  }
  return out;
}

export const TALENT_POOL: Candidate[] = [...CRAFTED, ...generate()].map(legacyToCandidate);
