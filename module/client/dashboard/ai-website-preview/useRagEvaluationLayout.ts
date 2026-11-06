import { useLayoutEffect, useRef, useState } from "react";

/** Measure the hypothetical side-by-side card, even while the visible cards stack. */
export function useRagEvaluationLayout(contentKey: string) {
  const overviewRef = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  const [summaryTwoLines, setSummaryTwoLines] = useState(false);

  useLayoutEffect(() => {
    const overview = overviewRef.current;
    if (!overview) return;
    let disposed = false;
    let frame: number | null = null;
    let measuredWidth = 0;
    let measuredCopyHeight = 0;
    const visibleCopy = overview.querySelector<HTMLElement>(":scope > .rag-verdict .rag-evaluation-summary-copy");

    const measure = () => {
      if (disposed) return;
      const width = overview.getBoundingClientRect().width;
      if (width <= 0) return;
      measuredWidth = width;
      if (visibleCopy) {
        measuredCopyHeight = visibleCopy.getBoundingClientRect().height;
        const lineHeight = parseFloat(getComputedStyle(visibleCopy).lineHeight) || 21;
        if (measuredCopyHeight > 0) {
          setSummaryTwoLines(measuredCopyHeight > lineHeight + 0.5 && measuredCopyHeight <= lineHeight * 2 + 0.5);
        }
      }
      const style = getComputedStyle(overview);
      const gaugeWidth = parseFloat(style.getPropertyValue("--rag-evaluation-card-width")) || 136;
      const parsedGap = parseFloat(style.columnGap);
      const gap = Number.isFinite(parsedGap) ? parsedGap : 16;
      const horizontalInset = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
        .reduce((total, value) => total + (parseFloat(value) || 0), 0);
      const candidateWidth = width - horizontalInset - gaugeWidth - gap;
      if (candidateWidth <= 0) {
        setStacked(true);
        return;
      }
      const verdict = overview.querySelector<HTMLElement>(":scope > .rag-verdict");
      if (!verdict) return;
      const probe = verdict.cloneNode(true) as HTMLElement;
      probe.setAttribute("aria-hidden", "true");
      probe.setAttribute("data-rag-measurement", "");
      probe.inert = true;
      Object.assign(probe.style, {
        position: "absolute", visibility: "hidden", pointerEvents: "none",
        width: `${candidateWidth}px`, left: "0", top: "0", margin: "0",
        height: "auto", minHeight: "0",
      });
      overview.append(probe);
      try {
        const copy = probe.querySelector<HTMLElement>(".rag-evaluation-summary-copy");
        const metrics = probe.querySelector<HTMLElement>(".rag-evaluation-metric-copy");
        if (!copy || !metrics) return;
        const copyLineHeight = parseFloat(getComputedStyle(copy).lineHeight) || 21;
        const metricsLineHeight = parseFloat(getComputedStyle(metrics).lineHeight) || 18;
        setStacked(
          copy.getBoundingClientRect().height > copyLineHeight * 2 + 0.5 ||
          metrics.getBoundingClientRect().height > metricsLineHeight + 0.5,
        );
      } finally {
        probe.remove();
      }
    };
    const schedule = () => {
      if (disposed || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      // Ignore changes to the card height caused by its own layout.
      if (Math.abs(overview.getBoundingClientRect().width - measuredWidth) > 0.01 ||
          (visibleCopy && Math.abs(visibleCopy.getBoundingClientRect().height - measuredCopyHeight) > 0.01)) schedule();
    });
    observer?.observe(overview);
    if (visibleCopy) observer?.observe(visibleCopy);
    window.addEventListener("resize", schedule);
    const fonts = document.fonts;
    void fonts?.ready.then(() => { if (!disposed) schedule(); });
    fonts?.addEventListener("loadingdone", schedule);
    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      fonts?.removeEventListener("loadingdone", schedule);
    };
  }, [contentKey]);

  return { overviewRef, stacked, summaryTwoLines };
}
