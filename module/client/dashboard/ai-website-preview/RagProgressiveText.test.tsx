// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RagProgressiveText, revealOpacity, textGraphemes } from "./RagProgressiveText";

afterEach(cleanup);

describe("progressive assessment text", () => {
  it("keeps complete text and grapheme clusters during the reveal", () => {
    const text = "待改进 · 评审覆盖 100% 👨‍👩‍👧‍👦";
    const graphemes = textGraphemes(text);
    expect(graphemes.join("")).toBe(text);
    expect(graphemes).toContain("👨‍👩‍👧‍👦");
    render(<h3 data-testid="text"><RagProgressiveText graphemes={graphemes} offset={0} total={graphemes.length} progress={0.5} /></h3>);
    expect(screen.getByTestId("text").querySelector('[aria-hidden="true"]')?.textContent).toBe(text);
    expect(screen.getByTestId("text").querySelector('.rag-reveal-screen-reader-text')?.textContent).toBe(text);
    expect(screen.getByRole("heading", { name: text })).toBeTruthy();
  });

  it("starts all text regions together while revealing each region in reading order", () => {
    const title = textGraphemes("待改进");
    const body = textGraphemes("核心能力有依据");
    const footer = textGraphemes("关键风险已核验");
    const progress = 0.05;
    render(<div>
      <h3 data-testid="title"><RagProgressiveText graphemes={title} offset={0} total={title.length} progress={progress} /></h3>
      <p data-testid="body"><RagProgressiveText graphemes={body} offset={0} total={body.length} progress={progress} /></p>
      <p data-testid="footer"><RagProgressiveText graphemes={footer} offset={0} total={footer.length} progress={progress} /></p>
    </div>);
    const opacityOf = (id: string) => Array.from(screen.getByTestId(id).querySelector('[aria-hidden="true"]')!.children, el => Number((el as HTMLElement).style.opacity));
    for (const region of ["title", "body", "footer"]) {
      const values = opacityOf(region);
      expect(values[0]).toBeGreaterThan(0);
      expect(values[values.length - 1]).toBe(0);
      expect(values.every((value, index) => index === 0 || value <= values[index - 1])).toBe(true);
    }
    expect(revealOpacity(0, 0, footer.length)).toBe(0);
    expect(revealOpacity(1, footer.length - 1, footer.length)).toBe(1);
  });

  it("shows every character and keeps a single accessible text copy when settled", () => {
    const text = "关键风险已核验 评审覆盖 100%";
    const graphemes = textGraphemes(text);
    render(<p data-testid="text"><RagProgressiveText graphemes={graphemes} offset={0} total={graphemes.length} progress={1} /></p>);
    const element = screen.getByTestId("text");
    expect(element.querySelector('.rag-reveal-screen-reader-text')?.textContent).toBe(text);
    const visual = element.querySelector('[aria-hidden="true"]')!;
    expect(visual.textContent).toBe(text);
    expect(Array.from(visual.children).every(el => (el as HTMLElement).style.opacity === "1")).toBe(true);
  });
});
