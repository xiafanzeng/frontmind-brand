/** Frozen V7 pagination. Older catalog artifacts retain their original shape. */
export const CURATED_STATIC_TEMPLATE_CATALOG_VERSION = "frontmind-curated-20261025-v7";
/** Chronological predecessor used for immutable reads and cache reuse. */
export const PREVIOUS_CURATED_STATIC_TEMPLATE_CATALOG_VERSION = "frontmind-curated-20261025-v6";
/** The only older catalog accepted as active during the rolling v7 deployment. */
export const ROLLING_STATIC_TEMPLATE_CATALOG_VERSION = "frontmind-curated-20261025-v6";
export const PRIOR_CURATED_STATIC_TEMPLATE_CATALOG_VERSIONS = Object.freeze([
  PREVIOUS_CURATED_STATIC_TEMPLATE_CATALOG_VERSION,
  "frontmind-curated-20261025-v5",
  "frontmind-curated-20261025-v4",
  "frontmind-curated-20261024-v3",
] as const);
export const CURATED_STATIC_TEMPLATE_PAGINATION = Object.freeze({
  entryCount: 1,
  pageCount: 1,
  pageSize: 8,
} as const);
const SIX_ENTRY_STATIC_TEMPLATE_PAGINATION = Object.freeze({
  entryCount: 6,
  pageCount: 1,
  pageSize: 8,
} as const);
export const HISTORICAL_CURATED_STATIC_TEMPLATE_PAGINATION = Object.freeze({
  entryCount: 35,
  pageCount: 5,
  pageSize: 8,
} as const);
const LEGACY_STATIC_TEMPLATE_PAGINATION = Object.freeze({
  entryCount: 32,
  pageCount: 4,
  pageSize: 8,
} as const);

export function staticTemplatePagination(catalogVersion: string | null | undefined) {
  if (catalogVersion === CURATED_STATIC_TEMPLATE_CATALOG_VERSION) {
    return CURATED_STATIC_TEMPLATE_PAGINATION;
  }
  if (
    catalogVersion === PREVIOUS_CURATED_STATIC_TEMPLATE_CATALOG_VERSION ||
    catalogVersion === ROLLING_STATIC_TEMPLATE_CATALOG_VERSION
  ) {
    return SIX_ENTRY_STATIC_TEMPLATE_PAGINATION;
  }
  return PRIOR_CURATED_STATIC_TEMPLATE_CATALOG_VERSIONS.some(
    (version) => version === catalogVersion,
  )
    ? HISTORICAL_CURATED_STATIC_TEMPLATE_PAGINATION
    : LEGACY_STATIC_TEMPLATE_PAGINATION;
}

/** Query ceilings must cover immutable historical v3-v6 projects after v7 shrinks to one template. */
export const MAX_STATIC_TEMPLATE_CATALOG_PAGE_COUNT = Math.max(
  CURATED_STATIC_TEMPLATE_PAGINATION.pageCount,
  SIX_ENTRY_STATIC_TEMPLATE_PAGINATION.pageCount,
  HISTORICAL_CURATED_STATIC_TEMPLATE_PAGINATION.pageCount,
  LEGACY_STATIC_TEMPLATE_PAGINATION.pageCount,
);
export const MAX_STATIC_TEMPLATE_CATALOG_ENTRY_COUNT = Math.max(
  CURATED_STATIC_TEMPLATE_PAGINATION.entryCount,
  SIX_ENTRY_STATIC_TEMPLATE_PAGINATION.entryCount,
  HISTORICAL_CURATED_STATIC_TEMPLATE_PAGINATION.entryCount,
  LEGACY_STATIC_TEMPLATE_PAGINATION.entryCount,
);

export function staticTemplatePageLength(catalogVersion: string | null | undefined, page: number) {
  const { entryCount, pageSize } = staticTemplatePagination(catalogVersion);
  return Math.max(0, Math.min(pageSize, entryCount - (page - 1) * pageSize));
}
