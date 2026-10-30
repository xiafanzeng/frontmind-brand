import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

export interface RagEvaluationDisclosureProps {
  children: ReactNode;
  label: string;
  testId?: string;
}

export function RagEvaluationDisclosure({ children, label, testId }: RagEvaluationDisclosureProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return <section className="rag-evaluation-disclosure" data-open={open ? "true" : "false"} data-testid={testId}>
    <button
      type="button"
      className="rag-evaluation-disclosure__trigger"
      aria-controls={contentId}
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
    >
      <span>{label}</span>
      <ChevronDown className="rag-evaluation-disclosure__chevron" size={18} aria-hidden="true" />
    </button>
    {open && <div
      id={contentId}
      className="rag-evaluation-disclosure__content"
      role="region"
      aria-label={`${label}内容`}
    >
      {children}
    </div>}
  </section>;
}

export default RagEvaluationDisclosure;
