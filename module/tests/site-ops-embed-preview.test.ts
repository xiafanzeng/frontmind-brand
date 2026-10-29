// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildSiteOpsEmbedPreviewToken,
  SITEOPS_EMBED_PREVIEW_TOKEN_TTL_MS,
  verifySiteOpsEmbedPreviewToken,
} from "../server/siteops/artifact-api.js";

const SIGNING_SECRET = "test-embed-signing-secret";

function signWithSecret(payload: string) {
  return createHmac("sha256", SIGNING_SECRET)
    .update("frontmind.siteops-embed-preview.v1\u0000")
    .update(payload)
    .digest("base64url");
}

describe("site ops embed preview tokens", () => {
  it("round-trips a minted token for the same build and user", () => {
    const token = buildSiteOpsEmbedPreviewToken({
      buildId: "44444444-4444-4444-8444-444444444444",
      userId: 7,
      now: 1_000_000,
      ttlMs: 60_000,
      sign: signWithSecret,
    });

    expect(verifySiteOpsEmbedPreviewToken(token, {
      buildId: "44444444-4444-4444-8444-444444444444",
      userId: 7,
      now: 1_030_000,
      sign: signWithSecret,
    })).toBe("valid");
  });

  it("reports expiry instead of validity once the TTL passes", () => {
    const token = buildSiteOpsEmbedPreviewToken({
      buildId: "44444444-4444-4444-8444-444444444444",
      userId: 7,
      now: 1_000_000,
      ttlMs: 60_000,
      sign: signWithSecret,
    });

    expect(verifySiteOpsEmbedPreviewToken(token, {
      buildId: "44444444-4444-4444-8444-444444444444",
      userId: 7,
      now: 1_061_000,
      sign: signWithSecret,
    })).toBe("expired");
  });

  it("rejects tokens for another build, user or signature", () => {
    const token = buildSiteOpsEmbedPreviewToken({
      buildId: "44444444-4444-4444-8444-444444444444",
      userId: 7,
      now: 1_000,
      sign: signWithSecret,
    });

    expect(verifySiteOpsEmbedPreviewToken(token, {
      buildId: "55555555-5555-4555-8555-555555555555",
      userId: 7,
      now: 2_000,
      sign: signWithSecret,
    })).toBe("invalid");
    expect(verifySiteOpsEmbedPreviewToken(token, {
      buildId: "44444444-4444-4444-8444-444444444444",
      userId: 8,
      now: 2_000,
      sign: signWithSecret,
    })).toBe("invalid");
    expect(verifySiteOpsEmbedPreviewToken(`${token}x`, {
      buildId: "44444444-4444-4444-8444-444444444444",
      userId: 7,
      now: 2_000,
      sign: signWithSecret,
    })).toBe("invalid");
    expect(verifySiteOpsEmbedPreviewToken("not-a-token", {
      buildId: "44444444-4444-4444-8444-444444444444",
      userId: 7,
      now: 2_000,
      sign: signWithSecret,
    })).toBe("invalid");
    // A different signing secret never validates a minted token.
    expect(verifySiteOpsEmbedPreviewToken(token, {
      buildId: "44444444-4444-4444-8444-444444444444",
      userId: 7,
      now: 2_000,
      sign: (payload) => signWithSecret(`${payload}!`),
    })).toBe("invalid");
  });

  it("uses a short-lived default TTL", () => {
    expect(SITEOPS_EMBED_PREVIEW_TOKEN_TTL_MS).toBe(10 * 60_000);
  });
});
