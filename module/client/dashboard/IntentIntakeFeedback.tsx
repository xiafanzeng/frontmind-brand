import {createPortal} from "react-dom";
import "./intent-intake-feedback.css";

export type IntentIntakeFeedbackState = "saving" | "success" | null;

/** Transient save feedback; does not request confirmation or move keyboard focus. */
export default function IntentIntakeFeedback({state}: {state: IntentIntakeFeedbackState}) {
  if (!state) return null;
  const label = state === "success" ? "已加入优化清单" : "正在加入优化清单";
  return createPortal(<div className={`iw-intake-feedback iw-intake-feedback--${state}`}
    role="status" aria-live="polite" aria-atomic="true" aria-label={label}>
    <svg viewBox="0 0 72 72" width="72" height="72" fill="none" aria-hidden="true">
      <circle className="iw-intake-track" cx="36" cy="36" r="28"/>
      {state === "saving"
        ? <circle className="iw-intake-spinner" cx="36" cy="36" r="28"/>
        : <g key="success"><circle className="iw-intake-complete" cx="36" cy="36" r="28" pathLength="1"/>
          <path className="iw-intake-check" d="m23 36 9 9 18-19" pathLength="1"/></g>}
    </svg>
    <span>{label}</span>
  </div>, document.body);
}
