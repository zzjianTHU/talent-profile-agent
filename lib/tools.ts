import { getDataset, metaOf, prepareDataset } from "./agents/data";
import { reviewProfile } from "./agents/reviewer";
import { candidateBrief, findContrast, pickDeck, queryPool, recompute, selfCheck } from "./engine";
import { assemble, writeWithLlm } from "./deliver";
import { replayWriter } from "./replay";
import { webSearch } from "./search";
import type { AgentRole, Card, Dimension, Filter, SessionState } from "./types";

// ---------------- JSON Schema ----------------

const FILTER = {
  type: "object",
  properties: {
    field: {
      type: "string",
      description: "years / degree / school / major / background / industries / mgmt / mentor / expected_salary，或 skill:<技能名>（技能名见数据集词表）",
    },
    op: { type: "string", enum: [">=", "<=", "in", "not_in", "any", "="] },
    value: { anyOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }, { type: "array", items: { type: "string" } }] },
  },
  required: ["field", "op", "value"],
};

const DIM_FIELDS = {
  id: { type: "string", description: "英文短 id，如 years / background / education" },
  name: { type: "string", description: "维度名，如「工作年限」" },
  type: { type: "string", enum: ["硬事实", "软素质", "优先级", "合规"] },
  status: { type: "string", enum: ["明确", "含糊", "冲突", "已澄清", "待面试验证"] },
  level: { type: "string", enum: ["硬性", "加分", "否决", "不考察", "待定"] },
  impact: { type: "integer", minimum: 1, maximum: 5 },
  sources: { type: "object", properties: { manager: { type: "string" }, jd: { type: "string" }, history: { type: "string" } } },
  issue: { type: "string", description: "冲突或含糊点，一句话" },
  final: { type: "string", description: "最终口径（澄清后填写）" },
  how_to_check: { type: "string", description: "简历 / 面试上如何判断" },
  rationale: { type: "string", description: "取舍理由" },
  decided_by: { type: "string", description: "依据：经理选择 / 真人 AB / 回测 / Agent 默认（依据…）" },
  filters: { type: "array", items: FILTER, description: "当前口径的可执行筛选条件（硬性/否决参与筛选；加分项用于排序）" },
  jd_filters: { type: "array", items: FILTER, description: "原 JD 字面硬性要求的筛选条件（仅 init 时给）" },
  interview_question: { type: "string" },
};

function fn(name: string, description: string, properties: object, required: string[] = []) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

export const TOOLS = [
  fn("prepare_dataset", "【数据 Agent】岗位明确后调用：加载该岗位的内部数据（岗位与预算、经理历史招聘、同类岗位画像、人才库）和外部市场行情。预置岗位直接加载，其他岗位现场生成模拟数据（约 30–60 秒）。换岗位时重新调用会清空当前画像。",
    {
      role_title: { type: "string" }, department: { type: "string" }, business: { type: "string" },
      city: { type: "string" }, budget_hint: { type: "string" },
      manager_brief: { type: "string", description: "经理到目前为止说过的全部需求，尽量保留原话" },
      jd: { type: "string", description: "用户提供的现有 JD 原文（没有就不填）" },
    },
    ["role_title", "manager_brief"]),
  fn("get_reference", "【数据 Agent】读取内部参考数据：job_meta 岗位信息与预算；similar_role 同类岗位历史画像；manager_history 该经理过往录用与面试淘汰记录（含表现评价）；vocab 数据集取值词表（背景类型、技能名、行业、专业）。",
    { type: { type: "string", enum: ["job_meta", "similar_role", "manager_history", "vocab"] } }, ["type"]),
  fn("query_talent_pool", "【数据 Agent】查询内部人才库：按条件筛选并统计人数、期望薪资分位，可按字段分组（如 background、years、skill:SQL）。用于回答经理关于人才的问题。",
    { filters: { type: "array", items: FILTER }, group_by: { type: "string" } }),
  fn("search_external_market", "【市场 Agent】查询外部招聘市场行情：salary 薪资分位；supply 供需比；competition 同类岗位竞争；trend 技能需求趋势。",
    { topic: { type: "string", enum: ["salary", "supply", "competition", "trend"] } }, ["topic"]),
  fn("web_search", "【市场 Agent】联网搜索真实的公开信息（薪资报道、行业报告、竞对招聘动态、陌生岗位的能力要求）。查询词要具体（含城市、年限、年份），≤ 30 字。未配置或失败时返回不可用，此时改用 search_external_market。",
    { query: { type: "string" } }, ["query"]),
  fn("init_profile", "【主控】准备阶段一次性写入初版画像（全部维度）。",
    { dimensions: { type: "array", items: { type: "object", properties: DIM_FIELDS, required: ["id", "name", "type", "status", "level", "impact", "sources"] } } },
    ["dimensions"]),
  fn("update_dimension", "【主控】更新一个维度（不存在则新建，需给 name 和 type）。返回更新后的漏斗与回测。", DIM_FIELDS, ["id"]),
  fn("ask_choice", "【主控】向经理发出一道选择题。发出后本轮结束，等待回答。界面会自动附带「我还不确定」和自由输入。",
    {
      dimension_id: { type: "string" },
      question: { type: "string" },
      why: { type: "string", description: "一句话：我为什么问这个（引用证据）" },
      options: { type: "array", items: { type: "object", properties: { key: { type: "string" }, label: { type: "string" }, detail: { type: "string" } }, required: ["key", "label"] } },
      repeat: { type: "boolean", description: "回答完插问后重新发出同一道题时设为 true（不占问题预算）" },
    },
    ["dimension_id", "question", "why", "options"]),
  fn("start_calibration", "【主控】快速校准：从人才库挑 8 位差异很大的候选人，让经理凭直觉逐个标「想聊 / 不想聊 / 说不好」。数据准备好后第一件事就做这个（先看人，后定标准）。发出后本轮结束，结果由代码做偏好统计后返回。",
    { why: { type: "string", description: "一句话：为什么先看人" } }),
  fn("ask_group", "【主控】一次发出 2–3 个主题相关的问题（如「经验与门槛」：年限、学历、薪资）。经理一次答完。这是澄清阶段的默认提问方式。发出后本轮结束。",
    {
      title: { type: "string", description: "这一组的主题，≤ 10 字" },
      why: { type: "string", description: "一句话：为什么这几个一起问（引用证据）" },
      questions: {
        type: "array", minItems: 2, maxItems: 3,
        items: {
          type: "object",
          properties: {
            dimension_id: { type: "string" },
            question: { type: "string" },
            options: { type: "array", items: { type: "object", properties: { label: { type: "string" }, detail: { type: "string" } }, required: ["label"] } },
          },
          required: ["dimension_id", "question", "options"],
        },
      },
      repeat: { type: "boolean" },
    },
    ["title", "why", "questions"]),
  fn("find_contrast_pair", "【数据 Agent】从人才库找分别代表冲突两端的候选人（其他条件尽量相近）。",
    {
      dimension_id: { type: "string" },
      side_a: { type: "array", items: FILTER },
      side_b: { type: "array", items: FILTER },
      shared: { type: "array", items: FILTER, description: "两侧都要满足的条件，用来控制变量" },
    },
    ["dimension_id", "side_a", "side_b"]),
  fn("show_ab", "【主控】把两位真实候选人并排展示给经理二选一。发出后本轮结束。",
    {
      dimension_id: { type: "string" }, question: { type: "string" }, why: { type: "string" },
      candidate_a_id: { type: "string" }, label_a: { type: "string", description: "这一类人的概括" },
      candidate_b_id: { type: "string" }, label_b: { type: "string" },
      repeat: { type: "boolean" },
    },
    ["dimension_id", "question", "why", "candidate_a_id", "label_a", "candidate_b_id", "label_b"]),
  fn("run_funnel", "【计算引擎】在人才库上计算当前硬性/否决条件的漏斗与放宽建议，并给出原 JD 口径的漏斗作对比。", {}),
  fn("backtest", "【计算引擎】用当前标准回测经理历史录用/淘汰记录，并给出原 JD 口径的回测。", {}),
  fn("self_check", "【审查 Agent】（可选）提前看一眼代码检查结果。正常收尾不需要调用，直接 finalize 即可。", {}),
  fn("finalize", "【审查 + 撰写 Agent】一步完成交付：内置代码检查，审查 Agent 与撰写 Agent 并行工作，生成标准卡、优化 JD、推荐候选人、漏斗与回测。仍有冲突/含糊维度或审查发现阻断问题时会退回。调用前先把所有维度写完。",
    { summary: { type: "string" }, accepted_risks: { type: "string", description: "经理明确接受的风险（可选）" } }),
];

export const TOOL_AGENT: Record<string, AgentRole> = {
  prepare_dataset: "data", get_reference: "data", query_talent_pool: "data", find_contrast_pair: "data",
  search_external_market: "market", web_search: "market",
  run_funnel: "engine", backtest: "engine",
  self_check: "reviewer", finalize: "orchestrator",
  init_profile: "orchestrator", update_dimension: "orchestrator", ask_choice: "orchestrator", show_ab: "orchestrator", start_calibration: "orchestrator", ask_group: "orchestrator",
};

// ---------------- 执行 ----------------

export interface ToolOutcome {
  result: unknown;
  activity: string;
  card?: Card;
  finalize?: { summary?: string; accepted_risks?: string };
  endTurn?: boolean;
}

export interface ToolCtx {
  mode: "llm" | "replay";
  progress: (text: string, agent: AgentRole) => void;
}

const pct = (n: number) => `${n}%`;
const used = (state: SessionState, ...keys: string[]): SessionState => ({ ...state, sources_used: [...new Set([...(state.sources_used ?? []), ...keys])] });
const NEED_DATA = { result: { error: "还没有加载岗位数据。请先弄清岗位，再调用 prepare_dataset。" }, activity: "尚未加载岗位数据" };

function normalizeDim(raw: Partial<Dimension>, prev?: Dimension): Dimension {
  return {
    id: String(raw.id ?? prev?.id),
    name: raw.name ?? prev?.name ?? String(raw.id),
    type: raw.type ?? prev?.type ?? "硬事实",
    status: raw.status ?? prev?.status ?? "含糊",
    initial_status: prev ? prev.initial_status : raw.initial_status,
    level: raw.level ?? prev?.level ?? "待定",
    impact: raw.impact ?? prev?.impact ?? 3,
    sources: { ...(prev?.sources ?? {}), ...(raw.sources ?? {}) },
    issue: raw.issue ?? prev?.issue,
    final: raw.final ?? prev?.final,
    how_to_check: raw.how_to_check ?? prev?.how_to_check,
    rationale: raw.rationale ?? prev?.rationale,
    decided_by: raw.decided_by ?? prev?.decided_by,
    filters: (raw.filters ?? prev?.filters) as Filter[] | undefined,
    jd_filters: (raw.jd_filters ?? prev?.jd_filters) as Filter[] | undefined,
    interview_question: raw.interview_question ?? prev?.interview_question,
  };
}

export async function executeTool(
  name: string, args: Record<string, any>, state: SessionState, ctx: ToolCtx,
): Promise<{ state: SessionState; out: ToolOutcome }> {
  if (name === "prepare_dataset") {
    if (ctx.mode === "replay" && !/商业分析|经营分析/.test(String(args.role_title))) {
      return { state, out: { result: { error: "回放模式只支持预置岗位" }, activity: "回放模式只支持预置岗位" } };
    }
    const ds = await prepareDataset(
      { role_title: String(args.role_title ?? ""), department: args.department, business: args.business, city: args.city, budget_hint: args.budget_hint, manager_brief: String(args.manager_brief ?? ""), jd: state.jd_override?.text || args.jd },
      (t) => ctx.progress(t, "data"),
    );
    const fresh: SessionState = {
      phase: "准备", dimensions: [], questions_asked: 0, question_budget: state.question_budget, self_check_passed: false,
      meta: metaOf(ds, state.jd_override?.source ?? (args.jd ? "用户粘贴" : "公司模板")), dataset: ds.generated ? ds : undefined,
      jd_override: state.jd_override ?? (args.jd ? { text: String(args.jd), source: "用户粘贴" } : undefined),
      sources_used: ["job", "similar", "history", "market", ...(state.web_results?.length ? ["web"] : [])], market_topics: ["salary", "supply"],
      web_results: state.web_results,
    };
    return {
      state: fresh,
      out: {
        result: {
          ok: true, dataset: ds.generated ? "按岗位现场生成（模拟）" : "预置精编数据",
          job: ds.job, jd: ds.jd, vocab: ds.vocab,
          similar_role: ds.similar,
          manager_history: ds.history.map((r) => ({ ...candidateBrief(r), kind: r.kind, outcome: r.outcome, note: r.note })),
          market: { source: ds.market.source, salary: ds.market.salary, supply: ds.market.supply },
          pool_size: ds.pool.length,
          next: "内部数据（岗位、同类岗位、经理历史）和外部行情（薪资、供需）已全部返回。可按需再查 competition / trend 或人才库；然后直接 init_profile。",
        },
        activity: `数据就绪：${ds.job.title} · 经理历史 ${ds.history.length} 条 · 人才库 ${ds.pool.length} 人${ds.generated ? "（按岗位生成的模拟数据）" : "（预置数据）"}`,
      },
    };
  }

  // 联网搜索不依赖岗位数据：需求采集阶段也能直接搜
  if (name === "web_search") {
      const r = await webSearch(String(args.query ?? ""));
      if (!r.available) return { state, out: { result: { available: false, note: r.error ? `搜索失败：${r.error}。请改用 search_external_market` : "未配置联网搜索服务，请改用 search_external_market" }, activity: `联网搜索「${args.query}」：${r.error ? "搜索失败" : "未配置搜索服务"}，改用市场数据` } };
      const offset = (state.web_results ?? []).reduce((n, q) => n + q.results.length, 0);
      const refs = r.results.map((x, i) => ({ ref: offset + i + 1, ...x }));
      const s = used({ ...state, web_results: [...(state.web_results ?? []), { query: args.query, results: refs }] }, "web");
      return {
        state: s,
        out: {
          result: {
            note: "以下是真实网页摘要，可信度不一。凡是用到其中的事实或数字，必须在该句末尾标注引用编号，如「……约 27k [3]」，多个来源写 [3][5]；编号只能用这里的 ref，不得编造；没有出处的话不要加编号。和模拟数据冲突时两者都说明。",
            results: refs.map(({ ref, title, source, date, snippet }) => ({ ref, title, source, date, snippet })),
          },
          activity: `联网搜索「${args.query}」：${r.results.length} 条真实网页结果`,
        },
      };
    }

  const ds = getDataset(state);
  if (!ds) return { state, out: NEED_DATA };

  switch (name) {
    case "get_reference": {
      if (args.type === "job_meta") return { state: used(state, "job"), out: { result: { ...ds.job, jd: ds.jd }, activity: `读取岗位信息与预算（${ds.job.budget}）` } };
      if (args.type === "similar_role") return { state: used(state, "similar"), out: { result: ds.similar, activity: `读取同类岗位历史画像（${ds.similar.scope}）` } };
      if (args.type === "vocab") return { state, out: { result: ds.vocab, activity: "读取数据集取值词表" } };
      return {
        state: used(state, "history"),
        out: {
          result: ds.history.map((r) => ({ ...candidateBrief(r), kind: r.kind, outcome: r.outcome, note: r.note })),
          activity: `读取${ds.job.manager}的历史招聘记录（${ds.history.length} 条，含表现评价）`,
        },
      };
    }
    case "query_talent_pool": {
      const r = queryPool(ds, args.filters ?? [], args.group_by);
      return { state: used(state, "pool"), out: { result: r, activity: `查询内部人才库：${r.matched}/${r.total} 人符合${args.group_by ? `，按 ${args.group_by} 分组` : ""}` } };
    }
    case "search_external_market": {
      const topic = (["salary", "supply", "competition", "trend"].includes(args.topic) ? args.topic : "salary") as "salary" | "supply" | "competition" | "trend";
      const s = used({ ...state, market_topics: [...new Set([...(state.market_topics ?? []), topic])] }, "market");
      return { state: s, out: { result: { source: ds.market.source, ...ds.market[topic] }, activity: `查询外部市场：${ds.market[topic].title}` } };
    }
    case "init_profile": {
      const dims = (args.dimensions ?? []).map((d: Partial<Dimension>) => normalizeDim({ ...d, initial_status: d.status }));
      const s = recompute(used({ ...state, dimensions: dims, phase: "澄清" }, "pool"), ds);
      const conflicts = dims.filter((d: Dimension) => d.status === "冲突").length;
      const vague = dims.filter((d: Dimension) => d.status === "含糊").length;
      return {
        state: s,
        out: {
          result: { ok: true, dimensions: dims.length, baseline_funnel: { final: s.baseline_funnel!.final, ratio: s.baseline_funnel!.ratio }, baseline_backtest: s.baseline_backtest!.agreement },
          activity: `拆出 ${dims.length} 个维度：${conflicts} 处冲突、${vague} 处含糊`,
        },
      };
    }
    case "update_dimension": {
      const prev = state.dimensions.find((d) => d.id === args.id);
      const dim = normalizeDim(args, prev);
      const dims = prev ? state.dimensions.map((d) => (d.id === dim.id ? dim : d)) : [...state.dimensions, dim];
      const reopen = state.phase === "自检" || state.phase === "交付";
      const s = recompute({ ...state, dimensions: dims, phase: reopen ? "澄清" : state.phase, self_check_passed: false, deliverables: reopen ? undefined : state.deliverables }, ds);
      return {
        state: s,
        out: {
          result: { ok: true, funnel: { final: s.funnel!.final, ratio: s.funnel!.ratio, before: state.funnel?.final ?? null }, backtest_agreement: s.backtest!.agreement },
          activity: `更新「${dim.name}」→ ${dim.status} · ${dim.level}${dim.final ? `：${dim.final}` : ""}`,
        },
      };
    }
    case "ask_choice": {
      if (!args.repeat && state.questions_asked >= state.question_budget) {
        return { state, out: { result: { error: "问题预算已用完。请把剩余项标为待面试验证（写 interview_question），然后 self_check / finalize。" }, activity: "问题预算已用完，拦截新提问" } };
      }
      // 选项编号统一成 A / B / C…，避免模型写出 keep_master 这类内部 key
      const options = (args.options ?? []).map((o: { label: string; detail?: string }, i: number) => ({ key: String.fromCharCode(65 + i), label: o.label, detail: o.detail }));
      const card: Card = { kind: "choice", dimension_id: args.dimension_id, question: args.question, why: args.why, options, repeat: !!args.repeat };
      return {
        state: { ...state, questions_asked: state.questions_asked + (args.repeat ? 0 : 1) },
        out: { result: { ok: true, note: "已展示给经理，等待回答" }, activity: args.repeat ? "回到刚才的问题" : "发出选择题", card, endTurn: true },
      };
    }
    case "start_calibration": {
      const deck = pickDeck(ds, 8);
      const card: Card = { kind: "deck", dimension_id: "calibration", title: "先看人：这 8 位，你想聊哪几位？", why: args.why || "比起描述标准，直接看人更容易说出真实偏好；我会把你的选择和口述、JD 对照。", candidates: deck };
      return {
        state: used({ ...state, phase: "看人" }, "pool"),
        out: { result: { ok: true, note: "已展示 8 位候选人，等待经理标注" }, activity: `从人才库挑出 ${deck.length} 位差异最大的候选人做快速校准`, card, endTurn: true },
      };
    }
    case "ask_group": {
      const qs = (args.questions ?? []).slice(0, 3);
      if (!args.repeat && state.questions_asked + qs.length > state.question_budget) {
        return { state, out: { result: { error: `问题预算不足（已问 ${state.questions_asked}/${state.question_budget}）。请只问最关键的，其余标为待面试验证。` }, activity: "问题预算不足，拦截新提问" } };
      }
      const card: Card = {
        kind: "group", dimension_id: qs[0]?.dimension_id ?? "", title: args.title, why: args.why, repeat: !!args.repeat,
        questions: qs.map((q: any) => ({ dimension_id: q.dimension_id, question: q.question, options: (q.options ?? []).map((o: any, i: number) => ({ key: String.fromCharCode(65 + i), label: o.label, detail: o.detail })) })),
      };
      return {
        state: { ...state, questions_asked: state.questions_asked + (args.repeat ? 0 : qs.length) },
        out: { result: { ok: true, note: "已展示给经理，等待回答" }, activity: args.repeat ? "回到刚才的问题组" : `发出问题组「${args.title}」（${qs.length} 题）`, card, endTurn: true },
      };
    }
    case "find_contrast_pair": {
      const { a, b } = findContrast(ds, args.side_a ?? [], args.side_b ?? [], args.shared ?? []);
      return {
        state: used(state, "pool"),
        out: { result: { side_a: a.map(candidateBrief), side_b: b.map(candidateBrief) }, activity: `在内部人才库中检索对照样本：A 侧 ${a.length} 人，B 侧 ${b.length} 人` },
      };
    }
    case "show_ab": {
      if (!args.repeat && state.questions_asked >= state.question_budget) {
        return { state, out: { result: { error: "问题预算已用完。" }, activity: "问题预算已用完，拦截新提问" } };
      }
      const ca = ds.pool.find((c) => c.id === args.candidate_a_id);
      const cb = ds.pool.find((c) => c.id === args.candidate_b_id);
      if (!ca || !cb) return { state, out: { result: { error: "候选人 id 不存在，请先用 find_contrast_pair 检索" }, activity: "候选人 id 无效" } };
      const card: Card = { kind: "ab", dimension_id: args.dimension_id, question: args.question, why: args.why, a: { label: args.label_a, candidate: ca }, b: { label: args.label_b, candidate: cb }, repeat: !!args.repeat };
      return {
        state: { ...state, questions_asked: state.questions_asked + (args.repeat ? 0 : 1) },
        out: { result: { ok: true, note: "已展示给经理，等待回答" }, activity: args.repeat ? "回到刚才的对比" : "发出真人 AB 对比", card, endTurn: true },
      };
    }
    case "run_funnel": {
      const s = recompute(state, ds);
      return {
        state: s,
        out: {
          result: { current: s.funnel, jd_baseline: { final: s.baseline_funnel!.final, ratio: s.baseline_funnel!.ratio, steps: s.baseline_funnel!.steps } },
          activity: `计算人才库漏斗：${ds.pool.length} → ${s.funnel!.final} 人（${pct(s.funnel!.ratio)}）`,
        },
      };
    }
    case "backtest": {
      const s = recompute(state, ds);
      return {
        state: s,
        out: {
          result: { current: s.backtest, jd_baseline: s.baseline_backtest },
          activity: `回测经理历史 ${ds.history.length} 条记录：原 JD 口径一致率 ${pct(s.baseline_backtest!.agreement)}，当前 ${pct(s.backtest!.agreement)}`,
        },
      };
    }
    case "self_check": {
      const r = selfCheck(state, ds);
      const attempts = (state.review?.attempts ?? 0) + 1;
      ctx.progress(r.passed ? `代码检查通过${r.warnings.length ? `，有 ${r.warnings.length} 条提醒` : ""}` : `代码检查发现 ${r.blocking.length} 个阻断问题`, "engine");
      let review: { severity: string; dimension: string; text: string }[] = [];
      if (ctx.mode === "llm") {
        ctx.progress("审查 Agent 从 HR 执行视角独立审查标准…", "reviewer");
        review = await reviewProfile(r.state.dimensions);
      }
      // 防止自检死循环：第 3 次起，审查 Agent 的阻断意见降为提醒，交给经理决定
      const reviewBlock = attempts >= 3 ? [] : review.filter((x) => x.severity === "阻断");
      const fmt = (x: { severity: string; dimension: string; text: string }) => `【审查】${x.dimension}：${x.text}`;
      const blocking = [...r.blocking, ...reviewBlock.map(fmt)];
      const warnings = [...r.warnings, ...review.filter((x) => !reviewBlock.includes(x)).map(fmt)];
      const passed = blocking.length === 0;
      return {
        state: { ...r.state, phase: "自检", self_check_passed: passed, review: { passed, issues: [...blocking, ...warnings], attempts } },
        out: {
          result: {
            passed, blocking, warnings,
            next: passed
              ? warnings.length
                ? "可以交付。用 1–2 句话告诉经理最重要的提醒（如回测偏低的原因），然后直接调用 finalize，把提醒摘要写进 accepted_risks。经理之后仍可修改。"
                : "可以交付，直接调用 finalize。"
              : "把阻断问题转成一个具体问题问经理（ask_choice），或自行修正口径后再 self_check。审查意见是建议性的可自行修正。",
          },
          activity: passed ? `自检通过${warnings.length ? `（${warnings.length} 条提醒将随交付物告知经理）` : ""}` : `自检发现 ${blocking.length} 个阻断问题`,
        },
      };
    }
    case "finalize": {
      // 一步完成：代码检查 → 审查 Agent 与撰写 Agent 并行 → 组装交付物
      const r = selfCheck(state, ds);
      if (!r.passed) {
        return { state: { ...r.state, phase: "澄清" }, out: { result: { error: `不能交付：${r.blocking.join("；")}` }, activity: "交付被拦截：仍有阻断问题" } };
      }
      ctx.progress(`代码检查通过${r.warnings.length ? `，${r.warnings.length} 条提醒` : ""}`, "engine");
      const attempts = (state.review?.attempts ?? 0) + 1;
      let review: { severity: string; dimension: string; text: string }[] = [];
      let writer;
      if (ctx.mode === "llm") {
        ctx.progress("独立审查标准（与撰写并行）…", "reviewer");
        ctx.progress("起草优化 JD 与面试验证问题（与审查并行）…", "writer");
        [review, writer] = await Promise.all([reviewProfile(r.state.dimensions), writeWithLlm(r.state, ds)]);
      } else {
        writer = replayWriter(r.state);
      }
      // 审查的阻断意见只拦一次，第二次起降为提醒，避免来回兜圈
      const block = attempts >= 2 ? [] : review.filter((x) => x.severity === "阻断");
      const fmt = (x: { dimension: string; text: string }) => `【审查】${x.dimension}：${x.text}`;
      if (block.length) {
        ctx.progress(`审查 Agent 发现 ${block.length} 个阻断问题，退回修改`, "reviewer");
        return {
          state: { ...r.state, phase: "自检", review: { passed: false, issues: block.map(fmt), attempts } },
          out: { result: { error: "审查 Agent 发现阻断问题，修正后再调用 finalize（只会再审一次）", blocking: block.map(fmt) }, activity: "交付被退回：审查发现阻断问题" },
        };
      }
      const warnings = [...r.warnings, ...review.filter((x) => !block.includes(x)).map(fmt)];
      ctx.progress(review.length ? `审查完成：${review.length} 条建议，随交付物附上` : "审查完成：无问题", "reviewer");
      const risks = args.accepted_risks || (warnings.length ? warnings.map((w) => w.split("。")[0]).join("；") : undefined);
      const done: SessionState = { ...r.state, phase: "交付", self_check_passed: true, review: { passed: true, issues: warnings, attempts } };
      return {
        state: { ...done, deliverables: assemble(done, ds, writer, args.summary, risks) },
        out: { result: { ok: true, warnings, note: "交付物已生成。用 1–2 句话告诉经理去「交付物」页确认，并点出最重要的一条提醒；约面、核验属于 HR 执行环节。" }, activity: "交付物已生成：标准卡 / 优化 JD / 推荐候选人 / 漏斗与回测" },
      };
    }
  }
  return { state, out: { result: { error: `未知工具 ${name}` }, activity: `未知工具 ${name}` } };
}
