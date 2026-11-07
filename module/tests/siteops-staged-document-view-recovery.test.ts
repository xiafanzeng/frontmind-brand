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
    const { recoveryState: recovered, resumedConsumedRecovery } =
      existingTaskOnlyStagedDocumentViewRecoveryState({ ...coordinates, result });
    expect(resumedConsumedRecovery).toBe(false);
    expect(recovered).toMatchObject({
      existingTaskOnly: true,
      stagedDocumentViewRecovery: {
        verdictSignature: result.nativeRejectedCandidateV1.verdictSignature,
        validatorVersion: "isolated-route-context-v1",
      },
      nativeRejectedCandidateV1: result.nativeRejectedCandidateV1,
      nativeSourceStaging: result.nativeSourceStaging,
    });
    expect(recovered.stagedDocumentViewRecovery?.startedAt).toBeUndefined();
    expect(() => existingTaskOnlyStagedDocumentViewRecoveryState({ ...coordinates, result: recovered }))
      .toThrow("SITEOPS_RECONCILE_STAGED_DOCUMENT_VIEW_STATE_INVALID");
    expect(() => existingTaskOnlyRecoveryState({ taskId: coordinates.taskId, result: recovered }))
      .toThrow("SITEOPS_RECONCILE_NATIVE_REPAIR_STATE_REQUIRED");
  });

  it("issues one current permission for a consumed legacy recovery", () => {
    const rejected = rejectedSourceState();
    const legacyStartedAt = "2026-11-07T11:00:00Z";
    const result = {
      ...rejected,
      existingTaskOnly: true,
      stagedDocumentViewRecovery: {
        verdictSignature: rejected.nativeRejectedCandidateV1.verdictSignature,
        startedAt: legacyStartedAt,
      },
    };
    const { recoveryState, resumedConsumedRecovery } =
      existingTaskOnlyStagedDocumentViewRecoveryState({ ...coordinates, result });
    expect(resumedConsumedRecovery).toBe(true);
    expect(recoveryState.stagedDocumentViewRecovery).toEqual({
      verdictSignature: rejected.nativeRejectedCandidateV1.verdictSignature,
      validatorVersion: "isolated-route-context-v1",
      previousStartedAt: legacyStartedAt,
    });
    expect(recoveryState.nativeRejectedCandidateV1).toEqual(rejected.nativeRejectedCandidateV1);
    expect(recoveryState.nativeSourceStaging).toEqual(rejected.nativeSourceStaging);
    expect(() => existingTaskOnlyStagedDocumentViewRecoveryState({
      ...coordinates,
      result: {
        ...recoveryState,
        stagedDocumentViewRecovery: {
          ...recoveryState.stagedDocumentViewRecovery,
          startedAt: "2026-11-07T11:30:00Z",
        },
      },
    })).toThrow("SITEOPS_RECONCILE_STAGED_DOCUMENT_VIEW_STATE_INVALID");
  });

  it.each([
    ["unused legacy permission", true, undefined, undefined],
    ["missing existing-task guard", false, "2026-11-07T11:00:00Z", undefined],
    ["start before rejection", true, "2026-11-07T09:00:00Z", undefined],
    ["start at rejection", true, "2026-11-07T10:00:00Z", undefined],
    ["start at reconciliation", true, "2026-11-07T12:00:00Z", undefined],
    ["start in future", true, "2026-11-07T13:00:00Z", undefined],
    ["mismatched marker verdict", true, "2026-11-07T11:00:00Z", "1".repeat(64)],
  ] as const)("refuses legacy recovery with %s", (_reason, existingTaskOnly, startedAt, verdictSignature) => {
    const rejected = rejectedSourceState();
    const result = {
      ...rejected,
      existingTaskOnly,
      stagedDocumentViewRecovery: {
        verdictSignature: verdictSignature ?? rejected.nativeRejectedCandidateV1.verdictSignature,
        startedAt,
      },
    };
    expect(() => existingTaskOnlyStagedDocumentViewRecoveryState({ ...coordinates, result }))
      .toThrow("SITEOPS_RECONCILE_STAGED_DOCUMENT_VIEW_STATE_INVALID");
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
