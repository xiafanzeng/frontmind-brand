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
});
