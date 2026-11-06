import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RagAnswerWindows, type RagAnswerWindowsProps } from "./RagAnswerWindows";
import { useRagEntranceReady } from "./RagEntranceContext";

const initialWidth = window.innerWidth;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  frames = new Map(); nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 1; }
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); Object.defineProperty(window, "innerWidth", { configurable: true, value: initialWidth }); });

function ReadyStatus() { return <output data-testid="child-ready">{useRagEntranceReady() ? "ready" : "waiting"}</output>; }
function props(): RagAnswerWindowsProps {
  return { panels: ["evidence"], activePanel: "evidence", onActivate: vi.fn(), onClose: vi.fn(),
    titles: { evidence: "回答依据", improve: "优化方案", review: "人工评审", answer: "回答编辑" },
    availability: { evidence: true, improve: true, review: true, answer: true },
    renderBody: vi.fn(() => <><ReadyStatus /><textarea aria-label="草稿" defaultValue="保存的输入" /></>), renderFooter: vi.fn(() => null) };
}
function runFrames() { const pending = [...frames.values()]; frames.clear(); act(() => pending.forEach(callback => callback(16))); }

describe("answer window motion", () => {
  it("releases child reveals after entry and preserves body rendering during coalesced movement", () => {
    const configuration = props(); render(<RagAnswerWindows {...configuration} />);
    const dialog = screen.getByRole("dialog", { name: "回答依据" });
    const header = screen.getByRole("group", { name: "移动回答依据窗口" });
    expect(dialog.getAttribute("data-entering")).toBe("true");
    expect(screen.getByTestId("child-ready").textContent).toBe("waiting");
    const entryEnd = new Event("animationend", { bubbles: true });
    Object.defineProperty(entryEnd, "animationName", { value: "rag-answer-window-enter" });
    fireEvent(dialog, entryEnd);
    expect(screen.getByTestId("child-ready").textContent).toBe("ready");
    const bodyRenders = vi.mocked(configuration.renderBody).mock.calls.length;
    const origin = parseFloat(dialog.style.left);
    fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 312, clientY: 105 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 332, clientY: 115 });
    expect(parseFloat(dialog.style.left)).toBe(origin);
    expect(frames.size).toBe(1);
    runFrames();
    expect(parseFloat(dialog.style.left)).toBe(origin + 32);
    expect(vi.mocked(configuration.renderBody).mock.calls.length).toBe(bodyRenders);
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 340, clientY: 120 });
    fireEvent.pointerUp(header, { pointerId: 1 });
    expect(parseFloat(dialog.style.left)).toBe(origin + 40);
    expect(frames.size).toBe(0);
    expect((screen.getByRole("textbox", { name: "草稿" }) as HTMLTextAreaElement).value).toBe("保存的输入");
  });

  it("cancels queued geometry when a gesture is cancelled or blocked", () => {
    const configuration = props(); const view = render(<RagAnswerWindows {...configuration} />);
    const dialog = screen.getByRole("dialog", { name: "回答依据" });
    const header = screen.getByRole("group", { name: "移动回答依据窗口" });
    const origin = dialog.style.left;
    fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 330, clientY: 100 });
    fireEvent.pointerCancel(header, { pointerId: 1 });
    runFrames(); expect(dialog.style.left).toBe(origin);
    fireEvent.pointerDown(header, { button: 0, pointerId: 2, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(header, { pointerId: 2, clientX: 350, clientY: 100 });
    view.rerender(<RagAnswerWindows {...configuration} modalBlocked />);
    runFrames(); expect(dialog.style.left).toBe(origin);
    expect(dialog.classList.contains("is-dragging")).toBe(false);
  });

  it("uses a fallback after a cancelled CSS entry and releases reduced-motion content immediately", () => {
    const configuration = props(); const view = render(<RagAnswerWindows {...configuration} />);
    act(() => vi.advanceTimersByTime(220));
    expect(screen.getByTestId("child-ready").textContent).toBe("ready");
    view.unmount();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<RagAnswerWindows {...configuration} />);
    expect(screen.getByTestId("child-ready").textContent).toBe("ready");
    expect(screen.getByRole("dialog", { name: "回答依据" }).hasAttribute("data-entering")).toBe(false);
  });

  it("keeps a queued drag within the latest browser bounds", () => {
    render(<RagAnswerWindows {...props()} />);
    const header = screen.getByRole("group", { name: "移动回答依据窗口" });
    fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 1200, clientY: 100 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 850 });
    fireEvent(window, new Event("resize"));
    runFrames();
    const dialog = screen.getByRole("dialog", { name: "回答依据" });
    expect(parseFloat(dialog.style.left) + parseFloat(dialog.style.width)).toBeLessThanOrEqual(834);
  });
});
