import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RagAnswerWindows, type AnswerPanel } from "./RagAnswerWindows";

const titles = { evidence: "回答依据", improve: "优化方案", review: "人工评审", answer: "录入待评估回答" };
const availability = { evidence: true, improve: true, review: true, answer: true };
const initialWidth = window.innerWidth;
afterEach(() => { cleanup(); Object.defineProperty(window, "innerWidth", { configurable: true, value: initialWidth }); });

function Windows({ first }: { first: AnswerPanel }) {
  const [panels, setPanels] = useState<AnswerPanel[]>([first]);
  const [active, setActive] = useState<AnswerPanel>(first);
  const [draft, setDraft] = useState("初始回答");
  return <RagAnswerWindows panels={panels} activePanel={active} titles={titles} availability={availability}
    onActivate={panel => { setPanels(old => old.includes(panel) ? old : [...old, panel]); setActive(panel); }}
    onClose={panel => setPanels(old => old.filter(item => item !== panel))}
    renderBody={panel => panel === "answer" ? <label>回答<textarea value={draft} onChange={event => setDraft(event.target.value)} /></label> : <p>详情</p>}
    renderFooter={panel => panel === "answer" ? <button onClick={() => setPanels(old => old.filter(item => item !== "answer"))}>保存回答</button> : null} />;
}

describe("answer editor window", () => {
  it("keeps its draft while moving, resizing and maximizing on desktop", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    render(<Windows first="answer" />);
    const dialog = screen.getByRole("dialog", { name: "录入待评估回答" });
    const header = within(dialog).getByRole("group", { name: "移动回答编辑窗口" });
    const input = within(dialog).getByRole("textbox", { name: "回答" });
    fireEvent.change(input, { target: { value: "保留的草稿" } });
    const left = parseFloat(dialog.style.left);
    fireEvent.keyDown(header, { key: "ArrowRight" });
    expect(parseFloat(dialog.style.left)).toBe(left + 8);
    const width = parseFloat(dialog.style.width);
    fireEvent.keyDown(header, { key: "ArrowRight", shiftKey: true });
    expect(parseFloat(dialog.style.width)).toBe(width + 8);
    fireEvent.click(within(dialog).getByRole("button", { name: "放大窗口" }));
    expect((input as HTMLTextAreaElement).value).toBe("保留的草稿");
    fireEvent.click(within(dialog).getByRole("button", { name: "保存回答" }));
    expect(screen.queryByRole("dialog", { name: "录入待评估回答" })).toBeNull();
  });

  it("shows no unrelated detail tabs in the mobile editor and retains the normal three tabs in detail panels", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    const view = render(<Windows first="answer" />);
    const dialog = screen.getByRole("dialog", { name: "录入待评估回答" });
    expect(within(dialog).queryByRole("navigation", { name: "回答评估详情切换" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭回答编辑" }));
    expect(screen.queryByRole("dialog", { name: "录入待评估回答" })).toBeNull();
    view.unmount();
    render(<Windows first="evidence" />);
    const nav = screen.getByRole("navigation", { name: "回答评估详情切换" });
    expect(within(nav).getAllByRole("button")).toHaveLength(3);
  });
});
