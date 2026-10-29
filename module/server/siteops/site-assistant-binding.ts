import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Server-signed binding between a real site build and the assistant that ships
 * inside it. The token freezes the build's knowledge snapshot coordinate so the
 * public assistant API can answer from exactly the knowledge the site pages
 * were built from; anonymous clients can never pick an arbitrary snapshot.
 *
 * The signature is deterministic for a stable secret: builds embed it in the
 * frozen assistant-config.js and the build-time QA byte-check re-derives it.
 */
export const SITE_ASSISTANT_BINDING_SECRET_ENV =
  "FRONTMIND_SITE_ASSISTANT_BINDING_SECRET";

const SITE_ASSISTANT_BINDING_DOMAIN =
  "frontmind.site-assistant-build-binding.v1";
const BINDING_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;

const bindingPayloadShape = {
  schemaVersion: z.literal(1),
  buildId: z.string().uuid(),
  knowledgeSnapshotId: z.string().uuid(),
  knowledgeArchiveHash: z.string().regex(SHA256_PATTERN),
  designRevision: z.number().int().nonnegative(),
  draftHash: z.string().regex(SHA256_PATTERN),
  assistantName: z.string().trim().min(1).max(80),
  welcome: z.string().trim().min(1).max(500),
  assistantAccent: z.string().regex(HEX_COLOR_PATTERN),
} as const;

export const siteAssistantBuildBindingPayloadSchema = z
  .object(bindingPayloadShape)
  .strict();

export const siteAssistantBuildBindingSchema = z
  .object({
    ...bindingPayloadShape,
    signature: z.string().regex(BINDING_SIGNATURE_PATTERN),
  })
  .strict();

export type SiteAssistantBuildBindingPayload = z.infer<
  typeof siteAssistantBuildBindingPayloadSchema
>;
export type SiteAssistantBuildBinding = z.infer<
  typeof siteAssistantBuildBindingSchema
>;

export function siteAssistantBindingSecret(env: NodeJS.ProcessEnv = process.env) {
  const secret = env[SITE_ASSISTANT_BINDING_SECRET_ENV];
  return typeof secret === "string" && secret.length >= 16 ? secret : null;
}

function canonicalBindingPayload(binding: SiteAssistantBuildBindingPayload) {
  return JSON.stringify(binding);
}

function bindingSignature(payload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`${SITE_ASSISTANT_BINDING_DOMAIN}\u0000`)
    .update(payload)
    .digest("base64url");
}

function timingSafeEqualText(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes);
}

export function signSiteAssistantBuildBinding(
  binding: SiteAssistantBuildBindingPayload,
  secret: string,
) {
  return bindingSignature(canonicalBindingPayload(binding), secret);
}

export function verifySiteAssistantBuildBinding(
  value: unknown,
  secret: string,
): SiteAssistantBuildBinding | null {
  const parsed = siteAssistantBuildBindingSchema.safeParse(value);
  if (!parsed.success) return null;
  const { signature, ...payload } = parsed.data;
  const expected = bindingSignature(
    canonicalBindingPayload(
      siteAssistantBuildBindingPayloadSchema.parse(payload),
    ),
    secret,
  );
  if (!timingSafeEqualText(signature, expected)) return null;
  return parsed.data;
}

/** Stable hash identifying the knowledge identity of a binding; sessions are
 * keyed on this so pure visual revisions keep the conversation while knowledge
 * changes always start a new one. */
export function siteAssistantBindingKnowledgeKey(
  binding: Pick<SiteAssistantBuildBinding, "knowledgeSnapshotId" | "knowledgeArchiveHash">,
) {
  return `${binding.knowledgeSnapshotId}:${binding.knowledgeArchiveHash}`;
}
