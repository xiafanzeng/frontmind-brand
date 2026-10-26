import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  liveSiteOps: { observation: { project: { revision: 7 } } },
  received: null as null | Record<string, unknown>,
}));

vi.mock("../siteops/ConnectedSiteOpsConversationPanel", () => ({
  default: ({
    render: renderView,
  }: {
    render?: (props: unknown) => ReactNode;
  }) => (
    <>
      {renderView
        ? renderView(mocks.liveSiteOps)
        : <div data-testid="established-siteops-panel">域名与发布设置</div>}
    </>
  ),
}));

vi.mock("../../host", () => ({
  useRuntimeContext: () => ({
    workspaceId: "workspace-1",
    accountId: 42,
    enabled: true,
  }),
}));

vi.mock("./SimplifiedWebsiteBuilderPreview", () => ({
  SimplifiedWebsiteBuilderPreview: (props: Record<string, unknown>) => {
    mocks.received = props;
    return (
      <button
        type="button"
        data-testid="designed-website-builder"
        onClick={() => (props.onOpenSiteOpsRelease as (() => void) | undefined)?.()}
      >
        四步建站
      </button>
    );
  },
}));

import ConnectedSimplifiedWebsiteBuilderPreview from "./ConnectedSimplifiedWebsiteBuilderPreview";

describe("connected redesigned website builder", () => {
  it("renders the later product design with the real SiteOps adapter", () => {
    const onOpenRag = vi.fn();
    const onStepChange = vi.fn();

    render(
      <ConnectedSimplifiedWebsiteBuilderPreview
        initialStep="assistant"
        onOpenRag={onOpenRag}
        onStepChange={onStepChange}
      />,
    );

    expect(screen.getByTestId("designed-website-builder")).toBeTruthy();
    expect(mocks.received).toMatchObject({
      initialStep: "assistant",
      onOpenRag,
      onOpenSiteOpsRelease: expect.any(Function),
      onStepChange,
      siteOps: mocks.liveSiteOps,
      storageScope: "live:42:workspace-1",
    });
  });

  it("switches the same connected controller to SiteOps release settings and back", () => {
    const view = render(<ConnectedSimplifiedWebsiteBuilderPreview />);
    const page = within(view.container);

    fireEvent.click(page.getByTestId("designed-website-builder"));

    expect(page.queryByTestId("designed-website-builder")).toBeNull();
    expect(page.getByTestId("established-siteops-panel")).toBeTruthy();
    fireEvent.click(page.getByRole("button", { name: "返回四步建站" }));

    expect(page.queryByTestId("established-siteops-panel")).toBeNull();
    expect(page.getByTestId("designed-website-builder")).toBeTruthy();
  });

  it("honors the host workspace scope instead of sharing drafts across projects", () => {
    render(
      <ConnectedSimplifiedWebsiteBuilderPreview storageScope="live:42:project-9" />,
    );

    expect(mocks.received).toMatchObject({
      siteOps: mocks.liveSiteOps,
      storageScope: "live:42:project-9",
    });
  });
});
