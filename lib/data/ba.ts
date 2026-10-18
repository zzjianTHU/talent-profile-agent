// 预置数据集：商业分析师（精心设计的冲突剧本）
import type { Dataset } from "../types";
import { MANAGER_HISTORY } from "./history";
import { MARKET, MARKET_SOURCE } from "./market";
import { TALENT_POOL } from "./pool";
import { JOB_META, ORIGINAL_JD, SIMILAR_ROLE_SUMMARY } from "./scenario";

export const BA_DATASET: Dataset = {
  id: "ba",
  generated: false,
  job: JOB_META,
  jd: ORIGINAL_JD,
  similar: SIMILAR_ROLE_SUMMARY,
  history: MANAGER_HISTORY,
  pool: TALENT_POOL,
  market: { source: MARKET_SOURCE, ...MARKET },
  vocab: {
    backgrounds: ["咨询", "业务分析", "数据分析", "数据科学", "运营转分析", "BI报表"],
    skills: ["SQL", "Python", "因果推断", "AB实验"],
    industries: ["本地生活", "电商", "金融", "出行", "快消", "游戏", "内容社区", "咨询服务"],
    majors: ["统计", "数学", "计算机", "经济", "金融", "管理", "市场营销", "其他"],
  },
};

export const PRESETS: Record<string, Dataset> = { ba: BA_DATASET };

export function matchPreset(roleTitle: string): Dataset | null {
  return /商业分析|经营分析|业务分析师/.test(roleTitle) ? BA_DATASET : null;
}
