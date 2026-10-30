// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildSiteOpsEmbedPreviewToken,
  sandboxedPreviewContentSecurityPolicy,
  siteOpsPreviewBridgeScript,
  siteOpsPreviewBridgeToken,
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

  it("keeps the top-level preview unframeable and only widens for the embed", () => {
    const nonce = "nonce-1234567890abcdef";
    const deny = sandboxedPreviewContentSecurityPolicy(nonce);
    expect(deny).toContain("frame-ancestors 'none'");
    expect(deny).toContain(`script-src 'nonce-${nonce}'`);
    expect(deny).toContain("sandbox allow-scripts");
    const embed = sandboxedPreviewContentSecurityPolicy(nonce, {
      frameAncestors: "'self'",
    });
    expect(embed).toContain("frame-ancestors 'self'");
    // Only the frame-ancestors directive differs; the sandbox stays identical.
    expect(embed.replace("frame-ancestors 'self'", "frame-ancestors 'none'"))
      .toBe(deny);
    expect(() => sandboxedPreviewContentSecurityPolicy(nonce, {
      frameAncestors: "https://evil.example",
    })).toThrow("SITEOPS_PREVIEW_FRAME_ANCESTORS_INVALID");
  });

  it("uses a short-lived default TTL", () => {
    expect(SITEOPS_EMBED_PREVIEW_TOKEN_TTL_MS).toBe(10 * 60_000);
  });

  it("derives a deterministic bridge token from the embed capability", () => {
    const token = buildSiteOpsEmbedPreviewToken({
      buildId: "44444444-4444-4444-8444-444444444444",
      userId: 7,
      now: 1_000,
      sign: signWithSecret,
    });
    expect(siteOpsPreviewBridgeToken(token, signWithSecret))
      .toBe(siteOpsPreviewBridgeToken(token, signWithSecret));
    expect(siteOpsPreviewBridgeToken(token, signWithSecret))
      .not.toBe(siteOpsPreviewBridgeToken(`${token}x`, signWithSecret));
  });

  it("escapes the bridge bootstrap for a nonce-scoped inline script", () => {
    const script = siteOpsPreviewBridgeScript("nonce-1234567890abcdef", {
      token: "bridge",
      buildId: "44444444-4444-4444-8444-444444444444",
      knowledgeSnapshotId: "22222222-2222-4222-8222-222222222222",
      knowledgeArchiveHash: "a".repeat(64),
      designRevision: 4,
      draftHash: "d".repeat(64),
    });
    expect(script).toContain('<script nonce="nonce-1234567890abcdef">');
    expect(script).toContain("window.__FRONTMIND_SITEOPS_PREVIEW_BRIDGE__=");
    expect(script).toContain('"buildId":"44444444-4444-4444-8444-444444444444"');
    expect(script.endsWith("</script>")).toBe(true);
    // Dangerous characters in any value stay escaped inside the script body.
    const hostile = siteOpsPreviewBridgeScript("nonce-1234567890abcdef", {
      token: "<script>",
      buildId: "44444444-4444-4444-8444-444444444444",
      knowledgeSnapshotId: "22222222-2222-4222-8222-222222222222",
      knowledgeArchiveHash: "a".repeat(64),
      designRevision: 4,
      draftHash: "d".repeat(64),
    });
    expect(hostile).toContain("\u003c");
    expect(hostile).not.toContain("<script>");
    expect(() => siteOpsPreviewBridgeScript("short", {
      token: "bridge",
      buildId: "44444444-4444-4444-8444-444444444444",
      knowledgeSnapshotId: "22222222-2222-4222-8222-222222222222",
      knowledgeArchiveHash: "a".repeat(64),
      designRevision: 4,
      draftHash: "d".repeat(64),
    })).toThrow("SITEOPS_PREVIEW_NONCE_INVALID");
  });
});
