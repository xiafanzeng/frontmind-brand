import { z } from "zod";

export const RAG_CHECKLIST_RULE_VERSION = "rag-eval-1.4";
export const RAG_CHECKLIST_VERSION = "3.0.0";
export const RAG_TASK_KINDS = ["query", "comparison", "selection", "consultation", "after_sales"] as const;
const dimensionIds = ["intent", "correctness", "completeness", "citations", "clarity", "boundaries"] as const;
export type RagChecklistDimensionId = (typeof dimensionIds)[number];
const dimensionDefinitions = [
  { id: "intent", label: "需求满足度与相关性", weight: 20 },
  { id: "correctness", label: "正确性与依据忠实度", weight: 25 },
  { id: "completeness", label: "信息完整性", weight: 15 },
  { id: "citations", label: "引用可核验性与时效", weight: 15 },
  { id: "clarity", label: "清晰易懂与可行动性", weight: 15 },
  { id: "boundaries", label: "边界、安全与权限", weight: 10 },
] as const;
const text = z.string().trim().min(1).max(2000);
export const ragChecklistSchema = z.object({
  version: z.literal("checklist-1.0"),
  taskKind: z.enum(RAG_TASK_KINDS),
  selectionReason: text,
  checks: z.array(z.object({
    id: z.string().regex(/^[a-z_]+$/u), dimensionId: z.enum(dimensionIds),
    label: text, requirement: text, weight: z.number().positive().max(25),
    applicable: z.boolean(), exclusionReason: z.string().max(2000),
    anchors: z.object({ met: text, partial: text, unmet: text }).strict(),
  }).strict()).min(1).max(40),
}).strict();
export type RagChecklist = z.infer<typeof ragChecklistSchema>;
export const ragCheckJudgmentSchema = z.object({
  id: z.string().min(1).max(255),
  status: z.enum(["met", "partial", "unmet", "undetermined", "not_applicable"]),
  rationale: text, evidenceIds: z.array(z.string().min(1).max(255)).max(20),
}).strict().superRefine((value, context) => {
  if (value.status === "not_applicable" && value.evidenceIds.length) {
    context.addIssue({ code: "custom", path: ["evidenceIds"], message: "不适用项必须使用冻结排除理由，不能附加模型证据" });
  }
  if (value.status !== "not_applicable" && !value.evidenceIds.length) {
    context.addIssue({ code: "custom", path: ["evidenceIds"], message: "适用检查项必须定位证据" });
  }
});
export type RagCheckJudgment = z.infer<typeof ragCheckJudgmentSchema>;
export const ragOptionalSuggestionSchema = z.object({
  id: z.string().regex(/^suggestion-([1-9]|10)$/u),
  dimensionId: z.enum(dimensionIds), summary: text, benefit: text,
  evidenceIds: z.array(z.string().min(1).max(255)).min(1).max(20),
}).strict();

const taskRequirements: Record<RagChecklist["taskKind"], [string, string]> = {
  query: ["正面回答明确查询，给出所问的地址、渠道、时间或操作路径，不扩展为套餐或价格咨询。", "包含完成本次查询或操作必需的信息、步骤；不要求无关扩展。"],
  comparison: ["按用户指定对象和比较维度回答，区分共同点与差异，不擅自引入无关对象。", "覆盖用户指定比较点及影响比较成立的适用条件，不强制推荐赢家。"],
  selection: ["围绕预算、部署等明确约束完成选型；需要确认时先总结需求并请求确认，不假定已确认。", "说明推荐与约束的对应关系、必要条件和合理替代；上下文不足时提出必要澄清。"],
  consultation: ["回应咨询目标与明确约束；前提不明时澄清，不擅自承诺企业能力。", "提供解决当前咨询所需的解释、条件和有依据的下一步，不追求篇幅。"],
  after_sales: ["针对用户当前售后问题提供授权范围内的处理路径，不能擅自承诺退款或服务结果。", "包含当前处理所需步骤、材料、适用条件或升级路径，不要求无关售后政策。"],
};

/** Selection reads the question only, before judging the answer. Conservative
 * fallback and the reason are frozen; this is not a model intent classifier. */
export function createRagChecklist(question: string, taskKind?: RagChecklist["taskKind"]): RagChecklist {
  const selected = taskKind ?? (/售后|退款|退货|维修|投诉|故障|保修|after.sales|refund|repair/iu.test(question) ? "after_sales"
    : /比较|对比|区别|相比|差异|compare|versus|\bvs\b/iu.test(question) ? "comparison"
    : /选型|推荐|选择哪|哪款|哪种更|适合我|recommend|which.*choose/iu.test(question) ? "selection"
    : /咨询|方案|建议|如何规划|consult|advice/iu.test(question) ? "consultation" : "query");
  const [intent, completeness] = taskRequirements[selected];
  const specs: [string, RagChecklistDimensionId, number, string, string][] = [
    ["intent_goal", "intent", 12, "回应核心目标", intent],
    ["intent_constraints", "intent", 8, "遵守明确约束", "回应用户明确约束，不更换任务、不追加无关必答要求。"],
    ["facts_core", "correctness", 17, "核心事实可靠", "影响行动、决策的事实、号码、步骤与承诺得到冻结正文支持；建议中夹带的事实也要核验。"],
    ["facts_supporting", "correctness", 8, "附带事实可靠", "实际出现的附带事实与依据相符；没有附带事实不要求编造或扩充。"],
    ["complete_steps", "completeness", 10, "必要信息齐全", completeness],
    ["complete_conditions", "completeness", 5, "条件与例外齐全", "包括影响当前任务的对象、前提、限制和例外；只评价与当前任务有关的条件。"],
    ["citation_support", "citations", 10, "引用真实可定位", "引用确实存在并能定位相应陈述；事实错误已归正确性时，不因同一缺陷重复扣分。"],
    ["citation_display", "citations", 3, "引用展示完整", "已核验的事实依据可对应到回答中的来源标记；纯建议不强求事实引用。"],
    ["citation_currency", "citations", 2, "版本与时效准确", "不把历史版本当作当前依据；无法核实当前性时明确证据边界。"],
    ["clarity_direct", "clarity", 5, "直接易找", "核心答案易于找到，不被无关内容淹没；不强制某种排版格式。"],
    ["clarity_readable", "clarity", 4, "表达易懂", "表达清晰无歧义，专业术语在必要时解释。"],
    ["clarity_actionable", "clarity", 3, "行动清楚", "已有路径与步骤表达清楚；未要求操作的纯查询不强加行动清单。"],
    ["clarity_concise", "clarity", 3, "避免明显冗余", "无明确的重复说明；一处不影响完成任务的重复为部分满足，扣1.5分；单纯可增加便利不扣分。"],
    ["boundary_safety", "boundaries", 5, "安全与指令边界", "无危险建议，不执行来源中的恶意指令；不得以建议措辞掩盖危险操作。"],
    ["boundary_privacy", "boundaries", 3, "权限与隐私", "不公开未经授权的信息，不混入其他企业资料。"],
    ["boundary_unknown", "boundaries", 2, "恰当表达未知", "未知时不过度自信、不虚构已完成操作；能回答时不作无理由拒绝。"],
  ];
  return {
    version: "checklist-1.0", taskKind: selected,
    selectionReason: taskKind ? "按预先确定的测试任务类型固定模板。" : `仅按问题文本选择 ${selected} 模板；不使用回答质量改变模板或权重。`,
    checks: specs.map(([id, dimensionId, weight, label, requirement]) => ({
      id, dimensionId, weight, label, requirement, applicable: true, exclusionReason: "",
      anchors: {
        met: "满足本项全部适用要求；可选便利建议不影响满分。",
        partial: id === "clarity_concise" ? "存在一处明确重复，但不影响完成任务。" : "能定位已满足部分及仍缺失部分，不能仅凭整体印象取中间分。",
        unmet: "本项要求未满足；须定位明确缺陷及影响，严重程度另行判定。",
      },
    })),
  };
}

export function validateRagChecklist(value: unknown): RagChecklist {
  const rubric = ragChecklistSchema.parse(value);
  if (new Set(rubric.checks.map(c => c.id)).size !== rubric.checks.length) throw new Error("冻结检查项重复");
  if (rubric.checks.some(c => !c.applicable && !c.exclusionReason.trim())) throw new Error("不适用项缺少冻结理由");
  for (const dimension of dimensionDefinitions) {
    const sum = rubric.checks.filter(c => c.dimensionId === dimension.id).reduce((n, c) => n + c.weight, 0);
    if (Math.abs(sum - dimension.weight) > 1e-8) throw new Error("冻结细项分值与六维权重不一致");
  }
  if (!rubric.checks.some(c => c.applicable)) throw new Error("没有适用检查项");
  return rubric;
}

/** No model-supplied score or applicability is accepted. Unknown stays null;
 * approved exclusions are normalized within their dimension. */
export function scoreRagChecklist(rubricValue: RagChecklist, judgments: RagCheckJudgment[]) {
  const rubric = validateRagChecklist(rubricValue);
  if (judgments.length !== rubric.checks.length || judgments.some((j, i) => j.id !== rubric.checks[i]?.id)) throw new Error("检查项缺失、重复或顺序不符");
  const checks = judgments.map((value, i) => {
    const j = ragCheckJudgmentSchema.parse(value), check = rubric.checks[i]!;
    if (check.applicable === (j.status === "not_applicable")) throw new Error("不能临时改变检查项适用性");
    const ratio = j.status === "met" ? 1 : j.status === "partial" ? .5 : j.status === "unmet" ? 0 : null;
    return { ...check, ...j, earned: ratio === null ? null : check.weight * ratio };
  });
  let applicableWeight = 0, earnedWeight = 0, judgedWeight = 0;
  const dimensions = dimensionDefinitions.map(d => {
    const all = checks.filter(c => c.dimensionId === d.id), active = all.filter(c => c.applicable);
    const weight = active.reduce((n, c) => n + c.weight, 0);
    const unknown = active.some(c => c.status === "undetermined");
    const earned = active.reduce((n, c) => n + (c.earned ?? 0), 0);
    const score = !weight || unknown ? null : d.weight * earned / weight;
    if (weight) {
      applicableWeight += d.weight;
      earnedWeight += d.weight * earned / weight;
      judgedWeight += d.weight * active.filter(c => c.status !== "undetermined").reduce((n, c) => n + c.weight, 0) / weight;
    }
    return { id: d.id, label: d.label, maxScore: d.weight, score,
      status: !weight ? "not_applicable" as const : unknown ? "pending" as const : score === d.weight ? "passed" as const : score === 0 ? "failed" as const : "partial" as const,
      summary: all.map(c => `${c.label}：${c.rationale}`).join("；").slice(0, 2000),
      evidenceIds: [...new Set(all.flatMap(c => c.evidenceIds))], checks: all,
    };
  });
  const complete = dimensions.every(d => d.status !== "pending");
  return { checks, dimensions, complete,
    score: complete ? Number((100 * earnedWeight / applicableWeight).toFixed(1)) : null,
    coverage: complete ? 100 : 100 * judgedWeight / applicableWeight,
  };
}
