import type {IntentQuestion} from "../../contracts/intent-workbench";

export type CatalogSelection = {tableId: string; rowIndex: number; question: string};
const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase();

/** Source coordinates survive an approved question rewrite; text links legacy duplicates. */
export function findCatalogQuestion(selection: CatalogSelection, questions: IntentQuestion[]) {
  return questions.find(item => item.tableId === selection.tableId && item.rowIndex === selection.rowIndex) ??
    questions.find(item => normalize(item.question) === normalize(selection.question));
}
