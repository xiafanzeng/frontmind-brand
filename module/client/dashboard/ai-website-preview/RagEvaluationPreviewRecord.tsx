import { RagEvaluationExampleRecord } from "./RagEvaluationExampleRecord";
import { installRagPreviewFixtures } from "./rag-preview-fixture-loader";
import { ragPreviewFixtures } from "./rag-preview-fixtures-data";

const fixtures = installRagPreviewFixtures(ragPreviewFixtures);

export function MissingPreviewExample() {
  return <section id="records"><h2>02 评估记录</h2><p className="rag-report-message" role="alert">示例问答标识无效，请重新打开示例报告。</p></section>;
}

/** Preview-only report entry. Formal report routes never request this chunk. */
export default function RagEvaluationPreviewRecord({ exampleId }: { exampleId: string }) {
  const example = fixtures.cases.find(item => item.id === exampleId);
  return example ? <RagEvaluationExampleRecord example={example} /> : <MissingPreviewExample />;
}
