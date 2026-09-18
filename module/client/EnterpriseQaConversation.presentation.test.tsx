import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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
  expect(document.querySelector('[data-workbench-output-key="answer:0"]')?.textContent)
    .toContain("企业说明.md");
});
