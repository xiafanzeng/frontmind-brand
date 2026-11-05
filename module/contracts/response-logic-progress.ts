import { z } from "zod";
import {
  generalExecutionActivity,
  type GeneralExecutionDto,
  type GeneralExecutionEntry,
} from "@frontmind/module-contracts/execution";

/** A read-only lookup, not proof that a timed-out creation did not succeed. */
export const responseLogicRecoverySchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("found"),
      taskId: z.string().min(1).max(255),
      attempt: z.number().int().min(0).max(100),
      recordRevision: z.number().int().positive(),
      sourceFingerprint: z.string(),
    })
    .strict(),
  z.object({ status: z.literal("none") }).strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reason: z.enum(["unsupported", "binding_pending"]),
    })
    .strict(),
]);
export type ResponseLogicRecovery = z.infer<typeof responseLogicRecoverySchema>;

/** Optional transport envelope, negotiated separately from strict result schemas. */
export const responseLogicExecutionSchema = z.custom<GeneralExecutionDto>(
  (value) => {
    if (!value || typeof value !== "object") return false;
    const x = value as GeneralExecutionDto;
    return (
      x.schemaVersion === 1 &&
      typeof x.taskId === "string" &&
      ["complete", "partial", "pending", "unavailable"].includes(x.coverage) &&
      Array.isArray(x.timeline)
    );
  },
);

/** Defense at the read boundary: accept only bounded, attributable public data. */
export function readResponseLogicExecution(
  value: unknown,
  taskId: string,
): GeneralExecutionDto | undefined {
  const parsed = responseLogicExecutionSchema.safeParse(value);
  if (!parsed.success || parsed.data.taskId !== taskId) return undefined;
  const seen = new Set<string>();
  const timeline: GeneralExecutionEntry[] = [];
  for (const e of parsed.data.timeline.slice(-200)) {
    if (
      !e ||
      typeof e.id !== "string" ||
      typeof e.turnId !== "string" ||
      !Number.isSafeInteger(e.userSequence) ||
      !Number.isFinite(e.timestamp) ||
      !Number.isFinite(e.rank) ||
      seen.has(e.id)
    )
      continue;
    seen.add(e.id);
    const base = {
      id: e.id,
      turnId: e.turnId,
      userSequence: e.userSequence,
      timestamp: e.timestamp,
      rank: e.rank,
    };
    if (e.kind === "status") {
      const safe = generalExecutionActivity({
        kind: "status",
        status: e.status,
      });
      if (safe?.kind === "status")
        timeline.push({ ...base, kind: "status", status: safe.status });
    } else if (
      e.kind === "tool" &&
      [
        "running",
        "waiting",
        "completed",
        "failed",
        "returned",
        "unconfirmed",
      ].includes(e.status)
    ) {
      timeline.push({
        ...base,
        kind: "tool",
        label: "处理任务资料",
        status: e.status,
      });
    }
  }
  const sequence = Math.max(0, ...timeline.map((e) => e.userSequence));
  return {
    schemaVersion: 1,
    taskId,
    coverage: parsed.data.coverage,
    timeline: timeline
      .filter((e) => e.userSequence === sequence)
      .sort((a, b) => a.rank - b.rank || a.timestamp - b.timestamp),
  };
}
