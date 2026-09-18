import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import BrandConversationMessage from "./BrandConversationMessage";

afterEach(cleanup);
describe("Brand conversation presentation", () => {
  it("keeps user input literal and separates attachments from the message bubble", () => {
    const { container } = render(<BrandConversationMessage message={{ id: "user", role: "user", timestamp: 1,
      content: "# 请保留我的原文\n**不是标题**",
      attachments: [{ id: "reference", type: "file", name: "企业参考材料.html" }],
    }} />);
    expect(container.querySelector(".brand-conversation-message--user")).not.toBeNull();
    expect(screen.getByLabelText("用户")).toBeDefined();
    expect(container.querySelector("h1,strong")).toBeNull();
    expect(container.querySelector(".brand-conversation-message__user-text")?.textContent).toBe("# 请保留我的原文\n**不是标题**");
    expect(screen.getByLabelText("消息附件").textContent).toContain("企业参考材料.html");
    expect(container.querySelector(".brand-conversation-message__user-text")?.textContent).not.toContain("企业参考材料.html");
  });
  it("retains assistant Markdown and supplied result controls without a user avatar", () => {
    const { container } = render(<BrandConversationMessage message={{ id: "assistant", role: "assistant", timestamp: 2, content: "## 企业身份总览" }}>
      <button>查看节点结果</button>
    </BrandConversationMessage>);
    expect(screen.getByRole("heading", { name: "企业身份总览" })).toBeDefined();
    expect(screen.getByRole("button", { name: "查看节点结果" })).toBeDefined();
    expect(container.querySelector(".brand-conversation-message__avatar")).toBeNull();
    expect(container.querySelector(".brand-conversation-message__user-text")).toBeNull();
  });
});

it("keeps assistant media, artifacts and execution steps when the text is empty", () => {
  const { container } = render(<BrandConversationMessage message={{ id: "media-only", role: "assistant", timestamp: 3, content: "",
    inlineImages: [{ src: "data:image/png;base64,c3ludGhldGlj", alt: "合成图片" }],
    outputFiles: [{ fileName: "合成成果.md", fileUrl: "/api/frontmind/v2/artifacts/synthetic/content", mimeType: "text/markdown" }],
    intermediateSteps: [{ id: "step", type: "function_call", label: "材料整理完成" }],
  }} />);
  expect(screen.getByRole("img", { name: "合成图片" })).toBeDefined();
  expect(screen.getAllByRole("link", { name: "合成成果.md" })).toHaveLength(1);
  expect(screen.getByText("材料整理完成")).toBeDefined();
  expect(container.querySelector(".brand-conversation-message__user-text")).toBeNull();
});
