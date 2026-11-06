import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

const REVEAL_DURATION_MS = 800;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Plays one presentation-only reveal for each enabled data revision. */
export function useDataReveal<T extends HTMLElement>(enabled: boolean, replayKey: string, durationMs = REVEAL_DURATION_MS, easing: "ease-out" | "linear" = "ease-out", ready = true): {
  ref: RefObject<T | null>;
  progress: number;
  finish: () => void;
} {
  const ref = useRef<T | null>(null);
  const [progress, setProgress] = useState(1);
  const finishCurrent = useRef<(() => void) | null>(null);
  const finish = useCallback(() => finishCurrent.current?.(), []);

  useLayoutEffect(() => {
    let active = true;
    let completed = false;
    let started = false;
    let frame: number | null = null;
    let observer: IntersectionObserver | null = null;
    let removeMediaListener: (() => void) | null = null;

    const stop = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      observer?.disconnect();
      observer = null;
    };
    const finishNow = () => {
      if (!active) return;
      completed = true;
      stop();
      setProgress(1);
    };
    finishCurrent.current = finishNow;

    const start = () => {
      if (!active || completed || started) return;
      started = true;
      observer?.disconnect();
      observer = null;
      let startTime: number | null = null;
      const tick = (timestamp: number) => {
        frame = null;
        if (!active || completed) return;
        startTime ??= timestamp;
        const elapsed = Math.min(1, Math.max(0, (timestamp - startTime) / durationMs));
        if (elapsed === 1) {
          finishNow();
          return;
        }
        setProgress(easing === "linear" ? elapsed : 1 - (1 - elapsed) ** 3);
        frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
    };

    if (!enabled || typeof window.matchMedia !== "function") {
      finishNow();
    } else {
      const media = window.matchMedia(REDUCED_MOTION_QUERY);
      const onPreferenceChange = (event: MediaQueryListEvent) => {
        if (event.matches) finishNow();
      };
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", onPreferenceChange);
        removeMediaListener = () => media.removeEventListener("change", onPreferenceChange);
      } else if (typeof media.addListener === "function") {
        media.addListener(onPreferenceChange);
        removeMediaListener = () => media.removeListener(onPreferenceChange);
      }

      if (media.matches || !ref.current) {
        finishNow();
      } else {
        setProgress(0);
        if (!ready) {
          // Keep valid values at their starting position until the outer card
          // has finished entering; opacity does not affect intersection tests.
        } else if (typeof window.IntersectionObserver !== "function") {
          start();
        } else {
          const element = ref.current;
          observer = new IntersectionObserver((entries) => {
            if (entries.some(entry => entry.target === element && entry.isIntersecting)) start();
          }, { threshold: 0 });
          observer.observe(element);
        }
      }
    }

    return () => {
      active = false;
      stop();
      removeMediaListener?.();
      if (finishCurrent.current === finishNow) finishCurrent.current = null;
    };
  }, [enabled, replayKey, durationMs, easing, ready]);

  return { ref, progress, finish };
}
