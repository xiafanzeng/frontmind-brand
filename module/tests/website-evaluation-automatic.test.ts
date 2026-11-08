// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
  WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
  WEBSITE_BUILD_EVALUATION_RULE_VERSION,
  WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
} from "../contracts/website-build-evaluation-run.js";
import {
  automaticWebsiteEvaluationRunId,
  reserveAutomaticWebsiteEvaluation,
  websiteEvaluationAdmissionProjection,
  websiteEvaluationEvidenceFingerprint,
  websiteEvaluationMode,
  websiteEvaluationProjectEligible,
} from "../server/website-evaluation-automatic.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const BUILD_ID = "22222222-2222-4222-8222-222222222222";

function build() {
  return {
    enterpriseProjectId: "33333333-3333-4333-8333-333333333333",
    userId: 7,
    projectId: PROJECT_ID,
    buildId: BUILD_ID,
    knowledgeSnapshotId: "44444444-4444-4444-8444-444444444444",
    knowledgeArchiveHash: "a".repeat(64),
    brief: { visitorTaskV1: { goal: "Book a call" } },
    selectionHash: "b".repeat(64),
    artifactBindings: Object.fromEntries(
      ["contract", "source", "dist", "qa", "provenance"].map(
        (kind, index) => [
          kind,
          { id: `asset-${kind}`, sha256: String(index + 1).repeat(64) },
        ],
      ),
    ) as {
      contract: { id: string; sha256: string };
      source: { id: string; sha256: string };
      dist: { id: string; sha256: string };
      qa: { id: string; sha256: string };
      provenance: { id: string; sha256: string };
    },
    now: new Date("2026-11-08T00:00:00.000Z"),
  };
}

describe("automatic website evaluation reservation", () => {
  it("defaults closed and admits only the configured project before live", () => {
    expect(websiteEvaluationMode({})).toBe("off");
    expect(
      websiteEvaluationProjectEligible({
        projectId: PROJECT_ID,
        environment: { FRONTMIND_WEBSITE_EVALUATION_MODE: "shadow" },
      }),
    ).toBe(false);
    expect(
      websiteEvaluationProjectEligible({
        projectId: PROJECT_ID,
        environment: {
          FRONTMIND_WEBSITE_EVALUATION_MODE: "allowlist",
          FRONTMIND_WEBSITE_EVALUATION_ALLOW_PROJECT_IDS: PROJECT_ID,
        },
      }),
    ).toBe(true);
    expect(
      websiteEvaluationProjectEligible({
        projectId: PROJECT_ID,
        environment: { FRONTMIND_WEBSITE_EVALUATION_MODE: "live" },
      }),
    ).toBe(true);
    expect(websiteEvaluationAdmissionProjection({
      projectId: PROJECT_ID,
      environment: { FRONTMIND_WEBSITE_EVALUATION_MODE: "off" },
    })).toEqual({ mode: "off", required: false, userVisible: false });
    expect(websiteEvaluationAdmissionProjection({
      projectId: PROJECT_ID,
      environment: {
        FRONTMIND_WEBSITE_EVALUATION_MODE: "shadow",
        FRONTMIND_WEBSITE_EVALUATION_ALLOW_PROJECT_IDS: PROJECT_ID,
      },
    })).toEqual({ mode: "shadow", required: true, userVisible: false });
    expect(websiteEvaluationAdmissionProjection({
      projectId: PROJECT_ID,
      environment: {
        FRONTMIND_WEBSITE_EVALUATION_MODE: "allowlist",
        FRONTMIND_WEBSITE_EVALUATION_ALLOW_PROJECT_IDS: PROJECT_ID,
      },
    })).toEqual({ mode: "allowlist", required: true, userVisible: true });
  });

  it("derives a stable logical run from the frozen evidence coordinate", () => {
    const input = build();
    const fingerprint = websiteEvaluationEvidenceFingerprint(input);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(websiteEvaluationEvidenceFingerprint(input)).toBe(fingerprint);
    const runId = automaticWebsiteEvaluationRunId({
      userId: input.userId,
      enterpriseProjectId: input.enterpriseProjectId,
      projectId: input.projectId,
      buildId: input.buildId,
      evidenceFingerprint: fingerprint,
    });
    expect(runId).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
    );
    expect(
      websiteEvaluationEvidenceFingerprint({
        ...input,
        artifactBindings: {
          ...input.artifactBindings,
          qa: { ...input.artifactBindings.qa, sha256: "f".repeat(64) },
        },
      }),
    ).not.toBe(fingerprint);
  });

  it("inserts only a queued idempotent reservation and never calls a runner", async () => {
    const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onDuplicateKeyUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const table = { id: { name: "id" } } as never;
    const input = build();

    const result = await reserveAutomaticWebsiteEvaluation({
      tx: { insert },
      tables: { siteEvaluationRuns: table },
      environment: { FRONTMIND_WEBSITE_EVALUATION_MODE: "live" },
      build: input,
    });

    expect(result).toMatchObject({ eligible: true, mode: "live" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.eligible ? result.runId : "",
        status: "queued",
        admissionMode: "user",
        evidenceManifestVersion: WEBSITE_BUILD_EVALUATION_EVIDENCE_VERSION,
        ruleVersion: WEBSITE_BUILD_EVALUATION_RULE_VERSION,
        judgeVersion: WEBSITE_BUILD_EVALUATION_JUDGE_VERSION,
        skillVersion: WEBSITE_BUILD_EVALUATION_SKILL_VERSION,
        nextAttemptAt: input.now,
      }),
    );
    expect(onDuplicateKeyUpdate).toHaveBeenCalledTimes(1);
    expect(Object.keys({ insert })).toEqual(["insert"]);

    await reserveAutomaticWebsiteEvaluation({
      tx: { insert },
      tables: { siteEvaluationRuns: table },
      environment: {
        FRONTMIND_WEBSITE_EVALUATION_MODE: "shadow",
        FRONTMIND_WEBSITE_EVALUATION_ALLOW_PROJECT_IDS: PROJECT_ID,
      },
      build: input,
    });
    expect(values).toHaveBeenLastCalledWith(
      expect.objectContaining({ admissionMode: "shadow", status: "queued" }),
    );
  });

  it("is wired to the durable preview-ready artifact checkpoint, not approval", () => {
    const source = readFileSync(
      new URL("../server/siteops/worker.ts", import.meta.url),
      "utf8",
    );
    const callIndex = source.indexOf("await reserveAutomaticWebsiteEvaluation");
    const reservation = source.slice(
      Math.max(0, callIndex - 400),
      source.indexOf("let liveHeadConflict", callIndex),
    );
    expect(reservation).toContain('buildCheckpoint === "preview_ready"');
    expect(reservation).not.toContain('buildStatus === "approved"');
  });
});
