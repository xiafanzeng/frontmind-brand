// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSiteOpsWorker } from "../server/siteops/worker.js";
import type { SiteOpsWorkerCore } from "../server/siteops/worker-core.js";

const { terminalSiteOpsOperationProjection } = createSiteOpsWorker({
  tables: {},
} as SiteOpsWorkerCore);

const recovery = {
  existingTaskOnly: true,
  stagedDocumentViewRecovery: {
    verdictSignature: "a".repeat(64),
    startedAt: "2026-11-07T07:00:00.000Z",
  },
  nativeRejectedCandidateV1: {
    verdictSignature: "a".repeat(64),
    archiveSha256: "b".repeat(64),
  },
};

const locked = {
  result: { ...recovery, buildCheckpoint: "artifacts_staged" },
  providerOperationId: null,
  providerTaskId: "existing-task",
};

describe("staged document-view recovery terminal state", () => {
  it("keeps the consumed permission and original verdict on checkpoint completion", () => {
    const result = terminalSiteOpsOperationProjection(locked, {
      status: "succeeded",
      result: { buildCheckpoint: "preview_ready", artifactCheckpointResume: true },
    });
    expect(result).toEqual({
      result: { ...recovery, buildCheckpoint: "preview_ready", artifactCheckpointResume: true },
      providerOperationId: null,
      providerTaskId: "existing-task",
    });
  });

  it("preserves the permission when a terminal failure supplies a partial result", () => {
    const result = terminalSiteOpsOperationProjection(locked, {
      status: "attention_required",
      code: "BUILD_ARTIFACT_BINDING_FAILED",
      message: "Artifact binding failed",
      result: { failure: "binding" },
    });
    expect(result.result).toEqual({ ...recovery, failure: "binding" });
  });

  it("uses the new result as before for an ordinary build", () => {
    const result = terminalSiteOpsOperationProjection({
      ...locked,
      result: { buildCheckpoint: "artifacts_staged", existingTaskOnly: true },
    }, {
      status: "succeeded",
      result: { buildCheckpoint: "preview_ready" },
    });
    expect(result.result).toEqual({ buildCheckpoint: "preview_ready" });
  });
});
