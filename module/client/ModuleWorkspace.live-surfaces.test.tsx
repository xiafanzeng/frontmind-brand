import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ragProps: null as null | Record<string, unknown>,
  websiteProps: null as null | Record<string, unknown>,
  websiteSettingsProps: null as null | Record<string, unknown>,
}));

vi.mock("./components/EmbeddedKnowledgeBasePanel", () => ({
  default: () => <div data-testid="knowledge-surface" />,
}));
vi.mock("./BrandReportWorkspace", () => ({
  default: () => <div data-testid="reports-surface" />,
}));
vi.mock("./dashboard/IntentWorkbench", () => ({
  default: () => <div data-testid="intent-surface" />,
}));
vi.mock("./dashboard/knowledge-frontend/KnowledgeFrontendSettings", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.websiteSettingsProps = props;
    return <div data-testid="website-settings-surface" />;
  },
}));
vi.mock("./dashboard/EnterpriseRagWorkspace", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.ragProps = props;
    return <div data-testid="live-designed-rag" />;
  },
}));
vi.mock(
  "./dashboard/ai-website-preview/ConnectedSimplifiedWebsiteBuilderPreview",
  () => ({
    default: (props: Record<string, unknown>) => {
      mocks.websiteProps = props;
      return <div data-testid="live-designed-website" />;
    },
  }),
);

import ModuleWorkspace, { type BrandPage, type ModuleContext } from "./ModuleWorkspace";

const context: ModuleContext = {
  module: "brand",
  workspace: { id: "workspace-1", ownerUserId: 1 },
  capabilities: ["brand"],
  marketEdition: "cn",
};
const keywordData = { tables: [], revision: null };

afterEach(() => {
  cleanup();
  mocks.ragProps = null;
  mocks.websiteProps = null;
  mocks.websiteSettingsProps = null;
});

describe("ModuleWorkspace redesigned live routes", () => {
  it("scopes every Brand page inside the Apple theme boundary", () => {
    const pages: BrandPage[] = [
      "reports",
      "knowledge",
      "keywords",
      "intent",
      "response-logic",
      "enterprise-qa",
      "website",
      "website-settings",
    ];

    for (const page of pages) {
      const view = render(
        <ModuleWorkspace
          context={context}
          page={page}
          keywordData={keywordData}
          preview
          previewQa={<div data-testid="fixture-rag" />}
          previewSiteOps={<div data-testid="fixture-website" />}
        />,
      );
      const boundary = view.container.querySelector(".fm-brand-theme");
      expect(boundary?.getAttribute("data-brand-page")).toBe(page);
      view.unmount();
    }
  });

  it("uses the connected later RAG design without legacy workbench chrome", () => {
    const onOpenWebsite = vi.fn();
    const onOpenWebsiteAssistant = vi.fn();
    render(
      <ModuleWorkspace
        context={context}
        page="enterprise-qa"
        keywordData={keywordData}
        preview={false}
        previewQa={<div data-testid="fixture-rag" />}
        enterpriseRagNavigation={{
          onOpenWebsite,
          onOpenWebsiteAssistant,
          websiteEntryLabel: "返回网站建设",
        }}
      />,
    );

    expect(screen.getByTestId("live-designed-rag")).toBeTruthy();
    expect(screen.queryByTestId("fixture-rag")).toBeNull();
    expect(mocks.ragProps).toMatchObject({
      projectId: "workspace-1",
      storageScopeKey: "live:1:workspace-1",
      onOpenWebsite,
      onOpenWebsiteAssistant,
      websiteEntryLabel: "返回网站建设",
    });
    expect(mocks.ragProps).not.toHaveProperty("workbench");
  });

  it("keeps the synthetic RAG fixture exclusive to preview mode", () => {
    render(
      <ModuleWorkspace
        context={context}
        page="enterprise-qa"
        keywordData={keywordData}
        preview
        previewQa={<div data-testid="fixture-rag" />}
      />,
    );

    expect(screen.getByTestId("fixture-rag")).toBeTruthy();
    expect(screen.queryByTestId("live-designed-rag")).toBeNull();
  });

  it("fails closed when the RAG preview fixture is unavailable", () => {
    render(
      <ModuleWorkspace
        context={context}
        page="enterprise-qa"
        keywordData={keywordData}
        preview
      />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "预览模式不会连接真实问答服务",
    );
    expect(screen.queryByTestId("live-designed-rag")).toBeNull();
  });

  it("uses the connected later website design in live mode, never the fixture", () => {
    const onOpenRag = vi.fn();
    const onStepChange = vi.fn();
    render(
      <ModuleWorkspace
        context={context}
        page="website"
        keywordData={keywordData}
        preview={false}
        previewSiteOps={<div data-testid="fixture-website" />}
        websiteBuilderNavigation={{
          initialStep: "design",
          onOpenRag,
          onStepChange,
        }}
      />,
    );

    expect(screen.getByTestId("live-designed-website")).toBeTruthy();
    expect(screen.queryByTestId("fixture-website")).toBeNull();
    expect(mocks.websiteProps).toMatchObject({
      initialStep: "design",
      onOpenRag,
      onStepChange,
      storageScope: "live:1:workspace-1",
    });
  });

  it("keeps the synthetic website fixture exclusive to preview mode", () => {
    render(
      <ModuleWorkspace
        context={context}
        page="website"
        keywordData={keywordData}
        preview
        previewSiteOps={<div data-testid="fixture-website" />}
      />,
    );

    expect(screen.getByTestId("fixture-website")).toBeTruthy();
    expect(screen.queryByTestId("live-designed-website")).toBeNull();
  });

  it("fails closed when the website preview fixture is unavailable", () => {
    render(
      <ModuleWorkspace
        context={context}
        page="website"
        keywordData={keywordData}
        preview
      />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "预览模式不会打开真实建站项目",
    );
    expect(screen.queryByTestId("live-designed-website")).toBeNull();
  });

  it("routes website settings to the scoped project without opening a real build", () => {
    render(
      <ModuleWorkspace
        context={context}
        page="website-settings"
        keywordData={keywordData}
        preview
      />,
    );

    expect(screen.getByTestId("website-settings-surface")).toBeTruthy();
    expect(mocks.websiteSettingsProps).toEqual({
      ownerId: 1,
      projectId: "workspace-1",
      demo: true,
    });
    expect(screen.queryByTestId("live-designed-website")).toBeNull();
  });
});
