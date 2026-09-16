export type SiteOpsQuotaState = "reserved" | "consumed" | "released";
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
