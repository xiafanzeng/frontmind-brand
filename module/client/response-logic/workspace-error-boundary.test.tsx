import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * Tests for the workspace error boundary: any uncaught render error must
 * show a recoverable error card instead of a blank page (white screen).
 */

import { WorkspaceErrorBoundary } from "./workspace-error-boundary.js";

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("BusinessExecutionActivity crashed on timeline data");
  return <div>All good</div>;
}

afterEach(cleanup);

describe("WorkspaceErrorBoundary", () => {
  it("catches a render error and shows a recoverable card instead of a white screen", () => {
    render(
      <WorkspaceErrorBoundary contextLabel="测试问题">
        <Bomb shouldThrow={true} />
      </WorkspaceErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toContain("应答逻辑页面遇到异常");
    expect(screen.getByRole("alert").textContent).toContain("测试问题");
    expect(screen.getByRole("alert").textContent).toContain("您的数据是安全的");
    expect(screen.getByText(/BusinessExecutionActivity crashed/)).toBeTruthy();
  });

  it("renders children normally when no error occurs", () => {
    render(
      <WorkspaceErrorBoundary>
        <Bomb shouldThrow={false} />
      </WorkspaceErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers a visible retry button on the error card", () => {
    render(
      <WorkspaceErrorBoundary>
        <Bomb shouldThrow={true} />
      </WorkspaceErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    // The retry button is present — clicking it clears the boundary error
    // state so the next render attempt can succeed if the cause is fixed.
    const retry = screen.getByRole("button", { name: /重试渲染/ });
    expect(retry).toBeTruthy();
    expect(retry.textContent).toContain("重试");
  });

  it("logs the error to console for server-side correlation", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <WorkspaceErrorBoundary>
        <Bomb shouldThrow={true} />
      </WorkspaceErrorBoundary>,
    );
    expect(spy).toHaveBeenCalledWith(
      "[ResponseLogicWorkspace] render error:",
      expect.objectContaining({ name: "Error" }),
    );
    spy.mockRestore();
  });
});
