import type { SiteOpsObservationV1 } from "../../../contracts/siteops-contract";
import type {
  WebsiteBuildEvaluationCheckId,
  WebsiteBuildEvaluationCheckStatus,
  WebsiteBuildEvaluationJudgment,
} from "./website-build-evaluation-skill";

/**
 * The website Skill deliberately remains a pure scoring function. This adapter
 * is the auditable boundary that turns durable SiteOps projections into the
 * seven website-only judgments consumed by that Skill.
 */
export const WEBSITE_BUILD_SITEOPS_EVIDENCE_VERSION = "siteops-evidence-v1";

const TERMINAL_BUILD_FAILURES = new Set([
  "failed",
  "attention_required",
  "cancelled",
  "superseded",
]);

const DEPLOYMENT_IN_PROGRESS = new Set(["reserved", "deploying", "verifying"]);
const DEPLOYMENT_FAILURES = new Set(["failed", "attention_required"]);

function evidence(...values: Array<string | null | undefined | false>) {
  // The shared immutable-report contract accepts at most 100 references per
  // dimension. Seven compact check receipts keep the merged dimension safely
  // below that limit even for the largest allowed Brief/operation history.
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
    .slice(0, 30);
}

function judgment(
  checkId: WebsiteBuildEvaluationCheckId,
  status: WebsiteBuildEvaluationCheckStatus,
  summary: string,
  evidenceIds: string[],
): WebsiteBuildEvaluationJudgment {
  return { checkId, status, summary, evidenceIds };
}

function pending(
  checkId: WebsiteBuildEvaluationCheckId,
  summary: string,
): WebsiteBuildEvaluationJudgment {
  return judgment(checkId, "pending", summary, []);
}

function currentBuildEvidence(
  build: SiteOpsObservationV1["builds"][number] | null,
) {
  return build ? `siteops:build:${build.id}:${build.status}` : null;
}

function qaEvidence(
  build: SiteOpsObservationV1["builds"][number] | null,
) {
  return build?.buildDelivery
    ? `siteops:build:${build.id}:qa:${build.buildDelivery.qaStatus}`
    : null;
}

function buildHasFailed(
  build: SiteOpsObservationV1["builds"][number] | null,
) {
  return Boolean(build && TERMINAL_BUILD_FAILURES.has(build.status));
}

function stableHash(value: unknown) {
  const text = JSON.stringify(value);
  let left = 2_166_136_261;
  let right = 3_332_780_557;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    left = Math.imul(left ^ code, 16_777_619);
    right = Math.imul(right ^ code, 2_246_822_519);
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

/** A version changes whenever evidence capable of changing a judgment changes. */
export function siteOpsWebsiteEvaluationVersion(
  observation: SiteOpsObservationV1,
) {
  return `${WEBSITE_BUILD_SITEOPS_EVIDENCE_VERSION}-${stableHash({
    project: observation.project,
    brief: observation.brief,
    knowledgeSnapshots: observation.knowledgeSnapshots,
    executionSteps: observation.executionSteps,
    builds: observation.builds,
    deployments: observation.deployments,
    aliyunConnection: observation.aliyunConnection,
    domainState: observation.domainState,
    interactionState: observation.interactionState,
  })}`;
}

export function siteOpsWebsiteEvaluationObservedAt(
  observation: SiteOpsObservationV1,
) {
  const timestamps = [
    observation.project.updatedAt,
    observation.aliyunConnection.verifiedAt,
    observation.domainState?.icpVerifiedAt,
    ...observation.knowledgeSnapshots.map((item) => item.createdAt),
    ...observation.executionSteps.flatMap((item) => [item.startedAt, item.completedAt]),
    ...observation.builds.flatMap((item) => [item.createdAt, item.updatedAt]),
    ...observation.deployments.map((item) => item.createdAt),
  ].filter((value): value is string => Boolean(value));
  return timestamps.reduce((latest, candidate) =>
    Date.parse(candidate) > Date.parse(latest) ? candidate : latest,
  observation.project.updatedAt);
}

export function buildWebsiteEvaluationJudgmentsFromSiteOps(
  observation: SiteOpsObservationV1,
): WebsiteBuildEvaluationJudgment[] {
  const build = observation.builds[0] ?? null;
  const brief = observation.brief;
  const snapshotId = observation.project.currentKnowledgeSnapshotId;
  const snapshot = snapshotId
    ? observation.knowledgeSnapshots.find((item) => item.id === snapshotId) ?? null
    : null;
  const routes = brief?.routes ?? [];
  const sourcedRoutes = routes.filter((route) => route.sourceDocumentIds.length > 0);
  const allRoutesSourced = routes.length > 0 && sourcedRoutes.length === routes.length;
  const contentPlanReady = Boolean(
    build?.contentPlan?.status === "ready" && build.contentPlan.sha256,
  );
  const buildEvidence = currentBuildEvidence(build);
  const deliveryEvidence = qaEvidence(build);
  const routeEvidence = routes.map((route) =>
    `siteops:brief:route:${route.id}:sources:${route.sourceDocumentIds.length}`,
  );
  const snapshotEvidence = snapshot
    ? `siteops:knowledge:${snapshot.id}`
    : null;
  const contentPlanEvidence = contentPlanReady && build?.contentPlan?.sha256
    ? `siteops:build:${build.id}:content:${build.contentPlan.sha256}`
    : null;
  const warnings = build?.buildDelivery?.warningCodes ?? [];
  const warningEvidence = warnings.map((code) =>
    `siteops:build:${build!.id}:warning:${code}`,
  );
  const buildCompleted = Boolean(
    build && ["preview_ready", "approved"].includes(build.status),
  );

  let contentStructure: WebsiteBuildEvaluationJudgment;
  if (!build) {
    contentStructure = pending(
      "website-content-structure",
      "SiteOps 尚未生成可检查的真实构建。",
    );
  } else if (buildHasFailed(build)) {
    contentStructure = judgment(
      "website-content-structure",
      "failed",
      `真实构建 #${build.ordinal} 状态为 ${build.status}，未形成可验收的信息结构。`,
      evidence(buildEvidence),
    );
  } else if (!buildCompleted) {
    contentStructure = pending(
      "website-content-structure",
      `真实构建 #${build.ordinal} 仍处于 ${build.status}，等待内容结构与 QA 结果。`,
    );
  } else if (!brief || !snapshot || !allRoutesSourced) {
    contentStructure = judgment(
      "website-content-structure",
      "failed",
      `真实构建已完成，但知识快照、Brief 或栏目来源不完整（${sourcedRoutes.length}/${routes.length} 个栏目已绑定来源）。`,
      evidence(buildEvidence, deliveryEvidence, snapshotEvidence, ...routeEvidence),
    );
  } else {
    const complete = contentPlanReady && Boolean(build.previewUrl);
    contentStructure = judgment(
      "website-content-structure",
      complete ? "passed" : "partial",
      complete
        ? `真实构建 #${build.ordinal} 已绑定知识快照、${routes.length} 个有来源栏目及冻结内容计划。`
        : `真实构建 #${build.ordinal} 已绑定知识快照和 ${routes.length} 个有来源栏目，但内容计划或预览坐标未完整投影。`,
      evidence(
        buildEvidence,
        deliveryEvidence,
        snapshotEvidence,
        contentPlanEvidence,
        build.previewUrl ? `siteops:build:${build.id}:preview` : null,
        ...routeEvidence,
      ),
    );
  }

  let navigationContact: WebsiteBuildEvaluationJudgment;
  if (!build || !buildCompleted) {
    navigationContact = buildHasFailed(build)
      ? judgment(
          "website-navigation-contact",
          "failed",
          `真实构建 #${build!.ordinal} 未通过，导航与联系入口没有形成可验收结果。`,
          evidence(buildEvidence),
        )
      : pending(
          "website-navigation-contact",
          "等待真实构建完成浏览器 QA 后检查逐页导航与联系入口。",
        );
  } else if (!build.buildDelivery) {
    navigationContact = judgment(
      "website-navigation-contact",
      "partial",
      "真实预览已形成，但当前投影没有浏览器 QA 明细，无法完整确认导航与联系入口。",
      evidence(buildEvidence, build.previewUrl ? `siteops:build:${build.id}:preview` : null),
    );
  } else {
    const sourcedContacts = (brief?.contacts ?? []).filter(
      (contact) => contact.sourceDocumentIds.length > 0,
    );
    const cleanQa = build.buildDelivery.qaStatus === "passed";
    const contactReady = sourcedContacts.length > 0;
    navigationContact = judgment(
      "website-navigation-contact",
      cleanQa && contactReady ? "passed" : "partial",
      cleanQa && contactReady
        ? `浏览器 QA 已通过，${routes.length} 个路由与 ${sourcedContacts.length} 个有来源联系入口已纳入真实构建。`
        : `浏览器 QA 为 ${build.buildDelivery.qaStatus}；${routes.length} 个路由、${sourcedContacts.length} 个有来源联系入口可核对，仍有一项未形成完整通过证据。`,
      evidence(
        buildEvidence,
        deliveryEvidence,
        ...routeEvidence,
        ...sourcedContacts.map((contact) =>
          `siteops:brief:contact:${contact.kind}:sources:${contact.sourceDocumentIds.length}`,
        ),
        ...warningEvidence,
      ),
    );
  }

  let responsiveAccessibility: WebsiteBuildEvaluationJudgment;
  if (!build || !buildCompleted) {
    responsiveAccessibility = buildHasFailed(build)
      ? judgment(
          "website-responsive-accessibility",
          "failed",
          `真实构建 #${build!.ordinal} 未完成，窄屏与可访问性 QA 未通过。`,
          evidence(buildEvidence),
        )
      : pending(
          "website-responsive-accessibility",
          "等待真实构建完成浏览器与可访问性 QA。",
        );
  } else if (!build.buildDelivery) {
    responsiveAccessibility = judgment(
      "website-responsive-accessibility",
      "partial",
      "真实预览已形成，但当前投影没有浏览器与可访问性 QA 结论。",
      evidence(buildEvidence, build.previewUrl ? `siteops:build:${build.id}:preview` : null),
    );
  } else {
    responsiveAccessibility = judgment(
      "website-responsive-accessibility",
      build.buildDelivery.qaStatus === "passed" ? "passed" : "partial",
      build.buildDelivery.qaStatus === "passed"
        ? "真实构建的浏览器、响应式与可访问性 QA 已通过且无警告。"
        : `真实构建 QA 为 ${build.buildDelivery.qaStatus}，记录了 ${warnings.length} 个警告，按部分通过处理。`,
      evidence(buildEvidence, deliveryEvidence, ...warningEvidence),
    );
  }

  let factsEvidence: WebsiteBuildEvaluationJudgment;
  if (!build || !buildCompleted) {
    factsEvidence = buildHasFailed(build)
      ? judgment(
          "website-facts-evidence",
          "failed",
          `真实构建 #${build!.ordinal} 未完成，企业事实证据未形成可核验成品。`,
          evidence(buildEvidence),
        )
      : pending(
          "website-facts-evidence",
          "等待真实构建冻结知识快照、企业事实与页面来源。",
        );
  } else if (!brief || !snapshot || !allRoutesSourced) {
    factsEvidence = judgment(
      "website-facts-evidence",
      "failed",
      `真实构建缺少完整知识快照或页面来源（${sourcedRoutes.length}/${routes.length} 个栏目有来源），不能确认企业事实。`,
      evidence(buildEvidence, snapshotEvidence, ...routeEvidence),
    );
  } else {
    const verifiedFacts = brief.verifiedFacts.filter(
      (fact) => fact.sourceDocumentIds.length > 0,
    );
    const complete = verifiedFacts.length > 0 && brief.unknowns.length === 0;
    factsEvidence = judgment(
      "website-facts-evidence",
      complete ? "passed" : "partial",
      complete
        ? `${verifiedFacts.length} 条企业事实和 ${routes.length} 个栏目均绑定冻结知识来源。`
        : `${routes.length} 个栏目已绑定来源；可追溯企业事实 ${verifiedFacts.length} 条、待确认事项 ${brief.unknowns.length} 条。`,
      evidence(
        buildEvidence,
        snapshotEvidence,
        ...routeEvidence,
        ...verifiedFacts.map((_, index) =>
          `siteops:brief:verified-fact:${index + 1}`,
        ),
        ...brief.unknowns.map((_, index) => `siteops:brief:unknown:${index + 1}`),
      ),
    );
  }

  const currentDeployments = build
    ? observation.deployments.filter((deployment) => deployment.buildId === build.id)
    : [];
  const authoritativeLiveHead = observation.project.globalLiveDeploymentId;
  const activeDeployment = (
    authoritativeLiveHead
      ? currentDeployments.find((deployment) =>
          deployment.id === authoritativeLiveHead && deployment.status === "active",
        )
      : null
  ) ?? currentDeployments.find(
    (deployment) => deployment.status === "active",
  ) ?? null;
  const pendingDeployment = currentDeployments.find((deployment) =>
    DEPLOYMENT_IN_PROGRESS.has(deployment.status),
  ) ?? null;
  const failedDeployment = currentDeployments.find((deployment) =>
    DEPLOYMENT_FAILURES.has(deployment.status),
  ) ?? null;
  const domain = observation.domainState;
  const domainEvidence = domain
    ? `siteops:domain:r${domain.revision}:${domain.dnsStatus ?? "unknown"}`
    : null;
  const deploymentEvidence = (deployment: typeof activeDeployment) => deployment
    ? `siteops:deployment:${deployment.id}:${deployment.status}`
    : null;
  const publicUrl = activeDeployment?.publicUrl ?? null;
  const publicBoundaryPassed = Boolean(
    build
    && publicUrl
    && snapshot
    && contentPlanReady
    && allRoutesSourced
    && domain?.domain
    && domain.dnsStatus === "active"
    && (authoritativeLiveHead === null
      || authoritativeLiveHead === undefined
      || authoritativeLiveHead === activeDeployment?.id),
  );

  let publicBoundary: WebsiteBuildEvaluationJudgment;
  if (!build || !buildCompleted) {
    publicBoundary = buildHasFailed(build)
      ? judgment(
          "website-public-boundary",
          "failed",
          `真实构建 #${build!.ordinal} 未完成，尚无可核验的公开边界。`,
          evidence(buildEvidence),
        )
      : pending(
          "website-public-boundary",
          "等待真实构建完成后核验域名、DNS 与公开访问地址。",
        );
  } else if (publicBoundaryPassed) {
    publicBoundary = judgment(
      "website-public-boundary",
      "passed",
      `当前构建已通过 active DNS 在 ${publicUrl} 公开，域名与权威部署头一致。`,
      evidence(
        buildEvidence,
        snapshotEvidence,
        domainEvidence,
        deploymentEvidence(activeDeployment),
        authoritativeLiveHead ? `siteops:project:global-head:${authoritativeLiveHead}` : null,
      ),
    );
  } else if (failedDeployment && !activeDeployment) {
    publicBoundary = judgment(
      "website-public-boundary",
      "failed",
      `当前构建的 ${failedDeployment.target} 部署状态为 ${failedDeployment.status}，公开地址未生效。`,
      evidence(buildEvidence, domainEvidence, deploymentEvidence(failedDeployment)),
    );
  } else {
    publicBoundary = judgment(
      "website-public-boundary",
      "partial",
      pendingDeployment
        ? `当前构建的 ${pendingDeployment.target} 部署处于 ${pendingDeployment.status}，尚不能确认公开访问。`
        : domain?.dnsStatus === "active"
          ? "域名 DNS 已 active，但当前构建尚无带公开地址的 active 部署。"
          : "真实构建已形成，但域名、active DNS 与公开部署尚未全部完成。",
      evidence(
        buildEvidence,
        snapshotEvidence,
        domainEvidence,
        deploymentEvidence(pendingDeployment),
        observation.aliyunConnection.verifiedAt
          ? `siteops:aliyun:verified:${observation.aliyunConnection.verifiedAt}`
          : null,
      ),
    );
  }

  const buildSteps = build
    ? observation.executionSteps.filter((step) => step.buildId === build.id)
    : [];
  const flowIssues = buildSteps.filter((step) =>
    step.status === "failed"
    || step.status === "attention_required"
    || step.status === "cancelled",
  );
  const inFlightSteps = buildSteps.filter((step) =>
    step.status === "queued" || step.status === "running",
  );
  const completedSteps = buildSteps.filter((step) =>
    step.stage === "completed" && step.status === "succeeded",
  );
  const latestStepTime = (steps: typeof buildSteps) => steps.reduce(
    (latest, step) => Math.max(
      latest,
      Date.parse(step.completedAt ?? step.startedAt),
    ),
    Number.NEGATIVE_INFINITY,
  );
  const latestIssueAt = latestStepTime(flowIssues);
  const latestSuccessAt = latestStepTime(completedSteps);
  const latestInFlightAt = latestStepTime(inFlightSteps);
  const unrecoveredIssue = flowIssues.length > 0 && latestSuccessAt <= latestIssueAt;
  const flowEvidence = buildSteps.map((step) =>
    `siteops:step:${step.id}:${step.status}`,
  );
  let flowRecovery: WebsiteBuildEvaluationJudgment;
  if (!build) {
    flowRecovery = pending(
      "website-flow-recovery",
      "SiteOps 尚未创建真实构建，暂无流程执行记录。",
    );
  } else if (unrecoveredIssue) {
    flowRecovery = judgment(
      "website-flow-recovery",
      "failed",
      `真实执行记录包含 ${flowIssues.length} 个失败或需处理步骤，尚未出现成功完成坐标。`,
      evidence(buildEvidence, ...flowEvidence),
    );
  } else if (inFlightSteps.length > 0 && latestInFlightAt >= latestSuccessAt) {
    flowRecovery = judgment(
      "website-flow-recovery",
      "partial",
      `真实构建已有成功记录，但仍有 ${inFlightSteps.length} 个步骤处于执行中，需等待最新流程收敛。`,
      evidence(buildEvidence, ...flowEvidence),
    );
  } else if (completedSteps.length > 0) {
    flowRecovery = judgment(
      "website-flow-recovery",
      "passed",
      flowIssues.length > 0
        ? `真实流程记录了 ${flowIssues.length} 个异常步骤，并已恢复到成功完成。`
        : `真实流程保留 ${buildSteps.length} 个步骤并已成功完成，可从服务端观察结果恢复。`,
      evidence(buildEvidence, ...flowEvidence),
    );
  } else if (buildCompleted) {
    flowRecovery = judgment(
      "website-flow-recovery",
      "partial",
      "真实构建已完成，但当前观察只保留构建结果，未投影完整步骤或失败恢复轨迹。",
      evidence(buildEvidence, deliveryEvidence, ...flowEvidence),
    );
  } else if (buildHasFailed(build)) {
    flowRecovery = judgment(
      "website-flow-recovery",
      "failed",
      `真实构建状态为 ${build.status}，且没有成功恢复记录。`,
      evidence(buildEvidence, ...flowEvidence),
    );
  } else {
    flowRecovery = pending(
      "website-flow-recovery",
      `真实构建仍处于 ${build.status}，等待流程完成或恢复结果。`,
    );
  }

  let draftReleaseState: WebsiteBuildEvaluationJudgment;
  if (!build) {
    draftReleaseState = pending(
      "website-draft-release-state",
      "尚无真实构建，无法核对草稿、批准、部署与公开状态。",
    );
  } else if (
    activeDeployment?.publicUrl
    || (observation.project.status === "live" && authoritativeLiveHead)
  ) {
    draftReleaseState = judgment(
      "website-draft-release-state",
      "passed",
      `构建 #${build.ordinal} 已从 ${build.status} 进入真实 live 部署，并保留公开访问坐标。`,
      evidence(
        buildEvidence,
        domainEvidence,
        deploymentEvidence(activeDeployment),
        authoritativeLiveHead ? `siteops:project:global-head:${authoritativeLiveHead}` : null,
      ),
    );
  } else if (failedDeployment) {
    draftReleaseState = judgment(
      "website-draft-release-state",
      "failed",
      `构建 #${build.ordinal} 与失败部署 ${failedDeployment.id} 已明确区分，当前未公开生效。`,
      evidence(buildEvidence, domainEvidence, deploymentEvidence(failedDeployment)),
    );
  } else if (pendingDeployment) {
    draftReleaseState = judgment(
      "website-draft-release-state",
      "partial",
      `构建 #${build.ordinal} 已批准，部署 ${pendingDeployment.id} 仍处于 ${pendingDeployment.status}，尚未宣称上线。`,
      evidence(buildEvidence, domainEvidence, deploymentEvidence(pendingDeployment)),
    );
  } else if (build.status === "approved") {
    draftReleaseState = judgment(
      "website-draft-release-state",
      "passed",
      `构建 #${build.ordinal} 已批准，但没有 active 部署记录；系统明确保持“可发布但尚未上线”。`,
      evidence(buildEvidence, domainEvidence),
    );
  } else if (build.status === "preview_ready") {
    draftReleaseState = judgment(
      "website-draft-release-state",
      "partial",
      `构建 #${build.ordinal} 仅处于 preview_ready，尚未批准或部署。`,
      evidence(buildEvidence),
    );
  } else if (buildHasFailed(build)) {
    draftReleaseState = judgment(
      "website-draft-release-state",
      "failed",
      `构建 #${build.ordinal} 状态为 ${build.status}，未进入可发布状态。`,
      evidence(buildEvidence),
    );
  } else {
    draftReleaseState = pending(
      "website-draft-release-state",
      `构建 #${build.ordinal} 仍处于 ${build.status}，等待批准或部署状态。`,
    );
  }

  return [
    contentStructure,
    navigationContact,
    responsiveAccessibility,
    factsEvidence,
    publicBoundary,
    flowRecovery,
    draftReleaseState,
  ];
}
