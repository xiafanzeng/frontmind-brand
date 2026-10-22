import {describe, expect, it} from "vitest";
import {knowledgeDiff} from "../client/dashboard/knowledge-diff";

describe("knowledge snapshot comparison", () => {
  it.each([
    ["标题\n原正文\n结尾", "标题\n新正文\n结尾"],
    ["重复\n旧段\n重复", "重复\n重复\n新增"],
    ["", "新节点\n"],
    ["删除全部", ""],
    ["未修改\n", "未修改\n"],
  ])("reconstructs both recorded snapshots: %s", (before, after) => {
    const diff = knowledgeDiff(before, after);
    expect(diff.filter(line => line.kind !== "add").map(line => line.text).join("\n")).toBe(before);
    expect(diff.filter(line => line.kind !== "remove").map(line => line.text).join("\n")).toBe(after);
  });
  it("marks only changed lines between shared context", () => {
    expect(knowledgeDiff("标题\n原正文\n结尾", "标题\n新正文\n结尾")).toEqual([
      {kind: "same", text: "标题"}, {kind: "remove", text: "原正文"}, {kind: "add", text: "新正文"}, {kind: "same", text: "结尾"},
    ]);
  });
  it("keeps large disjoint documents intact while bounding matching work", () => {
    const before = Array.from({length: 1100}, (_, i) => `旧${i}`).join("\n");
    const after = Array.from({length: 1100}, (_, i) => `新${i}`).join("\n");
    const diff = knowledgeDiff(before, after);
    expect(diff.filter(line => line.kind === "remove").map(line => line.text).join("\n")).toBe(before);
    expect(diff.filter(line => line.kind === "add").map(line => line.text).join("\n")).toBe(after);
  });
});
