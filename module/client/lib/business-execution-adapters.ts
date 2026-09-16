import {projectBusinessExecution,type BusinessExecutionPhase} from "@frontmind/module-contracts/execution";
import type {SiteOpsExecutionStep} from "../../contracts/siteops-contract";
const stamp = (value?: string | null) =>
  value ? Date.parse(value) : Number.NaN;
export function siteOpsPublicExecution(steps: readonly SiteOpsExecutionStep[]) {
  const phases: Record<SiteOpsExecutionStep["stage"], BusinessExecutionPhase> =
    {
      visual_searching: "preparing_assets",
      preparing: "reading_requirements",
      design_compiling: "preparing_assets",
      content_building: "generating_pages",
      qa_running: "checking_pages",
      completed: "previewing",
    };
  const statuses = {
    queued: "waiting",
    running: "running",
    succeeded: "ended",
    failed: "error",
    attention_required: "waiting",
    cancelled: "cancelled",
  } as const;
  const turnSequence = new Map<string, number>();
  // These are durable server steps. Never manufacture missing intermediate stages.
  return projectBusinessExecution(
    steps[0]?.buildId ?? "site-operations",
    [...steps]
      .sort(
        (a, b) =>
          stamp(a.startedAt) - stamp(b.startedAt) || a.id.localeCompare(b.id),
      )
      .map((step, rank) => {
        const turnId = step.id.split(":")[0]!;
        if (!turnSequence.has(turnId))
          turnSequence.set(turnId, turnSequence.size);
        return {
          id: step.id,
          turnId,
          userSequence: turnSequence.get(turnId),
          rank,
          timestamp: stamp(step.startedAt),
          phase: step.operationKind === "deploy" ? (step.stage === "qa_running" ? "verifying_site" : step.stage === "completed" ? "publishing_site" : "deploying_site") : step.operationKind === "build_revision" && step.stage === "preparing" ? "revising_site" : phases[step.stage],
          status: statuses[step.status],
          ...(step.completedAt ? { finishedAt: stamp(step.completedAt) } : {}),
        };
      }),
  );
}
