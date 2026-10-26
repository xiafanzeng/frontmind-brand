import { useCallback, useMemo, useState, useEffect } from "react";
import ResponseLogicWorkspace from "./ResponseLogicWorkspace.js";
import { createBrandResponseLogicHost } from "./response-logic-brand-adapter.js";
import type { IntentQuestion as BrandIntentQuestion } from "../contracts/intent-workbench.js";
import { captureWorkspaceRestOperation } from "./host.js";

/**
 * Entry point that connects Brand's question workspace to the migrated
 * response-logic workspace. Called when the user clicks「进入应答逻辑」on a
 * Brand intent-workbench question.
 *
 * The Brand question (from the JSON ledger) is adapted into the shape the
 * ResponseLogicWorkspace expects: IntentQuestionGroup with the question's
 * stable Brand ID, current text, and intent.
 */

export interface BrandResponseLogicEntryProps {
  question: BrandIntentQuestion;
  onBack: () => void;
  /** Visual components from Brand's vendor or local equivalents. */
  visual: {
    Button: React.ComponentType<React.HTMLAttributes<HTMLButtonElement> & { disabled?: boolean }>;
    FilePreview?: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
    ImagePreview?: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
    BusinessExecutionActivity?: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  };
  toast: { success(message: string): void; error(message: string): void };
}

type RLQuestionGroup = {
  id: string;
  title: string;
  questions: Array<{
    id: string;
    question: string;
    intent: string;
    summary: string;
  }>;
};

export default function BrandResponseLogicEntry({ question, onBack, visual, toast }: BrandResponseLogicEntryProps) {
  const host = useMemo(() => {
    return createBrandResponseLogicHost({
      captureRestOperation: (signal?: AbortSignal | null) => {
        const rest = captureWorkspaceRestOperation(signal ?? undefined) as unknown as ReturnType<typeof captureWorkspaceRestOperation>;
        return rest as never;
      },
      visual: visual as never,
      toast,
    });
  }, [visual, toast]);

  const groups = useMemo<RLQuestionGroup[]>(() => {
    return [{
      id: "brand-intent",
      title: "品牌意图优化",
      questions: [{
        id: question.id,
        question: question.question,
        intent: "",
        summary: question.category ?? "",
      }],
    }];
  }, [question]);

  return (
    <ResponseLogicWorkspace
      preview={false}
      questionGroups={groups as never}
      initialQuestionId={question.id}
      onPublished={() => {
        toast.success("应答逻辑已更新");
      }}
    />
  );
}
