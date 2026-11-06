// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDataReveal } from "./useDataReveal";
import { RagEntranceReadyContext } from "./RagEntranceContext";
import { RagEvaluationGauge, ragGaugePoint } from "./RagEvaluationGauge";

let frameId: number;
let frames: Map<number, FrameRequestCallback>;
let mediaMatches: boolean;
let mediaListeners: Set<(event: MediaQueryListEvent) => void>;
let observers: TestIntersectionObserver[];
let latestFinish: () => void;
const addMediaListener = vi.fn();
const removeMediaListener = vi.fn();

class TestIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(readonly callback: IntersectionObserverCallback) { observers.push(this); }
}

function Harness({ enabled = true, replayKey = "first", width = 152, duration, easing, ready = true }: {
  enabled?: boolean; replayKey?: string; width?: number; duration?: number; easing?: "ease-out" | "linear"; ready?: boolean;
}) {
  const { ref, progress, finish } = useDataReveal<HTMLOutputElement>(enabled, replayKey, duration, easing, ready);
  latestFinish = finish;
  return <><output ref={ref} data-testid="progress" style={{ width }}>{progress}</output><button onClick={finish}>Finish</button></>;
}

// The same generic contract must also assign directly to a section's ref.
function SectionHarness() {
  const { ref, progress } = useDataReveal<HTMLElement>(false, "section");
  return <section ref={ref} data-testid="progress">{progress}</section>;
}

const progress = () => Number(screen.getByTestId("progress").textContent);
function intersect(observer: TestIntersectionObserver, visible: boolean) {
  act(() => observer.callback([
    { target: screen.getByTestId("progress"), isIntersecting: visible } as unknown as IntersectionObserverEntry,
  ], observer as unknown as IntersectionObserver));
}
function frame(timestamp: number) {
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(timestamp));
  });
}
function motion(matches: boolean) {
  mediaMatches = matches;
  act(() => mediaListeners.forEach(listener => listener({ matches } as MediaQueryListEvent)));
}

beforeEach(() => {
  frameId = 0;
  frames = new Map();
  observers = [];
  mediaMatches = false;
  mediaListeners = new Set();
  addMediaListener.mockReset().mockImplementation((_type, listener) => mediaListeners.add(listener));
  removeMediaListener.mockReset().mockImplementation((_type, listener) => mediaListeners.delete(listener));
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches() { return mediaMatches; },
    addEventListener: addMediaListener,
    removeEventListener: removeMediaListener,
  })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("one-time visible data reveal", () => {
  it("keeps the purple gauge marker visible at zero while its page card is entering", () => {
    render(<RagEntranceReadyContext value={false}><RagEvaluationGauge score={67} /></RagEntranceReadyContext>);
    const marker = screen.getByTestId("rag-gauge-marker");
    const origin = ragGaugePoint(0);
    expect(screen.getByTestId("rag-gauge-value").textContent).toBe("0");
    expect(marker.getAttribute("cx")).toBe(String(origin.x));
    expect(marker.getAttribute("cy")).toBe(String(origin.y));
    expect(Number(marker.getAttribute("opacity") ?? 1)).toBe(1);
    expect(observers).toHaveLength(0);
    expect(frames.size).toBe(0);
  });

  it("holds valid data at zero without observing until its containing card is ready", () => {
    const page = render(<Harness ready={false} />);
    expect(progress()).toBe(0);
    expect(observers).toHaveLength(0);
    expect(frames.size).toBe(0);
    page.rerender(<Harness ready={false} replayKey="latest" />);
    expect(progress()).toBe(0);
    expect(observers).toHaveLength(0);
    page.rerender(<Harness ready replayKey="latest" />);
    expect(progress()).toBe(0);
    expect(observers).toHaveLength(1);
    intersect(observers[0], true);
    frame(0);
    frame(400);
    expect(progress()).toBe(0.875);
    page.rerender(<Harness ready replayKey="latest" width={200} />);
    expect(progress()).toBe(0.875);
    frame(800);
    expect(progress()).toBe(1);
  });

  it("respects disabled and reduced-motion states while the card is not ready", () => {
    const page = render(<Harness enabled={false} ready={false} />);
    expect(progress()).toBe(1);
    page.rerender(<Harness ready={false} />);
    expect(progress()).toBe(0);
    motion(true);
    expect(progress()).toBe(1);
    page.rerender(<Harness ready />);
    expect(progress()).toBe(1);
    expect(observers).toHaveLength(0);
    expect(frames.size).toBe(0);
  });

  it("waits for the card even without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const page = render(<Harness ready={false} />);
    expect(progress()).toBe(0);
    expect(frames.size).toBe(0);
    page.rerender(<Harness ready />);
    expect(progress()).toBe(0);
    expect(frames.size).toBe(1);
    frame(0);
    frame(800);
    expect(progress()).toBe(1);
  });

  it("allows a longer linear reveal without changing the default gauge timing", () => {
    render(<Harness duration={1600} easing="linear" />);
    intersect(observers[0], true);
    frame(1000);
    frame(1800);
    expect(progress()).toBe(0.5);
    frame(2600);
    expect(progress()).toBe(1);
  });

  it("shows a longer linear reveal immediately when reduced motion is enabled", () => {
    mediaMatches = true;
    render(<Harness duration={1600} easing="linear" />);
    expect(progress()).toBe(1);
    expect(observers).toHaveLength(0);
    expect(frames.size).toBe(0);
  });

  it("waits offscreen, eases to the final value over 800ms, and ignores repeated entry and layout renders", () => {
    const page = render(<Harness />);
    const observer = observers[0];
    expect(observer.observe).toHaveBeenCalledWith(screen.getByTestId("progress"));
    expect(progress()).toBe(0);
    intersect(observer, false);
    expect(frames.size).toBe(0);
    intersect(observer, true);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);
    frame(1_000);
    frame(1_400);
    expect(progress()).toBe(0.875);

    const finish = latestFinish;
    page.rerender(<Harness width={200} />);
    expect(latestFinish).toBe(finish);
    expect(progress()).toBe(0.875);
    expect(observers).toHaveLength(1);
    frame(1_800);
    expect(progress()).toBe(1);
    expect(frames.size).toBe(0);
    intersect(observer, false);
    intersect(observer, true);
    page.rerender(<Harness width={136} />);
    expect(progress()).toBe(1);
    expect(frames.size).toBe(0);
    expect(observers).toHaveLength(1);
  });

  it("starts immediately without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Harness />);
    expect(progress()).toBe(0);
    expect(frames.size).toBe(1);
    frame(0);
    frame(800);
    expect(progress()).toBe(1);
  });

  it("replays new data keys and newly enabled values while cancelling the previous revision", () => {
    const page = render(<Harness />);
    const first = observers[0];
    intersect(first, true);
    frame(0);
    frame(400);
    const staleTick = [...frames.values()][0];
    page.rerender(<Harness replayKey="second" />);
    expect(progress()).toBe(0);
    expect(frames.size).toBe(0);
    act(() => staleTick(800));
    intersect(first, true);
    expect(progress()).toBe(0);
    expect(frames.size).toBe(0);
    intersect(observers[1], true);
    expect(frames.size).toBe(1);

    page.rerender(<Harness enabled={false} replayKey="second" />);
    expect(progress()).toBe(1);
    expect(frames.size).toBe(0);
    page.rerender(<Harness enabled={false} replayKey="third" />);
    expect(progress()).toBe(1);
    expect(observers).toHaveLength(2);
    page.rerender(<Harness replayKey="third" />);
    expect(progress()).toBe(0);
    expect(observers).toHaveLength(3);
    intersect(observers[2], true);
    frame(1_000);
    frame(1_800);
    expect(progress()).toBe(1);
  });

  it("renders the final value when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<Harness />);
    expect(progress()).toBe(1);
    expect(observers).toHaveLength(0);
    expect(frames.size).toBe(0);
  });

  it("renders disabled section content immediately without observing or animating", () => {
    render(<SectionHarness />);
    expect(screen.getByTestId("progress").tagName).toBe("SECTION");
    expect(progress()).toBe(1);
    expect(observers).toHaveLength(0);
    expect(frames.size).toBe(0);
  });

  it("honors initial reduced motion without replaying when the preference is relaxed", () => {
    mediaMatches = true;
    const page = render(<Harness />);
    expect(progress()).toBe(1);
    expect(observers).toHaveLength(0);
    motion(false);
    expect(progress()).toBe(1);
    expect(frames.size).toBe(0);
    page.rerender(<Harness replayKey="new-data" />);
    expect(progress()).toBe(0);
    const observer = observers[0];
    motion(true);
    expect(progress()).toBe(1);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    intersect(observer, true);
    expect(frames.size).toBe(0);
  });

  it("finishes an in-flight reveal immediately when reduced motion is enabled", () => {
    render(<Harness />);
    intersect(observers[0], true);
    frame(0);
    frame(400);
    const staleTick = [...frames.values()][0];
    expect(progress()).toBe(0.875);
    motion(true);
    expect(progress()).toBe(1);
    expect(frames.size).toBe(0);
    act(() => staleTick(800));
    motion(false);
    expect(progress()).toBe(1);
    expect(frames.size).toBe(0);
  });

  it("lets interaction finish both an offscreen and an active reveal immediately", () => {
    const page = render(<Harness />);
    const observer = observers[0];
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(progress()).toBe(1);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    intersect(observer, true);
    expect(frames.size).toBe(0);

    page.rerender(<Harness replayKey="next" />);
    intersect(observers[1], true);
    frame(0);
    frame(400);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(progress()).toBe(1);
    expect(frames.size).toBe(0);
  });

  it.each([false, true])("cleans observers, media listeners and queued frames on unmount (playing: %s)", (playing) => {
    const page = render(<Harness />);
    const element = screen.getByTestId("progress");
    const observer = observers[0];
    if (playing) { intersect(observer, true); frame(0); }
    const staleTick = [...frames.values()][0];
    const finish = latestFinish;
    page.unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(removeMediaListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(mediaListeners.size).toBe(0);
    expect(frames.size).toBe(0);
    if (playing) expect(window.cancelAnimationFrame).toHaveBeenCalled();
    act(() => {
      staleTick?.(800);
      observer.callback([{ target: element, isIntersecting: true } as unknown as IntersectionObserverEntry], observer as unknown as IntersectionObserver);
      finish();
    });
    expect(frames.size).toBe(0);
  });

  it("supports and removes the legacy media-query listener API", () => {
    const addListener = vi.fn((listener) => mediaListeners.add(listener));
    const removeListener = vi.fn((listener) => mediaListeners.delete(listener));
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener, removeListener })));
    const page = render(<Harness />);
    expect(addListener).toHaveBeenCalledTimes(1);
    motion(true);
    expect(progress()).toBe(1);
    page.unmount();
    expect(removeListener).toHaveBeenCalledWith(addListener.mock.calls[0][0]);
    expect(mediaListeners.size).toBe(0);
  });
});
