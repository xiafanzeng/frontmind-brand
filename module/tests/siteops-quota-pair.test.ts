// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  siteOpsQuotaPairIsActive,
  siteOpsQuotaStateForPeriod,
  siteOpsQuotaStateForProviderResult,
  type SiteOpsQuotaState,
} from "../server/siteops/quota-state.js";

describe("SiteOps quota pairs", () => {
  it("keeps enterprise-project reservations as a null/null pair", () => {
    expect(siteOpsQuotaStateForPeriod(null, "reserved")).toBeNull();
    expect(siteOpsQuotaPairIsActive(null, null)).toBe(true);
    expect(siteOpsQuotaPairIsActive(null, "reserved")).toBe(false);
    expect(siteOpsQuotaPairIsActive(null, "consumed")).toBe(false);
    expect(siteOpsQuotaPairIsActive(null, "released")).toBe(false);
  });

  it("keeps account-scoped reservations paired with their period", () => {
    expect(siteOpsQuotaStateForPeriod("quota-period-1", "reserved")).toBe(
      "reserved",
    );
    expect(siteOpsQuotaPairIsActive("quota-period-1", "reserved")).toBe(true);
    expect(siteOpsQuotaPairIsActive("quota-period-1", null)).toBe(false);
    expect(siteOpsQuotaPairIsActive("quota-period-1", "consumed")).toBe(false);
    expect(siteOpsQuotaPairIsActive("quota-period-1", "released")).toBe(false);
  });

  it("preserves the database pair invariant for every provider result", () => {
    const statuses = [
      "pending",
      "succeeded",
      "failed",
      "attention_required",
      "outcome_unknown",
    ] as const;

    for (const status of statuses) {
      const meteredState = siteOpsQuotaStateForProviderResult(status);
      const pairs: Array<{
        quotaPeriodId: string | null;
        quotaState: SiteOpsQuotaState | null;
      }> = [
        {
          quotaPeriodId: null,
          quotaState: siteOpsQuotaStateForPeriod(null, meteredState),
        },
        {
          quotaPeriodId: "quota-period-1",
          quotaState: siteOpsQuotaStateForPeriod(
            "quota-period-1",
            meteredState,
          ),
        },
      ];

      for (const pair of pairs) {
        expect(pair.quotaPeriodId === null).toBe(pair.quotaState === null);
      }
    }
  });

  it("retains the metered provider-result state machine", () => {
    expect(siteOpsQuotaStateForProviderResult("succeeded")).toBe("consumed");
    expect(siteOpsQuotaStateForProviderResult("failed")).toBe("released");
    expect(siteOpsQuotaStateForProviderResult("pending")).toBe("reserved");
    expect(siteOpsQuotaStateForProviderResult("attention_required")).toBe(
      "reserved",
    );
    expect(siteOpsQuotaStateForProviderResult("outcome_unknown")).toBe(
      "reserved",
    );
  });

  it("keeps unmetered fallback release null and releases metered fallback", () => {
    expect(siteOpsQuotaStateForPeriod(null, "released")).toBeNull();
    expect(siteOpsQuotaStateForPeriod("quota-period-1", "released")).toBe(
      "released",
    );
  });
});
