// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RagTaskChecklist } from "./RagTaskChecklist";
import { RagEntranceReadyContext } from "./RagEntranceContext";

const points = [
  { id: "first", label: "拒绝无依据的两周保证", met: true },
  { id: "second", label: "给出补料与负责人确认路径", met: true },
];

let observers: TestIntersectionObserver[];
let reducedMotion: boolean;

class TestIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(readonly callback: IntersectionObserverCallback) { observers.push(this); }
}

function intersect(observer: TestIntersectionObserver, target: Element, visible: boolean) {
  act(() => observer.callback(
    [{ target, isIntersecting: visible } as IntersectionObserverEntry],
    observer as unknown as IntersectionObserver,
  ));
}

beforeEach(() => {
  observers = [];
  reducedMotion = false;
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reducedMotion })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("customer task checklist reveal", () => {
  it("waits for its card before observing and keeps the same reveal on unrelated renders", () => {
    const page = render(<RagEntranceReadyContext value={false}><RagTaskChecklist points={points} /></RagEntranceReadyContext>);
    const list = screen.getByRole("list");
    expect(list.dataset.reveal).toBe("pending");
    expect(observers).toHaveLength(0);
    page.rerender(<RagEntranceReadyContext value><RagTaskChecklist points={points} /></RagEntranceReadyContext>);
    expect(observers).toHaveLength(1);
    expect(list.dataset.reveal).toBe("pending");
    intersect(observers[0], list, true);
    expect(list.dataset.reveal).toBe("playing");
    page.rerender(<RagEntranceReadyContext value><RagTaskChecklist points={[...points]} /></RagEntranceReadyContext>);
    expect(list.dataset.reveal).toBe("playing");
    expect(observers).toHaveLength(1);
  });

  it("shows reduced-motion content immediately even while the card is not ready", () => {
    reducedMotion = true;
    render(<RagEntranceReadyContext value={false}><RagTaskChecklist points={points} /></RagEntranceReadyContext>);
    expect(screen.getByRole("list").dataset.reveal).toBe("static");
    expect(observers).toHaveLength(0);
  });

  it("reveals the ordered items when the list first enters the viewport", () => {
    render(<RagTaskChecklist points={points} />);
    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    const observer = observers[0];
    expect(within(items[0]).getByText("拒绝无依据的两周保证")).toBeTruthy();
    expect(within(items[0]).getByText("已满足")).toBeTruthy();
    expect(within(items[1]).getByText("给出补料与负责人确认路径")).toBeTruthy();
    expect(within(items[1]).getByText("已满足")).toBeTruthy();
    expect(observer.observe).toHaveBeenCalledWith(list);
    expect(list.dataset.reveal).toBe("pending");
    intersect(observer, list, false);
    expect(list.dataset.reveal).toBe("pending");
    intersect(observer, list, true);
    expect(list.dataset.reveal).toBe("playing");
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    intersect(observer, list, false);
    intersect(observer, list, true);
    expect(list.dataset.reveal).toBe("playing");
  });

  it("presents each outcome alongside its task with a readable status", () => {
    reducedMotion = true;
    render(<RagTaskChecklist points={[
      { id: "met", label: "满足的任务", met: true },
      { id: "miss", label: "未满足的任务", met: false },
      { id: "unknown", label: "待确认的任务", met: null },
    ]} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    for (const [index, label, status] of [
      [0, "满足的任务", "已满足"],
      [1, "未满足的任务", "未满足"],
      [2, "待确认的任务", "待确认"],
    ] as const) {
      expect(within(items[index]).getByText(label)).toBeTruthy();
      const statusText = within(items[index]).getByText(status);
      expect(statusText.closest('[aria-hidden="true"]')).toBeNull();
      expect(within(items[index]).queryByRole("button")).toBeNull();
    }
  });

  it("shows the list immediately when reduced motion is requested", () => {
    reducedMotion = true;
    render(<RagTaskChecklist points={points} />);
    expect(screen.getByRole("list").dataset.reveal).toBe("static");
    expect(observers).toHaveLength(0);
  });

  it.each(["matchMedia", "IntersectionObserver"])("shows the list immediately without %s", (missing) => {
    vi.stubGlobal(missing, undefined);
    render(<RagTaskChecklist points={points} />);
    expect(screen.getByRole("list").dataset.reveal).toBe("static");
    expect(observers).toHaveLength(0);
  });

  it("disconnects its observer when unmounted and observes a new list on remount", () => {
    const page = render(<RagTaskChecklist key="first" points={points} />);
    const original = screen.getByRole("list");
    const previousObserver = observers[0];
    intersect(previousObserver, original, true);
    page.rerender(<RagTaskChecklist key="next" points={[{ id: "next", label: "确认部署支持与部署要求", met: null }]} />);
    const next = screen.getByRole("list");
    expect(next).not.toBe(original);
    expect(next.dataset.reveal).toBe("pending");
    expect(observers[1].observe).toHaveBeenCalledWith(next);
    expect(within(next).getByText("确认部署支持与部署要求")).toBeTruthy();
    page.unmount();
    expect(observers[1].disconnect).toHaveBeenCalledTimes(1);
  });
});
