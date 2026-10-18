import type { HistoryRecord } from "../types";
import { legacyToCandidate, type LegacyCandidate } from "./legacy";

type LegacyHistory = LegacyCandidate & Pick<HistoryRecord, "kind" | "outcome" | "note">;

// 周经理过去 2 年的招聘记录（mock）
const RAW: LegacyHistory[] = [
  {
    id: "H1", name: "许同学", kind: "录用", outcome: "优秀", years: 3.5, degree: "本科", school: "211", major: "经济",
    background: "业务分析", industries: ["本地生活"], sql: 3, python: 1, causal: false, abtest: true, mgmt: false, mentor: false,
    expected_salary: 27, current: "入职时：某本地生活平台 · 经营分析",
    highlights: ["独立负责商户分层分析"], note: "取数独立、懂商户运营，结论能推动策略落地",
  },
  {
    id: "H2", name: "邓同学", kind: "录用", outcome: "优秀", years: 2.5, degree: "本科", school: "普通", major: "统计",
    background: "数据分析", industries: ["电商"], sql: 3, python: 3, causal: false, abtest: true, mgmt: false, mentor: false,
    expected_salary: 24, current: "入职时：某电商平台 · 数据分析师",
    highlights: ["实验分析扎实"], note: "取数快，实验分析扎实，业务理解上手很快",
  },
  {
    id: "H3", name: "孟同学", kind: "录用", outcome: "合格", years: 4, degree: "硕士", school: "985", major: "统计",
    background: "数据科学", industries: ["电商"], sql: 3, python: 3, causal: true, abtest: true, mgmt: false, mentor: false,
    expected_salary: 32, current: "入职时：某电商平台 · 数据科学家",
    highlights: ["因果推断能力强"], note: "方法很强，但结论偏学术，业务落地需要带",
  },
  {
    id: "H4", name: "韩同学", kind: "录用", outcome: "试用期淘汰", years: 3, degree: "本科", school: "985", major: "管理",
    background: "咨询", industries: ["咨询服务", "零售"], sql: 1, python: 0, causal: false, abtest: false, mgmt: false, mentor: false,
    expected_salary: 31, current: "入职时：某头部咨询公司 · 顾问",
    highlights: ["汇报能力强"], note: "汇报很好，但不愿意动手取数，产出依赖他人",
  },
  {
    id: "H5", name: "罗同学", kind: "录用", outcome: "试用期淘汰", years: 2, degree: "硕士", school: "海外名校", major: "金融",
    background: "咨询", industries: ["咨询服务"], sql: 1, python: 1, causal: false, abtest: false, mgmt: false, mentor: false,
    expected_salary: 30, current: "入职时：某战略咨询公司 · 分析师",
    highlights: ["结构化表达好"], note: "交付偏 PPT，SQL 跟不上业务节奏",
  },
  {
    id: "H6", name: "唐同学", kind: "录用", outcome: "优秀", years: 5, degree: "本科", school: "211", major: "计算机",
    background: "业务分析", industries: ["电商"], sql: 3, python: 2, causal: false, abtest: true, mgmt: false, mentor: true,
    expected_salary: 32, current: "入职时：某电商平台 · 高级业务分析",
    highlights: ["主导大促经营复盘"], note: "主动带新人，主导大促经营复盘，业务方评价高",
  },
  {
    id: "H7", name: "叶同学", kind: "录用", outcome: "合格", years: 3, degree: "本科", school: "普通", major: "市场营销",
    background: "运营转分析", industries: ["本地生活"], sql: 3, python: 1, causal: false, abtest: false, mgmt: false, mentor: false,
    expected_salary: 23, current: "入职时：某本地生活平台 · 运营分析",
    highlights: ["熟悉商户运营"], note: "非常懂业务，分析方法论需要补",
  },
  {
    id: "H8", name: "沈同学", kind: "录用", outcome: "合格", years: 4, degree: "硕士", school: "211", major: "统计",
    background: "数据分析", industries: ["本地生活"], sql: 3, python: 2, causal: false, abtest: true, mgmt: false, mentor: false,
    expected_salary: 29, current: "入职时：某出行平台 · 数据分析师",
    highlights: ["稳定可靠"], note: "稳定可靠，交付质量稳定",
  },
  {
    id: "R1", name: "钱同学", kind: "面试未通过", outcome: "面试未通过", years: 6, degree: "硕士", school: "985", major: "计算机",
    background: "数据科学", industries: ["金融", "电商"], sql: 3, python: 3, causal: true, abtest: true, mgmt: true, mentor: true,
    expected_salary: 52, current: "某金融科技公司 · 数据科学负责人",
    highlights: ["带 6 人团队"], note: "能力强，但期望薪资远超预算",
  },
  {
    id: "R2", name: "江同学", kind: "面试未通过", outcome: "面试未通过", years: 1, degree: "本科", school: "985", major: "数学",
    background: "数据分析", industries: ["内容社区"], sql: 2, python: 2, causal: false, abtest: false, mgmt: false, mentor: false,
    expected_salary: 20, current: "某内容平台 · 数据分析",
    highlights: ["数学基础好"], note: "业务理解太浅，需要从头带",
  },
  {
    id: "R3", name: "苏同学", kind: "面试未通过", outcome: "面试未通过", years: 3, degree: "本科", school: "211", major: "经济",
    background: "咨询", industries: ["咨询服务"], sql: 1, python: 0, causal: false, abtest: false, mgmt: false, mentor: false,
    expected_salary: 30, current: "某咨询公司 · 顾问",
    highlights: ["案例面表现好"], note: "案例面表现很好，SQL 笔试未通过",
  },
  {
    id: "R4", name: "陆同学", kind: "面试未通过", outcome: "面试未通过", years: 4, degree: "本科", school: "普通", major: "计算机",
    background: "BI报表", industries: ["快消"], sql: 3, python: 1, causal: false, abtest: false, mgmt: false, mentor: false,
    expected_salary: 25, current: "某快消企业 · BI 工程师",
    highlights: ["报表开发熟练"], note: "只做报表开发，缺乏分析结论与业务建议",
  },
];

export const MANAGER_HISTORY: HistoryRecord[] = RAW.map((r) => ({ ...legacyToCandidate(r), kind: r.kind, outcome: r.outcome, note: r.note }));

export function historyShouldPass(r: HistoryRecord) {
  return r.kind === "录用" && (r.outcome === "优秀" || r.outcome === "合格");
}
