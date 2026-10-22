import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QaWidgetPreview } from "./QaWidgetPreview";

vi.mock("../../../host", () => ({
  requestWorkspaceNavigation: (action: () => void) => action(),
  useWorkspaceDraftGuard: vi.fn(),
}));

const WIDGET_STORAGE_KEY = "frontmind.ai-website-preview.widget-draft.v1.%E4%B8%9C%E8%8E%9E%E5%8F%B0%E5%BF%83%E5%8C%BB%E7%BE%8E.w03";

describe("QaWidgetPreview", () => {
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

  it("opens a fixture-backed citation in the embedded enterprise QA preview", () => {
    const { container } = render(<QaWidgetPreview embedded />);

    expect(container.querySelector(".aqwp-shell")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "查看引用 1：企业身份总览",
      }),
    );

    const dialog = screen.getByRole("dialog", { name: "企业身份总览" });
    expect(within(dialog).getByText("资料摘录 · 示例")).toBeDefined();
    expect(dialog.textContent).toContain("历史知识快照");
    expect(dialog.textContent).toContain("不替换这份历史快照");
    expect(screen.getByText("示例回答与引用")).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates and saves the AI widget preview without external navigation", () => {
    const { container } = render(
      <QaWidgetPreview embedded initialPage="widget-config" />,
    );

    const nameInput = screen.getByLabelText(/助手名称/) as HTMLInputElement;
    const welcomeInput = screen.getByLabelText(/欢迎语/) as HTMLTextAreaElement;
    fireEvent.change(nameInput, { target: { value: "FrontMind 本地助手" } });
    fireEvent.change(welcomeInput, {
      target: { value: "您好，这是即时更新的本地欢迎语。" },
    });

    const livePreview = screen.getByRole("region", {
      name: "AI 部件实时预览",
    });
    expect(within(livePreview).getByRole("heading", { name: "FrontMind 本地助手" })).toBeDefined();
    expect(within(livePreview).getByText("您好，这是即时更新的本地欢迎语。")).toBeDefined();
    expect(screen.getByText("有未保存修改")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    const storedDraft = JSON.parse(
      window.localStorage.getItem(WIDGET_STORAGE_KEY) ?? "null",
    ) as { name?: string; welcome?: string } | null;
    expect(storedDraft).toMatchObject({
      name: "FrontMind 本地助手",
      welcome: "您好，这是即时更新的本地欢迎语。",
    });
    expect(screen.getByRole("status").textContent).toContain("没有提交线上配置");
    expect(container.innerHTML).not.toContain("file://");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
