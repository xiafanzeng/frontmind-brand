/** Frozen V7 pagination. Older catalog artifacts retain their original shape. */
export const CURATED_STATIC_TEMPLATE_CATALOG_VERSION = "frontmind-curated-20261025-v4";
export const PREVIOUS_CURATED_STATIC_TEMPLATE_CATALOG_VERSION = "frontmind-curated-20261024-v3";
export const CURATED_STATIC_TEMPLATE_PAGINATION = Object.freeze({
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
  return catalogVersion === CURATED_STATIC_TEMPLATE_CATALOG_VERSION ||
    catalogVersion === PREVIOUS_CURATED_STATIC_TEMPLATE_CATALOG_VERSION
    ? CURATED_STATIC_TEMPLATE_PAGINATION
    : LEGACY_STATIC_TEMPLATE_PAGINATION;
}

export function staticTemplatePageLength(catalogVersion: string | null | undefined, page: number) {
  const { entryCount, pageSize } = staticTemplatePagination(catalogVersion);
  return Math.max(0, Math.min(pageSize, entryCount - (page - 1) * pageSize));
}
