/** Presentation state only. Question text, evaluations and plans remain server-owned. */
export type IntentCatalogViewState = {
  search: string;
  category: string;
  status: string;
  page: number;
  selected: string[];
  expandedGaps: string[];
  questionId: string;
};
