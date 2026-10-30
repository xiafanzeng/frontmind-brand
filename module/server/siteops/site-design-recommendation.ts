import type { SiteBrief } from "../../contracts/siteops.js";
import {
  SITE_DESIGN_RECOMMENDATION_SCHEMA_VERSION,
  siteDesignRecommendationOutputSchema,
  type SiteDesignKnowledgeSnapshotCoordinate,
  type SiteDesignPreviewBlock,
  type SiteDesignRecommendationInput,
  type SiteDesignRecommendationOutput,
  type SiteDesignRecommendationReason,
  type SiteDesignTemplateCoordinate,
} from "../../contracts/site-design-preferences.js";
import { canonicalSha256 } from "../../contracts/siteops-workflow.js";

/**
 * The recommender deliberately receives only the public text needed to prove
 * its output. The service layer is responsible for selecting the immutable,
 * active snapshot; this pure projection never reads storage or calls a model.
 */
export type SiteDesignRecommendationSourceDocument = {
  id: string;
  title: string;
  content: string;
};

export type CreateSiteDesignRecommendationInput = {
  brief: SiteBrief;
  requestContext: SiteDesignRecommendationInput["requestContext"];
  knowledgeSnapshot: SiteDesignKnowledgeSnapshotCoordinate;
  template: SiteDesignTemplateCoordinate;
  documents: readonly SiteDesignRecommendationSourceDocument[];
};

type SourceDocument = SiteDesignRecommendationSourceDocument;
type BriefRoute = SiteBrief["routes"][number];

type RouteCategory =
  | "home"
  | "core"
  | "contact"
  | "fallback"
  | "secondary";

type RecommendableRoute = BriefRoute & {
  sourceDocumentIds: string[];
  evidenceDocumentCount: number;
  category: RouteCategory;
};

const ROUTE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/u;
const UNTRUSTED_NAME_PATTERN =
  /(?:待确认|待补充|未知|未命名|暂无|unknown|unnamed|tbd)/iu;

function compareText(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compactText(value: string, maximum: number) {
  return value
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function normalizedSlugKey(value: string) {
  const compact = value.trim().replace(/\\/gu, "/").replace(/\/{2,}/gu, "/");
  if (compact === "" || compact === "/") return "/";
  return `/${compact.replace(/^\/+|\/+$/gu, "").toLowerCase()}`;
}

function canonicalOutputSlug(value: string) {
  const compact = value.trim().replace(/\\/gu, "/").replace(/\/{2,}/gu, "/");
  if (compact === "" || compact === "/") return "/";
  return `/${compact.replace(/^\/+|\/+$/gu, "")}`;
}

function stableUnique(values: readonly string[], maximum = 100) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort(compareText)
    .slice(0, maximum);
}

function stableDocuments(
  documents: readonly SiteDesignRecommendationSourceDocument[],
) {
  const sorted = documents
    .map((document) => ({
      id: compactText(document.id, 191),
      title: compactText(document.title, 255),
      content: compactText(document.content, 100_000),
    }))
    .filter(
      (document) =>
        document.id.length > 0 &&
        (document.title.length > 0 || document.content.length > 0),
    )
    .sort((left, right) =>
      compareText(
        `${left.id}\u0000${left.title}\u0000${left.content}`,
        `${right.id}\u0000${right.title}\u0000${right.content}`,
      ),
    );
  const unique = new Map<string, SourceDocument>();
  for (const document of sorted) {
    if (!unique.has(document.id)) unique.set(document.id, document);
  }
  return [...unique.values()];
}

function routeCategory(route: Pick<BriefRoute, "id" | "slug">): RouteCategory {
  const id = route.id.toLowerCase();
  const slug = normalizedSlugKey(route.slug);
  if (slug === "/" || id === "home" || id === "homepage") return "home";
  if (
    ["offerings", "products", "product", "services", "service", "solutions", "solution"].includes(id) ||
    ["/offerings", "/products", "/product", "/services", "/service", "/solutions", "/solution"].includes(slug)
  ) {
    return "core";
  }
  if (id === "contact" || slug === "/contact") return "contact";
  if (
    ["about", "cases", "case-studies", "faq", "applications", "application"].includes(id) ||
    ["/about", "/cases", "/case-studies", "/faq", "/applications", "/application"].includes(slug)
  ) {
    return "fallback";
  }
  return "secondary";
}

function mergeRoutesByStableCoordinates(
  routes: readonly BriefRoute[],
  sourceDocuments: ReadonlyMap<string, SourceDocument>,
) {
  const valid = routes
    .map((route) => ({
      id: route.id.trim(),
      slug: canonicalOutputSlug(route.slug),
      title: compactText(route.title, 255),
      sourceDocumentIds: stableUnique(route.sourceDocumentIds).filter((id) =>
        sourceDocuments.has(id),
      ),
    }))
    .filter(
      (route) =>
        ROUTE_ID_PATTERN.test(route.id) &&
        route.title.length > 0 &&
        route.sourceDocumentIds.length > 0,
    )
    .sort((left, right) =>
      compareText(
        `${left.id}\u0000${normalizedSlugKey(left.slug)}\u0000${left.title}`,
        `${right.id}\u0000${normalizedSlugKey(right.slug)}\u0000${right.title}`,
      ),
    );

  const byId = new Map<string, BriefRoute>();
  for (const route of valid) {
    const existing = byId.get(route.id);
    if (!existing) {
      byId.set(route.id, route);
      continue;
    }
    const slugs = [existing.slug, route.slug].sort((left, right) => {
      if (left === "/") return -1;
      if (right === "/") return 1;
      return compareText(normalizedSlugKey(left), normalizedSlugKey(right));
    });
    byId.set(route.id, {
      id: route.id,
      slug: slugs[0],
      title: [existing.title, route.title].sort(compareText)[0],
      sourceDocumentIds: stableUnique([
        ...existing.sourceDocumentIds,
        ...route.sourceDocumentIds,
      ]),
    });
  }

  const bySlug = new Map<string, BriefRoute>();
  for (const route of [...byId.values()].sort((left, right) =>
    compareText(
      `${normalizedSlugKey(left.slug)}\u0000${left.id}`,
      `${normalizedSlugKey(right.slug)}\u0000${right.id}`,
    ),
  )) {
    const slugKey = normalizedSlugKey(route.slug);
    const existing = bySlug.get(slugKey);
    if (!existing) {
      bySlug.set(slugKey, route);
      continue;
    }
    const canonical = [existing, route].sort((left, right) =>
      compareText(left.id, right.id),
    )[0];
    bySlug.set(slugKey, {
      id: canonical.id,
      slug: canonical.slug,
      title: [existing.title, route.title].sort(compareText)[0],
      sourceDocumentIds: stableUnique([
        ...existing.sourceDocumentIds,
        ...route.sourceDocumentIds,
      ]),
    });
  }

  return [...bySlug.values()].map((route): RecommendableRoute => ({
    ...route,
    evidenceDocumentCount: route.sourceDocumentIds.length,
    category: routeCategory(route),
  }));
}

const CATEGORY_ORDER: Record<RouteCategory, number> = {
  home: 0,
  core: 1,
  contact: 2,
  fallback: 3,
  secondary: 4,
};

function compareEvidence(left: RecommendableRoute, right: RecommendableRoute) {
  return (
    right.evidenceDocumentCount - left.evidenceDocumentCount ||
    CATEGORY_ORDER[left.category] - CATEGORY_ORDER[right.category] ||
    compareText(left.id, right.id) ||
    compareText(normalizedSlugKey(left.slug), normalizedSlugKey(right.slug))
  );
}

function verifiedContactSources(
  brief: SiteBrief,
  sourceDocuments: ReadonlyMap<string, SourceDocument>,
) {
  return new Set(
    brief.contacts.flatMap((contact) =>
      contact.sourceDocumentIds.filter((id) => sourceDocuments.has(id)),
    ),
  );
}

function selectFeaturedRoutes(
  routes: readonly RecommendableRoute[],
  contactSources: ReadonlySet<string>,
) {
  const selected: RecommendableRoute[] = [];
  const reasonById = new Map<string, SiteDesignRecommendationReason>();
  const choose = (
    route: RecommendableRoute | undefined,
    reason: SiteDesignRecommendationReason,
  ) => {
    if (!route || selected.some((candidate) => candidate.id === route.id)) return;
    selected.push(route);
    reasonById.set(route.id, reason);
  };
  const best = (category: RouteCategory) =>
    routes.filter((route) => route.category === category).sort(compareEvidence)[0];

  choose(best("home"), "homepage_entry");
  choose(best("core"), "core_business_coverage");

  const contact = routes
    .filter(
      (route) =>
        route.category === "contact" &&
        route.sourceDocumentIds.some((id) => contactSources.has(id)),
    )
    .sort(compareEvidence)[0];
  if (contact) {
    choose(contact, "verified_contact_conversion");
  } else {
    choose(best("fallback"), "fallback_knowledge_coverage");
  }

  return { selected: selected.slice(0, 3), reasonById };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function siteNameRecommendation(
  companyName: string,
  documents: readonly SourceDocument[],
): SiteDesignRecommendationOutput["siteName"] {
  const value = compactText(companyName, 80);
  if (!value || UNTRUSTED_NAME_PATTERN.test(value)) {
    return {
      value: null,
      status: "needs_confirmation",
      sourceType: "unavailable",
      sourceDocumentIds: [],
    };
  }

  const escaped = escapeRegExp(value);
  const detectors = [
    {
      sourceType: "brand_name" as const,
      pattern: new RegExp(`(?:对外品牌|品牌名称|品牌名)[^\\n。；;]{0,24}${escaped}`, "iu"),
    },
    {
      sourceType: "company_name" as const,
      pattern: new RegExp(`(?:公司名称|企业名称)[^\\n。；;]{0,24}${escaped}`, "iu"),
    },
    {
      sourceType: "introduction_subject" as const,
      pattern: new RegExp(`${escaped}[^。！？\\n]{0,40}是一家`, "iu"),
    },
  ];
  for (const detector of detectors) {
    const sources = documents
      .filter((document) => detector.pattern.test(document.content))
      .map((document) => document.id);
    if (sources.length > 0) {
      return {
        value,
        status: "trusted",
        sourceType: detector.sourceType,
        sourceDocumentIds: stableUnique(sources, 50),
      };
    }
  }

  return {
    value: null,
    status: "needs_confirmation",
    sourceType: "unavailable",
    sourceDocumentIds: [],
  };
}

function siteGoalRecommendation(
  selectedRoutes: readonly RecommendableRoute[],
  sourceDocuments: ReadonlyMap<string, SourceDocument>,
  contactSources: ReadonlySet<string>,
): SiteDesignRecommendationOutput["siteGoal"] {
  const subjectRoute =
    selectedRoutes.find((route) => route.category === "core") ??
    selectedRoutes.find((route) => route.category === "home") ??
    selectedRoutes.find((route) => route.category === "fallback") ??
    selectedRoutes[0];
  if (!subjectRoute) {
    return {
      value: null,
      status: "needs_confirmation",
      sourceDocumentIds: [],
    };
  }

  const subjects: Array<{ title: string; sourceDocumentId: string }> = [];
  const seenTitles = new Set<string>();
  for (const sourceDocumentId of subjectRoute.sourceDocumentIds) {
    const document = sourceDocuments.get(sourceDocumentId);
    const title = document ? compactText(document.title, 255) : "";
    if (!title || seenTitles.has(title)) continue;
    seenTitles.add(title);
    subjects.push({ title, sourceDocumentId });
    if (subjects.length >= 3) break;
  }
  if (subjects.length === 0) {
    return {
      value: null,
      status: "needs_confirmation",
      sourceDocumentIds: [],
    };
  }

  const contactRoute = selectedRoutes.find(
    (route) =>
      route.category === "contact" &&
      route.sourceDocumentIds.some((id) => contactSources.has(id)),
  );
  const contactSourceDocumentIds = contactRoute
    ? contactRoute.sourceDocumentIds.filter((id) => contactSources.has(id))
    : [];
  const value = compactText(
    `帮助访客了解${subjects.map((subject) => subject.title).join("、")}${
      contactSourceDocumentIds.length > 0
        ? "，并通过已验证的联系方式进一步咨询"
        : ""
    }`,
    200,
  );

  return {
    value,
    status: "recommended",
    sourceDocumentIds: stableUnique([
      ...subjects.map((subject) => subject.sourceDocumentId),
      ...contactSourceDocumentIds,
    ]),
  };
}

function blockKind(route: RecommendableRoute): SiteDesignPreviewBlock["kind"] {
  if (route.category === "home") return "hero";
  if (route.category === "core") return "offerings";
  if (route.category === "contact") return "contact";
  if (route.id === "faq" || normalizedSlugKey(route.slug) === "/faq") return "faq";
  if (route.category === "fallback") return "facts";
  return "summary";
}

function sourceItemsForRoute(
  brief: SiteBrief,
  route: RecommendableRoute,
  sourceDocuments: ReadonlyMap<string, SourceDocument>,
) {
  const routeSources = new Set(route.sourceDocumentIds);
  const facts = brief.verifiedFacts
    .map((fact) => ({
      title: null,
      body: compactText(fact.statement, 2_000),
      sourceDocumentIds: stableUnique(fact.sourceDocumentIds, 50).filter(
        (id) => routeSources.has(id) && sourceDocuments.has(id),
      ),
    }))
    .filter((item) => item.body.length > 0 && item.sourceDocumentIds.length > 0)
    .sort((left, right) =>
      compareText(
        `${left.body}\u0000${left.sourceDocumentIds.join(",")}`,
        `${right.body}\u0000${right.sourceDocumentIds.join(",")}`,
      ),
    );
  const seenBodies = new Set(facts.map((fact) => fact.body));
  const excerpts = route.sourceDocumentIds.flatMap((id) => {
    const document = sourceDocuments.get(id);
    if (!document) return [];
    const body = compactText(document.content || document.title, 2_000);
    if (!body || seenBodies.has(body)) return [];
    seenBodies.add(body);
    return [
      {
        title: document.title ? compactText(document.title, 255) : null,
        body,
        sourceDocumentIds: [document.id],
      },
    ];
  });
  return [...facts, ...excerpts].slice(0, 6);
}

function previewBlockForRoute(
  brief: SiteBrief,
  route: RecommendableRoute,
  sourceDocuments: ReadonlyMap<string, SourceDocument>,
): SiteDesignPreviewBlock {
  const kind = blockKind(route);
  if (kind === "contact") {
    const routeSources = new Set(route.sourceDocumentIds);
    const items = brief.contacts
      .map((contact) => ({
        title:
          contact.kind === "email"
            ? "邮箱"
            : contact.kind === "phone"
              ? "电话"
              : "地址",
        body: compactText(contact.value, 2_000),
        sourceDocumentIds: stableUnique(contact.sourceDocumentIds, 50).filter(
          (id) => routeSources.has(id) && sourceDocuments.has(id),
        ),
      }))
      .filter((item) => item.body.length > 0 && item.sourceDocumentIds.length > 0)
      .sort((left, right) =>
        compareText(
          `${left.title}\u0000${left.body}\u0000${left.sourceDocumentIds.join(",")}`,
          `${right.title}\u0000${right.body}\u0000${right.sourceDocumentIds.join(",")}`,
        ),
      );
    if (items.length > 0) {
      return {
        id: `${route.id}:contact:1`,
        routeId: route.id,
        kind,
        title: route.title,
        body: null,
        items,
        sourceDocumentIds: stableUnique(
          items.flatMap((item) => item.sourceDocumentIds),
        ),
      };
    }
  }

  const sourceItems = sourceItemsForRoute(brief, route, sourceDocuments);
  const [lead, ...items] = sourceItems;
  return {
    id: `${route.id}:${kind}:1`,
    routeId: route.id,
    kind,
    title: route.title,
    body: lead?.body ?? null,
    items,
    sourceDocumentIds: stableUnique(
      sourceItems.flatMap((item) => item.sourceDocumentIds),
    ),
  };
}

/**
 * Rank routes and project preview copy from an already materialized SiteBrief.
 * Every candidate, featured route and preview block is backed by document IDs
 * present in the supplied immutable snapshot projection.
 */
export function createSiteDesignRecommendation(
  input: CreateSiteDesignRecommendationInput,
): SiteDesignRecommendationOutput {
  const documents = stableDocuments(input.documents);
  const sourceDocuments = new Map(
    documents.map((document) => [document.id, document] as const),
  );
  const routes = mergeRoutesByStableCoordinates(
    input.brief.routes,
    sourceDocuments,
  );
  const contactSources = verifiedContactSources(input.brief, sourceDocuments);
  const { selected, reasonById } = selectFeaturedRoutes(
    routes,
    contactSources,
  );
  const selectedIds = new Set(selected.map((route) => route.id));
  const remaining = routes
    .filter((route) => !selectedIds.has(route.id))
    .sort(compareEvidence);
  const ranked = [...selected, ...remaining];
  // Every source-backed route is featured by default; the priority picks only
  // drive ordering and the recommendation reasons, never a hard column cap.
  const featuredRouteIds = ranked.map((route) => route.id);
  const featuredIds = new Set(featuredRouteIds);
  const name = siteNameRecommendation(input.brief.companyName, documents);
  const goal = siteGoalRecommendation(
    selected,
    sourceDocuments,
    contactSources,
  );
  const unresolved = stableUnique(
    [
      ...(name.status === "trusted" ? [] : ["site_name_needs_confirmation"]),
      ...(goal.status === "recommended" ? [] : ["site_goal_needs_confirmation"]),
      ...(ranked.length === 0 ? ["no_recommendable_routes"] : []),
      ...(featuredRouteIds.length < 3
        ? ["fewer_than_three_featured_routes"]
        : []),
    ],
    50,
  );

  const deterministicRecommendation = {
    schemaVersion: SITE_DESIGN_RECOMMENDATION_SCHEMA_VERSION,
    knowledgeSnapshot: input.knowledgeSnapshot,
    template: input.template,
    siteName: name,
    siteGoal: goal,
    candidates: ranked.map((route, index) => ({
      id: route.id,
      slug: route.slug,
      title: route.title,
      sourceDocumentIds: route.sourceDocumentIds,
      evidenceDocumentCount: route.evidenceDocumentCount,
      importanceRank: index + 1,
      featured: featuredIds.has(route.id),
      recommendationReason:
        reasonById.get(route.id) ?? "secondary_knowledge_coverage",
    })),
    featuredRouteIds,
    previewBlocks: ranked.map((route) =>
      previewBlockForRoute(input.brief, route, sourceDocuments),
    ),
    unresolved,
  };

  return siteDesignRecommendationOutputSchema.parse({
    ...deterministicRecommendation,
    requestContext: input.requestContext,
    recommendationHash: canonicalSha256(deterministicRecommendation),
  });
}
