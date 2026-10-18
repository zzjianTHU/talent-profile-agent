// 商业分析师预置剧本的原始字段（SQL / Python 等）→ 通用的「技能 + 等级」结构
import type { Candidate } from "../types";

export type Degree = "本科" | "硕士" | "博士";
export type School = "985" | "211" | "海外名校" | "普通";
export type Background = "咨询" | "业务分析" | "数据分析" | "数据科学" | "运营转分析" | "BI报表";

export interface LegacyCandidate {
  id: string;
  name: string;
  years: number;
  degree: Degree;
  school: School;
  major: string;
  background: Background;
  industries: string[];
  sql: 1 | 2 | 3;
  python: 0 | 1 | 2 | 3;
  causal: boolean;
  abtest: boolean;
  mgmt: boolean;
  mentor: boolean;
  expected_salary: number;
  current: string;
  highlights: string[];
}

export function legacyToCandidate(c: LegacyCandidate): Candidate {
  const { sql, python, causal, abtest, ...rest } = c;
  return { ...rest, skills: { SQL: sql, Python: python, 因果推断: causal ? 2 : 0, AB实验: abtest ? 2 : 0 } };
}
