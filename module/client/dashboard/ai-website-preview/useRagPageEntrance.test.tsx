// @vitest-environment jsdom
import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRagPageEntrance } from "./useRagPageEntrance";

type UnitId = "chat" | "quality" | "knowledge" | "task";
let observers: TestIntersectionObserver[];
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let reducedMotion: boolean;
let mediaListeners: Set<(event: MediaQueryListEvent) => void>;
let rects: Record<UnitId, { top: number; left: number; width: number; height: number }>;

class TestIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(readonly callback: IntersectionObserverCallback) { observers.push(this); }
}

function Harness({ scope = "first", revision = 0, urgent }: { scope?: string; revision?: number; urgent?: UnitId }) {
  const ref = useRef<HTMLDivElement>(null);
  const ready = useRagPageEntrance(ref, scope);
  // Deliberately use column-major DOM order; the visible geometry must choose
  // knowledge → quality → chat rather than the source order.
  return <div ref={ref} data-testid="page" data-revision={revision}>
    {(["chat", "quality", "knowledge", "task"] as const).map(id => <section key={id} data-rag-entrance={id} data-rag-entrance-immediate={urgent === id || undefined} data-testid={id}>
      <button>{id}</button><output data-testid={`${id}-ready`}>{String(ready(id))}</output>
    </section>)}
  </div>;
}

const unit = (id: UnitId) => screen.getByTestId(id);
const isReady = (id: UnitId) => screen.getByTestId(`${id}-ready`).textContent === "true";
function intersect(entries: Array<[UnitId, boolean]>, observer = observers[observers.length - 1]) {
  act(() => observer.callback(entries.map(([id, visible]) => ({
    target: unit(id), isIntersecting: visible,
  } as unknown as IntersectionObserverEntry)), observer as unknown as IntersectionObserver));
}
function flushFrame() {
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(0));
  });
}
function animationFinish(target: Element, type = "animationend", animationName = "rag-page-enter") {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "animationName", { value: animationName });
  fireEvent(target, event);
}
function motion(matches: boolean) {
  reducedMotion = matches;
  act(() => mediaListeners.forEach(listener => listener({ matches } as MediaQueryListEvent)));
}

beforeEach(() => {
  vi.useFakeTimers();
  observers = [];
  frames = new Map();
  frameId = 0;
  reducedMotion = false;
  mediaListeners = new Set();
  rects = {
    knowledge: { top: 100, left: 0, width: 300, height: 100 },
    quality: { top: 100, left: 320, width: 300, height: 300 },
    chat: { top: 220, left: 0, width: 300, height: 300 },
    task: { top: 1200, left: 320, width: 300, height: 200 },
  };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rect = rects[this.dataset.ragEntrance as UnitId];
    if (!rect) return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
    return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON() {} };
  });
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches() { return reducedMotion; },
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.delete(listener),
  })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RAG page entrance coordination", () => {
  it("orders each visible batch by geometry with 120ms stagger and releases children after 600ms", () => {
    render(<Harness />);
    expect(observers[0].observe).toHaveBeenCalledTimes(4);
    for (const id of ["knowledge", "quality", "chat", "task"] as const) {
      expect(unit(id).dataset.ragEntranceState).toBe("pending");
      expect(isReady(id)).toBe(false);
    }
    intersect([["chat", true], ["quality", true], ["knowledge", true]]);
    expect(frames.size).toBe(1);
    flushFrame();
    expect(unit("knowledge").style.getPropertyValue("--rag-entrance-delay")).toBe("0ms");
    expect(unit("quality").style.getPropertyValue("--rag-entrance-delay")).toBe("120ms");
    expect(unit("chat").style.getPropertyValue("--rag-entrance-delay")).toBe("240ms");
    expect(unit("task").dataset.ragEntranceState).toBe("pending");
    act(() => vi.advanceTimersByTime(599));
    expect(isReady("knowledge")).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(isReady("knowledge")).toBe(true);
    expect(isReady("quality")).toBe(false);
    act(() => vi.advanceTimersByTime(119));
    expect(isReady("quality")).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(isReady("quality")).toBe(true);
    expect(isReady("chat")).toBe(false);
    act(() => vi.advanceTimersByTime(120));
    expect(isReady("chat")).toBe(true);
    expect(isReady("task")).toBe(false);
    expect(unit("knowledge").style.getPropertyValue("--rag-entrance-delay")).toBe("");
  });

  it("keeps offscreen content pending and starts the next viewport batch without inherited delay", () => {
    render(<Harness />);
    intersect([["knowledge", true], ["task", true]]);
    intersect([["knowledge", false]]);
    flushFrame();
    expect(unit("knowledge").dataset.ragEntranceState).toBe("pending");
    expect(unit("task").dataset.ragEntranceState).toBe("pending");
    expect(vi.getTimerCount()).toBe(0);
    rects.task.top = 400;
    intersect([["task", true]]);
    flushFrame();
    expect(unit("task").dataset.ragEntranceState).toBe("playing");
    expect(unit("task").style.getPropertyValue("--rag-entrance-delay")).toBe("0ms");
    act(() => vi.advanceTimersByTime(600));
    expect(isReady("task")).toBe(true);
    intersect([["task", false], ["task", true]]);
    expect(frames.size).toBe(0);
  });

  it("uses the card's own animation end or cancellation and ignores nested or unrelated animations", () => {
    render(<Harness />);
    intersect([["knowledge", true], ["quality", true]]);
    flushFrame();
    animationFinish(unit("knowledge"), "animationend", "other-animation");
    animationFinish(unit("knowledge").querySelector("button")!);
    expect(isReady("knowledge")).toBe(false);
    animationFinish(unit("knowledge"));
    expect(isReady("knowledge")).toBe(true);
    animationFinish(unit("quality"), "animationcancel");
    expect(isReady("quality")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("immediately exposes a focused pending card and does not animate it afterward", () => {
    render(<Harness />);
    intersect([["knowledge", true]]);
    fireEvent.focusIn(unit("knowledge").querySelector("button")!);
    expect(isReady("knowledge")).toBe(true);
    expect(unit("knowledge").dataset.ragEntranceState).toBe("complete");
    flushFrame();
    expect(unit("knowledge").dataset.ragEntranceState).toBe("complete");
    expect(vi.getTimerCount()).toBe(0);
    expect(observers[0].unobserve).toHaveBeenCalledWith(unit("knowledge"));
  });

  it("shows newly arriving urgent notices immediately without replaying other cards", () => {
    const page = render(<Harness />);
    intersect([["knowledge", true]]);
    flushFrame();
    page.rerender(<Harness urgent="quality" />);
    expect(isReady("quality")).toBe(true);
    expect(unit("quality").dataset.ragEntranceState).toBe("complete");
    expect(unit("knowledge").dataset.ragEntranceState).toBe("playing");
    expect(isReady("task")).toBe(false);
    expect(observers).toHaveLength(1);
    page.rerender(<Harness />);
    expect(isReady("quality")).toBe(true);
  });

  it.each(["IntersectionObserver", "matchMedia", "requestAnimationFrame", "cancelAnimationFrame"])("shows all content directly when %s is unavailable", missing => {
    vi.stubGlobal(missing, undefined);
    render(<Harness />);
    for (const id of ["knowledge", "quality", "chat", "task"] as const) {
      expect(isReady(id)).toBe(true);
      expect(unit(id).dataset.ragEntranceState).toBe("complete");
    }
    expect(observers).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors initial and newly enabled reduced motion without replaying when it is relaxed", () => {
    reducedMotion = true;
    const page = render(<Harness />);
    expect(isReady("task")).toBe(true);
    expect(observers).toHaveLength(0);
    reducedMotion = false;
    page.rerender(<Harness scope="next" />);
    intersect([["knowledge", true]]);
    expect(frames.size).toBe(1);
    motion(true);
    expect(frames.size).toBe(0);
    expect(isReady("knowledge")).toBe(true);
    expect(isReady("task")).toBe(true);
    motion(false);
    intersect([["knowledge", true], ["task", true]]);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps completion across ordinary renders and restarts only when the workspace scope changes", () => {
    const page = render(<Harness />);
    animationFinish(unit("knowledge"));
    expect(isReady("knowledge")).toBe(true);
    page.rerender(<Harness revision={1} />);
    expect(isReady("knowledge")).toBe(true);
    expect(observers).toHaveLength(1);
    const previous = observers[0];
    page.rerender(<Harness scope="different-workspace" revision={2} />);
    expect(isReady("knowledge")).toBe(false);
    expect(unit("knowledge").dataset.ragEntranceState).toBe("pending");
    expect(observers).toHaveLength(2);
    expect(previous.disconnect).toHaveBeenCalled();
    intersect([["knowledge", true]], previous);
    expect(frames.size).toBe(0);
    intersect([["knowledge", true]]);
    flushFrame();
    act(() => vi.advanceTimersByTime(600));
    expect(isReady("knowledge")).toBe(true);
  });

  it("cleans listeners, observers, timers and queued work on unmount, including stale callbacks", () => {
    const page = render(<Harness />);
    intersect([["knowledge", true]]);
    flushFrame();
    intersect([["quality", true]]);
    const staleFrame = [...frames.values()][0];
    const knowledge = unit("knowledge");
    const quality = unit("quality");
    const previousObserver = observers[0];
    page.unmount();
    expect(previousObserver.disconnect).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(mediaListeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(knowledge.dataset.ragEntranceState).toBeUndefined();
    act(() => {
      previousObserver.callback([{ target: quality, isIntersecting: true } as unknown as IntersectionObserverEntry], previousObserver as unknown as IntersectionObserver);
      staleFrame(1000);
    });
    expect(quality.dataset.ragEntranceState).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
