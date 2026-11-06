/** Presentation metadata only; saved reviews continue to store evidenceIds. */
export type ReviewEvidenceOption = {
  value: string;
  label: string;
  description?: string;
  group: "answer" | "claim" | "source" | "existing";
};

export type ReviewEvidenceInputs = {
  answer: string;
  answerId?: string;
  claims?: readonly { id: string; statement: string }[];
  sources?: readonly {
    id: string;
    title: string;
    section?: string;
    excerpt?: string;
    kind?: "published_knowledge" | "user_attachment";
  }[];
  selectedValues?: readonly string[];
};

/**
 * Build once when a review draft is opened, so a refreshed report cannot change
 * the meaning of a selected claim ID underneath an in-progress review.
 */
export function buildReviewEvidenceOptions({ answer, answerId, claims = [], sources = [], selectedValues = [] }: ReviewEvidenceInputs): ReviewEvidenceOption[] {
  const options: ReviewEvidenceOption[] = [];
  const values = new Set<string>();
  const add = (option: ReviewEvidenceOption) => {
    if (!option.value.trim() || values.has(option.value)) return;
    values.add(option.value);
    options.push(option);
  };

  if (answer.trim()) {
    if (answerId?.trim()) {
      add({ value: `answer:${answerId}`, label: "本轮完整回答", description: answer, group: "answer" });
    }
    // Blank lines delimit paragraphs; preserve the chosen paragraph verbatim.
    answer.split(/\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/u).filter(paragraph => paragraph.trim()).forEach((paragraph, index) => {
      add({ value: paragraph, label: `回答原文 · 第 ${index + 1} 段`, description: paragraph, group: "answer" });
    });
  }

  for (const claim of claims) {
    add({ value: claim.id, label: claim.statement || claim.id, description: claim.id, group: "claim" });
  }
  for (const source of sources) {
    const description = [source.section, source.excerpt].filter(part => part?.trim()).join("\n") || (
      source.kind === "published_knowledge" ? "已发布知识资料" : source.kind === "user_attachment" ? "本轮用户附件" : undefined
    );
    add({ value: source.id, label: source.title || source.id, description, group: "source" });
  }

  for (const value of selectedValues) {
    // Older reviews accepted arbitrary text. Keep its exact bytes and order;
    // this is an existing locator, not a newly verified source or statement.
    add(value === answerId && answer.trim()
      ? { value, label: "本轮完整回答（已有定位）", description: answer, group: "existing" }
      : { value, label: value, description: "已有证据定位", group: "existing" });
  }
  return options;
}
