import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiteOpsObservationV1 } from "../../../contracts/siteops-contract";
import { WebsiteOperationHistory } from "./WebsiteOperationHistory";

afterEach(cleanup);

function observation(allowed = true): SiteOpsObservationV1 {
  // This component consumes only the history and reset projections.
  return {
    messages: [{ id: "message-1", role: "user", content: "请突出预约入口", sequence: 1, metadata: null, sentAt: "2026-11-05T00:00:00.000Z" }],
    builds: [{ id: "build-1", ordinal: 34 }],
    executionSteps: [{ id: "step-1", operationKind: "site_build", buildId: "build-1", stage: "completed", label: "官网构建", status: "succeeded", startedAt: "2026-11-05T01:00:00.000Z", completedAt: "2026-11-05T02:00:00.000Z" }],
    rebuildRequest: { allowed, resetApplied: false, resetPending: false, resetSourceBuildId: null },
  } as SiteOpsObservationV1;
}

describe("website operation history", () => {
  it("keeps chronological messages and build transitions in a compact disclosure", () => {
    const onAction = vi.fn();
    const view = render(<WebsiteOperationHistory siteOps={{ observation: observation(), onAction }} />);
    const disclosure = view.container.querySelector(".sfp-website-history-disclosure") as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);
    expect(screen.getByText("2 条")).toBeTruthy();
    fireEvent.click(screen.getByText("操作记录"));
    expect(screen.getByText("官网构建 · 已完成")).toBeTruthy();
    expect(screen.getByText("请突出预约入口")).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("requires a separate explicit confirmation before resetting and supports cancellation", async () => {
    const onAction = vi.fn(async () => undefined);
    render(<WebsiteOperationHistory siteOps={{ observation: observation(), onAction }} />);
    fireEvent.click(screen.getByText("更多"));
    fireEvent.click(screen.getByRole("button", { name: "重新开始制作" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新开始制作" }));
    fireEvent.click(screen.getByRole("button", { name: "确认重新开始" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    expect(onAction).toHaveBeenCalledWith({ action: "request_rebuild", input: {} });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("keeps the confirmation open with a retryable error when reset fails", async () => {
    const onAction = vi.fn().mockRejectedValueOnce(new Error("网络连接异常，请重试")).mockResolvedValueOnce(undefined);
    render(<WebsiteOperationHistory siteOps={{ observation: observation(), onAction }} />);
    fireEvent.click(screen.getByText("更多"));
    fireEvent.click(screen.getByRole("button", { name: "重新开始制作" }));
    fireEvent.click(screen.getByRole("button", { name: "确认重新开始" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("网络连接异常"));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认重新开始" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2));
  });

  it("does not offer a reset when the server disallows it", () => {
    render(<WebsiteOperationHistory siteOps={{ observation: observation(false), onAction: vi.fn() }} />);
    expect(screen.queryByText("更多")).toBeNull();
    expect(screen.queryByRole("button", { name: "重新开始制作" })).toBeNull();
  });
});
