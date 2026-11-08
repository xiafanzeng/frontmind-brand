import { z } from "zod";

const siteBrandColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/iu, "Brand colors must use six-digit hex values");

/** Optional operator-confirmed brand evidence. Absence lowers reference
 * coverage but never changes the evaluation denominator. */
export const siteBrandKitV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    logo: z
      .object({
        assetId: z.string().trim().min(1).max(191),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict()
      .optional(),
    primaryColor: siteBrandColorSchema.optional(),
    secondaryColors: z
      .array(siteBrandColorSchema)
      .max(4)
      .default([])
      .refine(
        (values) =>
          new Set(values.map((value) => value.toLowerCase())).size ===
          values.length,
        { message: "Secondary brand colors must be unique" },
      ),
    fontPreferences: z
      .array(z.string().trim().min(1).max(128))
      .max(4)
      .default([]),
    toneKeywords: z
      .array(z.string().trim().min(1).max(64))
      .max(8)
      .default([]),
    forbiddenPhrases: z
      .array(z.string().trim().min(1).max(128))
      .max(20)
      .default([]),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.logo || value.primaryColor) ||
      value.secondaryColors.length > 0 ||
      value.fontPreferences.length > 0 ||
      value.toneKeywords.length > 0 ||
      value.forbiddenPhrases.length > 0,
    { message: "Brand Kit must contain at least one confirmed reference" },
  );

const visitorTaskDraftShape = {
  schemaVersion: z.literal(1),
  goal: z.string().trim().min(1).max(500),
  entryRouteId: z.string().trim().min(1).max(64),
  successCriteria: z
    .array(z.string().trim().min(1).max(500))
    .min(1)
    .max(8),
  requiredRouteIds: z
    .array(z.string().trim().min(1).max(64))
    .min(1)
    .max(8)
    .refine((values) => new Set(values).size === values.length, {
      message: "Visitor task routes must be unique",
    }),
  assistantRequired: z.boolean(),
} as const;

function requireEntryRoute(
  value: { entryRouteId: string; requiredRouteIds: string[] },
  context: z.RefinementCtx,
) {
  if (!value.requiredRouteIds.includes(value.entryRouteId)) {
    context.addIssue({
      code: "custom",
      path: ["requiredRouteIds"],
      message: "Visitor task routes must include the entry route",
    });
  }
}

/** Browser draft. Confirmation coordinates are always minted by the server. */
export const siteVisitorTaskDraftV1Schema = z
  .object(visitorTaskDraftShape)
  .strict()
  .superRefine(requireEntryRoute);

/** Frozen, operator-confirmed visitor task for one immutable build. */
export const siteVisitorTaskV1Schema = z
  .object({
    ...visitorTaskDraftShape,
    generatedFromBriefHash: z.string().regex(/^[a-f0-9]{64}$/u),
    confirmedAt: z.string().datetime(),
    confirmedByUserId: z.number().int().positive(),
  })
  .strict()
  .superRefine(requireEntryRoute);

export const siteWebsiteEvaluationInputsDraftSchema = z
  .object({
    brandKitV1: siteBrandKitV1Schema.nullable().default(null),
    visitorTaskV1: siteVisitorTaskDraftV1Schema,
  })
  .strict();

export type SiteBrandKitV1 = z.infer<typeof siteBrandKitV1Schema>;
export type SiteVisitorTaskDraftV1 = z.infer<
  typeof siteVisitorTaskDraftV1Schema
>;
export type SiteVisitorTaskV1 = z.infer<typeof siteVisitorTaskV1Schema>;
export type SiteWebsiteEvaluationInputsDraft = z.infer<
  typeof siteWebsiteEvaluationInputsDraftSchema
>;
