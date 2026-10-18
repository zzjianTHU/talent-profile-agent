// 演示回放模式：未配置模型 Key 时，按预设剧本产出「工具调用」，走与真实模型完全相同的执行链路。
// 仅用于开发自测与断网兜底；界面会明确标注，不理解经理的自由输入。
import { BA_DATASET } from "./data/ba";
import { MANAGER_BRIEF } from "./data/scenario";
import { TALENT_POOL } from "./data/pool";
import { MARKET } from "./data/market";
import { findContrast, matchFilter, runFunnel } from "./engine";
import type { Dimension, Filter, LlmMessage, LlmToolCall, SessionState } from "./types";

type Assistant = Extract<LlmMessage, { role: "assistant" }>;
let seq = 0;
const call = (name: string, args: object): LlmToolCall => ({
  id: `replay_${Date.now()}_${seq++}`,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
const say = (content: string | null, ...calls: LlmToolCall[]): Assistant => ({
  role: "assistant", content, tool_calls: calls.length ? calls : undefined,
});
const count = (fs: Filter[]) => TALENT_POOL.filter((c) => fs.every((f) => matchFilter(c, f))).length;

const INIT_DIMS: Partial<Dimension>[] = [
  {
    id: "years", name: "工作年限", type: "硬事实", status: "冲突", level: "待定", impact: 5,
    sources: { manager: "1–3 年就够，太资深的贵", jd: "3–5 年", history: "录用 8 人平均 3.4 年；1 年经验的江同学因业务理解浅被拒" },
    issue: "口述上限 3 年 vs JD 下限 3 年，几乎没有交集",
    jd_filters: [{ field: "years", op: ">=", value: 3 }, { field: "years", op: "<=", value: 5 }],
  },
  {
    id: "background", name: "背景类型", type: "软素质", status: "冲突", level: "待定", impact: 5,
    sources: { manager: "最好是咨询公司出来的，结构化思维强", jd: "未提", history: "录用的 2 位咨询背景同学均在试用期淘汰；3 位优秀者是业务分析 / 数据分析型" },
    issue: "口述偏好与历史实际表现相反",
  },
  {
    id: "data_skill", name: "独立取数能力", type: "硬事实", status: "明确", level: "硬性", impact: 4,
    sources: { manager: "能自己拉数写 SQL，别什么都等数仓", jd: "精通 SQL", history: "被淘汰 / 被拒者的共同点之一是 SQL 弱" },
    final: "SQL 精通，能独立取数建模", how_to_check: "SQL 笔试；简历中有不依赖数仓、独立取数完成的分析项目",
    filters: [{ field: "skill:SQL", op: ">=", value: 3 }], jd_filters: [{ field: "skill:SQL", op: ">=", value: 3 }],
    decided_by: "三方一致",
  },
  {
    id: "biz_sense", name: "业务理解与落地", type: "软素质", status: "明确", level: "硬性", impact: 5,
    sources: { manager: "要懂业务", jd: "推动分析结论落地", history: "优秀者共同点：结论能推动策略落地" },
    final: "能从数据追到商户 / 运营动作，并推动落地", how_to_check: "简历中至少 1 个「分析 → 策略 → 结果」闭环案例；面试做一道到店商户经营 case",
    decided_by: "三方一致",
  },
  {
    id: "tech_depth", name: "建模深度（Python / 因果推断）", type: "优先级", status: "冲突", level: "待定", impact: 4,
    sources: { manager: "只提到能拉数写 SQL", jd: "精通 Python，熟悉因果推断、AB 实验", history: "因果推断最强的孟同学仅评「合格」：结论偏学术" },
    issue: "JD 的技术门槛远高于口述，且历史上技术最强的人并非表现最好",
    jd_filters: [{ field: "skill:Python", op: ">=", value: 3 }, { field: "skill:因果推断", op: ">=", value: 2 }],
  },
  {
    id: "compliance", name: "「年轻、能加班」", type: "合规", status: "冲突", level: "待定", impact: 4,
    sources: { manager: "年轻一点的好，扛得住节奏，我们加班多" },
    issue: "年龄不能作为筛选条件，需要找到背后的真实诉求",
  },
  {
    id: "education", name: "学历与专业", type: "硬事实", status: "冲突", level: "待定", impact: 4,
    sources: { manager: "统计、数学最好", jd: "硕士及以上，统计 / 数学 / 计算机", history: "3 位优秀录用中 2 位本科，专业为经济、计算机、统计" },
    issue: "JD 学历门槛会筛掉经理评价最好的人",
    jd_filters: [{ field: "degree", op: ">=", value: "硕士" }, { field: "major", op: "in", value: ["统计", "数学", "计算机"] }],
  },
  {
    id: "industry", name: "行业经验", type: "硬事实", status: "含糊", level: "待定", impact: 3,
    sources: { jd: "电商、本地生活优先", history: "3 位优秀录用均来自电商 / 本地生活" },
    issue: "经理没提，JD 写「优先」，是否硬性不明确",
  },
  {
    id: "mgmt", name: "团队管理经验", type: "优先级", status: "冲突", level: "待定", impact: 2,
    sources: { manager: "太资深的不好管", jd: "具备团队管理经验者优先", history: "唐同学主动带新人，表现优秀" },
    issue: "JD 想要管理经验，经理却担心太资深",
  },
  {
    id: "salary", name: "薪资预算", type: "硬事实", status: "明确", level: "硬性", impact: 3,
    sources: { manager: "太资深的贵", jd: "未写", history: "钱同学期望 52k 被拒；外部市场 3–5 年中位数 30k、P75 35k；预算上限 32k" },
    final: "期望月薪 ≤ 32k（预算上限）", how_to_check: "初筛电话确认期望薪资",
    filters: [{ field: "expected_salary", op: "<=", value: 32 }], decided_by: "岗位预算",
  },
];

function lastUser(messages: LlmMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return messages[i].content as string;
  return "";
}

const isAnswer = (t: string) => /^(选 |我选 )/.test(t) || t.startsWith("【经理描述】");
const isUnsure = (t: string) => !isAnswer(t) && /不确定|不清楚|说不好|拿不准|看看具体的人/.test(t);

// 最近一次发出、尚未回答的题目
function pendingCard(messages: LlmMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.tool_calls) {
      const tc = [...m.tool_calls].reverse().find((t) => t.function.name === "ask_choice" || t.function.name === "show_ab");
      if (tc) return { name: tc.function.name, args: JSON.parse(tc.function.arguments) };
    }
  }
  return null;
}

export function replayStep(messages: LlmMessage[], state: SessionState): Assistant {
  let lastUserIdx = -1;
  messages.forEach((m, i) => { if (m.role === "user") lastUserIdx = i; });
  const step = messages.slice(lastUserIdx + 1).filter((m) => m.role === "assistant").length;
  const answer = lastUser(messages).replace(/\n\n\[系统合规提示[\s\S]*$/, "");
  const turn = messages.filter((m) => m.role === "user" && isAnswer(m.content)).length - 1;
  const unsure = isUnsure(answer);
  const pending = pendingCard(messages);
  const reask = () => pending ? call(pending.name, { ...pending.args, repeat: true }) : null;

  // ---- 「我还不确定」：升级澄清方式 ----
  if (unsure && pending) {
    if (pending.args.dimension_id === "years" && pending.name === "ask_choice") {
      const shared: Filter[] = [{ field: "background", op: "in", value: ["业务分析", "数据分析", "运营转分析"] }, { field: "skill:SQL", op: ">=", value: 3 }, { field: "expected_salary", op: "<=", value: 32 }];
      const { a, b } = findContrast(BA_DATASET, [{ field: "years", op: ">=", value: 2 }, { field: "years", op: "<=", value: 2.5 }], [{ field: "years", op: ">=", value: 4 }, { field: "years", op: "<=", value: 5 }], shared);
      const S: Array<() => Assistant> = [
        () => say(null, call("find_contrast_pair", { dimension_id: "years", side_a: [{ field: "years", op: ">=", value: 2 }, { field: "years", op: "<=", value: 2.5 }], side_b: [{ field: "years", op: ">=", value: 4 }, { field: "years", op: "<=", value: 5 }], shared })),
        () => say(
          "没关系，年限这种事看真人更直观。我从人才库挑了背景、技能都差不多，只有年限不同的两个人。",
          call("show_ab", {
            dimension_id: "years", question: "这两位，你更想要哪一位？",
            why: "只看年限数字很难判断，让你在其他条件相近的两个人里做选择，能看出你真正需要的是潜力还是即战力。",
            candidate_a_id: a[0]?.id ?? "C04", label_a: "2 年左右 · 潜力型", candidate_b_id: b[0]?.id ?? "C07", label_b: "4–5 年 · 即战力型",
          }),
        ),
      ];
      return S[step]?.() ?? say(null);
    }
    const S: Array<() => Assistant> = [
      () => say(`没关系，我换个角度说：${pending.args.why} 凭第一直觉选就好，后面随时可以改。`, reask()!),
    ];
    return S[step]?.() ?? say(null);
  }

  // ---- 经理插问：查证 → 简短回答 → 回到主线 ----
  if (!isAnswer(answer) && pending) {
    const back = "我们回到刚才的问题。";
    let S: Array<() => Assistant>;
    if (/薪资|多少钱|工资|行情|贵|预算|报价/.test(answer)) {
      S = [
        () => say(null, call("search_external_market", { topic: "salary" })),
        () => {
          const [, b23, b35] = MARKET.salary.bands;
          return say(`外部市场（模拟数据）：北京商业分析师 2–3 年月薪中位数 ${b23.p50}k，3–5 年中位数 ${b35.p50}k、P75 ${b35.p75}k。你的预算上限 32k，大约在 3–5 年的中位数偏上；咨询转互联网的人期望普遍再高 20%–30%。${back}`, reask()!);
        },
      ];
    } else if (/多少人|够不够|人才库|难招|好招|招得到|供给/.test(answer)) {
      S = [
        () => say(null, call("run_funnel", {}), call("search_external_market", { topic: "supply" })),
        () => say(`内部人才库按目前的硬性条件有 ${state.funnel?.final ?? "-"} 人满足（${state.funnel?.ratio ?? "-"}%）。外部市场上，3–5 年商业分析的供需比约 2.1:1，但如果叠加「硕士 + 统计 / 数学」会降到 0.8:1，属于稀缺。${back}`, reask()!),
      ];
    } else if (/竞对|别家|其他公司|同行|竞争/.test(answer)) {
      S = [
        () => say(null, call("search_external_market", { topic: "competition" })),
        () => say(`同城本地生活 / 电商平台在招同类岗位约 40 家，头部平台给 3–5 年的报价普遍在 30–38k；要求硕士 + 统计的岗位平均要招 58 天，放宽学历的只要 32 天。${back}`, reask()!),
      ];
    } else if (/为什么|干嘛|有必要|什么意思/.test(answer)) {
      S = [() => say(`这一题的依据是：${pending.args.why} 这一项定不下来，HR 筛人时就会两头跑偏。${back}`, reask()!)];
    } else {
      S = [() => say(`记下了：「${answer.slice(0, 40)}」。（演示回放模式只能识别薪资、人才库、竞对、原因这几类插问；接入模型后可以处理任意问题。）${back}`, reask()!)];
    }
    return S[step]?.() ?? say(null);
  }

  const T: Array<Array<() => Assistant>> = [
    // T0 准备 + 开场
    [
      () => say(null, call("prepare_dataset", { role_title: "商业分析师", department: "本地生活事业部 · 经营分析组", manager_brief: MANAGER_BRIEF })),
      () => say(null, call("get_reference", { type: "similar_role" }), call("get_reference", { type: "manager_history" })),
      () => say(null, call("search_external_market", { topic: "salary" }), call("search_external_market", { topic: "supply" }), call("web_search", { query: "2026 北京 商业分析师 薪资 本地生活" })),
      () => say(null, call("init_profile", { dimensions: INIT_DIMS })),
      () => say(null, call("backtest", {})),
      () => {
        const b = state.baseline_backtest!;
        const missed = b.rows.filter((r) => r.expected_pass && !r.predicted_pass).length;
        const yearsOpts: [string, string, Filter[]][] = [
          ["A", "1–3 年（按口述）", [{ field: "years", op: ">=", value: 1 }, { field: "years", op: "<=", value: 3 }]],
          ["B", "2–5 年（取交集，参考你的历史录用）", [{ field: "years", op: ">=", value: 2 }, { field: "years", op: "<=", value: 5 }]],
          ["C", "3–5 年（按 JD）", [{ field: "years", op: ">=", value: 3 }, { field: "years", op: "<=", value: 5 }]],
        ];
        const nConflict = state.dimensions.filter((d) => d.status === "冲突").length;
        const nVague = state.dimensions.filter((d) => d.status === "含糊").length;
        return say(
          `我先看了 JD、你过去两年招的 12 个人、同类岗位和外部市场数据，发现 ${nConflict} 处冲突、${nVague} 处含糊。最关键的一点：按原 JD 口径回测你的历史招聘，一致率只有 ${b.agreement}%——你评价合格以上的 6 个人里，有 ${missed} 个会被原 JD 筛掉。我们从影响最大的开始。`,
          call("ask_choice", {
            dimension_id: "years",
            question: "经验年限，你更倾向哪个口径？",
            why: "你说 1–3 年，JD 写 3–5 年，几乎没有交集；你录用的 8 人平均 3.4 年，1 年经验的江同学因业务理解浅被拒。",
            options: yearsOpts.map(([key, label, fs]) => ({ key, label, detail: `人才库约 ${count(fs)} 人` })),
          }),
        );
      },
    ],
    // T1 年限 → 背景类型真人 AB
    [
      () => {
        const pick: [number, number, string, string] =
          /潜力型/.test(answer) ? [2, 5, "2–5 年，偏好 2–3 年潜力型", "真人对比中经理选择潜力型"] :
          /即战力型/.test(answer) ? [3, 5, "3–5 年，要求能直接上手", "真人对比中经理选择即战力型"] :
          /选 A/.test(answer) ? [1, 3, "1–3 年", "经理选择按口述口径"] :
          /选 C/.test(answer) ? [3, 5, "3–5 年", "经理选择按 JD 口径"] :
          [2, 5, "2–5 年相关全职经验", "取口述与 JD 的交集，并与历史录用平均 3.4 年吻合"];
        return say(null, call("update_dimension", {
          id: "years", status: "已澄清", level: "硬性", final: pick[2],
          filters: [{ field: "years", op: ">=", value: pick[0] }, { field: "years", op: "<=", value: pick[1] }],
          how_to_check: `简历中数据 / 商业分析相关全职经验累计 ${pick[0]}–${pick[1]} 年（实习不计）`,
          rationale: pick[3], decided_by: /型/.test(answer) ? "真人 AB" : "经理选择",
        }));
      },
      () => say(null, call("find_contrast_pair", {
        dimension_id: "background",
        side_a: [{ field: "background", op: "in", value: ["咨询"] }],
        side_b: [{ field: "background", op: "in", value: ["业务分析", "运营转分析"] }],
        shared: [{ field: "years", op: ">=", value: 2 }, { field: "years", op: "<=", value: 5 }],
      })),
      () => say(
        `年限定了${state.backtest && state.backtest.agreement < 80 ? `（提醒：按这个口径，回测一致率是 ${state.backtest.agreement}%，自检时我会再提一次）` : ""}。下面是最关键的一处：背景类型。抽象地问「要不要咨询背景」不好答，我从人才库挑了两位年限相同的真人，你凭直觉选一个。`,
        call("show_ab", {
          dimension_id: "background",
          question: "如果明天只能约一位来面试，你约谁？",
          why: "你希望要咨询背景，但你录用过的 2 位咨询背景同学都在试用期离开；我想看看你面对真人时的实际偏好。",
          candidate_a_id: "C01", label_a: "咨询顾问型", candidate_b_id: "C02", label_b: "业务分析型",
        }),
      ),
    ],
    // T2 背景 → 技术深度取舍
    [
      () => {
        const choseA = /咨询顾问型|顾以宁|选 ?A\b|\bA\b/.test(answer) && !/业务分析型|方嘉禾/.test(answer);
        return say(
          choseA
            ? "你选了咨询顾问型。提醒一个数据：你录用过的 2 位咨询背景同学都在试用期离开，原因都是不愿动手取数。所以我保留「SQL 精通」作为硬门槛，咨询背景只作为加分。"
            : "你选了业务分析型——这和你嘴上说的「最好咨询出来」正好相反，但和你过去的招聘结果一致：2 位咨询背景同学都在试用期离开。我把它理解为：你真正要的是「汇报讲得清」，而不是咨询背景本身。",
          call("update_dimension", {
            id: "background", status: "已澄清", level: "加分",
            final: "不要求咨询背景；业务分析 / 运营转分析型优先",
            filters: [{ field: "background", op: "in", value: ["业务分析", "运营转分析"] }],
            how_to_check: "简历中有业务线经营分析经历；咨询背景需确认有独立取数经历",
            rationale: choseA ? "经理偏好咨询型，但历史 2/2 咨询背景试用期淘汰，以取数能力兜底" : "真人 AB 中经理选择业务分析型，与历史表现一致",
            decided_by: "真人 AB + 历史回测",
          }),
          call("update_dimension", {
            id: "reporting", name: "结构化汇报能力", type: "软素质", status: "已澄清", level: "加分", impact: 3,
            sources: { manager: "跟老板汇报能讲清楚" }, final: "能用结构化方式向业务负责人汇报结论",
            how_to_check: "面试 case 最后 5 分钟，请候选人向「业务负责人」汇报结论", decided_by: "从「咨询背景」诉求中拆出",
          }),
        );
      },
      () => say(
        "接下来是技术门槛。",
        call("ask_choice", {
          dimension_id: "tech_depth",
          question: "Python 和因果推断，要作为硬性门槛吗？",
          why: "JD 要求「精通 Python + 因果推断」，你只提到能拉数；你团队里因果推断最强的孟同学评价是「合格」，原因是结论偏学术。",
          options: [
            { key: "A", label: "硬性：必须精通", detail: `叠加后人才库仅剩约 ${count([{ field: "skill:Python", op: ">=", value: 3 }, { field: "skill:因果推断", op: ">=", value: 2 }, { field: "skill:SQL", op: ">=", value: 3 }])} 人` },
            { key: "B", label: "加分：SQL 精通就够，建模能力加分", detail: "和你的历史录用最一致" },
            { key: "C", label: "不考察" },
          ],
        }),
      ),
    ],
    // T3 技术深度 → 合规追问
    [
      () => say(null, call("update_dimension", {
        id: "tech_depth", status: "已澄清", level: "加分", final: "Python / 因果推断 / AB 实验为加分项",
        filters: [{ field: "skill:Python", op: ">=", value: 2 }],
        how_to_check: "简历中有实验设计或因果评估项目；面试追问方法选择理由", rationale: "历史上技术最强者表现仅合格，业务落地更关键", decided_by: "经理选择",
      })),
      () => say(
        "还有一处需要换个说法。",
        call("ask_choice", {
          dimension_id: "compliance",
          question: "你提到「年轻一点、扛得住节奏」。年龄不能写进标准，你真正担心的是哪一点？",
          why: "年龄属于歧视性条件，写进 JD 或筛选标准有合规风险；但背后的诉求通常是可以考察的。",
          options: [
            { key: "A", label: "学习和上手速度", detail: "改写为：近一年快速掌握新领域 / 新工具的案例" },
            { key: "B", label: "能适应业务高峰期节奏", detail: "改写为：有大促 / 节假日高峰期支持经历" },
            { key: "C", label: "薪资成本可控", detail: "已由薪资预算覆盖" },
            { key: "D", label: "好沟通、好带", detail: "改写为：接受反馈、协作意愿" },
          ],
        }),
      ),
    ],
    // T4 合规 → 学历（带漏斗数据）
    [
      () => say(null, call("update_dimension", {
        id: "compliance", name: "学习速度与节奏适应", status: "已澄清", level: "加分",
        final: "以「学习速度 + 适应业务高峰期节奏」替代年龄偏好",
        how_to_check: "面试追问：最近一年快速掌握的新技能及用时；过往大促 / 高峰期的工作方式",
        rationale: "年龄不可作为标准，按经理真实诉求改写", decided_by: "经理选择 + 合规改写",
      })),
      () => say(null, call("run_funnel", {})),
      () => {
        const now = state.funnel!.final;
        const withEdu = runFunnel([...state.dimensions, {
          id: "tmp", name: "学历", type: "硬事实", status: "明确", level: "硬性", impact: 1, sources: {},
          filters: [{ field: "degree", op: ">=", value: "硕士" }, { field: "major", op: "in", value: ["统计", "数学", "计算机"] }],
        }], BA_DATASET).final;
        return say(
          `目前的硬性条件下，人才库有 ${now} 人满足。`,
          call("ask_choice", {
            dimension_id: "education",
            question: "学历和专业，怎么定？",
            why: `JD 要求硕士 + 统计 / 数学 / 计算机，加上后人才库会从 ${now} 人降到 ${withEdu} 人；而你评价优秀的 3 个人里有 2 个是本科，专业是经济和计算机。`,
            options: [
              { key: "A", label: "保留硬性：硕士 + 相关专业", detail: `人才库剩 ${withEdu} 人` },
              { key: "B", label: "不设门槛，统计 / 数学专业加分", detail: `人才库保持 ${now} 人` },
            ],
          }),
        );
      },
    ],
    // T5 学历 → 行业
    [
      () => say(null, call("update_dimension", {
        id: "education", status: "已澄清", level: "加分", final: "本科及以上即可；统计 / 数学专业加分",
        filters: [{ field: "major", op: "in", value: ["统计", "数学"] }],
        how_to_check: "学历信息核验；专业背景作为排序参考", rationale: "硕士门槛会筛掉历史优秀者，且大幅收窄人才池", decided_by: "经理选择 + 漏斗 + 回测",
      })),
      () => say(
        unsure ? "没关系，我换个问法。" : null,
        call("ask_choice", {
          dimension_id: "industry",
          question: "电商 / 本地生活的行业经验，要作为硬性吗？",
          why: "JD 写「优先」，你没提；你录用的 3 位优秀同学都来自这两个行业。",
          options: [
            { key: "A", label: "硬性：必须有", detail: `人才库约 ${count([...state.dimensions.flatMap((d) => (d.level === "硬性" ? d.filters ?? [] : [])), { field: "industries", op: "any", value: ["电商", "本地生活"] }])} 人` },
            { key: "B", label: "加分：有更好，没有也能看" },
          ],
        }),
      ),
    ],
    // T6 行业 → Agent 自主补齐低影响项 → 自检 → 交付
    [
      () => {
        const hard = /\bA\b|硬性|必须/.test(answer) && !/\bB\b|加分/.test(answer);
        return say(null,
          call("update_dimension", {
            id: "industry", status: "已澄清", level: hard ? "硬性" : "加分", final: "电商 / 本地生活行业经验",
            filters: [{ field: "industries", op: "any", value: ["电商", "本地生活"] }],
            how_to_check: "简历中在电商 / 本地生活业务线有分析经历", decided_by: "经理选择",
          }),
          call("update_dimension", {
            id: "mgmt", status: "已澄清", level: "不考察", final: "不要求团队管理经验；带新人经验加分",
            rationale: "经理担心太资深不好管；历史上带新人的唐同学表现优秀", decided_by: "Agent 默认（依据：口述 + 历史录用），经理可推翻",
          }),
          call("update_dimension", {
            id: "report_only", name: "纯报表背景", type: "软素质", status: "已澄清", level: "否决", impact: 2,
            sources: { history: "陆同学因只做报表、无分析结论被拒；同类岗位 BI 报表背景试用期通过率 60%" },
            final: "只做报表开发、无分析结论输出的背景不考虑",
            filters: [{ field: "background", op: "not_in", value: ["BI报表"] }],
            how_to_check: "简历中只有报表 / ETL 开发、没有分析结论或业务建议", decided_by: "Agent 默认（依据：历史淘汰记录），经理可推翻",
          }),
        );
      },
      () => say(null, call("self_check", {})),
      () => {
        const s = state;
        const years = s.dimensions.find((d) => d.id === "years")?.final ?? "2–5 年";
        const head = "我按证据补了两个小项，你可以推翻：① 团队管理不考察，带新人经验加分；② 纯报表背景一票否决。";
        const nums = `人才库 ${s.funnel!.final} 人满足（${s.funnel!.ratio}%），回测一致率 ${s.backtest!.agreement}%（原 JD 口径 ${s.baseline_backtest!.agreement}%）`;
        return s.self_check_passed
          ? say(`${head}自检通过：${nums}。标准已生成，请在交付页确认。`, call("finalize", { summary: `能独立取数、懂到店业务、能把分析结论推动落地的商业分析师（${years}）` }))
          : say(`${head}自检有提醒：${nums}，偏差主要来自你选定的口径。按你的选择交付，风险会写进交付物，你可以回到对话里随时调整。`,
              call("finalize", { summary: `能独立取数、懂到店业务、能把分析结论推动落地的商业分析师（${years}）`, accepted_risks: "经理坚持当前口径，接受回测偏差" }));
      },
    ],
  ];

  const fnTurn = T[turn]?.[step];
  if (!fnTurn) return T[turn] ? say(null) : say("（演示回放模式到此结束。配置模型 Key 后，Agent 会真正理解你的回答并自主决定下一步。）");
  return fnTurn();
}

const REPLAY_WRITER = {
  summary: "",
  jd: {
    title: "商业分析师（到店业务经营分析）",
    sections: [
      { heading: "岗位职责", items: [
        "负责到店业务（餐饮 / 休闲娱乐商户）核心经营指标的监控与异动分析；",
        "围绕商户分层、流失、供给质量等问题开展专题分析，输出可落地的策略建议；",
        "与运营、产品团队协作推动策略落地，并负责效果复盘；",
        "向业务负责人定期汇报经营洞察。",
      ] },
      { heading: "任职要求", items: [
        "本科及以上学历，2–5 年数据分析 / 商业分析相关全职经验；",
        "SQL 精通，能独立完成取数与分析建模，不依赖数仓排期；",
        "有「分析 → 策略 → 结果」的完整闭环案例，能把数据结论转化为业务动作；",
      ] },
      { heading: "加分项", items: [
        "有电商 / 本地生活业务线分析经验；",
        "熟悉 Python、AB 实验或因果推断方法；",
        "统计 / 数学等相关专业背景；",
        "结构化汇报能力强，有带新人经验；",
        "能快速学习新领域，适应业务高峰期节奏。",
      ] },
    ],
  },
  jd_changes: [
    { before: "硕士及以上学历，统计学、数学、计算机等相关专业", after: "本科及以上学历；统计 / 数学专业加分", reason: "硕士门槛会筛掉经理评价优秀的 3 人中的 2 人，且大幅收窄人才池" },
    { before: "3–5 年互联网数据分析或商业分析经验", after: "2–5 年数据分析 / 商业分析相关全职经验", reason: "按经理在澄清中确定的年限口径；历史录用平均 3.4 年" },
    { before: "精通 SQL、Python，熟悉因果推断、AB 实验方法", after: "SQL 精通为硬性；Python / 因果推断 / AB 实验为加分项", reason: "历史上技术最强者仅评合格；经理更看重独立取数与业务落地" },
    { before: "（无）", after: "有「分析 → 策略 → 结果」的完整闭环案例", reason: "经理的「要懂业务」，与历史优秀者的共同特征" },
    { before: "具备团队管理经验者优先", after: "（删除）；带新人经验加分", reason: "经理担心太资深不好管，岗位定位为骨干而非管理者" },
    { before: "沟通能力强，抗压能力强", after: "结构化汇报能力强；能适应业务高峰期节奏", reason: "把空泛描述改成可考察的行为；替代口述中的「年轻、能加班」" },
  ],
  interview_questions: {},
};

// 按经理最终选择的年限口径改写回放用 JD
export function replayWriter(state: SessionState) {
  const fs = state.dimensions.find((d) => d.id === "years")?.filters ?? [];
  const lo = fs.find((f) => f.op === ">=")?.value ?? 2;
  const hi = fs.find((f) => f.op === "<=")?.value ?? 5;
  return JSON.parse(JSON.stringify(REPLAY_WRITER).replaceAll("2–5 年数据分析", `${lo}–${hi} 年数据分析`).replaceAll("after\":\"2–5 年", `after\":\"${lo}–${hi} 年`));
}
