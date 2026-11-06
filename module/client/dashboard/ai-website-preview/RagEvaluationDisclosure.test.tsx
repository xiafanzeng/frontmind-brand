import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RagEvaluationDisclosure } from "./RagEvaluationDisclosure";

afterEach(cleanup);

describe("RagEvaluationDisclosure", () => {
  it("keeps details out of the focus tree until the user expands them", () => {
    render(
      <RagEvaluationDisclosure label="查看优化方案" testId="quality-disclosure">
        <button type="button">查看完整方案</button>
      </RagEvaluationDisclosure>,
    );

    const trigger = screen.getByRole("button", { name: "查看优化方案" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "查看完整方案" })).toBeNull();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const content = screen.getByRole("region", { name: "查看优化方案内容" });
    expect(trigger.getAttribute("aria-controls")).toBe(content.id);
    expect(screen.getByRole("button", { name: "查看完整方案" })).toBeTruthy();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "查看优化方案内容" })).toBeNull();
    expect(screen.queryByRole("button", { name: "查看完整方案" })).toBeNull();
  });

  it("allows independent sections to remain open together", () => {
    render(<>
      <RagEvaluationDisclosure label="需求满足"><input aria-label="需求满足理由" /></RagEvaluationDisclosure>
      <RagEvaluationDisclosure label="信息完整"><input aria-label="信息完整理由" /></RagEvaluationDisclosure>
    </>);

    const intent = screen.getByRole("button", { name: "需求满足" });
    const completeness = screen.getByRole("button", { name: "信息完整" });
    fireEvent.click(intent);
    fireEvent.click(completeness);
    expect(screen.getByRole("textbox", { name: "需求满足理由" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "信息完整理由" })).toBeTruthy();

    fireEvent.click(intent);
    expect(screen.queryByRole("textbox", { name: "需求满足理由" })).toBeNull();
    expect(completeness.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("textbox", { name: "信息完整理由" })).toBeTruthy();
  });

  it("returns focus to the heading when collapsing an editor", () => {
    render(<RagEvaluationDisclosure label="需求满足"><input aria-label="判断理由" /></RagEvaluationDisclosure>);
    const trigger = screen.getByRole("button", { name: "需求满足" });
    fireEvent.click(trigger);
    const editor = screen.getByRole("textbox", { name: "判断理由" });
    editor.focus();
    expect(document.activeElement).toBe(editor);

    fireEvent.click(trigger);
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("textbox", { name: "判断理由" })).toBeNull();
  });
});
