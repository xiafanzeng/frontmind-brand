import { useId } from "react";
import type { RagImprovementPlanData, RagImprovementStep } from "./rag-improvement-plan";
import "./rag-improvement-plan.css";

const priorities = {
  P0: { label: "立即修复", tone: "danger" },
  P1: { label: "优先处理", tone: "attention" },
  P2: { label: "建议完善", tone: "suggestion" },
} as const;

function StepPriority({ step }: { step: RagImprovementStep }) {
  const presentation = step.pending
    ? { label: "待补证", tone: "attention" }
    : step.priority ? priorities[step.priority] : null;
  return presentation && <span className={`rag-priority-label is-${presentation.tone}`}>
    <i className="rag-evaluation-status-orb" aria-hidden="true" />{presentation.label}
  </span>;
}

function EvidenceReferences({ ids }: { ids: readonly string[] }) {
  return ids.length > 0 ? <p className="rag-improvement-plan__references">相关依据：{ids.join("、")}</p> : null;
}

/** A reading document with inset surfaces only for actions and the example. */
export function RagImprovementPlan({ plan, onAdopt }: { plan: RagImprovementPlanData; onAdopt: (answer: string) => void }) {
  const id = useId();
  const hasAdjustments = plan.steps.length > 0 || plan.optionalSuggestions.length > 0;

  return <div className="rag-improvement-plan">
    <section aria-labelledby={`${id}-goal`}>
      <h3 id={`${id}-goal`}>优化目标</h3>
      <p data-testid="rag-improvement-summary">{plan.goal}</p>
    </section>

    {hasAdjustments && <section aria-labelledby={`${id}-steps`}>
      <h3 id={`${id}-steps`}>调整步骤</h3>
      {plan.steps.length > 0 && <ol className="rag-improvement-plan__steps" aria-label="调整步骤" role="list">
        {plan.steps.map((step, index) => <li key={step.id}>
          <span className="rag-improvement-plan__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <div className="rag-improvement-plan__step">
            <div className="rag-improvement-plan__step-heading"><h4>{step.title}</h4><StepPriority step={step} /></div>
            <p>{step.body}</p>
            {step.quotes.map(quote => <blockquote key={quote.id}>{quote.text}</blockquote>)}
            <EvidenceReferences ids={step.evidenceIds} />
          </div>
        </li>)}
      </ol>}
      {plan.optionalSuggestions.length > 0 && <section className="rag-improvement-plan__optional" aria-labelledby={`${id}-optional`}>
        <div className="rag-improvement-plan__step-heading"><h4 id={`${id}-optional`}>可选建议</h4><span className="rag-improvement-plan__note">不扣分</span></div>
        <ul>
          {plan.optionalSuggestions.map(suggestion => <li key={suggestion.id}>
            <p><strong>{suggestion.title}</strong>{suggestion.body ? `${/[。！？.!?]$/u.test(suggestion.title.trim()) ? "" : "。"}${suggestion.body}` : ""}</p>
            <EvidenceReferences ids={suggestion.evidenceIds} />
          </li>)}
        </ul>
      </section>}
    </section>}

    {plan.rewrite && <section aria-labelledby={`${id}-rewrite`}>
      <h3 id={`${id}-rewrite`}>改写示例</h3>
      <p className="rag-improvement-plan__answer">{plan.rewrite}</p>
      <button type="button" className="sfp-button sfp-button--primary" onClick={() => onAdopt(plan.rewrite!)}>采用改写并重新评审</button>
    </section>}

    {plan.checks.length > 0 && <section aria-labelledby={`${id}-checks`}>
      <h3 id={`${id}-checks`}>检查要点</h3>
      <ul className="rag-improvement-plan__checks">
        {plan.checks.map((check, index) => <li key={`${index}-${check}`}>{check}</li>)}
      </ul>
    </section>}
  </div>;
}
