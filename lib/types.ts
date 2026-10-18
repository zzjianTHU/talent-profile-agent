// ---------- 候选人 / 数据集（通用结构，任何岗位都适用） ----------

export type Degree = "大专" | "本科" | "硕士" | "博士";

export interface Candidate {
  id: string;
  name: string;
  years: number;
  degree: Degree;
  school: string; // 985 / 211 / 海外名校 / 普通
  major: string;
  background: string; // 背景类型，取值来自 dataset.vocab.backgrounds
  industries: string[];
  skills: Record<string, number>; // 0 无 1 基础 2 熟练 3 精通，技能名来自 dataset.vocab.skills
  mgmt: boolean; // 正式带团队经验
  mentor: boolean; // 带过新人
  expected_salary: number; // k / 月
  current: string; // 现任公司 · 岗位（脱敏）
  highlights: string[];
}

export interface HistoryRecord extends Candidate {
  kind: "录用" | "面试未通过";
  outcome: "优秀" | "合格" | "试用期淘汰" | "面试未通过";
  note: string;
}

export interface JobMeta {
  title: string;
  department: string;
  manager: string;
  headcount: number;
  budget: string;
  budget_max: number;
  urgency: string;
  business: string;
  city: string;
}

export interface MarketData {
  source: string;
  salary: { title: string; bands: { years: string; p25: number; p50: number; p75: number }[]; notes: string[] };
  supply: { title: string; items: { segment: string; ratio: number; label: string }[] };
  competition: { title: string; items: string[] };
  trend: { title: string; items: string[] };
}

export interface SimilarRole {
  scope: string;
  hired_profile: string[];
  probation: string[];
  rejected_reasons: string[];
  success_traits: string[];
}

export interface Dataset {
  id: string;
  generated: boolean;
  job: JobMeta;
  jd: string;
  similar: SimilarRole;
  history: HistoryRecord[];
  pool: Candidate[];
  market: MarketData;
  vocab: { backgrounds: string[]; skills: string[]; industries: string[]; majors: string[] };
}

// 发给前端展示用的数据集摘要（不含人才库全量）
export interface DatasetMeta {
  id: string;
  generated: boolean;
  job: JobMeta;
  jd: string;
  market: MarketData;
  counts: { history_hired: number; history_rejected: number; pool: number; similar: string };
  jd_source: JdSource;
}

export type JdSource = "用户粘贴" | "截图识别" | "公司模板";

// ---------- 结构化筛选条件（代码执行，LLM 只负责翻译） ----------
// field 取值：years / degree / school / major / background / industries / mgmt / mentor / expected_salary / skill:<技能名>
export type FilterOp = ">=" | "<=" | "in" | "not_in" | "any" | "=";

export interface Filter {
  field: string;
  op: FilterOp;
  value: number | string | boolean | string[];
}

// ---------- 画像状态（唯一事实来源） ----------

export type DimStatus = "明确" | "含糊" | "冲突" | "已澄清" | "待面试验证";
export type DimLevel = "硬性" | "加分" | "否决" | "不考察" | "待定";
export type DimType = "硬事实" | "软素质" | "优先级" | "合规";

export interface Dimension {
  id: string;
  name: string;
  type: DimType;
  status: DimStatus;
  initial_status?: DimStatus; // 准备阶段的状态，用于交付页「已解决的冲突」
  level: DimLevel;
  impact: number; // 1-5，对筛选结果的影响
  sources: { manager?: string; jd?: string; history?: string };
  issue?: string;
  final?: string;
  how_to_check?: string;
  rationale?: string;
  decided_by?: string;
  filters?: Filter[];
  jd_filters?: Filter[];
  interview_question?: string;
}

export interface FunnelStep {
  label: string;
  remaining: number;
}

export interface FunnelResult {
  total: number;
  steps: FunnelStep[];
  final: number;
  ratio: number;
  relax: { dimension: string; label: string; gain: number; final_if_removed: number }[];
}

export interface BacktestRow {
  id: string;
  name: string;
  actual: string;
  expected_pass: boolean;
  predicted_pass: boolean;
  match: boolean;
  failed_on: string[];
  note: string;
}

export interface BacktestResult {
  agreement: number;
  rows: BacktestRow[];
}

export type Phase = "需求采集" | "准备" | "看人" | "澄清" | "自检" | "交付";

export interface SessionState {
  phase: Phase;
  dimensions: Dimension[];
  questions_asked: number;
  question_budget: number;
  self_check_passed: boolean;
  meta?: DatasetMeta;
  dataset?: Dataset; // 仅「按岗位生成」的数据集随状态往返；预置数据集只传 id
  funnel?: FunnelResult;
  baseline_funnel?: FunnelResult;
  backtest?: BacktestResult;
  baseline_backtest?: BacktestResult;
  deliverables?: Deliverables;
  review?: { passed: boolean; issues: string[]; attempts?: number };
  calibration?: CalibrationResult;
  jd_override?: { text: string; source: JdSource }; // 用户中途提供 / 替换的 JD
  sources_used?: string[]; // job / history / similar / pool / market / web
  market_topics?: string[];
  web_results?: { query: string; results: WebRef[] }[];
}

// 联网搜索结果，ref 为整场对话内的全局引用编号
export interface WebRef { ref: number; title: string; url: string; snippet: string; source?: string; date?: string }

// ---------- UI 卡片 ----------

export interface ChoiceCard {
  kind: "choice";
  dimension_id: string;
  question: string;
  why: string;
  options: { key: string; label: string; detail?: string }[];
  repeat?: boolean;
}

export interface AbCard {
  kind: "ab";
  dimension_id: string;
  question: string;
  why: string;
  a: { label: string; candidate: Candidate };
  b: { label: string; candidate: Candidate };
  repeat?: boolean;
}

// 快速校准：先看人，后定标准
export interface DeckCard {
  kind: "deck";
  dimension_id: "calibration";
  title: string;
  why: string;
  candidates: Candidate[];
}

// 问题组：相关的 2–3 个问题一次答完
export interface GroupCard {
  kind: "group";
  dimension_id: string; // 第一个问题的维度，用于议程定位
  title: string;
  why: string;
  questions: { dimension_id: string; question: string; options: { key: string; label: string; detail?: string }[] }[];
  repeat?: boolean;
}

export type Verdict = "想聊" | "不想聊" | "说不好";
export interface CalibrationResult {
  picks: { id: string; verdict: Verdict }[];
  findings: string[];
}

export type Card = ChoiceCard | AbCard | DeckCard | GroupCard;

// ---------- 交付物 ----------

export interface DeliverItem {
  name: string;
  final: string;
  how_to_check: string;
  positive?: string;
  negative?: string;
}

export interface Deliverables {
  summary: string;
  must: DeliverItem[];
  plus: DeliverItem[];
  veto: DeliverItem[];
  resolved: { name: string; before: string; after: string; rationale: string; decided_by: string }[];
  pending: { name: string; question: string }[];
  jd: { title: string; sections: { heading: string; items: string[] }[] };
  jd_changes: { before: string; after: string; reason: string }[];
  funnel: FunnelResult;
  baseline_funnel: FunnelResult;
  backtest: BacktestResult;
  baseline_backtest: BacktestResult;
  recommended: { candidate: Candidate; plus_hits: string[] }[];
  risks?: string;
}

// ---------- 多 Agent 协作 ----------

export type AgentRole = "orchestrator" | "vision" | "data" | "market" | "engine" | "reviewer" | "writer" | "guard";

// ---------- 流式事件 ----------

export type AgentEvent =
  | { t: "activity"; text: string; agent: AgentRole }
  | { t: "assistant"; text: string }
  | { t: "card"; card: Card }
  | { t: "state"; state: SessionState }
  | { t: "done"; messages: LlmMessage[]; mode: "llm" | "replay" }
  | { t: "error"; message: string };

export interface LlmToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
