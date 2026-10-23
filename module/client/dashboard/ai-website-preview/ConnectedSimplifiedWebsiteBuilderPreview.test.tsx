import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
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
  }) => <>{renderView?.(mocks.liveSiteOps)}</>,
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
    return <div data-testid="designed-website-builder" />;
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
      onStepChange,
      siteOps: mocks.liveSiteOps,
      storageScope: "live:42:workspace-1",
    });
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
