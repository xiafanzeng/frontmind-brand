// @vitest-environment node
import { describe, expect, it } from "vitest";
import { siteOpsArtifactIdForIdempotency } from "../server/siteops/artifact-store.js";
import {
  createNativeRejectedCandidateV1,
  existingTaskOnlyRecoveryState,
  existingTaskOnlyStagedDocumentViewRecoveryState,
} from "../server/siteops/manus-provider.js";

const coordinates = {
  taskId: "bound-provider-task",
  operationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  userId: 7,
  contentPlanLocalAssetId: "33333333-3333-4333-8333-333333333333",
  contentPlanSha256: "b".repeat(64),
  now: new Date("2026-11-07T12:00:00Z"),
};

function rejectedSourceState() {
  const repairAttempt = 3;
  const operationToken = `siteops-native-source:${coordinates.operationId}:${repairAttempt}`;
  const scope = { taskId: coordinates.taskId, repairAttempt, operationToken };
  const archiveSha256 = "a".repeat(64);
  const attachmentIdentity = "source-attachment";
  const runtime = {
    contractVersion: "runtime-v1",
    contractSha256: "d".repeat(64),
    executionShellVersion: "execution-shell-v1",
    executionShellSha256: "e".repeat(64),
    preflightVersion: "preflight-v2",
    preflightSha256: "f".repeat(64),
  };
  return {
    schemaVersion: 2,
    attempts: { extraction: 0, design: 0, content: 0, materialization: 0 },
    stage: "native_repair_pending",
    taskId: scope.taskId,
    buildPhase: "compiling",
    buildCheckpoint: "compile_started",
    phaseOperationToken: operationToken,
    nativeRepairAttempt: repairAttempt,
    nativeSourceContractVersion: 2,
    nativeSourceRuntimeCoordinates: runtime,
    nativeSourceAttachmentIdentity: attachmentIdentity,
    nativeSourceAttachmentScope: scope,
    nativeLastErrorSignature: "416615ffb50ea6c00f54a51a28859a3d8065e765f3ad8711e8419b22b039fedc",
    contentPlanLocalAssetId: coordinates.contentPlanLocalAssetId,
    contentPlanSha256: coordinates.contentPlanSha256,
    nativeRejectedCandidateV1: createNativeRejectedCandidateV1({
      ...scope,
      attachmentIdentity,
      archiveSha256,
      errorCode: "NATIVE_BUILD_DOCUMENT_VIEW_INVALID",
      rejectedAt: new Date("2026-11-07T10:00:00Z"),
    }),
    nativeSourceStaging: {
      assetId: siteOpsArtifactIdForIdempotency({
        projectId: coordinates.projectId,
        userId: coordinates.userId,
        kind: "site-source-staging",
        idempotencyKey: `native-source:${operationToken}`,
      }),
      sha256: archiveSha256,
      bytes: 400,
      expiresAt: "2026-11-08T10:00:00Z",
      taskId: scope.taskId,
      repairAttempt,
      receipt: {
        operationToken,
        archiveSha256,
        baseSourceSha256: "c".repeat(64),
        executionBaselineSha256: "c".repeat(64),
        contentPlanSha256: coordinates.contentPlanSha256,
        runtimeContractVersion: runtime.contractVersion,
        runtimeContractSha256: runtime.contractSha256,
        executionShellSha256: runtime.executionShellSha256,
        preflightVersion: runtime.preflightVersion,
        preflightSha256: runtime.preflightSha256,
        preflightStatus: "passed",
        fileCount: 5,
      },
    },
  };
}

describe("one-time staged document-view revalidation", () => {
  it("retains the original rejection and prevents reopening the admitted operation", () => {
    const result = rejectedSourceState();
    const recovered = existingTaskOnlyStagedDocumentViewRecoveryState({ ...coordinates, result });
    expect(recovered).toMatchObject({
      existingTaskOnly: true,
      stagedDocumentViewRecovery: { verdictSignature: result.nativeRejectedCandidateV1.verdictSignature },
      nativeRejectedCandidateV1: result.nativeRejectedCandidateV1,
      nativeSourceStaging: result.nativeSourceStaging,
    });
    expect(recovered.stagedDocumentViewRecovery?.startedAt).toBeUndefined();
    expect(() => existingTaskOnlyStagedDocumentViewRecoveryState({ ...coordinates, result: recovered }))
      .toThrow("SITEOPS_RECONCILE_STAGED_DOCUMENT_VIEW_STATE_INVALID");
    expect(() => existingTaskOnlyRecoveryState({ taskId: coordinates.taskId, result: recovered }))
      .toThrow("SITEOPS_RECONCILE_NATIVE_REPAIR_STATE_REQUIRED");
  });

  it.each([
    ["expired staging", (state: ReturnType<typeof rejectedSourceState>) => {
      state.nativeSourceStaging.expiresAt = "2026-11-07T11:59:59Z";
    }],
    ["different renderer failure", (state: ReturnType<typeof rejectedSourceState>) => {
      state.nativeLastErrorSignature = "1".repeat(64);
    }],
    ["altered verdict", (state: ReturnType<typeof rejectedSourceState>) => {
      state.nativeRejectedCandidateV1.verdictSignature = "1".repeat(64);
    }],
    ["receipt for another plan", (state: ReturnType<typeof rejectedSourceState>) => {
      state.nativeSourceStaging.receipt.contentPlanSha256 = "1".repeat(64);
    }],
    ["attachment from another attempt", (state: ReturnType<typeof rejectedSourceState>) => {
      state.nativeSourceAttachmentScope.repairAttempt = 2;
    }],
  ] as const)("fails closed for %s", (_name, mutate) => {
    const result = rejectedSourceState();
    mutate(result);
    expect(() => existingTaskOnlyStagedDocumentViewRecoveryState({ ...coordinates, result }))
      .toThrow("SITEOPS_RECONCILE_STAGED_DOCUMENT_VIEW_STATE_INVALID");
  });
});
