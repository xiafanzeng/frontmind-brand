import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export const RAG_PAGE_ENTRANCE_DURATION = 600;
export const RAG_PAGE_ENTRANCE_STAGGER = 120;
const UNIT_SELECTOR = "[data-rag-entrance]";

/** Coordinates a single, viewport-driven entrance without owning business state. */
export function useRagPageEntrance(root: RefObject<HTMLElement | null>, scopeKey: string) {
  const [ready, setReady] = useState<{ scope: string; ids: Set<string> }>(() => ({ scope: scopeKey, ids: new Set() }));
  const finishUnit = useRef<((unit: HTMLElement) => void) | null>(null);

  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const units = Array.from(container.querySelectorAll<HTMLElement>(UNIT_SELECTOR));
    const completed = new Set<HTMLElement>();
    const queued = new Set<HTMLElement>();
    const timers = new Map<HTMLElement, number>();
    let observer: IntersectionObserver | null = null;
    let batchFrame: number | null = null;
    let active = true;
    let removeMediaListener: (() => void) | undefined;
    setReady({ scope: scopeKey, ids: new Set() });

    const finish = (unit: HTMLElement) => {
      if (!active || completed.has(unit)) return;
      completed.add(unit);
      queued.delete(unit);
      observer?.unobserve(unit);
      window.clearTimeout(timers.get(unit));
      timers.delete(unit);
      unit.dataset.ragEntranceState = "complete";
      unit.style.removeProperty("--rag-entrance-delay");
      const id = unit.dataset.ragEntrance!;
      setReady(previous => ({ scope: scopeKey, ids: new Set([...(previous.scope === scopeKey ? previous.ids : []), id]) }));
    };
    finishUnit.current = finish;
    const finishAll = () => {
      observer?.disconnect();
      if (batchFrame !== null) window.cancelAnimationFrame(batchFrame);
      batchFrame = null;
      queued.clear();
      units.forEach(finish);
    };
    const onAnimationFinish = (event: AnimationEvent) => {
      if (event.animationName !== "rag-page-enter" || !(event.target instanceof HTMLElement)) return;
      if (units.includes(event.target)) finish(event.target);
    };
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      const unit = event.target.closest<HTMLElement>(UNIT_SELECTOR);
      if (unit && units.includes(unit)) finish(unit);
    };
    const flush = () => {
      batchFrame = null;
      if (!active) return;
      // Re-read geometry per batch: desktop columns and narrow screens have different reading orders.
      const batch = [...queued].map(unit => ({ unit, rect: unit.getBoundingClientRect() }))
        .filter(({ unit, rect }) => !completed.has(unit) && rect.width > 0 && rect.height > 0 &&
          rect.bottom > 0 && rect.top < window.innerHeight)
        .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
      queued.clear();
      batch.forEach(({ unit }, index) => {
        const delay = index * RAG_PAGE_ENTRANCE_STAGGER;
        observer?.unobserve(unit);
        unit.style.setProperty("--rag-entrance-delay", `${delay}ms`);
        unit.dataset.ragEntranceState = "playing";
        // Also release children if animation events are cancelled or unavailable.
        timers.set(unit, window.setTimeout(() => finish(unit), delay + RAG_PAGE_ENTRANCE_DURATION));
      });
    };

    container.addEventListener("focusin", onFocus);
    container.addEventListener("animationend", onAnimationFinish);
    container.addEventListener("animationcancel", onAnimationFinish);
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (!media || media.matches || typeof window.IntersectionObserver !== "function" ||
      typeof window.requestAnimationFrame !== "function" || typeof window.cancelAnimationFrame !== "function") {
      finishAll();
    } else {
      units.forEach(unit => { unit.dataset.ragEntranceState = "pending"; });
      observer = new IntersectionObserver(entries => {
        if (!active) return;
        entries.forEach(entry => {
          const unit = entry.target as HTMLElement;
          if (entry.isIntersecting && !completed.has(unit) && unit.dataset.ragEntranceState === "pending") queued.add(unit);
          else if (!entry.isIntersecting) queued.delete(unit);
        });
        if (queued.size && batchFrame === null) batchFrame = window.requestAnimationFrame(flush);
      }, { threshold: 0 });
      units.forEach(unit => observer!.observe(unit));
      const onPreferenceChange = (event: MediaQueryListEvent) => { if (event.matches) finishAll(); };
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", onPreferenceChange);
        removeMediaListener = () => media.removeEventListener("change", onPreferenceChange);
      } else if (typeof media.addListener === "function") {
        media.addListener(onPreferenceChange);
        removeMediaListener = () => media.removeListener(onPreferenceChange);
      }
      const focusedUnit = document.activeElement?.closest<HTMLElement>(UNIT_SELECTOR);
      if (focusedUnit && units.includes(focusedUnit)) finish(focusedUnit);
    }

    return () => {
      active = false;
      if (finishUnit.current === finish) finishUnit.current = null;
      observer?.disconnect();
      if (batchFrame !== null) window.cancelAnimationFrame(batchFrame);
      timers.forEach(timer => window.clearTimeout(timer));
      removeMediaListener?.();
      container.removeEventListener("focusin", onFocus);
      container.removeEventListener("animationend", onAnimationFinish);
      container.removeEventListener("animationcancel", onAnimationFinish);
      units.forEach(unit => {
        delete unit.dataset.ragEntranceState;
        unit.style.removeProperty("--rag-entrance-delay");
      });
    };
  }, [root, scopeKey]);

  // Running/failure notices may arrive while an offscreen card is still waiting.
  // Release only their card, without restarting the page's presentation cycle.
  useLayoutEffect(() => {
    root.current?.querySelectorAll<HTMLElement>(`${UNIT_SELECTOR}[data-rag-entrance-immediate="true"]`)
      .forEach(unit => finishUnit.current?.(unit));
  });

  return (id: string) => ready.scope === scopeKey && ready.ids.has(id);
}
