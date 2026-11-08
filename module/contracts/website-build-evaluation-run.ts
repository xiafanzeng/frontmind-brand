import { z } from "zod";

export const WEBSITE_BUILD_EVALUATION_CONTRACT_REVISION = 1;
export const WEBSITE_BUILD_EVALUATION_SKILL_VERSION = "2.0.0";
export const WEBSITE_BUILD_EVALUATION_RULE_VERSION = "website-build-eval-2.0";
export const WEBSITE_BUILD_EVALUATION_JUDGE_VERSION = "1.0.0";
export const WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION = "website-evidence-1.0";

export const WEBSITE_BUILD_EVALUATION_RUN_STATUSES = [
  "queued",
  "capturing",
  "running",
  "result_pending",
  "completed",
  "failed",
] as const;
export const websiteBuildEvaluationRunStatusSchema = z.enum(
  WEBSITE_BUILD_EVALUATION_RUN_STATUSES,
);
export type WebsiteBuildEvaluationRunStatus = z.infer<
  typeof websiteBuildEvaluationRunStatusSchema
>;

export const websiteBuildEvaluationStageSchema = z.literal("build_readiness");
export type WebsiteBuildEvaluationStage = z.infer<
  typeof websiteBuildEvaluationStageSchema
>;

export const WEBSITE_BUILD_EVALUATION_DIMENSIONS = [
  { id: "visitor_task", label: "访客任务完成度", weight: 20 },
  { id: "brand_consistency", label: "品牌一致性", weight: 15 },
  { id: "facts_evidence", label: "事实与证据", weight: 20 },
  { id: "information_architecture", label: "信息架构", weight: 15 },
  { id: "visual_usability", label: "视觉与可用性", weight: 15 },
  { id: "assistant_boundary", label: "助手集成与边界", weight: 15 },
] as const;

export const WEBSITE_BUILD_EVALUATION_DIMENSION_IDS =
  WEBSITE_BUILD_EVALUATION_DIMENSIONS.map(({ id }) => id) as [
    "visitor_task",
    "brand_consistency",
    "facts_evidence",
    "information_architecture",
    "visual_usability",
    "assistant_boundary",
  ];

export type WebsiteBuildEvaluationDimensionId =
  (typeof WEBSITE_BUILD_EVALUATION_DIMENSIONS)[number]["id"];

type CheckSeed = {
  id: string;
  dimensionId: WebsiteBuildEvaluationDimensionId;
  label: string;
  requirement: string;
};

const checks = (
  dimensionId: WebsiteBuildEvaluationDimensionId,
  values: ReadonlyArray<readonly [string, string, string]>,
): CheckSeed[] =>
  values.map(([id, label, requirement]) => ({
    id,
    dimensionId,
    label,
    requirement,
  }));

export const WEBSITE_BUILD_EVALUATION_CHECKS = [
  ...checks("visitor_task", [
    ["visitor_entry_clear", "入口清楚", "目标访客能识别任务入口和首个行动。"],
    ["visitor_path_continuous", "路径连续", "任务必经页面和交互之间不存在断路。"],
    ["visitor_success_reachable", "成功条件可达", "冻结成功条件可在成品中实际达成并确认。"],
    ["visitor_failure_recovery", "失败恢复明确", "失败、空状态和下一步恢复路径清楚。"],
  ]),
  ...checks("brand_consistency", [
    ["brand_identity", "品牌标识", "Logo、名称和身份表达与冻结品牌基准一致。"],
    ["brand_visual_tokens", "色彩与字体", "主辅色、字体偏好和视觉令牌一致应用。"],
    ["brand_voice", "语调与禁用表达", "文案符合语调关键词且未出现禁用表达。"],
    ["brand_cross_route", "跨页面一致性", "关键页面保持同一品牌身份和表达系统。"],
  ]),
  ...checks("facts_evidence", [
    ["facts_traceable", "核心声明可追溯", "关键事实能定位到允许公开的冻结证据。"],
    ["facts_not_invented", "无矛盾或臆造", "未发现无依据、冲突或扩大承诺的声明。"],
    ["facts_unknown_boundary", "未知项边界", "资料不足处明确表达未知、条件和时效。"],
    ["facts_public_privacy", "公开与隐私边界", "公开内容不泄漏私有资料或其他项目内容。"],
  ]),
  ...checks("information_architecture", [
    ["ia_required_routes", "必需页面完整", "冻结任务和主导航所需页面均存在。"],
    ["ia_navigation_links", "导航与链接", "全局导航、返回路径和关键链接有效。"],
    ["ia_hierarchy_labels", "层级与标签", "页面标题、区块层级和标签清楚可扫描。"],
    ["ia_long_content", "长内容组织", "最长内容页有可理解的分组和跨页关系。"],
  ]),
  ...checks("visual_usability", [
    ["visual_hierarchy", "层级与可读性", "视觉层级、对比度和正文可读性良好。"],
    ["visual_responsive", "三档响应式", "1440、390、320 三档无关键遮挡或横向溢出。"],
    ["visual_accessibility", "键盘触控无障碍", "焦点、语义、触控目标和辅助技术路径可用。"],
    ["visual_feedback_stability", "反馈与稳定性", "交互反馈明确且页面没有严重布局漂移。"],
  ]),
  ...checks("assistant_boundary", [
    ["assistant_entry", "助手入口可用", "助手入口可发现、可聚焦并能正确打开。"],
    ["assistant_identity_scope", "身份与范围", "助手身份、能力范围和限制清楚。"],
    ["assistant_unknown_privacy", "知识与未知兜底", "未知、隐私和越界问题得到安全处理。"],
    ["assistant_task_recovery", "任务或故障恢复", "按冻结任务完成隔离探测或验证静态故障恢复。"],
  ]),
] as const;

export type WebsiteBuildEvaluationCheckId =
  (typeof WEBSITE_BUILD_EVALUATION_CHECKS)[number]["id"];

const identifierSchema = z.string().trim().min(1).max(255);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const explanationSchema = z.string().trim().min(1).max(2_000);
const uniqueEvidenceIdsSchema = z
  .array(identifierSchema)
  .min(1)
  .max(20)
  .refine((values) => new Set(values).size === values.length, {
    message: "Evidence identifiers must be unique",
  });

export const websiteBuildEvaluationAnchorSchema = z.union([
  z.literal(0),
  z.literal(0.5),
  z.literal(1),
]);
export type WebsiteBuildEvaluationAnchor = z.infer<
  typeof websiteBuildEvaluationAnchorSchema
>;

export const websiteBuildEvaluationCheckJudgmentSchema = z
  .object({
    checkId: z.enum(
      WEBSITE_BUILD_EVALUATION_CHECKS.map(({ id }) => id) as [
        WebsiteBuildEvaluationCheckId,
        ...WebsiteBuildEvaluationCheckId[],
      ],
    ),
    anchor: websiteBuildEvaluationAnchorSchema,
    rationale: explanationSchema,
    evidenceIds: uniqueEvidenceIdsSchema,
  })
  .strict();
export type WebsiteBuildEvaluationCheckJudgment = z.infer<
  typeof websiteBuildEvaluationCheckJudgmentSchema
>;

export const WEBSITE_BUILD_EVALUATION_CRITICAL_RISK_KINDS = [
  "unsupported_or_contradicted_fact",
  "privacy_or_public_boundary",
  "core_task_broken",
  "severe_mobile_or_accessibility",
  "brand_identity_error",
  "assistant_safety_or_scope",
] as const;
export const websiteBuildEvaluationCriticalRiskKindSchema = z.enum(
  WEBSITE_BUILD_EVALUATION_CRITICAL_RISK_KINDS,
);

export const websiteBuildEvaluationCriticalRiskSchema = z
  .object({
    id: identifierSchema,
    kind: websiteBuildEvaluationCriticalRiskKindSchema,
    title: z.string().trim().min(1).max(255),
    summary: explanationSchema,
    checkIds: z
      .array(websiteBuildEvaluationCheckJudgmentSchema.shape.checkId)
      .min(1)
      .max(8),
    evidenceIds: uniqueEvidenceIdsSchema,
  })
  .strict();
export type WebsiteBuildEvaluationCriticalRisk = z.infer<
  typeof websiteBuildEvaluationCriticalRiskSchema
>;

export const websiteBuildEvaluationFindingTargetSchema = z
  .object({
    kind: z.enum([
      "route",
      "brand_kit",
      "design_preferences",
      "knowledge",
      "assistant",
      "build",
    ]),
    routeId: identifierSchema.optional(),
    sectionId: identifierSchema.optional(),
    anchor: z.string().trim().min(1).max(191).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "route" && !value.routeId) {
      context.addIssue({
        code: "custom",
        path: ["routeId"],
        message: "Route findings require routeId",
      });
    }
    if (value.kind !== "route" && value.routeId) {
      context.addIssue({
        code: "custom",
        path: ["routeId"],
        message: "Only route findings may carry routeId",
      });
    }
  });
export type WebsiteBuildEvaluationFindingTarget = z.infer<
  typeof websiteBuildEvaluationFindingTargetSchema
>;

export const websiteBuildEvaluationFindingSchema = z
  .object({
    id: identifierSchema,
    checkId: websiteBuildEvaluationCheckJudgmentSchema.shape.checkId,
    severity: z.enum(["low", "medium", "high", "critical"]),
    title: z.string().trim().min(1).max(255),
    summary: explanationSchema,
    impact: explanationSchema,
    suggestedAction: explanationSchema,
    evidenceIds: uniqueEvidenceIdsSchema,
    target: websiteBuildEvaluationFindingTargetSchema,
  })
  .strict();
export type WebsiteBuildEvaluationFinding = z.infer<
  typeof websiteBuildEvaluationFindingSchema
>;

function validateRepairItemIds(
  value: {
    criticalRisks: readonly { id: string }[];
    findings: readonly { id: string }[];
  },
  context: z.RefinementCtx,
) {
  for (const collection of ["criticalRisks", "findings"] as const) {
    const seen = new Set<string>();
    value[collection].forEach((item, index) => {
      if (seen.has(item.id)) {
        context.addIssue({
          code: "custom",
          path: [collection, index, "id"],
          message: `${collection} repair item ids must be unique`,
        });
      }
      seen.add(item.id);
    });
  }
}

export const websiteBuildEvaluationJudgeOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationToken: identifierSchema,
    evidenceFingerprint: sha256Schema,
    judgments: z
      .array(websiteBuildEvaluationCheckJudgmentSchema)
      .length(WEBSITE_BUILD_EVALUATION_CHECKS.length),
    criticalRisks: z
      .array(websiteBuildEvaluationCriticalRiskSchema)
      .max(20)
      .default([]),
    findings: z.array(websiteBuildEvaluationFindingSchema).max(40).default([]),
    summary: explanationSchema,
  })
  .strict()
  .superRefine(validateRepairItemIds);
export type WebsiteBuildEvaluationJudgeOutput = z.infer<
  typeof websiteBuildEvaluationJudgeOutputSchema
>;

export const websiteBuildEvaluationFrozenInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationToken: identifierSchema,
    evidenceFingerprint: sha256Schema,
    projectId: z.string().uuid(),
    buildId: z.string().uuid(),
    stage: websiteBuildEvaluationStageSchema,
    allowedEvidenceIds: z
      .array(identifierSchema)
      .min(1)
      .max(2_000)
      .refine((values) => new Set(values).size === values.length),
    evaluator: z
      .object({
        skillVersion: z.literal(WEBSITE_BUILD_EVALUATION_SKILL_VERSION),
        ruleVersion: z.literal(WEBSITE_BUILD_EVALUATION_RULE_VERSION),
        judgeVersion: z.literal(WEBSITE_BUILD_EVALUATION_JUDGE_VERSION),
        evidenceVersion: z.literal(WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION),
        provider: z.literal("openai_agents"),
        model: z.string().trim().min(1).max(64),
      })
      .strict(),
  })
  .strict();
export type WebsiteBuildEvaluationFrozenInput = z.infer<
  typeof websiteBuildEvaluationFrozenInputSchema
>;

export class WebsiteBuildEvaluationContractError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "WebsiteBuildEvaluationContractError";
  }
}

function assertCompleteJudgments(
  judgments: readonly WebsiteBuildEvaluationCheckJudgment[],
) {
  const expected = new Set(
    WEBSITE_BUILD_EVALUATION_CHECKS.map(({ id }) => id),
  );
  const observed = new Set(judgments.map(({ checkId }) => checkId));
  if (
    observed.size !== judgments.length ||
    observed.size !== expected.size ||
    [...expected].some((id) => !observed.has(id))
  ) {
    throw new WebsiteBuildEvaluationContractError(
      "CHECKLIST_INCOMPLETE",
      "Website evaluation requires one evidence-backed judgment per frozen check.",
    );
  }
}

export function validateWebsiteBuildEvaluationJudgeOutput(
  value: unknown,
  frozenValue: unknown,
): WebsiteBuildEvaluationJudgeOutput {
  const frozen = websiteBuildEvaluationFrozenInputSchema.parse(frozenValue);
  const output = websiteBuildEvaluationJudgeOutputSchema.parse(value);
  if (output.operationToken !== frozen.operationToken) {
    throw new WebsiteBuildEvaluationContractError(
      "OPERATION_TOKEN_MISMATCH",
      "Judge output is not bound to this operation.",
    );
  }
  if (output.evidenceFingerprint !== frozen.evidenceFingerprint) {
    throw new WebsiteBuildEvaluationContractError(
      "EVIDENCE_FINGERPRINT_MISMATCH",
      "Judge output is not bound to this evidence snapshot.",
    );
  }
  assertCompleteJudgments(output.judgments);
  const allowed = new Set(frozen.allowedEvidenceIds);
  const referenced = [
    ...output.judgments.flatMap(({ evidenceIds }) => evidenceIds),
    ...output.criticalRisks.flatMap(({ evidenceIds }) => evidenceIds),
    ...output.findings.flatMap(({ evidenceIds }) => evidenceIds),
  ];
  if (referenced.some((evidenceId) => !allowed.has(evidenceId))) {
    throw new WebsiteBuildEvaluationContractError(
      "EVIDENCE_REFERENCE_INVALID",
      "Judge output references evidence outside the frozen manifest.",
    );
  }
  return output;
}

export const websiteBuildEvaluationVerdictSchema = z.enum([
  "recommended",
  "repair_or_continue",
  "not_recommended",
]);
export type WebsiteBuildEvaluationVerdict = z.infer<
  typeof websiteBuildEvaluationVerdictSchema
>;

export type WebsiteBuildEvaluationScoringResult =
  | {
      complete: false;
      score: null;
      verdict: null;
      missingCheckIds: WebsiteBuildEvaluationCheckId[];
      dimensions: [];
    }
  | {
      complete: true;
      score: number;
      verdict: WebsiteBuildEvaluationVerdict;
      missingCheckIds: [];
      dimensions: Array<{
        id: WebsiteBuildEvaluationDimensionId;
        label: string;
        weight: number;
        score: number;
        normalizedScore: number;
        judgmentCount: 4;
        evidenceIds: string[];
      }>;
    };

export function scoreWebsiteBuildEvaluation(input: {
  judgments: readonly WebsiteBuildEvaluationCheckJudgment[];
  criticalRisks?: readonly WebsiteBuildEvaluationCriticalRisk[];
}): WebsiteBuildEvaluationScoringResult {
  const parsedJudgments: WebsiteBuildEvaluationCheckJudgment[] = [];
  const invalidCheckIds = new Set<WebsiteBuildEvaluationCheckId>();
  for (const value of input.judgments) {
    const parsed = websiteBuildEvaluationCheckJudgmentSchema.safeParse(value);
    if (!parsed.success) {
      const checkId = (value as { checkId?: WebsiteBuildEvaluationCheckId })
        ?.checkId;
      if (checkId) invalidCheckIds.add(checkId);
      continue;
    }
    parsedJudgments.push(parsed.data);
  }
  const counts = new Map<WebsiteBuildEvaluationCheckId, number>();
  for (const judgment of parsedJudgments) {
    counts.set(judgment.checkId, (counts.get(judgment.checkId) ?? 0) + 1);
  }
  const missingCheckIds = WEBSITE_BUILD_EVALUATION_CHECKS
    .map(({ id }) => id)
    .filter((id) => counts.get(id) !== 1 || invalidCheckIds.has(id));
  if (missingCheckIds.length > 0) {
    return {
      complete: false,
      score: null,
      verdict: null,
      missingCheckIds,
      dimensions: [],
    };
  }
  const byId = new Map(parsedJudgments.map((item) => [item.checkId, item]));
  const dimensions = WEBSITE_BUILD_EVALUATION_DIMENSIONS.map((dimension) => {
    const definitions = WEBSITE_BUILD_EVALUATION_CHECKS.filter(
      ({ dimensionId }) => dimensionId === dimension.id,
    );
    const judgments = definitions.map(({ id }) => byId.get(id)!);
    const normalizedScore =
      judgments.reduce((sum, { anchor }) => sum + anchor, 0) /
      judgments.length;
    return {
      id: dimension.id,
      label: dimension.label,
      weight: dimension.weight,
      score: Math.round(dimension.weight * normalizedScore * 100) / 100,
      normalizedScore: Math.round(normalizedScore * 10_000) / 100,
      judgmentCount: 4 as const,
      evidenceIds: [
        ...new Set(judgments.flatMap(({ evidenceIds }) => evidenceIds)),
      ],
    };
  });
  const score = Math.round(
    dimensions.reduce((sum, dimension) => sum + dimension.score, 0),
  );
  const criticalRisks = z
    .array(websiteBuildEvaluationCriticalRiskSchema)
    .parse(input.criticalRisks ?? []);
  const thresholdVerdict: WebsiteBuildEvaluationVerdict =
    score >= 85
      ? "recommended"
      : score >= 70
        ? "repair_or_continue"
        : "not_recommended";
  return {
    complete: true,
    score,
    verdict:
      criticalRisks.length > 0 ? "not_recommended" : thresholdVerdict,
    missingCheckIds: [],
    dimensions,
  };
}

export const websiteBuildEvaluationCoverageSchema = z
  .object({
    requiredEvidencePercent: z.literal(100),
    routeViewportPercent: z.literal(100),
    brandReferencePercent: z.number().finite().min(0).max(100),
    criticalRouteIds: z.array(identifierSchema).min(1).max(5),
    structuralRouteIds: z.array(identifierSchema).max(30),
    viewports: z
      .array(z.enum(["1440x1000", "390x844", "320x720"]))
      .length(3),
  })
  .strict();
export type WebsiteBuildEvaluationCoverage = z.infer<
  typeof websiteBuildEvaluationCoverageSchema
>;

const dimensionResultSchema = z
  .object({
    id: z.enum(WEBSITE_BUILD_EVALUATION_DIMENSION_IDS),
    label: z.string().min(1).max(255),
    weight: z.number().positive().max(100),
    score: z.number().finite().min(0).max(100),
    normalizedScore: z.number().finite().min(0).max(100),
    judgmentCount: z.literal(4),
    evidenceIds: z.array(identifierSchema).min(1).max(80),
  })
  .strict();

export const websiteBuildEvaluationReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    reportId: identifierSchema,
    runId: z.string().uuid(),
    projectId: z.string().uuid(),
    buildId: z.string().uuid(),
    buildOrdinal: z.number().int().positive(),
    stage: websiteBuildEvaluationStageSchema,
    evidenceFingerprint: sha256Schema,
    reportHash: sha256Schema,
    evaluator: websiteBuildEvaluationFrozenInputSchema.shape.evaluator.extend({
      skillHash: sha256Schema,
      outputHash: sha256Schema,
    }),
    coverage: websiteBuildEvaluationCoverageSchema,
    score: z.number().int().min(0).max(100),
    verdict: websiteBuildEvaluationVerdictSchema,
    summary: explanationSchema,
    judgments: z
      .array(websiteBuildEvaluationCheckJudgmentSchema)
      .length(WEBSITE_BUILD_EVALUATION_CHECKS.length),
    dimensions: z.array(dimensionResultSchema).length(
      WEBSITE_BUILD_EVALUATION_DIMENSIONS.length,
    ),
    criticalRisks: z.array(websiteBuildEvaluationCriticalRiskSchema).max(20),
    findings: z.array(websiteBuildEvaluationFindingSchema).max(40),
    relatedRagReportIds: z.array(identifierSchema).max(20).default([]),
    comparablePreviousReportId: identifierSchema.nullable().default(null),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime(),
  })
  .strict()
  .superRefine(validateRepairItemIds);
export type WebsiteBuildEvaluationReport = z.infer<
  typeof websiteBuildEvaluationReportSchema
>;

export const websiteBuildEvaluationRunDtoSchema = z
  .object({
    runId: z.string().uuid(),
    projectId: z.string().uuid(),
    buildId: z.string().uuid(),
    stage: websiteBuildEvaluationStageSchema,
    status: websiteBuildEvaluationRunStatusSchema,
    attemptCount: z.number().int().nonnegative(),
    automatic: z.boolean(),
    evidenceFingerprint: sha256Schema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    report: websiteBuildEvaluationReportSchema.nullable(),
    error: z
      .object({ code: identifierSchema, message: z.string().min(1).max(500) })
      .strict()
      .nullable(),
  })
  .strict();
export type WebsiteBuildEvaluationRunDto = z.infer<
  typeof websiteBuildEvaluationRunDtoSchema
>;

export const websiteBuildEvaluationRetryInputSchema = z
  .object({
    clientRequestId: z.string().trim().min(8).max(128),
  })
  .strict();
export type WebsiteBuildEvaluationRetryInput = z.infer<
  typeof websiteBuildEvaluationRetryInputSchema
>;

export const websiteBuildEvaluationReviewRepairItemSchema = z
  .object({
    kind: z.enum(["critical_risk", "finding"]),
    id: identifierSchema,
  })
  .strict();
export type WebsiteBuildEvaluationReviewRepairItem = z.infer<
  typeof websiteBuildEvaluationReviewRepairItemSchema
>;

const websiteBuildEvaluationReviewFields = {
  disposition: z.enum(["agree", "concerns", "reject"]),
  checkComments: z
    .array(
      z
        .object({
          checkId: websiteBuildEvaluationCheckJudgmentSchema.shape.checkId,
          comment: explanationSchema,
        })
        .strict(),
    )
    .max(24),
  repairItem: websiteBuildEvaluationReviewRepairItemSchema.optional(),
  note: z.string().trim().max(4_000).default(""),
} as const;

function requireTargetedReviewNote(
  value: { repairItem?: unknown; note: string },
  context: z.RefinementCtx,
) {
  if (value.repairItem && value.note.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["note"],
      message: "Targeted repair reviews require a note",
    });
  }
}

export const websiteBuildEvaluationReviewInputSchema = z
  .object({
    clientRequestId: z.string().trim().min(8).max(128),
    ...websiteBuildEvaluationReviewFields,
  })
  .strict()
  .superRefine(requireTargetedReviewNote);
export type WebsiteBuildEvaluationReviewInput = z.infer<
  typeof websiteBuildEvaluationReviewInputSchema
>;

export const websiteBuildEvaluationReviewSchema = z
  .object({
    ...websiteBuildEvaluationReviewFields,
    reviewId: z.string().uuid(),
    reportId: identifierSchema,
    reviewerUserId: z.number().int().positive(),
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine(requireTargetedReviewNote);
export type WebsiteBuildEvaluationReview = z.infer<
  typeof websiteBuildEvaluationReviewSchema
>;

export const websiteBuildEvaluationHistoryDtoSchema = z
  .object({
    latest: websiteBuildEvaluationRunDtoSchema.nullable(),
    history: z.array(websiteBuildEvaluationRunDtoSchema).max(20),
    nextCursor: z.string().min(1).max(512).nullable(),
  })
  .strict();
export type WebsiteBuildEvaluationHistoryDto = z.infer<
  typeof websiteBuildEvaluationHistoryDtoSchema
>;

export const websiteBuildEvaluationDecisionSchema = z
  .object({
    mode: z.enum([
      "follow_recommendation",
      "accepted_risk",
      "assessment_unavailable",
    ]),
    buildId: z.string().uuid(),
    runId: z.string().uuid().nullable().default(null),
    reportId: identifierSchema.nullable().default(null),
    reportHash: sha256Schema.nullable().default(null),
    // Twenty critical risks can coexist with the fixed recommendation risk.
    acknowledgedRiskIds: z.array(identifierSchema).max(64).default([]),
    reason: z.string().trim().max(2_000).default(""),
  })
  .strict()
  .superRefine((value, context) => {
    const informed = value.mode !== "follow_recommendation";
    if (informed && value.acknowledgedRiskIds.length < 1) {
      context.addIssue({
        code: "custom",
        path: ["acknowledgedRiskIds"],
        message: "Informed publication requires explicit risk acknowledgement",
      });
    }
    if (informed && !value.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Informed publication requires a reason",
      });
    }
    if (
      value.mode !== "assessment_unavailable" &&
      (!value.reportId || !value.reportHash)
    ) {
      context.addIssue({
        code: "custom",
        path: ["reportId"],
        message: "Report-based publication requires an immutable report",
      });
    }
    if (
      value.mode === "assessment_unavailable" &&
      (value.reportId || value.reportHash)
    ) {
      context.addIssue({
        code: "custom",
        path: ["reportId"],
        message: "Unavailable assessment cannot claim a completed report",
      });
    }
  });
export type WebsiteBuildEvaluationDecision = z.infer<
  typeof websiteBuildEvaluationDecisionSchema
>;

export const WEBSITE_BUILD_EVALUATION_JUDGE_WIRE_SCHEMA = z.toJSONSchema(
  websiteBuildEvaluationJudgeOutputSchema,
  { target: "draft-7" },
);
