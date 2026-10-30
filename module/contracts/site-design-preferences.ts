import { z } from "zod";

export const SITE_DESIGN_PREFERENCES_SCHEMA_VERSION = 1 as const;
export const SITE_DESIGN_RECOMMENDATION_SCHEMA_VERSION = 1 as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/iu);
export const siteDesignRouteIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u);
const sourceDocumentIdSchema = z.string().trim().min(1).max(191);

function uniqueStringArray<T extends z.ZodType<string>>(
  itemSchema: T,
  maximum: number,
  minimum = 0,
) {
  return z
    .array(itemSchema)
    .min(minimum)
    .max(maximum)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: "Values must be unique",
        });
      }
    });
}

export const siteDesignKnowledgeSnapshotCoordinateSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    archiveHash: sha256Schema,
  })
  .strict();

/**
 * `id` is the immutable static-template candidate ID and `version` is the
 * catalogVersion from which that candidate was selected.
 */
export const siteDesignTemplateCoordinateSchema = z
  .object({
    id: z.string().trim().min(1).max(191),
    version: z.string().trim().min(1).max(191),
  })
  .strict();

const siteDesignAssistantSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    welcome: z.string().trim().min(1).max(500),
    accentMode: z.enum(["follow_site", "custom"]),
    // Retain the last valid custom color while follow_site is active.
    customAccent: hexColorSchema.nullable(),
  })
  .strict();

const siteDesignPreferencesDraftShape = {
  schemaVersion: z.literal(SITE_DESIGN_PREFERENCES_SCHEMA_VERSION),
  siteName: z.string().trim().min(1).max(80),
  siteGoal: z.string().trim().min(1).max(200),
  // A persisted design must expose at least one real, source-backed page.
  // Honest empty recommendations remain valid in the separate response schema.
  featuredRouteIds: uniqueStringArray(siteDesignRouteIdSchema, 3, 1),
  siteAccent: hexColorSchema,
  assistant: siteDesignAssistantSchema,
  knowledgeSnapshot: siteDesignKnowledgeSnapshotCoordinateSchema,
  template: siteDesignTemplateCoordinateSchema,
} as const;

function requireCustomAssistantAccent(
  value: { assistant: { accentMode: string; customAccent: string | null } },
  context: z.RefinementCtx,
) {
    if (
      value.assistant.accentMode === "custom" &&
      value.assistant.customAccent === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["assistant", "customAccent"],
        message: "A custom assistant accent is required in custom mode",
      });
    }
}

export const siteDesignPreferencesDraftSchema = z
  .object(siteDesignPreferencesDraftShape)
  .strict()
  .superRefine(requireCustomAssistantAccent);

const siteDesignPreferencesHashPayloadSchema = z
  .object({
    ...siteDesignPreferencesDraftShape,
    designRevision: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine(requireCustomAssistantAccent);

export const siteDesignPreferencesV1Schema = z
  .object({
    ...siteDesignPreferencesDraftShape,
    designRevision: z.number().int().positive(),
    draftHash: sha256Schema,
  })
  .strict()
  .superRefine(requireCustomAssistantAccent);

export type SiteDesignKnowledgeSnapshotCoordinate = z.infer<
  typeof siteDesignKnowledgeSnapshotCoordinateSchema
>;
export type SiteDesignTemplateCoordinate = z.infer<
  typeof siteDesignTemplateCoordinateSchema
>;
export type SiteDesignPreferences = z.infer<
  typeof siteDesignPreferencesV1Schema
>;
export type SiteDesignPreferencesV1 = SiteDesignPreferences;
export type SiteDesignPreferencesDraft = z.infer<
  typeof siteDesignPreferencesDraftSchema
>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) =>
          left === right ? 0 : left < right ? -1 : 1,
        )
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

/** Canonical UTF-8 input for the server-authoritative SHA-256 draft hash. */
export function canonicalSiteDesignDraftJson(value: unknown): string {
  return JSON.stringify(
    canonicalize(siteDesignPreferencesHashPayloadSchema.parse(value)),
  );
}

export const siteDesignPreferencesSaveInputSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(191),
    expectedProjectRevision: z.number().int().positive(),
    expectedDesignRevision: z.number().int().nonnegative(),
    draft: siteDesignPreferencesDraftSchema,
  })
  .strict();

export type SiteDesignPreferencesSaveInput = z.infer<
  typeof siteDesignPreferencesSaveInputSchema
>;

export class UnsupportedSiteDesignPreferencesVersionError extends Error {
  readonly schemaVersion: unknown;

  constructor(schemaVersion: unknown) {
    super(
      `Unsupported SiteDesignPreferences schemaVersion: ${String(schemaVersion)}`,
    );
    this.name = "UnsupportedSiteDesignPreferencesVersionError";
    this.schemaVersion = schemaVersion;
  }
}

export class UnknownSiteDesignFeaturedRouteError extends Error {
  readonly routeIds: string[];

  constructor(routeIds: string[]) {
    super(`Unknown featured route IDs: ${routeIds.join(", ")}`);
    this.name = "UnknownSiteDesignFeaturedRouteError";
    this.routeIds = routeIds;
  }
}

/**
 * Single migration entry point for persisted values. Add older-version cases
 * here when the contract advances; never silently accept a future version.
 */
export function migrateSiteDesignPreferences(
  value: unknown,
): SiteDesignPreferences {
  const schemaVersion =
    value !== null && typeof value === "object" && "schemaVersion" in value
      ? (value as { schemaVersion?: unknown }).schemaVersion
      : undefined;

  switch (schemaVersion) {
    case SITE_DESIGN_PREFERENCES_SCHEMA_VERSION:
      return siteDesignPreferencesV1Schema.parse(value);
    default:
      throw new UnsupportedSiteDesignPreferencesVersionError(schemaVersion);
  }
}

/**
 * Persistence boundary for SiteBrief and other envelopes. Keeping migration
 * inside the field schema prevents an envelope-level parse from rejecting an
 * older supported version before its migration case can run.
 */
export const persistedSiteDesignPreferencesSchema = z
  .unknown()
  .transform((value, context): SiteDesignPreferences => {
    try {
      return migrateSiteDesignPreferences(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error
            ? error.message
            : "Invalid persisted SiteDesignPreferences",
      });
      return z.NEVER;
    }
  });

export function parseSiteDesignPreferences(
  value: unknown,
): SiteDesignPreferences {
  return migrateSiteDesignPreferences(value);
}

/**
 * Project-aware validation for persistence/build boundaries. The base schema
 * validates ID syntax; callers must provide the source-backed route IDs from
 * the current frozen brief so empty placeholder routes cannot enter navigation.
 */
export function parseSiteDesignPreferencesForRoutes(
  value: unknown,
  sourceBackedRouteIds: readonly string[],
): SiteDesignPreferences {
  const parsed = migrateSiteDesignPreferences(value);
  const available = uniqueStringArray(siteDesignRouteIdSchema, 30).parse([
    ...sourceBackedRouteIds,
  ]);
  const availableSet = new Set(available);
  const unknownRouteIds = parsed.featuredRouteIds.filter(
    (routeId) => !availableSet.has(routeId),
  );
  if (unknownRouteIds.length > 0) {
    throw new UnknownSiteDesignFeaturedRouteError(unknownRouteIds);
  }
  return parsed;
}

export function serializeSiteDesignPreferences(
  value: unknown,
): string {
  return JSON.stringify(migrateSiteDesignPreferences(value));
}

export function deserializeSiteDesignPreferences(
  serialized: string,
): SiteDesignPreferences {
  return migrateSiteDesignPreferences(JSON.parse(serialized) as unknown);
}

export const siteDesignRecommendationInputSchema = z
  .object({
    schemaVersion: z.literal(SITE_DESIGN_RECOMMENDATION_SCHEMA_VERSION),
    requestContext: z
      .object({
        requestId: z
          .string()
          .trim()
          .min(8)
          .max(128)
          .regex(/^[A-Za-z0-9._:-]+$/u),
        baseDesignRevision: z.number().int().nonnegative(),
        baseDraftHash: sha256Schema,
      })
      .strict(),
    knowledgeSnapshot: siteDesignKnowledgeSnapshotCoordinateSchema,
    template: siteDesignTemplateCoordinateSchema,
  })
  .strict();

export const siteDesignRecommendationReasonSchema = z.enum([
  "homepage_entry",
  "core_business_coverage",
  "verified_contact_conversion",
  "fallback_knowledge_coverage",
  "secondary_knowledge_coverage",
]);

export const siteDesignRouteRecommendationSchema = z
  .object({
    id: siteDesignRouteIdSchema,
    slug: z.string().trim().min(1).max(191),
    title: z.string().trim().min(1).max(255),
    sourceDocumentIds: uniqueStringArray(sourceDocumentIdSchema, 100, 1),
    evidenceDocumentCount: z.number().int().positive().max(100),
    importanceRank: z.number().int().positive().max(30),
    featured: z.boolean(),
    recommendationReason: siteDesignRecommendationReasonSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.evidenceDocumentCount !== value.sourceDocumentIds.length) {
      context.addIssue({
        code: "custom",
        path: ["evidenceDocumentCount"],
        message: "Evidence count must match the unique source document IDs",
      });
    }
  });

export const siteDesignPreviewBlockKindSchema = z.enum([
  "hero",
  "summary",
  "offerings",
  "facts",
  "faq",
  "contact",
]);

const siteDesignPreviewBlockItemSchema = z
  .object({
    title: z.string().trim().min(1).max(255).nullable(),
    body: z.string().trim().min(1).max(2_000),
    sourceDocumentIds: uniqueStringArray(sourceDocumentIdSchema, 50, 1),
  })
  .strict();

export const siteDesignPreviewBlockSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9][a-z0-9._:-]*$/u),
    routeId: siteDesignRouteIdSchema,
    kind: siteDesignPreviewBlockKindSchema,
    title: z.string().trim().min(1).max(255),
    body: z.string().trim().min(1).max(2_000).nullable(),
    items: z.array(siteDesignPreviewBlockItemSchema).max(50),
    sourceDocumentIds: uniqueStringArray(sourceDocumentIdSchema, 100, 1),
  })
  .strict();

const siteNameRecommendationSchema = z
  .object({
    value: z.string().trim().min(1).max(80).nullable(),
    status: z.enum(["trusted", "needs_confirmation"]),
    sourceType: z.enum([
      "brand_name",
      "company_name",
      "introduction_subject",
      "document_title",
      "source_filename",
      "unavailable",
    ]),
    sourceDocumentIds: uniqueStringArray(sourceDocumentIdSchema, 50),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "trusted" &&
      (value.value === null ||
        value.sourceType === "unavailable" ||
        value.sourceDocumentIds.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "A trusted site name must include a value and real sources",
      });
    }
    if (value.value === null && value.sourceType !== "unavailable") {
      context.addIssue({
        code: "custom",
        path: ["sourceType"],
        message: "A missing site name must use the unavailable source type",
      });
    }
  });

const siteGoalRecommendationSchema = z
  .object({
    value: z.string().trim().min(1).max(200).nullable(),
    status: z.enum(["recommended", "needs_confirmation"]),
    sourceDocumentIds: uniqueStringArray(sourceDocumentIdSchema, 100),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "recommended" &&
      (value.value === null || value.sourceDocumentIds.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "A recommended site goal must include a value and real sources",
      });
    }
  });

export const siteDesignRecommendationOutputSchema = z
  .object({
    schemaVersion: z.literal(SITE_DESIGN_RECOMMENDATION_SCHEMA_VERSION),
    requestContext: siteDesignRecommendationInputSchema.shape.requestContext,
    knowledgeSnapshot: siteDesignKnowledgeSnapshotCoordinateSchema,
    template: siteDesignTemplateCoordinateSchema,
    siteName: siteNameRecommendationSchema,
    siteGoal: siteGoalRecommendationSchema,
    candidates: z.array(siteDesignRouteRecommendationSchema).max(30),
    featuredRouteIds: uniqueStringArray(siteDesignRouteIdSchema, 3),
    previewBlocks: z.array(siteDesignPreviewBlockSchema).max(100),
    unresolved: uniqueStringArray(
      z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[a-z][a-z0-9_]*$/u),
      50,
    ),
    // Hashes only deterministic recommendation data; there is no timestamp.
    recommendationHash: sha256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const candidateIds = value.candidates.map((candidate) => candidate.id);
    const candidateIdSet = new Set(candidateIds);
    if (candidateIdSet.size !== candidateIds.length) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Candidate route IDs must be unique",
      });
    }

    const slugs = value.candidates.map((candidate) => candidate.slug);
    if (new Set(slugs).size !== slugs.length) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Candidate route slugs must be unique",
      });
    }

    const ranks = value.candidates.map((candidate) => candidate.importanceRank);
    const expectedRanks = value.candidates.map((_, index) => index + 1);
    if (
      new Set(ranks).size !== ranks.length ||
      !expectedRanks.every((rank) => ranks.includes(rank))
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Candidate importance ranks must be unique and contiguous",
      });
    }

    if (
      value.featuredRouteIds.some((routeId) => !candidateIdSet.has(routeId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["featuredRouteIds"],
        message: "Featured routes must be recommendation candidates",
      });
    }

    const featuredSet = new Set(value.featuredRouteIds);
    if (
      value.candidates.some(
        (candidate) => candidate.featured !== featuredSet.has(candidate.id),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Candidate featured flags must match featuredRouteIds",
      });
    }

    const blockIds = value.previewBlocks.map((block) => block.id);
    if (new Set(blockIds).size !== blockIds.length) {
      context.addIssue({
        code: "custom",
        path: ["previewBlocks"],
        message: "Preview block IDs must be unique",
      });
    }
    if (
      value.previewBlocks.some((block) => !candidateIdSet.has(block.routeId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["previewBlocks"],
        message: "Preview blocks must reference candidate routes",
      });
    }
  });

export type SiteDesignRecommendationInput = z.infer<
  typeof siteDesignRecommendationInputSchema
>;
export type SiteDesignRecommendationReason = z.infer<
  typeof siteDesignRecommendationReasonSchema
>;
export type SiteDesignRouteRecommendation = z.infer<
  typeof siteDesignRouteRecommendationSchema
>;
export type SiteDesignPreviewBlock = z.infer<
  typeof siteDesignPreviewBlockSchema
>;
export type SiteDesignRecommendationOutput = z.infer<
  typeof siteDesignRecommendationOutputSchema
>;

/**
 * Client-side stale-response guard. A response is applicable only to the
 * exact immutable knowledge and template coordinates that originated it.
 */
export function siteDesignRecommendationMatchesRequest(
  request: unknown,
  response: unknown,
  currentDraft: unknown,
): boolean {
  const parsedRequest = siteDesignRecommendationInputSchema.safeParse(request);
  const parsedResponse =
    siteDesignRecommendationOutputSchema.safeParse(response);
  const parsedCurrentDraft = z
    .object({
      designRevision: z.number().int().nonnegative(),
      draftHash: sha256Schema,
    })
    .passthrough()
    .safeParse(currentDraft);
  if (
    !parsedRequest.success ||
    !parsedResponse.success ||
    !parsedCurrentDraft.success
  ) {
    return false;
  }

  return (
    parsedRequest.data.requestContext.baseDesignRevision ===
      parsedCurrentDraft.data.designRevision &&
    parsedRequest.data.requestContext.baseDraftHash ===
      parsedCurrentDraft.data.draftHash &&
    parsedRequest.data.requestContext.requestId ===
      parsedResponse.data.requestContext.requestId &&
    parsedRequest.data.requestContext.baseDesignRevision ===
      parsedResponse.data.requestContext.baseDesignRevision &&
    parsedRequest.data.requestContext.baseDraftHash ===
      parsedResponse.data.requestContext.baseDraftHash &&
    parsedRequest.data.knowledgeSnapshot.id ===
      parsedResponse.data.knowledgeSnapshot.id &&
    parsedRequest.data.knowledgeSnapshot.version ===
      parsedResponse.data.knowledgeSnapshot.version &&
    parsedRequest.data.knowledgeSnapshot.archiveHash ===
      parsedResponse.data.knowledgeSnapshot.archiveHash &&
    parsedRequest.data.template.id === parsedResponse.data.template.id &&
    parsedRequest.data.template.version ===
      parsedResponse.data.template.version
  );
}
