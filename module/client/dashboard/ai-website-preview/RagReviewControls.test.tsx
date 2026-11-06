import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RagReviewEvidencePicker, RagReviewSelect } from "./RagReviewControls";
import type { ReviewEvidenceOption } from "./rag-review-evidence";

const options: ReviewEvidenceOption[] = [
  { value: "answer:1", label: "本次完整回答", description: "当前回答原文", group: "answer" },
  { value: "claim:1", label: "支持私有部署", description: "部署能力陈述", group: "claim" },
  { value: "source:1", label: "产品说明.pdf", description: "已发布知识资料", group: "source" },
];
beforeAll(() => {
  if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as typeof PointerEvent;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
});
afterEach(cleanup);

function EvidenceHarness({ initial = [] }: { initial?: string[] }) {
  const [values, setValues] = useState(initial);
  return <aside data-answer-panel="review"><div className="rag-drawer-body"><RagReviewEvidencePicker label="需求满足证据" values={values} options={options} onValuesChange={setValues} /><input aria-label="下一字段" /></div><output aria-label="存储数据">{JSON.stringify(values)}</output></aside>;
}

describe("RagReviewControls", () => {
  it("displays pending and judged values through the same labelled control", () => {
    const shared = { label: "需求满足等级", fieldLabel: "判断等级", options: [{ value: "", label: "待判定" }, { value: "2", label: "2 · 部分满足" }], onValueChange: vi.fn() };
    const { rerender } = render(<aside data-answer-panel="review"><RagReviewSelect {...shared} value="" /></aside>);
    expect(screen.getByRole("combobox", { name: "需求满足等级" }).textContent).toContain("待判定");
    rerender(<aside data-answer-panel="review"><RagReviewSelect {...shared} value="2" /></aside>);
    expect(screen.getByRole("combobox", { name: "需求满足等级" }).textContent).toContain("2 · 部分满足");
    expect(shared.onValueChange).not.toHaveBeenCalled();
  });

  it("preserves legacy values and removes them through separate controls", () => {
    render(<EvidenceHarness initial={["自定义原句，保留空格 ", "source:1"]} />);
    const list = screen.getByRole("list", { name: "需求满足证据：已选证据" });
    expect(within(list).getAllByRole("listitem").map(item => item.getAttribute("data-evidence-value"))).toEqual(["自定义原句，保留空格 ", "source:1"]);
    fireEvent.click(screen.getByRole("button", { name: /移除自定义原句/ }));
    expect(screen.getByRole("status", { name: "存储数据" }).textContent).toBe('["source:1"]');
    expect(screen.getByRole("button", { name: "调整产品说明.pdf顺序" })).toBeTruthy();
  });

  it("supports keyboard reordering within the current field and keeps focus on the moved handle", () => {
    render(<EvidenceHarness initial={["answer:1", "claim:1", "source:1"]} />);
    const handle = screen.getByRole("button", { name: "调整支持私有部署顺序" });
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowLeft", altKey: true });
    expect(screen.getByRole("status", { name: "存储数据" }).textContent).toBe('["claim:1","answer:1","source:1"]');
    expect(document.activeElement).toBe(handle);
    fireEvent.keyDown(handle, { key: "ArrowLeft", altKey: true });
    expect(screen.getByRole("status", { name: "存储数据" }).textContent).toBe('["claim:1","answer:1","source:1"]');
  });

});
