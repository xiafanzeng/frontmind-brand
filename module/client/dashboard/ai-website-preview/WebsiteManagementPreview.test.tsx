import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { WebsiteManagementPreview } from "./WebsiteManagementPreview";

vi.mock("../../host", () => ({
  requestWorkspaceNavigation: (action: () => void) => action(),
  useWorkspaceDraftGuard: vi.fn(),
}));

const STORAGE_KEY = "frontmind.aiWebsite.preview.v1.%E4%B8%9C%E8%8E%9E%E5%8F%B0%E5%BF%83%E5%8C%BB%E7%BE%8E.v03.websiteDraft";

describe("WebsiteManagementPreview", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("edits and saves a website draft entirely in the local preview", () => {
    const { container } = render(<WebsiteManagementPreview />);

    expect(screen.getByRole("heading", { name: "网站工作台" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "编辑网站" }));

    expect(screen.getByRole("heading", { name: "编辑网站" })).toBeDefined();
    const titleInput = screen.getByRole("textbox", { name: "主标题" });
    fireEvent.change(titleInput, { target: { value: "可信企业信息，即刻可见" } });

    const canvas = container.querySelector(".awp-editor-canvas");
    expect(canvas).not.toBeNull();
    expect(
      within(canvas as HTMLElement).getByRole("heading", {
        name: "可信企业信息，即刻可见",
      }),
    ).toBeDefined();
    expect(screen.getByText("有未保存修改 · Evaluation 待重评")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    const storedDraft = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as { heroTitle?: string } | null;
    expect(storedDraft?.heroTitle).toBe("可信企业信息，即刻可见");
    expect(
      screen.getByRole("status").textContent,
    ).toContain("未向线上提交");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("discards an unsaved editor value after confirmed navigation to the workbench", () => {
    render(<WebsiteManagementPreview />);
    fireEvent.click(screen.getByRole("button", { name: "编辑网站" }));
    const titleInput = screen.getByRole("textbox", { name: "主标题" }) as HTMLTextAreaElement;
    const savedTitle = titleInput.value;
    fireEvent.change(titleInput, { target: { value: "尚未保存的标题" } });

    fireEvent.click(screen.getByRole("button", { name: "返回网站工作台" }));
    expect(screen.getByRole("heading", { name: "网站工作台" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "编辑网站" }));

    expect((screen.getByRole("textbox", { name: "主标题" }) as HTMLTextAreaElement).value).toBe(savedTitle);
  });

  it("keeps the workbench card distinct while styling numbered flow steps as routes", () => {
    const { container } = render(<WebsiteManagementPreview />);
    const steps = Array.from(container.querySelectorAll(".awp-flow-step"));

    expect(steps).toHaveLength(6);
    expect(steps[0]?.classList.contains("awp-flow-step--route")).toBe(false);
    expect(container.querySelectorAll(".awp-flow-step--route")).toHaveLength(5);
  });
});
