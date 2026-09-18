import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("./host", () => ({
  brandHost: vi.fn(() => { throw new Error("Presentation must not perform business requests"); }),
  useWorkspaceDraftGuard: vi.fn(),
  useConversation: () => ({ activeConversation: {
    id: "synthetic-qa", purpose: "enterprise_qa", status: "completed",
    messages: [{ id: "answer", role: "assistant", content: "## 已生成企业说明", timestamp: 1,
      outputFiles: [{ fileName: "企业说明.md", fileUrl: "/api/frontmind/v2/artifacts/synthetic/content", mimeType: "text/markdown" }],
    }],
  } }),
}));
import EnterpriseQaConversation from "./EnterpriseQaConversation";

afterEach(cleanup);
it("renders a QA answer artifact once through the shared message component", () => {
  render(<EnterpriseQaConversation preview />);
  expect(screen.getByRole("heading", { name: "已生成企业说明" })).toBeDefined();
  expect(screen.getAllByRole("link", { name: "企业说明.md" })).toHaveLength(1);
});

it("uses the original knowledge-only QA composer and preserves an unsent preview draft", async () => {
  const { container } = render(<EnterpriseQaConversation preview />);
  expect(container.querySelector(".agent-composer-controls")).not.toBeNull();
  expect(screen.queryByRole("button", { name: "添加附件" })).toBeNull();
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "企业有哪些服务？" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("本地预览不调用"));
  expect(input.value).toBe("企业有哪些服务？");
});
