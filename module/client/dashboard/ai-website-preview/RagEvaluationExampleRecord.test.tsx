import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RagEvaluationExampleRecord } from "./RagEvaluationExampleRecord";
import RagEvaluationReportPage from "./RagEvaluationReportPage";
import { RAG_SAMPLE_CASES } from "./rag-evaluation-cases";
import { installRagPreviewFixtures } from "./rag-preview-fixture-loader";
import { ragPreviewFixtures } from "./rag-preview-fixtures-data";
import { scoreEvaluation } from "./rag-evaluation";
import { liveEnterpriseRagEvaluationApi } from "../enterprise-rag-evaluation-api";

installRagPreviewFixtures(ragPreviewFixtures);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("example report records", () => {
  it("presents the selected question, answer, six dimensions, risks and synthetic sources", () => {
    const example = RAG_SAMPLE_CASES[0];
    render(<RagEvaluationExampleRecord example={example} />);
    const record = screen.getByTestId("rag-report-example-record");
    expect(record.textContent).toContain("示例");
    expect(record.textContent).not.toContain("预设评审");
    expect(screen.getByText(example.question)).toBeTruthy();
    expect(screen.getByText(example.answer)).toBeTruthy();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(7);
    for (const source of example.sources) expect(screen.getByText(source.title)).toBeTruthy();
    for (const gate of example.gates) expect(record.textContent).toContain(gate.reason);
    expect(record.textContent).not.toMatch(/rag-eval-\d/);
  });

  it("marks an unusable example N/A without a numeric total", () => {
    const example = RAG_SAMPLE_CASES.find(item => scoreEvaluation(item).verdict === "unusable")!;
    render(<RagEvaluationExampleRecord example={example} />);
    expect(screen.getByLabelText("重大问题，数值分不适用").textContent).toBe("N/A");
    expect(screen.queryByText(/^\d+(?:\.\d+)?\/100$/)).toBeNull();
  });

  it("keeps example pages independent of live APIs and browser review history", async () => {
    const latest = vi.spyOn(liveEnterpriseRagEvaluationApi, "latest");
    const start = vi.spyOn(liveEnterpriseRagEvaluationApi, "start");
    const read = vi.spyOn(Storage.prototype, "getItem");
    const write = vi.spyOn(Storage.prototype, "setItem");
    render(<RagEvaluationReportPage storageScopeKey="preview:example-workspace" preview exampleId={RAG_SAMPLE_CASES[0].id} contextError={null} returnUrl="/?view=enterprise-qa" brandMarkSrc="/wordmark.svg" />);
    expect(await screen.findByTestId("rag-report-example-record")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "当前回答的自动评估" })).toBeNull();
    expect(latest).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });

  it("rejects unknown and mixed contexts before mounting any records", async () => {
    const latest = vi.spyOn(liveEnterpriseRagEvaluationApi, "latest");
    const props = { storageScopeKey: "preview:a", preview: true, contextError: null, returnUrl: "/", brandMarkSrc: "/wordmark.svg" };
    const view = render(<RagEvaluationReportPage {...props} exampleId="unknown" />);
    expect((await screen.findByRole("alert")).textContent).toContain("标识无效");
    view.rerender(<RagEvaluationReportPage {...props} exampleId={RAG_SAMPLE_CASES[0].id} coordinate={{ sourceQaTaskId: "real", turnId: "turn" }} />);
    expect(screen.getByRole("alert").textContent).toContain("不能混用");
    expect(screen.queryByTestId("rag-report-example-record")).toBeNull();
    expect(latest).not.toHaveBeenCalled();
  });
});
