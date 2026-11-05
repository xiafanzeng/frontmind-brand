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
        onClick={() => (props.onStepChange as ((step: string) => void) | undefined)?.("design")}
      >
        三步建站
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
        initialStep="design"
        onOpenRag={onOpenRag}
        onStepChange={onStepChange}
      />,
    );

    expect(screen.getByTestId("designed-website-builder")).toBeTruthy();
    expect(mocks.received).toMatchObject({
      initialStep: "design",
      onOpenRag,
      onStepChange,
      siteOps: mocks.liveSiteOps,
      storageScope: "live:42:workspace-1",
    });
  });

  it("keeps the three-step builder mounted and removes the legacy management-page switch", () => {
    const onStepChange = vi.fn();
    const view = render(<ConnectedSimplifiedWebsiteBuilderPreview onStepChange={onStepChange} />);
    const page = within(view.container);

    fireEvent.click(page.getByTestId("designed-website-builder"));

    expect(onStepChange).toHaveBeenCalledWith("design");
    expect(page.queryByTestId("established-siteops-panel")).toBeNull();
    expect(page.getByTestId("designed-website-builder")).toBeTruthy();
    expect(page.queryByRole("button", { name: "返回三步建站" })).toBeNull();
    expect(mocks.received).not.toHaveProperty("onOpenSiteOpsRelease");
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
