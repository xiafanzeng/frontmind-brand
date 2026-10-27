// @vitest-environment node
import {describe, expect, it} from "vitest";
import {TRUSTED_REACT_COMPONENT_LIBRARY_SOURCE} from "../server/siteops/react-static-runtime.js";
import {nativeDocumentCsp} from "../server/siteops/native-react-build-runtime.js";
import {
  SITE_ASSISTANT_WIDGET_API_ORIGIN_DEFAULT,
  TRUSTED_SITE_ASSISTANT_WIDGET_CSS,
  TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE,
  siteAssistantApiOrigin,
} from "../server/siteops/site-assistant-widget.js";

describe("site assistant trusted build integration", () => {
  it("renders the assistant boot tags inside the trusted site document", () => {
    const library = TRUSTED_REACT_COMPONENT_LIBRARY_SOURCE;
    expect(library).toContain("SiteAssistantTags");
    expect(library).toContain('"/assistant.css"');
    expect(library).toContain('"/assistant.js"');
    expect(library).toContain("__FRONTMIND_ASSISTANT__");
    // Every rendered page keeps the assistant, including the 404 document.
    expect(library).toMatch(/NotFoundDocument[\s\S]*?SiteAssistantTags/);
  });

  it("keeps the widget dependency-free and multi-turn capable", () => {
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE).not.toContain("import ");
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE).toContain("sessionStorage");
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE).toContain("/ask");
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE).toContain("/config");
    expect(TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE).toContain("session");
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
