// Keep each grapheme inline so the browser can wrap text naturally and assistive
// technology receives the same text in the same reading order.
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

export function textGraphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), item => item.segment) : Array.from(text);
}

export function revealOpacity(progress: number, index: number, count: number) {
  const fadeWidth = 4;
  return Math.max(0, Math.min(1, (progress * (count + fadeWidth) - index) / fadeWidth));
}

export function RagProgressiveText({ graphemes, offset, total, progress }: { graphemes: string[]; offset: number; total: number; progress: number }) {
  // Keep the same inline structure after the animation to avoid a change in
  // wrapping when the last frame replaces one text layout with another.
  return <><span aria-hidden="true">{graphemes.map((grapheme, index) => <span key={index} style={{ opacity: revealOpacity(progress, offset + index, total) }}>{grapheme}</span>)}</span><span className="rag-reveal-screen-reader-text">{graphemes.join("")}</span></>;
}
