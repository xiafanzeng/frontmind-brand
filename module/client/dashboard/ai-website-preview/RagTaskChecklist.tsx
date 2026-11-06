import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { RagCase } from "./rag-evaluation-cases";
import { useRagEntranceReady } from "./RagEntranceContext";

type CompletionPoint = RagCase["conversation"]["completionPoints"][number];

const REVEAL_TOTAL_MS = 800;
const REVEAL_STAGGER_MS = 80;
const REVEAL_MAX_DELAY_MS = 320;

/** Reveals the task points once when this list enters the viewport. */
export function RagTaskChecklist({ points }: { points: CompletionPoint[] }) {
  const entranceReady = useRagEntranceReady();
  const listRef = useRef<HTMLUListElement>(null);
  const [reveal, setReveal] = useState<"static" | "pending" | "playing">("static");
  const maxDelay = Math.min(Math.max(points.length - 1, 0) * REVEAL_STAGGER_MS, REVEAL_MAX_DELAY_MS);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || typeof window.matchMedia !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      typeof IntersectionObserver !== "function") {
      setReveal("static");
      return;
    }

    setReveal("pending");
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let active = true;
    let completed = false;
    let observer: IntersectionObserver | null = null;
    const onPreferenceChange = (event: MediaQueryListEvent) => {
      if (event.matches && active) {
        completed = true;
        observer?.disconnect();
        setReveal("static");
      }
    };
    media.addEventListener?.("change", onPreferenceChange);
    if (!media.addEventListener) media.addListener?.(onPreferenceChange);
    if (entranceReady) {
      observer = new IntersectionObserver((entries) => {
        if (active && !completed && entries.some((entry) => entry.target === list && entry.isIntersecting)) {
          completed = true;
          setReveal("playing");
          observer?.disconnect();
        }
      }, { threshold: 0 });
      observer.observe(list);
    }
    return () => {
      active = false;
      observer?.disconnect();
      media.removeEventListener?.("change", onPreferenceChange);
      if (!media.removeEventListener) media.removeListener?.(onPreferenceChange);
    };
  }, [entranceReady]);

  return <ul ref={listRef} className="rag-checklist" data-reveal={reveal} style={{ "--rag-task-reveal-duration": `${REVEAL_TOTAL_MS - maxDelay}ms` } as CSSProperties}>
    {points.map((point, index) => <li
      key={point.id}
      className={point.met === true ? "is-met" : point.met === false ? "is-miss" : "is-na"}
      style={{ "--rag-task-reveal-delay": `${Math.min(index * REVEAL_STAGGER_MS, REVEAL_MAX_DELAY_MS)}ms` } as CSSProperties}
    >
      <span className="rag-checklist__text">{point.label}</span>
      <span className="rag-checklist__status"><i className="rag-evaluation-status-orb" aria-hidden="true" />{point.met === true ? "已满足" : point.met === false ? "未满足" : "待确认"}</span>
    </li>)}
  </ul>;
}
