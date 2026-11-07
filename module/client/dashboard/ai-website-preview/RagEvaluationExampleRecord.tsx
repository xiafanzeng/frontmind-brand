import { RAG_DIMENSIONS, RAG_GATES, scoreEvaluation } from "./rag-evaluation";
import type { RagCase } from "./rag-evaluation-cases";
import { enterpriseRagQualityVerdictLabels, presentEvaluationScore } from "./rag-report-presentation";
import "./rag-report-records.css";

const gates = { passed: "通过", failed: "发现风险", pending: "待核验" };

/** A synthetic case is a read-only document, independent of live report history. */
export function RagEvaluationExampleRecord({ example }: { example: RagCase }) {
  const result = scoreEvaluation(example);
  const score = presentEvaluationScore(result.score, result.verdict === "unusable");
  return <section id="records" className="rag-report-section rag-report-records" aria-labelledby="rag-report-example-heading" data-testid="rag-report-example-record">
    <h2 id="rag-report-example-heading"><span className="rag-report-section-number">02</span> 示例评估记录</h2>
    <p className="rag-report-record-note">示例</p>
    <article className="rag-report-record-group" aria-label={example.title}>
      <div className="rag-report-record-line"><h3>{example.title}</h3><span className="rag-report-record-score" aria-label={score.ariaLabel}>{score.text}</span></div>
      <p>{enterpriseRagQualityVerdictLabels[result.verdict]} · {example.summary}</p>
      <div className="rag-report-record-detail">
        <section className="rag-report-record-block"><h4>客户任务</h4><p>{example.need}</p></section>
        <section className="rag-report-record-block"><h4>问题与回答</h4><p>{example.question}</p><blockquote>{example.answer}</blockquote></section>
        <section className="rag-report-record-block"><h4>六维判断</h4><div className="rag-report-record-table-scroll" role="region" aria-label="示例六维判断" tabIndex={0}>
          <table><thead><tr><th>维度</th><th>得分／权重</th><th>判断依据</th></tr></thead><tbody>{RAG_DIMENSIONS.map(dimension => {
            const judgment = example.dimensions.find(item => item.id === dimension.id);
            const earned = result.earnedByDimension[dimension.id];
            return <tr key={dimension.id}><th scope="row">{dimension.label}</th><td>{earned === null ? "待核验" : Number(earned.toFixed(2))} / {dimension.weight}</td><td>{judgment?.rationale || "尚无判断依据。"}<p className="rag-report-record-note">证据定位：{judgment?.evidenceIds.join("、") || "未记录"}</p></td></tr>;
          })}</tbody></table>
        </div></section>
        <section className="rag-report-record-block"><h4>关键风险核验</h4><ul className="rag-report-record-list">{example.gates.map(gate => <li key={gate.id}><strong>{RAG_GATES.find(item => item.id === gate.id)?.label ?? gate.id}</strong><span className="rag-report-record-inline-status">{gates[gate.status]}</span><p>{gate.reason || "尚无核验记录。"}</p></li>)}</ul></section>
        <section className="rag-report-record-block"><h4>参考资料</h4><ul className="rag-report-record-list">{example.sources.map(source => <li key={source.id}><strong>{source.title}</strong><p className="rag-report-record-note">{source.id} · {source.section} · {source.scope}</p><blockquote>{source.excerpt}</blockquote></li>)}</ul></section>
      </div>
    </article>
  </section>;
}
