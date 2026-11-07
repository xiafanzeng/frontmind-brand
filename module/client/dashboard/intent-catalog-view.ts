/** Presentation state only. Question text, evaluations and plans remain server-owned. */
export type IntentCatalogSort = "newest" | "value" | "support";
export type IntentCatalogViewState = {
  search: string;
  category: string;
  status: string;
  sort?: IntentCatalogSort;
  page: number;
  selected: string[];
  expandedGaps: string[];
  questionId: string;
};
