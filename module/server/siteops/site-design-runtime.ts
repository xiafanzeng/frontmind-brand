import type { SiteDesignPreferences } from "../../contracts/site-design-preferences.js";
import type { SiteBrief } from "../../contracts/siteops.js";

export type SiteDesignRuntimeProjection = {
  navigation: Array<{
    id: string;
    href: string;
    title: string;
  }>;
  allRoutePaths: string[];
  siteAccent: string | null;
  assistant: {
    name: string;
    welcome: string;
    accent: string;
  } | null;
  designRevision: number | null;
  draftHash: string | null;
};

function routePath(slug: string) {
  const trimmed = slug.trim();
  if (trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/gu, "")}/`;
}

function featuredNavigation(
  brief: SiteBrief,
  preferences: SiteDesignPreferences | null,
) {
  if (!preferences) return brief.routes;
  const routeById = new Map(brief.routes.map((route) => [route.id, route]));
  return preferences.featuredRouteIds.map((routeId) => {
    const route = routeById.get(routeId);
    // The persisted SiteDesignPreferences boundary already verifies this
    // relation. Keep the runtime guard fail-closed for historical/corrupt rows.
    if (!route) throw new Error("SITE_DESIGN_FEATURED_ROUTE_MISSING");
    return route;
  });
}

/**
 * Projects only the immutable, build-owned SiteDesignPreferences. Callers
 * must pass the frozen build Brief, never the mutable project Brief.
 */
export function projectSiteDesignRuntime(
  brief: SiteBrief,
): SiteDesignRuntimeProjection {
  const preferences = brief.designPreferences ?? null;
  const navigation = featuredNavigation(brief, preferences).map((route) => ({
    id: route.id,
    href: routePath(route.slug),
    title: route.title,
  }));
  if (!preferences) {
    return {
      navigation,
      allRoutePaths: brief.routes.map((route) => routePath(route.slug)),
      siteAccent: null,
      assistant: null,
      designRevision: null,
      draftHash: null,
    };
  }
  const assistantAccent =
    preferences.assistant.accentMode === "custom"
      ? preferences.assistant.customAccent
      : preferences.siteAccent;
  if (!assistantAccent) {
    throw new Error("SITE_DESIGN_ASSISTANT_ACCENT_MISSING");
  }
  return {
    navigation,
    allRoutePaths: brief.routes.map((route) => routePath(route.slug)),
    siteAccent: preferences.siteAccent,
    assistant: {
      name: preferences.assistant.name,
      welcome: preferences.assistant.welcome,
      accent: assistantAccent,
    },
    designRevision: preferences.designRevision,
    draftHash: preferences.draftHash,
  };
}

export function siteDesignAccentCss(
  projection: SiteDesignRuntimeProjection,
) {
  return projection.siteAccent
    ? `:root{--frontmind-site-accent:${projection.siteAccent};--accent:${projection.siteAccent}!important;accent-color:${projection.siteAccent}}\n`
    : "";
}

export function siteAssistantBootConfig(
  apiBase: string,
  projection: SiteDesignRuntimeProjection,
) {
  return {
    apiBase,
    ...(projection.assistant ?? {}),
    design: {
      navigation: projection.navigation,
      allRoutePaths: projection.allRoutePaths,
      siteAccent: projection.siteAccent,
      designRevision: projection.designRevision,
      draftHash: projection.draftHash,
    },
  };
}
