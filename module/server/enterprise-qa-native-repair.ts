import { createHash } from "node:crypto";
import type { DashboardManagedRuntime, DashboardManagedCommand } from "@frontmind/module-contracts/managed-runtime";
type ZhipuRecord=Record<string,any>;

const content = (value: unknown) => typeof value === "string" ? value : Array.isArray(value) ? value.filter((item) => item?.type === "text").map((item) => item.text ?? "").join("\n") : "";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Hide only the recorded internal correction, preserving all model/tool usage events. */
export function enterpriseQaMergedNativeEvents(raw: ZhipuRecord[], runtime: DashboardManagedRuntime) {
  const repairs = Object.entries(runtime.enterpriseQaRepairs ?? {});
  if (!repairs.length) return raw;
  const hidden = new Set<string>();
  for (const [key, repair] of repairs) {
    const mutation = runtime.mutations[`qa-repair:${key}`];
    if (!repair.failed && mutation?.state !== "rejected") {
      hidden.add(repair.finalEventId);
      hidden.add(repair.terminalEventId);
    }
    for (const event of raw) {
      if (event.type === "user.message" && (event.id === mutation?.resourceId || hash(content(event.content)) === hash(repair.prompt))) hidden.add(String(event.id));
    }
  }
  return raw.filter((event) => !hidden.has(String(event.id)));
}

export function enterpriseQaRepairState(raw: ZhipuRecord[], runtime: DashboardManagedRuntime): "pending" | "failed" | null {
  const command = runtime.commands.at(-1);
  const repair = command && runtime.enterpriseQaRepairs?.[command.key];
  if (!command || !repair) return null;
  const mutation = runtime.mutations[`qa-repair:${command.key}`];
  if (mutation?.state === "outcome_unknown") return "failed";
  if (repair.failed || mutation?.state === "rejected") return null;
  const start = raw.findIndex((event) => event.id === mutation?.resourceId || (event.type === "user.message" && hash(content(event.content)) === hash(repair.prompt)));
  if (start < 0) return "pending";
  const completed = raw.slice(start + 1).some((event) => ["session.status_idle", "session.error", "session.status_terminated"].includes(String(event.type)));
  return completed ? null : "pending";
}

/** Billing retains the actual native events and an internal subcommand alias. */
export function enterpriseQaBillingCommands(runtime: Pick<DashboardManagedRuntime, "commands" | "mutations" | "enterpriseQaRepairs">): DashboardManagedCommand[] {
  return runtime.commands.flatMap((command) => {
    const repair = runtime.enterpriseQaRepairs?.[command.key];
    if (!repair) return [command];
    const mutation = runtime.mutations[`qa-repair:${command.key}`];
    return [command, {
      ...command, key: `qa-repair:${command.key}`, prompt: repair.prompt, providerPromptHash: hash(repair.prompt),
      eventId: mutation?.resourceId, createdAt: repair.createdAt, attachments: [],
      beforeEventIds: [...command.beforeEventIds, command.eventId ?? "", repair.finalEventId, repair.terminalEventId].filter(Boolean),
    }];
  });
}
