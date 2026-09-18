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
    attachments: [{ id: "image-reference", type: "image", name: "参考图片.png", base64: "data:image/png;base64,c3ludGhldGlj" }],
    inlineImages: [{ src: "data:image/png;base64,c3ludGhldGlj", alt: "合成图片" }],
    outputFiles: [{ fileName: "合成成果.md", fileUrl: "/api/frontmind/v2/artifacts/synthetic/content", mimeType: "text/markdown" }],
    enterpriseQaAnswer: { schemaVersion: 1, sources: [{ id: "source", kind: "user_attachment", title: "合成参考材料" }] },
    stepGroups: [{ id: "group", title: "资料处理", steps: [{ id: "step", type: "function_call", label: "读取资料" }] }],
  }} />);
  expect(screen.getByRole("img", { name: "参考图片.png" })).toBeDefined();
  expect(screen.getByRole("img", { name: "合成图片" })).toBeDefined();
  expect(container.querySelector('[data-workbench-output-key="media-only:0"]')?.textContent)
    .toContain("合成成果.md");
  expect(container.querySelector("details")?.textContent).toContain("合成参考材料");
  expect(screen.getByText("读取资料")).toBeDefined();
  expect(container.querySelector(".brand-conversation-message__user-text")).toBeNull();
});
