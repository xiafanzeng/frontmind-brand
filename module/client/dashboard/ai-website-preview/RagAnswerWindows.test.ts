import { describe, expect, it } from "vitest";
import { constrainAnswerWindow, resizeAnswerWindow } from "./RagAnswerWindows";

describe("answer window geometry", () => {
  const viewport = { width: 1440, height: 1000 };

  it("keeps the complete frame reachable within the viewport after resizing the browser", () => {
    expect(constrainAnswerWindow({ x: -80, y: 900, width: 1800, height: 1200 }, viewport))
      .toEqual({ x: 16, y: 16, width: 1408, height: 968 });
    const narrow = constrainAnswerWindow({ x: 1200, y: 750, width: 600, height: 700 }, { width: 768, height: 500 });
    expect(narrow.x + narrow.width).toBeLessThanOrEqual(752);
    expect(narrow.y + narrow.height).toBeLessThanOrEqual(484);
  });

  it("enforces usable minimum sizes while allowing unusually short viewports", () => {
    expect(constrainAnswerWindow({ x: 30, y: 30, width: 10, height: 10 }, viewport))
      .toEqual({ x: 30, y: 30, width: 360, height: 320 });
    expect(constrainAnswerWindow({ x: 0, y: 0, width: 360, height: 320 }, { width: 300, height: 260 }))
      .toEqual({ x: 16, y: 16, width: 268, height: 228 });
  });

  it("keeps the opposite corner fixed when pulling a north-west edge", () => {
    const rect = { x: 200, y: 180, width: 640, height: 500 };
    const next = resizeAnswerWindow(rect, "nw", -80, -64, viewport);
    expect(next).toEqual({ x: 120, y: 116, width: 720, height: 564 });
    expect(next.x + next.width).toBe(rect.x + rect.width);
    expect(next.y + next.height).toBe(rect.y + rect.height);
  });

  it("stops each resize edge at the viewport and minimum dimensions", () => {
    const rect = { x: 200, y: 180, width: 640, height: 500 };
    const large = resizeAnswerWindow(rect, "se", 2000, 2000, viewport);
    expect(large).toEqual({ x: 200, y: 180, width: 1224, height: 804 });
    const small = resizeAnswerWindow(rect, "nw", 2000, 2000, viewport);
    expect(small).toEqual({ x: 480, y: 360, width: 360, height: 320 });
    const left = resizeAnswerWindow(rect, "w", -2000, 0, viewport);
    expect(left.x).toBe(16);
    expect(left.x + left.width).toBe(840);
  });
});
