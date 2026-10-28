// @vitest-environment node
import {describe, expect, it} from "vitest";
import {TRUSTED_REACT_COMPONENT_LIBRARY_SOURCE} from "../server/siteops/react-static-runtime.js";
import {nativeDocumentCsp} from "../server/siteops/native-react-build-runtime.js";
import {
  SITE_ASSISTANT_CONFIG_ASSET_PATH,
  SITE_ASSISTANT_STYLES_ASSET_PATH,
  SITE_ASSISTANT_WIDGET_ASSET_PATH,
  SITE_ASSISTANT_WIDGET_API_ORIGIN_DEFAULT,
  TRUSTED_SITE_ASSISTANT_HEAD_MARKUP,
  TRUSTED_SITE_ASSISTANT_WIDGET_CSS,
  TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE,
  isTrustedSiteAssistantExternalScriptTag,
  siteAssistantApiOrigin,
  trustedSiteAssistantConfigSource,
} from "../server/siteops/site-assistant-widget.js";

describe("site assistant trusted build integration", () => {
  it("renders the assistant boot tags inside the trusted site document", () => {
    const library = TRUSTED_REACT_COMPONENT_LIBRARY_SOURCE;
    expect(library).toContain("SiteAssistantTags");
    expect(library).toContain('"/assistant.css"');
    expect(library).toContain('"/assistant-config.js"');
    expect(library).toContain('"/assistant.js"');
    expect(library).not.toContain("assistantConfigScript");
    // Every rendered page keeps the assistant, including the 404 document.
    expect(library).toMatch(/NotFoundDocument[\s\S]*?SiteAssistantTags/);
  });

  it("uses one external frozen config boundary for Astro, React and fallback pages", () => {
    expect(TRUSTED_SITE_ASSISTANT_HEAD_MARKUP).toContain(
      `href="${SITE_ASSISTANT_STYLES_ASSET_PATH}"`,
    );
    expect(TRUSTED_SITE_ASSISTANT_HEAD_MARKUP).toContain(
      `src="${SITE_ASSISTANT_CONFIG_ASSET_PATH}" defer`,
    );
    expect(TRUSTED_SITE_ASSISTANT_HEAD_MARKUP).toContain(
      `src="${SITE_ASSISTANT_WIDGET_ASSET_PATH}" defer`,
    );
    const source = trustedSiteAssistantConfigSource({
      apiBase: "https://brand.frontmind.cn",
      name: "冻结</script>助手",
      welcome: `欢迎\u2028使用`,
      accent: "#8a2be2",
    });
    expect(source).toContain("window.__FRONTMIND_ASSISTANT__=");
    expect(source).toContain("#8a2be2");
    expect(source).not.toContain("</script>");
    expect(source).not.toContain(String.fromCharCode(0x2028));
    expect(
      isTrustedSiteAssistantExternalScriptTag(
        '<script defer="" src="/assistant-config.js">',
      ),
    ).toBe(true);
    expect(
      isTrustedSiteAssistantExternalScriptTag(
        '<script src="/assistant.js" defer onload="steal()">',
      ),
    ).toBe(false);
    expect(
      isTrustedSiteAssistantExternalScriptTag(
        '<script src="https://example.com/evil.js" defer>',
      ),
    ).toBe(false);
  });

  it("keeps the widget dependency-free and multi-turn capable", () => {
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE).not.toContain("import ");
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE).toContain("sessionStorage");
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE).toContain("/ask");
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE).toContain("/config");
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE).toContain("session");
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE).toContain("frozenWelcome");
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE).toContain("--fma-accent");
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE).toContain("data-frontmind-site-navigation");
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_CSS).toContain(".fm-assistant-panel");
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_CSS).toContain("prefers-reduced-motion");
  });

  it("opens only the assistant Q&A origin in the native document CSP", () => {
    const csp = nativeDocumentCsp("https://brand.frontmind.cn");
    expect(csp).toContain("connect-src https://brand.frontmind.cn");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("form-action 'none'");
    // No wildcard or second origin may sneak into the connect policy.
    expect(csp.match(/connect-src [^;]+/)![0].split(" ")).toHaveLength(2);
  });

  it("uses the deterministic brand origin and only accepts https overrides", () => {
    expect(siteAssistantApiOrigin()).toBe(SITE_ASSISTANT_WIDGET_API_ORIGIN_DEFAULT);
    expect(siteAssistantApiOrigin({FRONTMIND_SITE_ASSISTANT_API_ORIGIN: "https://assistant.example.com/path"}))
      .toBe("https://assistant.example.com");
    expect(siteAssistantApiOrigin({FRONTMIND_SITE_ASSISTANT_API_ORIGIN: "http://insecure.example.com"}))
      .toBe(SITE_ASSISTANT_WIDGET_API_ORIGIN_DEFAULT);
    expect(siteAssistantApiOrigin({FRONTMIND_SITE_ASSISTANT_API_ORIGIN: "not a url"}))
      .toBe(SITE_ASSISTANT_WIDGET_API_ORIGIN_DEFAULT);
  });
});
