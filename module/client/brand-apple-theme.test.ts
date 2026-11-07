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
const ragChatCss = readFileSync(
  resolve(process.cwd(), "client/dashboard/ai-website-preview/rag-chat.css"),
  "utf8",
);
const enterpriseRagPreview = readFileSync(
  resolve(process.cwd(), "client/dashboard/ai-website-preview/EnterpriseRagPreview.tsx"),
  "utf8",
);
const ragImprovementPlan = readFileSync(
  resolve(process.cwd(), "client/dashboard/ai-website-preview/RagImprovementPlan.tsx"),
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

  it("adapts knowledge surfaces inside their page boundaries", () => {
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
    expect(css).toContain('.fm-brand-theme[data-brand-page="enterprise-qa"] .rag-eval-root .rag-evaluation-overview > :is(.rag-verdict, .rag-evaluation-gauge-card)');
    expect(css).toContain('.fm-brand-theme[data-brand-page="enterprise-qa"] .rag-eval-root .rag-drawer');
    expect(ragGauge).toContain("export const RAG_GAUGE_SWEEP_DEGREES = 240;");
    expect(ragGauge).toContain("export const RAG_GAUGE_STROKE_WIDTH = 9;");
    expect(ragGauge).toContain("export const RAG_GAUGE_DOT_RADIUS = 4.5;");
    expect(ragGauge).toContain("export const RAG_GAUGE_RENDERED_WIDTH = 152;");
    expect(ragEvaluationCss).toContain("gap: 16px;");
    expect(ragEvaluationCss).toContain("transform: translateY(-1px);");
  });

  it("enlarges only the marker and keeps its hover control and tooltip outside layout flow", () => {
    const marker = ragEvaluationCss.match(/\.rag-eval-root \.rag-evaluation-gauge-marker \{([^}]*)\}/)?.[1];
    expect(marker).toContain("transform-box: fill-box;");
    expect(marker).toContain("transform-origin: center;");
    const activeMarker = ragEvaluationCss.match(/\.rag-evaluation-gauge-graphic\.is-marker-active \.rag-evaluation-gauge-marker \{([^}]*)\}/)?.[1];
    expect(activeMarker).toContain("transform: scale(1.35);");
    const control = ragEvaluationCss.match(/\.rag-evaluation-gauge-card \.rag-evaluation-gauge-graphic \.rag-gauge-marker-control \{([^}]*)\}/)?.[1];
    expect(control).toContain("position: absolute;");
    expect(control).toContain("min-height: 0;");
    expect(control).toContain("background: transparent;");
    expect(control).toContain("transform: translate(-50%, -50%);");
    const controlHover = ragEvaluationCss.match(/\.rag-gauge-marker-control:active:not\(:disabled\) \{([^}]*)\}/)?.[1];
    expect(controlHover).toContain("transform: translate(-50%, -50%);");
    const tooltip = ragEvaluationCss.match(/\.rag-eval-root \.rag-gauge-marker-tooltip \{([^}]*)\}/)?.[1];
    expect(tooltip).toContain("position: absolute;");
    expect(tooltip).toContain("pointer-events: auto;");
    expect(ragEvaluationCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.rag-eval-root \.rag-evaluation-gauge-marker \{ transition: none; \}/);
  });

  it("keeps gauge geometry and type sizes stable while the summary stacks in normal flow", () => {
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-overview {");
    expect(ragEvaluationCss).toContain("--rag-evaluation-card-width: 136px;");
    expect(ragEvaluationCss).toContain("grid-template-columns: var(--rag-evaluation-card-width) minmax(0, 1fr);");
    expect(ragEvaluationCss).toContain("align-items: start;");
    expect(ragEvaluationCss).toContain("min-height: var(--rag-evaluation-card-width);");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-overview > .rag-verdict {");
    expect(ragEvaluationCss).toContain("padding: 16px;");
    expect(ragEvaluationCss).toContain("grid-column: 2;");
    expect(ragEvaluationCss).toContain("grid-column: 1;");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-gauge-card {");
    expect(ragEvaluationCss).toContain("width: var(--rag-evaluation-card-width);");
    expect(ragEvaluationCss).toContain("height: auto;");
    expect(ragEvaluationCss).toContain("aspect-ratio: 1 / 1;");
    expect(ragEvaluationCss).toContain("align-self: start;");
    expect(ragEvaluationCss).toContain("aspect-ratio: 3 / 2;");
    const overviewSurface = ragEvaluationCss.match(/\.rag-eval-root \.rag-evaluation-overview \{([^}]*)\}/)?.[1];
    expect(overviewSurface).toContain("--rag-evaluation-graphic-width: 152px;");
    expect(overviewSurface).toContain("gap: 8px;");
    expect(overviewSurface).toContain("padding-inline: 8px;");
    expect(overviewSurface).toContain("border: 0.5px solid rgba(0, 0, 0, 0.1);");
    expect(overviewSurface).toContain("border-radius: 20px;");
    expect(overviewSurface).toContain("background: rgba(255, 255, 255, 0.72);");
    expect(overviewSurface).toContain("box-shadow: 0 8px 24px rgba(29, 29, 31, 0.08);");
    expect(overviewSurface).toContain("backdrop-filter: blur(20px) saturate(180%);");
    const verdictLayout = ragEvaluationCss.match(/\.rag-eval-root \.rag-evaluation-overview > \.rag-verdict \{([^}]*)\}/)?.[1];
    expect(verdictLayout).toContain("justify-content: center;");
    expect(verdictLayout).toContain("gap: 16px;");
    expect(verdictLayout).toContain("padding: 16px;");
    expect(verdictLayout).toContain("padding-inline-start: 0;");
    const gaugeLayout = ragEvaluationCss.match(/\.rag-eval-root \.rag-evaluation-gauge-card \{([^}]*)\}/)?.[1];
    expect(gaugeLayout).toContain("place-content: center;");
    const gaugeGraphic = ragEvaluationCss.match(/\.rag-eval-root \.rag-evaluation-gauge-graphic \{([^}]*)\}/)?.[1];
    expect(gaugeGraphic).toContain("width: var(--rag-evaluation-graphic-width);");
    expect(gaugeGraphic).not.toContain("max-width: 100%;");
    for (const source of [ragEvaluationCss, css]) {
      const innerSurface = source.match(/\.rag-evaluation-overview > :is\(\.rag-verdict, \.rag-evaluation-gauge-card\) \{([^}]*)\}/)?.[1];
      expect(innerSurface).toContain("border: 0;");
      expect(innerSurface).toContain("border-radius: 0;");
      expect(innerSurface).toContain("background: transparent;");
      expect(innerSurface).toContain("box-shadow: none;");
      expect(innerSurface).toContain("backdrop-filter: none;");
    }
    expect(ragEvaluationCss).toContain("overflow-wrap: anywhere;");
    expect(ragEvaluationCss).toContain("padding:24px 16px 16px;");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-summary-flow {");
    expect(ragEvaluationCss).toContain("flex-direction: column;");
    expect(ragEvaluationCss).toContain("min-height: 0;");
    expect(ragEvaluationCss).toContain("text-align: left;");
    expect(ragEvaluationCss).toContain("font-size: 16px;");
    expect(ragEvaluationCss).toContain("line-height: 20px;");
    expect(ragEvaluationCss).toContain("grid-template-columns: 20px minmax(0, 1fr);");
    expect(ragEvaluationCss).toContain("padding-inline-start: calc(20px + 8px);");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-metrics {");
    expect(ragEvaluationCss).toContain("margin-top: 0;");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-supporting-meta {");
    const supportingMeta = ragEvaluationCss.match(/\.rag-eval-root \.rag-evaluation-supporting-meta \{([^}]*)\}/)?.[1];
    expect(supportingMeta).toContain("margin: 0;");
    expect(supportingMeta).not.toContain("auto");
    expect(supportingMeta).not.toMatch(/grid-(column|row)|z-index|position:\s*absolute/);
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-metric-copy {");
    expect(ragEvaluationCss).toContain("gap: 8px 16px;");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-summary-copy {");
    expect(ragEvaluationCss).not.toContain(".rag-eval-root .rag-evaluation-summary-layout {");
    expect(ragEvaluationCss).not.toContain("grid-template-columns: max-content minmax(0, 1fr);");
    expect(ragEvaluationCss).not.toContain("@container rag-evaluation-summary");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-status-orb {");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-evaluation-status-orb::after {");
    expect(ragEvaluationCss).not.toContain("--rag-evaluation-card-width: 120px;");
    expect(ragEvaluationCss).toContain('.rag-evaluation-overview[data-layout="stacked"]');
    const stackedOverview = ragEvaluationCss.match(/\.rag-evaluation-overview\[data-layout="stacked"\] \{([^}]*)\}/)?.[1];
    expect(stackedOverview).toContain("row-gap: 0;");
    expect(stackedOverview).toContain("padding-top: 8px;");
    const stackedGauge = ragEvaluationCss.match(/\.rag-evaluation-overview\[data-layout="stacked"\] > \.rag-evaluation-gauge-card \{([^}]*)\}/)?.[1];
    expect(stackedGauge).toContain("width: 100%;");
    expect(stackedGauge).toContain("min-height: 128px;");
    expect(stackedGauge).toContain("aspect-ratio: auto;");
    const stackedVerdict = ragEvaluationCss.match(/\.rag-evaluation-overview\[data-layout="stacked"\] > \.rag-verdict:not\(\[data-rag-measurement\]\) \{([^}]*)\}/)?.[1];
    expect(stackedVerdict).toContain("gap: 16px;");
    expect(stackedVerdict).toContain("padding: 0 8px 16px;");
    const summaryCopy = ragEvaluationCss.match(/\.rag-eval-root \.rag-evaluation-summary-copy \{([^}]*)\}/g);
    expect(summaryCopy).toHaveLength(1);
    expect(summaryCopy?.[0]).toContain("font-size: 14px;");
    expect(summaryCopy?.[0]).toContain("line-height: 21px;");
    const metrics = ragEvaluationCss.match(/\.rag-eval-root \.rag-evaluation-metrics \{([^}]*)\}/)?.[1];
    expect(metrics).toContain("font-size: 12px;");
    expect(metrics).toContain("line-height: 18px;");
    expect(enterpriseRagPreview).not.toContain("让回答真正满足用户需求");
    expect(enterpriseRagPreview).not.toContain("用企业资料回答客户问题，核对回答依据，找到改进方向。");
    expect(enterpriseRagPreview).toContain('className="rag-toolbar rag-evaluation-toolbar"');
    expect(ragEvaluationCss).toContain(".rag-eval-root .erag-evaluation-panel__heading > .rag-evaluation-toolbar {");
    expect(ragEvaluationCss).toContain("margin: 0 0 0 auto;");
    expect(ragEvaluationCss).toMatch(/@container sfp \(max-width:400px\) \{[\s\S]*?\.rag-eval-root \.rag-radar-label \{ width:68px; \}[\s\S]*?\}/);
    expect(enterpriseRagPreview).toContain('className="rag-evaluation-supporting-meta"');
    expect(enterpriseRagPreview).not.toContain('setProperty("--rag-evaluation-card-width"');
    expect(enterpriseRagPreview).not.toContain('setProperty("--rag-evaluation-card-height"');
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
    expect(ragEvaluationCss).toContain(".rag-eval-root .erag-evaluation-panel { gap:16px; padding: 24px; }");
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

  it("keeps the three rounded detail buttons large enough to tap", () => {
    expect(ragEvaluationCss).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    const actionStyles = ragEvaluationCss.match(/\.rag-eval-root \.rag-evaluation-action\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(actionStyles).toContain("height: 44px;");
    expect(actionStyles).toContain("border-radius: 12px;");
    expect(enterpriseRagPreview).toContain('className="sfp-button sfp-button--ghost rag-evaluation-action"');
    expect(actionStyles).toContain("white-space: nowrap;");
    const qualityPanel = enterpriseRagPreview.slice(
      enterpriseRagPreview.indexOf('<aside className="sfp-panel erag-evaluation-panel'),
      enterpriseRagPreview.indexOf('<section className="sfp-panel rag-task-panel'),
    );
    expect(qualityPanel).toContain('aria-label="回答评估详情"');
    expect(qualityPanel).not.toContain("RagEvaluationDisclosure");
    expect(enterpriseRagPreview).not.toContain("查看完整方案");
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-priority-label.is-suggestion {");
    expect(ragImprovementPlan).toContain('<i className="rag-evaluation-status-orb" aria-hidden="true" />{presentation.label}');
  });

  it("enforces Apple card radii across every Brand page without flattening controls", () => {
    const start = css.indexOf("/* Brand semantic card radius contract */");
    const end = css.indexOf("/* End Brand semantic card radius contract */");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const contract = css.slice(start, end);

    for (const selector of [
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
    expect(ragEvaluationCss).toContain(".rag-eval-root .rag-radar-point-control { width:36px; height:36px; min-height:36px; }");
    expect(ragRadar).toContain("const RADAR_MIN_CONTROL_RADIUS = 42;");
    expect(ragEvaluationCss).toContain(".rag-radar-point-control[aria-expanded=true]");
    expect(css).toContain(".rag-radar-point-control:hover:not(:disabled)");
    expect(css).not.toContain(".rag-radar-label:hover:not(:disabled)");
  });

  it("keeps starter questions visually compact without shrinking their touch target", () => {
    const start = ragChatCss.indexOf('.rag-eval-root .rag-chat-starters__questions > button {');
    const end = ragChatCss.indexOf('.rag-eval-root .rag-chat-starters__questions.is-entrance', start);
    const starterStyle = ragChatCss.slice(start, end);
    expect(starterStyle).toContain("flex:0 0 auto;");
    expect(starterStyle).toContain("min-height:32px;");
    expect(starterStyle).toContain("padding:3px 10px;");
    expect(starterStyle).toContain("border:.5px solid var(--sfp-line);");
    expect(starterStyle).toContain("border-radius:9px;");
    expect(starterStyle).toContain("box-shadow:0 2px 8px rgba(29,29,31,.06);");
    expect(starterStyle).toContain("inset:-6px 0;");
    expect(ragChatCss).toMatch(/\.rag-chat-starters__questions > button:hover:not\(:disabled\) \{[^}]*box-shadow:0 4px 12px rgba\(29,29,31,.08\);/);
    expect(ragChatCss).toContain("flex-wrap:nowrap; overflow-x:auto;");
    expect(ragChatCss).toContain("max-width:none; white-space:nowrap;");
  });

  it("gives only newly sent user messages a reduced-motion-safe entrance", () => {
    expect(ragChatCss).toContain(".erag-user-message.rag-chat-user-message--sent");
    expect(ragChatCss).toContain("animation:rag-chat-user-message-send 260ms cubic-bezier(.22,1,.36,1) both;");
    expect(ragChatCss).toContain("@keyframes rag-chat-user-message-send");
    expect(ragChatCss).toMatch(/@media \(prefers-reduced-motion:reduce\)[\s\S]*\.erag-user-message\.rag-chat-user-message--sent \{ animation:none; \}/);
  });

  it("uses five transparent-center radar levels and distinct marker states", () => {
    expect(ragEvaluationCss).toContain("--rag-radar-score-muted:var(--sfp-muted,#6b7280);");
    expect(ragEvaluationCss).toContain(".rag-radar-detail-score__earned.is-zero { color:var(--rag-radar-score-muted); }");
    expect(ragEvaluationCss).toContain(".rag-radar-detail-score__maximum { color:var(--rag-radar-score-muted);");
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
  });

  it("uses Apple hierarchy for the evidence drawer, risk grid, and semantic tags", () => {
    expect(enterpriseRagPreview).toContain('rag-drawer rag-drawer--${drawer}');
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
    expect(ragEvaluationCss).toContain("container:rag-drawer / inline-size;");
    expect(ragEvaluationCss).toContain("@container rag-drawer (max-width: 880px)");
    expect(ragEvaluationCss).toContain("@container rag-drawer (max-width: 560px)");
    expect(ragEvaluationCss).toContain("--rag-drawer-inline-space:16px;");
    expect(css).toContain("padding: 24px var(--rag-drawer-inline-space);");
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

  it("reuses the template and evaluation card and type treatment inside the design step", () => {
    expect(css).toContain(
      '.fm-brand-theme[data-brand-page="website"] .sfp-design-section {',
    );
    expect(css).toContain(
      ".fm-brand-theme[data-brand-page=\"website\"] :where(.sfp-brand-fields, .sfp-knowledge-summary, .sfp-design-color-grid fieldset, .sfp-assistant-trial, .sfp-inline-error, .sfp-recommend-stale) {",
    );
    expect(css).toContain(
      ".fm-brand-theme[data-brand-page=\"website\"] :where(.sfp-page-list strong, .sfp-knowledge-summary strong, .sfp-assistant-trial strong, .sfp-page-disclosure > summary) {",
    );
  });
});
