export type SiteOpsQuotaState = "reserved" | "consumed" | "released";

/**
 * Enterprise-project work is intentionally unmetered. Its durable quota
 * coordinates must therefore remain null/null for the lifetime of the row,
 * while account-scoped work keeps the normal quota state machine.
 */
export function siteOpsQuotaStateForPeriod(
  quotaPeriodId: string | null,
  meteredState: SiteOpsQuotaState,
): SiteOpsQuotaState | null {
  return quotaPeriodId === null ? null : meteredState;
}

/**
 * A build may stay active either with a real reserved quota period or with
 * the explicit unmetered null/null pair used by enterprise projects.
 */
export function siteOpsQuotaPairIsActive(
  quotaPeriodId: string | null,
  quotaState: SiteOpsQuotaState | null,
) {
  return quotaPeriodId === null
    ? quotaState === null
    : quotaState === "reserved";
}

export function siteOpsQuotaStateForProviderResult(
  status:
    | "pending"
    | "succeeded"
    | "failed"
    | "attention_required"
    | "outcome_unknown",
): SiteOpsQuotaState {
  if (status === "succeeded") return "consumed";
  if (status === "failed") return "released";
  return "reserved";
}
