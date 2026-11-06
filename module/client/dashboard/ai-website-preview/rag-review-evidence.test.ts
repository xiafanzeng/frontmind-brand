import { describe, expect, it } from "vitest";
import { buildReviewEvidenceOptions } from "./rag-review-evidence";

describe("manual review evidence candidates", () => {
  it("offers actual answer paragraphs without requiring a report or a source", () => {
    const answer = "  第一段原文。  \n仍属于第一段。\r\n\t\r\n第二段原文。\n\n\n第三段。";
    const options = buildReviewEvidenceOptions({ answer });
    expect(options).toEqual([
      { value: "  第一段原文。  \n仍属于第一段。", label: "回答原文 · 第 1 段", description: "  第一段原文。  \n仍属于第一段。", group: "answer" },
      { value: "第二段原文。", label: "回答原文 · 第 2 段", description: "第二段原文。", group: "answer" },
      { value: "第三段。", label: "回答原文 · 第 3 段", description: "第三段。", group: "answer" },
    ]);
    expect(buildReviewEvidenceOptions({ answer: " \n\t " })).toEqual([]);
  });

  it("keeps source and claim IDs with only their actual available descriptions", () => {
    const options = buildReviewEvidenceOptions({
      answer: "当前回答。",
      answerId: "answer-1",
      claims: [{ id: "claim-1", statement: "支持私有化部署。" }],
      sources: [
        { id: "live-source", title: "部署手册.pdf", kind: "published_knowledge" },
        { id: "attachment", title: "用户附件.docx", kind: "user_attachment" },
        { id: "sample-source", title: "合成资料", section: "公开演示", excerpt: "实际提供的合成摘录。" },
        { id: "metadata-only", title: "仅有名称" },
      ],
    });
    expect(options[0]).toEqual({ value: "answer:answer-1", label: "本轮完整回答", description: "当前回答。", group: "answer" });
    expect(options.find(option => option.value === "claim-1")).toEqual({ value: "claim-1", label: "支持私有化部署。", description: "claim-1", group: "claim" });
    expect(options.filter(option => option.group === "source")).toEqual([
      { value: "live-source", label: "部署手册.pdf", description: "已发布知识资料", group: "source" },
      { value: "attachment", label: "用户附件.docx", description: "本轮用户附件", group: "source" },
      { value: "sample-source", label: "合成资料", description: "公开演示\n实际提供的合成摘录。", group: "source" },
      { value: "metadata-only", label: "仅有名称", description: undefined, group: "source" },
    ]);
    expect(JSON.stringify(options)).not.toContain("已核验");
  });

  it("retains arbitrary old locators verbatim, including significant spaces and case", () => {
    const selectedValues = ["  手写原句，保留空格。 ", "Unknown-ID", "unknown-id", "  ", "Unknown-ID", "answer-1"];
    const options = buildReviewEvidenceOptions({ answer: "实际回答。", answerId: "answer-1", selectedValues });
    expect(options.filter(option => option.group === "existing")).toEqual([
      { value: "  手写原句，保留空格。 ", label: "  手写原句，保留空格。 ", description: "已有证据定位", group: "existing" },
      { value: "Unknown-ID", label: "Unknown-ID", description: "已有证据定位", group: "existing" },
      { value: "unknown-id", label: "unknown-id", description: "已有证据定位", group: "existing" },
      { value: "answer-1", label: "本轮完整回答（已有定位）", description: "实际回答。", group: "existing" },
    ]);
    expect(selectedValues).toEqual(["  手写原句，保留空格。 ", "Unknown-ID", "unknown-id", "  ", "Unknown-ID", "answer-1"]);
  });

  it("deduplicates only exact values and preserves candidate order without selecting evidence", () => {
    const input = {
      answer: "实际回答。\n\n实际回答。",
      claims: [{ id: "shared-id", statement: "原始陈述" }, { id: "shared-id", statement: "重复 ID 的另一说明" }],
      sources: [{ id: "shared-id", title: "同 ID 资料" }, { id: "Shared-ID", title: "大小写不同的资料" }],
      selectedValues: ["shared-id", "旧引用", "旧引用"],
    };
    const before = JSON.stringify(input);
    const options = buildReviewEvidenceOptions(input);
    expect(options.map(option => option.value)).toEqual(["实际回答。", "shared-id", "Shared-ID", "旧引用"]);
    expect(options.find(option => option.value === "shared-id")?.label).toBe("原始陈述");
    expect(JSON.stringify(input)).toBe(before);
    expect(options.every(option => !("selected" in option))).toBe(true);
  });

  it("returns detached descriptions so report refreshes cannot alter a draft's catalogue", () => {
    const claim = { id: "claim-1", statement: "打开草稿时的陈述。" };
    const source = { id: "source-1", title: "打开时的资料", excerpt: "打开时的原文。" };
    const options = buildReviewEvidenceOptions({ answer: "原回答。", claims: [claim], sources: [source] });
    claim.statement = "同一个 ID 的新版陈述。";
    source.title = "刷新后的资料";
    source.excerpt = "刷新后的原文。";
    expect(options.find(option => option.value === "claim-1")?.label).toBe("打开草稿时的陈述。");
    expect(options.find(option => option.value === "source-1")).toMatchObject({ label: "打开时的资料", description: "打开时的原文。" });
  });
});
