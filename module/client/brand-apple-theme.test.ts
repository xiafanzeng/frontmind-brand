import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "client/brand-apple-theme.css"), "utf8");
const knowledgeImageDialog = readFileSync(
  resolve(process.cwd(), "client/components/KnowledgeImageLibraryDialog.tsx"),
  "utf8",
);
const knowledgeNodeWorkspace = readFileSync(
  resolve(process.cwd(), "client/components/KnowledgeNodeWorkspace.tsx"),
  "utf8",
);
const intentWorkbench = readFileSync(
  resolve(process.cwd(), "client/dashboard/IntentWorkbench.tsx"),
  "utf8",
);
const ragGauge = readFileSync(
  resolve(process.cwd(), "client/dashboard/ai-website-preview/RagEvaluationGauge.tsx"),
  "utf8",
);
const ragRadar = readFileSync(
  resolve(process.cwd(), "client/dashboard/ai-website-preview/RagEvaluationRadar.tsx"),
  "utf8",
);
const ragEvaluationCss = readFileSync(
  resolve(process.cwd(), "client/dashboard/ai-website-preview/rag-evaluation-ui.css"),
  "utf8",
);
const enterpriseRagPreview = readFileSync(
  resolve(process.cwd(), "client/dashboard/ai-website-preview/EnterpriseRagPreview.tsx"),
  "utf8",
);
const knowledgeFrontendSettings = readFileSync(
  resolve(process.cwd(), "client/dashboard/knowledge-frontend/KnowledgeFrontendSettings.tsx"),
  "utf8",
);
const moduleWorkspace = readFileSync(
  resolve(process.cwd(), "client/ModuleWorkspace.tsx"),
  "utf8",
);

describe("Brand Apple theme contract", () => {
  it("publishes the verified FrontMind Apple design constants", () => {
    expect(css.startsWith("/* Apple UI Design System – Verified: 8pt Grid, SF Pro Typography, Material-Depth, Natural Spring Motion */")).toBe(true);
    expect(css).toContain("--fm-brand-accent: #7542b0;");
    expect(css).toContain("--fm-brand-radius-card: 20px;");
    expect(css).toContain("--fm-brand-radius-control: 12px;");
    expect(css).toContain("--fm-brand-radius-small: 8px;");
    expect(css).toContain("--fm-brand-motion: 300ms cubic-bezier(0.25, 0.1, 0.25, 1);");
    expect(css).toContain("background: rgba(255, 255, 255, 0.72);");
    expect(css).toContain("backdrop-filter: blur(20px) saturate(180%);");
    expect(css).toContain("border: 0.5px solid rgba(0, 0, 0, 0.1);");
    expect(css).toContain("min-height: 44px;");
  });

  it("uses only the approved system font stack and supports reduced motion", () => {
    expect(css).toContain('-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif');
    expect(css).not.toMatch(/\b(?:Inter|Roboto|Helvetica|Arial|Open Sans)\b/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps system-blue, raw easing, and static fallback styles out of the scoped theme", () => {
    expect(css).not.toMatch(/#007aff|#0a84ff|rgba\(0,\s*122,\s*255/i);
    expect(css).not.toMatch(/transition:[^;]*(?:\bease\b|\bease-in\b|\bease-out\b)/i);
    expect(moduleWorkspace).not.toContain("style={{");
  });

  it("adapts report and knowledge surfaces inside their page boundaries", () => {
    expect(css).toContain('.fm-brand-theme[data-brand-page="reports"] .brand-report');
    expect(css).toContain('.fm-brand-theme[data-brand-page="knowledge"] .knowledge-workspace');
    expect(css).toContain('input:not([type="checkbox"]):not([type="radio"])');
    expect(css).toContain(".knowledge-workbench-stage--resource");
    expect(css).toContain('.fm-brand-theme[data-brand-page="knowledge"] .knowledge-node-workspace');
    expect(css).toContain('.fm-brand-theme[data-brand-page="knowledge"] .knowledge-image-library-dialog');
  });

  it("keeps knowledge portals inside the scoped Brand theme", () => {
    expect(css).toContain(".fm-brand-portal-theme");
    expect(knowledgeImageDialog).toContain(
      'className="fm-brand-portal-theme knowledge-image-library-dialog"',
    );
    expect(knowledgeImageDialog).toContain('data-brand-page="knowledge"');
    expect(knowledgeNodeWorkspace).toContain(
      'className="fm-brand-portal-theme knowledge-node-workspace knowledge-node-workspace-modal"',
    );
    expect(knowledgeNodeWorkspace).toContain(
      'className="fm-brand-portal-theme knowledge-node-workspace knowledge-node-workspace-drawer"',
    );
  });

  it("adapts keyword, intent, and response-logic workspaces", () => {
    expect(css).toContain('.fm-brand-theme[data-brand-page="keywords"] .iw-workbench');
    expect(css).toContain('.fm-brand-theme[data-brand-page="intent"] .iw-workbench');
    expect(css).toContain('.fm-brand-theme[data-brand-page="response-logic"] .rl-single-page');
    expect(css).toContain(
      '.fm-brand-portal-theme[data-brand-surface="intent-workbench"].iw-modal',
    );
    expect(intentWorkbench).toContain(
      'className="fm-brand-portal-theme iw-modal"',
    );
    expect(intentWorkbench).toContain(
      'data-brand-surface="intent-workbench"',
    );
  });

  it("adapts the enterprise RAG surface and preserves the accepted gauge tuning", () => {
    expect(css).toContain('.fm-brand-theme[data-brand-page="enterprise-qa"] .rag-eval-root');
    expect(css).toContain('.fm-brand-theme[data-brand-page="enterprise-qa"] .rag-eval-root .rag-evaluation-gauge-card');
    expect(css).toContain('.fm-brand-theme[data-brand-page="enterprise-qa"] .rag-eval-root .rag-drawer');
    expect(ragGauge).toContain("export const RAG_GAUGE_SWEEP_DEGREES = 240;");
    expect(ragGauge).toContain("export const RAG_GAUGE_STROKE_WIDTH = 9;");
    expect(ragGauge).toContain("export const RAG_GAUGE_DOT_RADIUS = 4.5;");
    expect(ragGauge).toContain("export const RAG_GAUGE_CUTOUT_RADIUS = 8;");
    expect(ragEvaluationCss).toContain("gap: 16px;");
    expect(ragEvaluationCss).toContain("transform: translateY(-1px);");
  });

  it("sizes the left gauge card from the right summary on every viewport", () => {
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-overview {");
    expect(ragEvaluationCss).toContain("--rag-evaluation-card-width: 120px;");
    expect(ragEvaluationCss).toContain("--rag-evaluation-card-height: 120px;");
    expect(ragEvaluationCss).toContain("grid-template-columns: var(--rag-evaluation-card-width) minmax(0, 1fr);");
    expect(ragEvaluationCss).toContain("align-items: start;");
    expect(ragEvaluationCss).toContain("min-height: 120px;");
    expect(ragEvaluationCss).toContain("gap: 16px;");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-gauge-card {");
    expect(ragEvaluationCss).toContain("width: var(--rag-evaluation-card-width);");
    expect(ragEvaluationCss).toContain("height: var(--rag-evaluation-card-height);");
    expect(ragEvaluationCss).toContain("aspect-ratio: 3 / 2;");
    expect(ragEvaluationCss).toContain("border-radius: 20px;");
    expect(ragEvaluationCss).toContain("background: rgba(255, 255, 255, 0.72);");
    expect(ragEvaluationCss).toContain("backdrop-filter: blur(20px) saturate(180%);");
    expect(ragEvaluationCss).toContain("overflow-wrap: anywhere;");
    expect(ragEvaluationCss).toContain("padding:24px 16px 16px;");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-summary-flow {");
    expect(ragEvaluationCss).toContain("flex-direction: column;");
    expect(ragEvaluationCss).toContain("min-height: 100%;");
    expect(ragEvaluationCss).toContain("text-align: left;");
    expect(ragEvaluationCss).toContain("font-size: 16px;");
    expect(ragEvaluationCss).toContain("line-height: 20px;");
    expect(ragEvaluationCss).toContain("grid-template-columns: 20px minmax(0, 1fr);");
    expect(ragEvaluationCss).toContain("padding-inline-start: calc(20px + 8px);");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-metrics {");
    expect(ragEvaluationCss).toContain("margin-top: auto;");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-metric-copy {");
    expect(ragEvaluationCss).toContain("gap: 8px 16px;");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-summary-copy {");
    expect(ragEvaluationCss).not.toContain(".rag-eval-root .rag-evaluation-summary-layout {");
    expect(ragEvaluationCss).not.toContain("grid-template-columns: max-content minmax(0, 1fr);");
    expect(ragEvaluationCss).not.toContain("@container rag-evaluation-summary");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-status-orb {");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-status-orb::after {");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-overview { gap: 8px; }");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-overview .rag-verdict { padding: 16px 8px 8px; }");
    expect(enterpriseRagPreview).toContain("new ResizeObserver");
    expect(enterpriseRagPreview).toContain('setProperty("--rag-evaluation-card-width"');
    expect(enterpriseRagPreview).toContain('setProperty("--rag-evaluation-card-height"');
  });

  it("separates answer quality and task completion into Apple material cards", () => {
    expect(enterpriseRagPreview).toContain('className="erag-evaluation-column"');
    expect(enterpriseRagPreview).toContain('className="sfp-panel rag-task-panel"');
    expect(enterpriseRagPreview.indexOf('className="sfp-panel erag-evaluation-panel"')).toBeLessThan(
      enterpriseRagPreview.indexOf('className="sfp-panel rag-task-panel"'),
    );
    expect(ragEvaluationCss).toContain(".rag-eval-root .erag-evaluation-column {");
    expect(ragEvaluationCss).toContain("flex-direction: column;");
    expect(ragEvaluationCss).toContain("gap: 16px;");
    expect(ragEvaluationCss).toContain(".rag-eval-root .erag-evaluation-panel { gap:16px; padding: 24px 24px 16px; }");
    expect(ragEvaluationCss).toContain(".rag-eval-root .erag-evaluation-panel { padding:16px; }");
    expect(css).toContain('.fm-brand-theme[data-brand-page="enterprise-qa"] .rag-eval-root .erag-evaluation-panel {');
    expect(css).toContain("padding-bottom: var(--fm-brand-space-2);");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-task-panel {");
    expect(ragEvaluationCss).toContain("padding: 24px;");
    expect(ragEvaluationCss).toContain("border: 0.5px solid rgba(0, 0, 0, 0.1);");
    expect(ragEvaluationCss).toContain("border-radius: 20px;");
    expect(ragEvaluationCss).toContain("background: rgba(255, 255, 255, 0.72);");
    expect(ragEvaluationCss).toContain("backdrop-filter: blur(20px) saturate(180%);");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-case-status {");
    expect(ragEvaluationCss).toContain("min-height: 24px;");
    expect(ragEvaluationCss).toContain("padding: 0 8px;");
    expect(ragEvaluationCss).toContain("border-radius: 8px;");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-task-panel { padding: 16px; }");
  });

  it("uses ordered Apple-sized disclosures for judgment and optimization details", () => {
    expect(enterpriseRagPreview).toContain('label="理解本次判断"');
    expect(enterpriseRagPreview).toContain('label="查看优化方案"');
    expect(enterpriseRagPreview.indexOf('label="理解本次判断"')).toBeLessThan(
      enterpriseRagPreview.indexOf('label="查看优化方案"'),
    );
    expect(enterpriseRagPreview).not.toContain('label="判定依据与测试信息"');
    expect(enterpriseRagPreview).toContain("查看完整方案");
    expect(enterpriseRagPreview).not.toContain("进入网站建设的 AI 助手");
    expect(enterpriseRagPreview).not.toContain("优先优化");
    expect(enterpriseRagPreview).not.toContain("建议做法");
    expect(enterpriseRagPreview).not.toContain("Lightbulb");
    expect(enterpriseRagPreview).toContain('className="rag-judgment-copy"');
    expect(enterpriseRagPreview).toContain('className="rag-priority-copy"');
    expect(enterpriseRagPreview).not.toContain('className="rag-judgment-context"');
    expect(enterpriseRagPreview).not.toContain('className="rag-priority-card"');
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-quality-disclosures {");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-disclosure__trigger {");
    expect(ragEvaluationCss).toContain("min-height: 44px;");
    expect(ragEvaluationCss).toContain("padding: 8px;");
    expect(ragEvaluationCss).toContain("border-radius: 12px;");
    expect(ragEvaluationCss).toContain("color: var(--sfp-ink);");
    expect(ragEvaluationCss).toContain("box-shadow: 0 0 0 3px rgba(0,0,0,.18);");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-judgment-copy,");
    expect(ragEvaluationCss).not.toContain(".rag-eval-root .rag-judgment-context,");
    expect(ragEvaluationCss).not.toContain(".rag-eval-root .rag-priority-card {");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-detail-action {");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-priority-label.is-suggestion {");
    expect(ragEvaluationCss).toContain("background: rgba(255, 204, 0, 0.16);");
    expect(ragEvaluationCss).toContain("gap: 0;");
    expect(ragEvaluationCss).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-priority-copy__statement {");
    expect(ragEvaluationCss).toContain("grid-template-columns: auto minmax(0, 1fr);");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-priority-copy__title,\n.rag-eval-root .rag-priority-copy__action { color:#545b6a; }");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-priority-copy__statement > strong { color:#1d1d1f;");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-detail-action--full:disabled {");
    expect(ragEvaluationCss).toContain("color: #86868b;");
    expect(ragEvaluationCss).toContain("background: #f5f5f7;");
    expect(ragEvaluationCss).toContain("padding: 0 8px 16px;");
    const disclosureStart = ragEvaluationCss.indexOf(".rag-eval-root .rag-evaluation-disclosure {");
    const disclosureEnd = ragEvaluationCss.indexOf(".rag-drawer-backdrop", disclosureStart);
    const disclosureStyles = ragEvaluationCss.slice(disclosureStart, disclosureEnd);
    expect(disclosureStyles).not.toContain("__trigger:hover");
    expect(disclosureStyles).not.toContain("__trigger:active");
    expect(disclosureStyles).not.toContain("transition:");
    expect(disclosureStyles).not.toContain("animation:");
    expect(disclosureStyles).not.toContain("border-bottom:");
    expect(ragEvaluationCss).not.toContain("@keyframes rag-disclosure-enter");
    const staticOverrideStart = css.indexOf("/* Enterprise RAG static disclosure interaction */");
    const staticOverrideEnd = css.indexOf("/* End Enterprise RAG static disclosure interaction */");
    expect(staticOverrideStart).toBeGreaterThan(-1);
    expect(staticOverrideEnd).toBeGreaterThan(staticOverrideStart);
    const staticOverride = css.slice(staticOverrideStart, staticOverrideEnd);
    expect(staticOverride).toContain("transition: none;");
    expect(staticOverride).toContain("background: transparent;");
    expect(staticOverride).toContain("box-shadow: none;");
    expect(staticOverride).toContain("transform: none;");
    expect(staticOverride).toContain('.rag-priority-copy__statement > strong');
    expect(staticOverride).toContain("color: var(--fm-brand-ink);");
    expect(staticOverride).toContain('.rag-detail-action--full:disabled');
    expect(staticOverride).toContain("background: #f5f5f7;");
  });

  it("enforces Apple card radii across every Brand page without flattening controls", () => {
    const start = css.indexOf("/* Brand semantic card radius contract */");
    const end = css.indexOf("/* End Brand semantic card radius contract */");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const contract = css.slice(start, end);

    for (const selector of [
      ".brand-report__option",
      ".knowledge-node-workspace__error",
      ".iw-task",
      ".iw-intake-list > div",
      ".rl-eval-entry",
      ".erag-stats > div",
      ".rag-task-panel",
      ".sfp-source-strip",
      ".sfp-template-grid > label",
      ".kf-choices label",
      ".kf-info",
    ]) {
      expect(contract).toContain(selector);
    }

    expect(contract).toContain("border-radius: var(--fm-brand-radius-card);");
    expect(contract).not.toContain("var(--fm-brand-radius-control)");
    expect(contract).not.toContain("var(--fm-brand-radius-small)");
    expect(css).toContain(".fm-brand-button {");
    expect(css).toContain("border-radius: var(--fm-brand-radius-control);");
    expect(css).toContain(".fm-brand-badge {");
    expect(css).toContain("border-radius: var(--fm-brand-radius-small);");
  });

  it("uses static radar labels and Apple-sized point controls", () => {
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-radar-label {");
    expect(ragEvaluationCss).not.toContain(".rag-radar-label:hover");
    expect(ragEvaluationCss).not.toContain(".rag-radar-label[aria-expanded");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-radar-point-control {");
    expect(ragEvaluationCss).toContain("width:44px");
    expect(ragEvaluationCss).toContain("height:44px");
    expect(ragEvaluationCss).toContain(".rag-radar-point-control[aria-expanded=true]");
    expect(css).toContain(".rag-radar-point-control:hover:not(:disabled)");
    expect(css).not.toContain(".rag-radar-label:hover:not(:disabled)");
  });

  it("uses five transparent-center radar levels and distinct marker states", () => {
    expect(ragRadar).toContain("const RADAR_INNER_RADIUS = 20;");
    expect(ragRadar).toContain("[20, 40, 60, 80, 100]");
    expect(ragRadar).not.toContain("rag-radar-tick");
    expect(ragRadar).toContain("rag-radar-center-cutout");
    expect(ragEvaluationCss).toContain(".rag-radar-point-marker.is-zero");
    expect(ragEvaluationCss).toContain(".rag-radar-point-marker.is-zero { width:9px; height:9px; border:1.5px solid #fff; border-radius:50%; background:#aeaeb2; }");
    expect(ragEvaluationCss).toContain(".rag-radar-point-control.is-zero[aria-expanded=true]::before");
    expect(css).toContain('.rag-radar-point-control.is-zero[aria-expanded="true"]::before');
    expect(css).toContain("background: rgba(174, 174, 178, 0.16);");
    expect(ragEvaluationCss).toContain(".rag-radar-point-marker.is-pending");
    expect(ragEvaluationCss).toContain(".rag-radar-point-marker.is-not-applicable");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-radar-detail h3 { margin:0; font-size:14px; font-weight:600;");
  });

  it("uses compact content-width Apple metadata labels and black optimization field labels", () => {
    expect(enterpriseRagPreview).toContain('data-testid="rag-conversation-meta-card"');
    const metadataStart = ragEvaluationCss.indexOf(".rag-conversation__meta {");
    const metadataEnd = ragEvaluationCss.indexOf(".rag-checklist {", metadataStart);
    const metadataStyle = ragEvaluationCss.slice(metadataStart, metadataEnd);
    expect(metadataStyle).toContain("display:flex;");
    expect(metadataStyle).toContain("flex-wrap:wrap;");
    expect(metadataStyle).toContain("gap:8px;");
    expect(ragEvaluationCss).toContain(".rag-conversation__meta > li {");
    expect(ragEvaluationCss).toContain("flex:0 0 auto;");
    expect(ragEvaluationCss).toContain("height:24px;");
    expect(ragEvaluationCss).toContain("padding:0 8px;");
    expect(ragEvaluationCss).toContain("border-radius:8px;");
    expect(ragEvaluationCss).toContain("white-space:nowrap;");
    expect(ragEvaluationCss).not.toContain("grid-template-columns:repeat(4,minmax(0,1fr));");
    expect(ragEvaluationCss).toContain(".rag-priority-copy__statement > strong { color:#1d1d1f;");
  });

  it("uses Apple hierarchy for the evidence drawer, risk grid, and semantic tags", () => {
    expect(enterpriseRagPreview).toContain('rag-drawer--evidence');
    expect(enterpriseRagPreview).toContain('data-testid="rag-evidence-radar"');
    expect(enterpriseRagPreview).toContain('data-testid="rag-evaluation-gate-grid"');
    expect(enterpriseRagPreview).toContain('data-testid="rag-gate-status-orb"');
    expect(ragEvaluationCss).toContain(".rag-drawer.rag-drawer--evidence {");
    expect(ragEvaluationCss).toContain("width: min(960px, 100%);");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-gate-grid {");
    expect(ragEvaluationCss).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(ragEvaluationCss).toContain("border-radius: 20px;");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evidence-tag {");
    expect(ragEvaluationCss).toContain("min-height: 24px;");
    expect(ragEvaluationCss).toContain("padding: 0 8px;");
    expect(ragEvaluationCss).toContain("border-radius: 8px;");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-gate-status-orb.is-passed {");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-gate-status-orb.is-failed {");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-gate-status-orb.is-pending {");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evidence-tag.is-info {");
    expect(ragEvaluationCss).toContain("@media (max-width: 560px)");
  });

  it("adapts website management and settings without replacing customer-selected preview colors", () => {
    expect(css).toContain('.fm-brand-theme[data-brand-page="website"] .sfp-root');
    expect(css).toContain('.fm-brand-theme[data-brand-page="website"] .siteops-panel');
    expect(css).toContain('.fm-brand-theme[data-brand-page="website"] .ai-website-preview');
    expect(css).toContain('.fm-brand-theme[data-brand-page="website"] .aqwp-root');
    expect(css).toContain('.fm-brand-theme[data-brand-page="website-settings"] .knowledge-frontend');
    expect(css).toContain('.fm-brand-portal-theme[data-brand-page="website-settings"].kf-preview-dialog');
    expect(css).toContain("Customer preview accent values remain runtime-owned");
    expect(knowledgeFrontendSettings).toContain(
      'className="fm-brand-portal-theme kf-preview-dialog"',
    );
    expect(knowledgeFrontendSettings).toContain('data-brand-page="website-settings"');
  });
});
