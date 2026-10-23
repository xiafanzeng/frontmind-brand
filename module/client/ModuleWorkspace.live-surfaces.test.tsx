import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ragProps: null as null | Record<string, unknown>,
  websiteProps: null as null | Record<string, unknown>,
}));

vi.mock("./components/EmbeddedKnowledgeBasePanel", () => ({
  default: () => <div data-testid="knowledge-surface" />,
}));
vi.mock("./dashboard/IntentWorkbench", () => ({
  default: () => <div data-testid="intent-surface" />,
}));
vi.mock("./dashboard/knowledge-frontend/KnowledgeFrontendSettings", () => ({
  default: () => <div data-testid="website-settings-surface" />,
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

import ModuleWorkspace, { type ModuleContext } from "./ModuleWorkspace";

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
});

describe("ModuleWorkspace redesigned live routes", () => {
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
          initialStep: "assistant",
          onOpenRag,
          onStepChange,
        }}
      />,
    );

    expect(screen.getByTestId("live-designed-website")).toBeTruthy();
    expect(screen.queryByTestId("fixture-website")).toBeNull();
    expect(mocks.websiteProps).toMatchObject({
      initialStep: "assistant",
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
});
