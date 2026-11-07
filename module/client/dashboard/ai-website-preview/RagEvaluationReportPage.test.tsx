import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RAG_SAMPLE_CASES } from "./rag-evaluation-cases";
import { installRagPreviewFixtures } from "./rag-preview-fixture-loader";
import { ragPreviewFixtures } from "./rag-preview-fixtures-data";
import RagEvaluationReportPage from "./RagEvaluationReportPage";

vi.mock("./RagEvaluationReportRules", () => ({
  RagEvaluationReportRules: () => <section id="rules">评分规则</section>,
}));
vi.mock("./RagEvaluationReportRecords", () => ({
  RagEvaluationReportRecords: () => <section id="records">真实评估记录</section>,
}));
vi.mock("./RagEvaluationExampleRecord", () => ({
  RagEvaluationExampleRecord: ({ example }: { example: { id: string } }) =>
    <section id="records">示例记录 {example.id}</section>,
}));

afterEach(cleanup);

describe("RAG standalone report fixture boundary", () => {
  const props = {
    storageScopeKey: "live:1:workspace",
    contextError: null,
    returnUrl: "/?view=enterprise-qa",
    brandMarkSrc: "/brand.svg",
  };
installRagPreviewFixtures(ragPreviewFixtures);

  it("rejects a direct synthetic example id in formal mode", () => {
    render(<RagEvaluationReportPage {...props} preview={false} exampleId={RAG_SAMPLE_CASES[0].id} />);
    expect(screen.getByRole("alert").textContent).toContain("报告链接无效");
    expect(screen.queryByText(new RegExp(`示例记录 ${RAG_SAMPLE_CASES[0].id}`))).toBeNull();
    expect(screen.queryByText("真实评估记录")).toBeNull();
  });

  it("keeps the same example available in local preview mode", async () => {
    render(<RagEvaluationReportPage {...props} preview exampleId={RAG_SAMPLE_CASES[0].id} />);
    expect(await screen.findByText(`示例记录 ${RAG_SAMPLE_CASES[0].id}`)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
