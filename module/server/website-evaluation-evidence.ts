import { createHash } from "node:crypto";
import { z } from "zod";

export const WEBSITE_EVALUATION_VIEWPORTS = [
  { id: "1440x1000", width: 1440, height: 1000 },
  { id: "390x844", width: 390, height: 844 },
  { id: "320x720", width: 320, height: 720 },
] as const;

export type WebsiteEvaluationRouteCandidate = {
  id: string;
  route: string;
  contentLength: number;
  home?: boolean;
  visitorTaskEntry?: boolean;
  requiredTaskRoute?: boolean;
  primaryNavigationTarget?: boolean;
  conversion?: boolean;
  contact?: boolean;
  assistant?: boolean;
};

export type WebsiteEvaluationPublicEvidence = {
  id: string;
  kind:
    | "screenshot"
    | "dom"
    | "accessibility_tree"
    | "axe"
    | "lighthouse"
    | "structural_qa"
    | "public_fact"
    | "redacted_fact_result";
  route?: string;
  viewport?: (typeof WEBSITE_EVALUATION_VIEWPORTS)[number]["id"];
  value: unknown;
};

export type WebsiteEvaluationEvidenceManifest = {
  schemaVersion: 1;
  buildId: string;
  routes: WebsiteEvaluationRouteCandidate[];
  evidence: WebsiteEvaluationPublicEvidence[];
};

const routeSchema = z.object({
  id: z.string().trim().min(1).max(128),
  route: z.string().trim().startsWith("/").max(512),
  contentLength: z.number().int().nonnegative(),
  home: z.boolean().optional(),
  visitorTaskEntry: z.boolean().optional(),
  requiredTaskRoute: z.boolean().optional(),
  primaryNavigationTarget: z.boolean().optional(),
  conversion: z.boolean().optional(),
  contact: z.boolean().optional(),
  assistant: z.boolean().optional(),
}).strict();

const publicEvidenceSchema = z.object({
  id: z.string().trim().min(1).max(256),
  kind: z.enum([
    "screenshot",
    "dom",
    "accessibility_tree",
    "axe",
    "lighthouse",
    "structural_qa",
    "public_fact",
    "redacted_fact_result",
  ]),
  route: z.string().trim().startsWith("/").max(512).optional(),
  viewport: z.enum(["1440x1000", "390x844", "320x720"]).optional(),
  value: z.unknown(),
}).strict();

export const websiteEvaluationEvidenceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  buildId: z.string().uuid(),
  routes: z.array(routeSchema).min(1).max(500),
  evidence: z.array(publicEvidenceSchema).min(1).max(10_000),
}).strict();

function normalizeRoute(route: string) {
  const [pathname] = route.trim().split(/[?#]/, 1);
  if (!pathname || pathname === "/") return "/";
  return `/${pathname.replace(/^\/+|\/+$/g, "")}`;
}

/** Deterministic, priority-ordered selection of at most five critical routes. */
export function selectWebsiteEvaluationCriticalRoutes(
  candidates: readonly WebsiteEvaluationRouteCandidate[],
) {
  const parsed = z.array(routeSchema).max(500).parse(candidates).map((item) => ({
    ...item,
    route: normalizeRoute(item.route),
  }));
  const byRoute = new Map<string, (typeof parsed)[number]>();
  for (const candidate of parsed) {
    const current = byRoute.get(candidate.route);
    if (!current || candidate.contentLength > current.contentLength) {
      byRoute.set(candidate.route, candidate);
    }
  }
  const unique = [...byRoute.values()];
  const selected: typeof unique = [];
  const add = (predicate: (item: (typeof unique)[number]) => boolean) => {
    const next = unique.find(
      (item) => predicate(item) && !selected.some(({ route }) => route === item.route),
    );
    if (next && selected.length < 5) selected.push(next);
  };
  add((item) => item.home || item.route === "/");
  add((item) => Boolean(
    item.visitorTaskEntry || item.requiredTaskRoute || item.primaryNavigationTarget,
  ));
  add((item) => Boolean(item.contact || item.conversion));
  add((item) => Boolean(item.assistant));
  add((item) => item.contentLength === Math.max(...unique.map(({ contentLength }) => contentLength), 0));
  for (const item of unique) {
    if (selected.length >= 5) break;
    if (!selected.some(({ route }) => route === item.route)) selected.push(item);
  }
  return selected;
}

const forbiddenKey = /(?:private|secret|token|authorization|cookie|signed.?url|raw.?knowledge|sensitive.?log)/i;
const signedUrl = /(?:[?&](?:x-amz-signature|signature|sig|token)=|https?:\/\/[^\s]+\?.*(?:credential|expires)=)/i;

function assertPublicSafe(value: unknown, path = "evidence") {
  if (typeof value === "string" && signedUrl.test(value)) {
    throw new Error(`PRIVATE_EVIDENCE_REJECTED:${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicSafe(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenKey.test(key)) throw new Error(`PRIVATE_EVIDENCE_REJECTED:${path}.${key}`);
    assertPublicSafe(nested, `${path}.${key}`);
  }
}

export function assertWebsiteEvaluationPublicEvidence(value: unknown) {
  assertPublicSafe(value);
}

export function missingWebsiteEvaluationEvidence(input: {
  routes: readonly WebsiteEvaluationRouteCandidate[];
  criticalRoutes: readonly WebsiteEvaluationRouteCandidate[];
  evidence: readonly WebsiteEvaluationPublicEvidence[];
}) {
  const gaps: string[] = [];
  const has = (kind: WebsiteEvaluationPublicEvidence["kind"], route: string, viewport?: string) =>
    input.evidence.some((item) =>
      item.kind === kind &&
      item.route && normalizeRoute(item.route) === route &&
      (viewport === undefined || item.viewport === viewport),
    );
  for (const route of input.criticalRoutes.map((item) => normalizeRoute(item.route))) {
    for (const viewport of WEBSITE_EVALUATION_VIEWPORTS) {
      if (!has("screenshot", route, viewport.id)) gaps.push(`${route}:${viewport.id}:screenshot`);
      if (!has("axe", route, viewport.id)) gaps.push(`${route}:${viewport.id}:axe`);
    }
    if (!has("dom", route)) gaps.push(`${route}:dom`);
    if (!has("accessibility_tree", route)) gaps.push(`${route}:accessibility_tree`);
    if (!has("lighthouse", route)) gaps.push(`${route}:lighthouse`);
  }
  const structuralRoutes = new Set(input.routes.map(({ route }) => normalizeRoute(route)));
  for (const route of structuralRoutes) {
    if (!has("structural_qa", route)) gaps.push(`${route}:structural_qa`);
  }
  return gaps;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonical(nested)]),
  );
}

export function freezeWebsiteEvaluationEvidence(input: {
  buildId: string;
  routes: readonly WebsiteEvaluationRouteCandidate[];
  evidence: readonly WebsiteEvaluationPublicEvidence[];
}) {
  const routes = z.array(routeSchema).min(1).max(500).parse(input.routes);
  const evidence = z.array(publicEvidenceSchema).min(1).max(10_000).parse(
    input.evidence,
  );
  const criticalRoutes = selectWebsiteEvaluationCriticalRoutes(routes);
  if (criticalRoutes.length < 1) throw new Error("REQUIRED_EVIDENCE_MISSING:routes");
  evidence.forEach((item, index) => assertPublicSafe(item, `evidence[${index}]`));
  const ids = evidence.map(({ id }) => id);
  if (ids.length < 1 || new Set(ids).size !== ids.length) {
    throw new Error("REQUIRED_EVIDENCE_MISSING:items");
  }
  const missing = missingWebsiteEvaluationEvidence({
    routes,
    criticalRoutes,
    evidence,
  });
  if (missing.length) {
    throw new Error(`REQUIRED_EVIDENCE_MISSING:${missing.join(",")}`);
  }
  const structuralRoutes = [...new Map(
    routes.map((route) => [
      normalizeRoute(route.route),
      { id: route.id, route: normalizeRoute(route.route) },
    ]),
  ).values()];
  const frozen = {
    schemaVersion: 1,
    buildId: input.buildId,
    criticalRoutes,
    structuralRoutes,
    viewports: WEBSITE_EVALUATION_VIEWPORTS,
    evidence,
  } as const;
  const json = JSON.stringify(canonical(frozen));
  return {
    frozen,
    evidenceHash: createHash("sha256").update(json, "utf8").digest("hex"),
    allowedEvidenceIds: ids,
  };
}

/** Parses the public runner boundary before deriving its authoritative manifest. */
export function freezeWebsiteEvaluationEvidenceManifest(value: unknown) {
  const manifest = websiteEvaluationEvidenceManifestSchema.parse(value);
  return {
    manifest,
    ...freezeWebsiteEvaluationEvidence({
      buildId: manifest.buildId,
      routes: manifest.routes,
      evidence: manifest.evidence,
    }),
  };
}
