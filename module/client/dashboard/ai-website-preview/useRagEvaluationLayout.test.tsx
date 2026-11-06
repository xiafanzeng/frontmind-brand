import { type CSSProperties } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRagEvaluationLayout } from "./useRagEvaluationLayout";

type Geometry = { width: number; height: number; wrapBodyBelow: number; visibleBodyLines: number };
let geometry: Geometry;
let measurements: number[];
let observers: TestResizeObserver[];
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let resolveFontsReady: () => void;
let fonts: EventTarget & { ready: Promise<void> };
let fontsDescriptor: PropertyDescriptor | undefined;
const requestFrame = vi.fn<(callback: FrameRequestCallback) => number>();
const cancelFrame = vi.fn<(id: number) => void>();

class TestResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
  emit() { this.callback([], this as unknown as ResizeObserver); }
}

function rect(width: number, height: number): DOMRect {
  return { x: 0, y: 0, width, height, top: 0, right: width, bottom: height, left: 0, toJSON: () => ({}) };
}

function Layout({ bodyLines = 2, metaLines = 1, overviewStyle }: { bodyLines?: number; metaLines?: number; overviewStyle?: CSSProperties }) {
  const { overviewRef, stacked, summaryTwoLines } = useRagEvaluationLayout(`${bodyLines}:${metaLines}`);
  return (
    <div ref={overviewRef} className="rag-evaluation-overview" data-testid="layout"
      data-layout={stacked ? "stacked" : "side-by-side"}
      data-two-lines={summaryTwoLines}
      style={{ "--rag-evaluation-card-width": "136px", columnGap: "16px", ...overviewStyle } as CSSProperties}>
      <div className="rag-evaluation-gauge-card" />
      <section className="rag-verdict">
        <p className="rag-evaluation-summary-copy" data-lines={bodyLines} style={{ lineHeight: "21px" }}>摘要 {bodyLines}</p>
        <span className="rag-evaluation-metric-copy" data-lines={metaLines} style={{ lineHeight: "18px" }}>风险与覆盖 {metaLines}</span>
      </section>
    </div>
  );
}

function flushFrames() {
  act(() => {
    const pending = Array.from(frames.values());
    frames.clear();
    for (const callback of pending) callback(0);
  });
}

function layout() { return screen.getByTestId("layout").getAttribute("data-layout"); }
function twoLines() { return screen.getByTestId("layout").getAttribute("data-two-lines"); }

beforeEach(() => {
  geometry = { width: 600, height: 136, wrapBodyBelow: 0, visibleBodyLines: 1 };
  measurements = [];
  observers = [];
  frames = new Map();
  nextFrame = 0;
  requestFrame.mockReset().mockImplementation((callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  cancelFrame.mockReset().mockImplementation((id) => { frames.delete(id); });
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  fontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");
  fonts = Object.assign(new EventTarget(), {
    ready: new Promise<void>((resolve) => { resolveFontsReady = resolve; }),
  });
  Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
  // jsdom has no layout engine. Supply independent visible line-box geometry;
  // the hidden candidate always retains its hypothetical side-by-side width.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("rag-evaluation-overview")) return rect(geometry.width, geometry.height);
    const probe = this.closest<HTMLElement>('.rag-verdict[aria-hidden="true"]');
    const width = probe ? parseFloat(probe.style.width) : geometry.width;
    if (this.classList.contains("rag-evaluation-summary-copy")) {
      if (!probe) return rect(width, geometry.visibleBodyLines * 21);
      measurements.push(width);
      const lines = width < geometry.wrapBodyBelow ? 3 : Number(this.dataset.lines);
      return rect(width, lines * 21);
    }
    if (this.classList.contains("rag-evaluation-metric-copy")) {
      const lines = probe ? Number(this.dataset.lines) : 1;
      return rect(width, lines * 18 + (lines - 1) * 8);
    }
    return rect(0, 0);
  });
});

afterEach(() => {
  cleanup();
  if (fontsDescriptor) Object.defineProperty(document, "fonts", fontsDescriptor);
  else Reflect.deleteProperty(document, "fonts");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("content-aware RAG evaluation layout", () => {
  it.each([
    { bodyLines: 2, metaLines: 1, expected: "side-by-side" },
    { bodyLines: 3, metaLines: 1, expected: "stacked" },
    { bodyLines: 2, metaLines: 2, expected: "stacked" },
    { bodyLines: 3, metaLines: 2, expected: "stacked" },
  ])("uses $expected for $bodyLines body lines and $metaLines metadata lines", ({ expected, ...props }) => {
    render(<Layout {...props} />);
    expect(layout()).toBe(expected);
    expect(measurements).toEqual([448]);
    expect(document.querySelector('.rag-verdict[aria-hidden="true"]')).toBeNull();
    const overview = screen.getByTestId("layout");
    expect(overview.style.getPropertyValue("--rag-evaluation-card-width")).toBe("136px");
    expect(overview.style.getPropertyValue("--rag-evaluation-card-height")).toBe("");
  });

  it.each([
    { visibleLines: 1, expected: "false" },
    { visibleLines: 2, expected: "true" },
    { visibleLines: 3, expected: "false" },
  ])("enables compact metadata spacing only for exactly two visible lines ($visibleLines)", ({ visibleLines, expected }) => {
    geometry.visibleBodyLines = visibleLines;
    render(<Layout bodyLines={visibleLines} />);
    expect(twoLines()).toBe(expected);
    const overview = screen.getByTestId("layout");
    const visibleCopy = overview.querySelector(".rag-evaluation-summary-copy");
    expect(observers[0].observe).toHaveBeenCalledTimes(2);
    expect(observers[0].observe).toHaveBeenCalledWith(overview);
    expect(observers[0].observe).toHaveBeenCalledWith(visibleCopy);
  });

  it("uses actual visible lines while stacked and ignores height changes caused by the spacing update", () => {
    geometry.width = 500;
    geometry.wrapBodyBelow = 360;
    render(<Layout />);
    expect(layout()).toBe("stacked");
    expect(twoLines()).toBe("false");

    geometry.visibleBodyLines = 2;
    act(() => {
      observers[0].emit();
      observers[0].emit();
      observers[0].emit();
    });
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);
    flushFrames();
    expect(twoLines()).toBe("true");
    expect(layout()).toBe("stacked");
    expect(measurements).toEqual([348, 348]);

    // Changing the gap may resize the card, but the paragraph is still two
    // lines. Repeated observer callbacks must not schedule another pass.
    for (const height of [248, 240, 248]) {
      geometry.height = height;
      act(() => observers[0].emit());
    }
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(measurements).toEqual([348, 348]);

    geometry.visibleBodyLines = 3;
    act(() => observers[0].emit());
    flushFrames();
    expect(twoLines()).toBe("false");
    expect(layout()).toBe("stacked");
    expect(measurements).toEqual([348, 348, 348]);
    act(() => observers[0].emit());
    expect(frames.size).toBe(0);
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });

  it("rechecks content changes at the same width and restores side-by-side only when both limits fit", () => {
    const page = render(<Layout />);
    expect(layout()).toBe("side-by-side");
    page.rerender(<Layout bodyLines={3} />);
    expect(layout()).toBe("stacked");
    page.rerender(<Layout bodyLines={2} metaLines={2} />);
    expect(layout()).toBe("stacked");
    page.rerender(<Layout bodyLines={2} metaLines={1} />);
    expect(layout()).toBe("side-by-side");
    expect(measurements).toEqual([448, 448, 448, 448]);
  });

  it("subtracts both borders and padding before deciding whether the summary fits", () => {
    geometry.wrapBodyBelow = 430;
    render(<Layout overviewStyle={{
      borderLeft: "0.5px solid black", borderRight: "1.5px solid black",
      paddingLeft: "8px", paddingRight: "16px",
    }} />);
    // The outer 600px includes 26px of borders and padding: the candidate is
    // 422px, which wraps, rather than the incorrectly unadjusted 448px.
    expect(measurements).toEqual([422]);
    expect(layout()).toBe("stacked");

    geometry.width = 626;
    act(() => observers[0].emit());
    flushFrames();
    expect(measurements).toEqual([422, 448]);
    expect(layout()).toBe("side-by-side");
    expect(document.querySelector('.rag-verdict[aria-hidden="true"]')).toBeNull();
  });

  it("preserves a zero column gap when measuring and restoring the side-by-side layout", () => {
    geometry.wrapBodyBelow = 456;
    render(<Layout overviewStyle={{ columnGap: "0px" }} />);
    // With no gap the candidate is 464px and fits. Substituting the 16px
    // fallback would incorrectly measure 448px and force stacking.
    expect(measurements).toEqual([464]);
    expect(layout()).toBe("side-by-side");

    geometry.width = 584;
    act(() => observers[0].emit());
    flushFrames();
    expect(layout()).toBe("stacked");

    geometry.width = 600;
    act(() => observers[0].emit());
    flushFrames();
    expect(measurements).toEqual([464, 448, 464]);
    expect(layout()).toBe("side-by-side");
  });

  it("ignores stacked height changes and keeps measuring the hypothetical side-by-side width", () => {
    geometry.width = 500;
    geometry.wrapBodyBelow = 360;
    render(<Layout />);
    expect(layout()).toBe("stacked");
    expect(measurements).toEqual([348]);

    for (const height of [220, 300, 240]) {
      geometry.height = height;
      act(() => observers[0].emit());
    }
    expect(requestFrame).not.toHaveBeenCalled();
    expect(measurements).toEqual([348]);
    expect(layout()).toBe("stacked");

    act(() => window.dispatchEvent(new Event("resize")));
    flushFrames();
    expect(measurements).toEqual([348, 348]);
    expect(layout()).toBe("stacked");

    geometry.width = 700;
    act(() => observers[0].emit());
    flushFrames();
    expect(measurements).toEqual([348, 348, 548]);
    expect(layout()).toBe("side-by-side");
  });

  it("remeasures after fonts become ready and removes every probe", async () => {
    render(<Layout />);
    geometry.wrapBodyBelow = 500;
    await act(async () => { resolveFontsReady(); await Promise.resolve(); });
    flushFrames();
    expect(layout()).toBe("stacked");

    geometry.wrapBodyBelow = 0;
    act(() => fonts.dispatchEvent(new Event("loadingdone")));
    flushFrames();
    expect(layout()).toBe("side-by-side");
    expect(document.querySelector('.rag-verdict[aria-hidden="true"]')).toBeNull();
  });

  it("cancels pending frames and stops observing resize or font events after unmount", async () => {
    const removeFontListener = vi.spyOn(fonts, "removeEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const page = render(<Layout />);
    geometry.width = 500;
    act(() => observers[0].emit());
    expect(frames.size).toBe(1);
    page.unmount();
    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(removeFontListener).toHaveBeenCalledWith("loadingdone", expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith("resize", expect.any(Function));

    const scheduledBefore = requestFrame.mock.calls.length;
    await act(async () => {
      resolveFontsReady();
      await Promise.resolve();
      window.dispatchEvent(new Event("resize"));
      fonts.dispatchEvent(new Event("loadingdone"));
      observers[0].emit();
    });
    expect(requestFrame).toHaveBeenCalledTimes(scheduledBefore);
    expect(document.querySelector('.rag-verdict[aria-hidden="true"]')).toBeNull();
  });
});
