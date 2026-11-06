import { renderToString } from "katex";
import { RAG_ACCEPTANCE_PARAMS, RAG_DIMENSIONS, RAG_GATES } from "./rag-evaluation";
import "katex/dist/katex.min.css";
import "./rag-report-rules.css";

/** Only these authored expressions are passed to KaTeX; report text is never parsed as TeX. */
export const RAG_REPORT_FORMULAS = {
  checklistScore: String.raw`\begin{aligned}d_i&=w_i\frac{\sum_{j\in A_i}p_{ij}r_{ij}}{\sum_{j\in A_i}p_{ij}}\\[6pt]S_{\mathrm{raw}}&=100\frac{\sum_{i\in A}d_i}{\sum_{i\in A}w_i}\end{aligned}`,
  checklistCoverage: String.raw`C=100\frac{\displaystyle\sum_{i\in A}w_i\frac{\sum_{j\in J_i}p_{ij}}{\sum_{j\in A_i}p_{ij}}}{\displaystyle\sum_{i\in A}w_i}`,
  manualScore: String.raw`S_{\mathrm{raw}}=100\frac{\displaystyle\sum_{i\in A}w_i\frac{\ell_i}{4}}{\displaystyle\sum_{i\in A}w_i}`,
  manualCoverage: String.raw`C=100\frac{\sum_{i\in J}w_i}{W},\qquad W=\sum_{i\in A}w_i`,
  manualBounds: String.raw`\begin{aligned}L&=\frac{100}{W}\sum_{i\in J}w_i\frac{\ell_i}{4}\\[6pt]U&=L+\frac{100}{W}\sum_{i\in A\setminus J}w_i\end{aligned}`,
  excellent: String.raw`S_{\mathrm{raw}}\geq90`,
  usable: String.raw`80\leq S_{\mathrm{raw}}<90`,
  improve: String.raw`70\leq S_{\mathrm{raw}}<80`,
  unusable: String.raw`S_{\mathrm{raw}}<70`,
  acceptanceRates: String.raw`\leq5\%\;/\;\leq10\%\;/\;\leq5\%`,
} as const;

export const RAG_REPORT_SYMBOLS = {
  applicableDimensions: String.raw`A`,
  applicableChecks: String.raw`A_i`,
  dimensionIndex: String.raw`i`,
  weights: String.raw`w_i\,/\,p_{ij}`,
  contribution: String.raw`r_{ij}\,/\,d_i`,
  dimensionWeight: String.raw`w_i`,
  level: String.raw`\ell_i`,
  judgedChecks: String.raw`J_i`,
  judgedDimensions: String.raw`J`,
  totalWeight: String.raw`W`,
  lower: String.raw`L`,
  upper: String.raw`U`,
} as const;

const authoredMath = { ...RAG_REPORT_FORMULAS, ...RAG_REPORT_SYMBOLS };
type FormulaName = keyof typeof authoredMath;
const formulaMarkup = new Map<string, string>();
function Formula({ name, inline = false, label }: { name: FormulaName; inline?: boolean; label?: string }) {
  const key = `${name}:${inline}`;
  let markup = formulaMarkup.get(key);
  if (!markup) {
    markup = renderToString(authoredMath[name], {
      displayMode: !inline,
      output: "htmlAndMathml",
      trust: false,
      throwOnError: true,
    });
    formulaMarkup.set(key, markup);
  }
  return inline
    ? <span className="rag-report-inline-math" dangerouslySetInnerHTML={{ __html: markup }} />
    : <div className="rag-report-formula" role="group" aria-label={label} tabIndex={0} dangerouslySetInnerHTML={{ __html: markup }} />;
}

export function RagEvaluationReportRules() {
  return <section id="rules" className="rag-report-section rag-report-rules" aria-labelledby="rag-report-rules-heading" tabIndex={-1}>
    <h2 id="rag-report-rules-heading">01 评分规则</h2>
    <section className="rag-report-rule-section" aria-labelledby="evaluation-scope">
      <h3 id="evaluation-scope" tabIndex={-1}>评估对象</h3>
      <p>评估针对一次回答，核对它是否完成用户任务、得到企业资料支持，并遵守安全与权限边界。分数用于定位问题，质量结论还要结合任务完成情况、关键风险和证据是否完整。</p>
      <p>每份记录保留对应问答、知识版本和评分规则，方便后续核对。人工评审还会在当前浏览器保存完整问答，与自动评估分别记录，互不覆盖。</p>
    </section>

    <section className="rag-report-rule-section" aria-labelledby="dimensions">
      <h3 id="dimensions" tabIndex={-1}>六维权重</h3>
      <p>六个维度共 100 分。权重固定，具体检查要求随预先确定的任务类型选择。</p>
      <div className="rag-report-table-scroll" role="region" aria-label="六维评分权重" tabIndex={0}>
        <table className="rag-report-rule-table">
          <thead><tr><th scope="col">维度</th><th scope="col">权重</th><th scope="col">核对内容</th></tr></thead>
          <tbody>{RAG_DIMENSIONS.map(item => <tr key={item.id}><th scope="row">{item.label}</th><td className="rag-report-number">{item.weight} 分</td><td>{item.question}</td></tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className="rag-report-rule-section" aria-labelledby="calculation">
      <h3 id="calculation" tabIndex={-1}>计算方法</h3>
      <div className="rag-report-rule-method" id="rule-rag-eval-1-4">
        <h4>自动评估</h4>
        <p>先确定检查项、分值和适用范围，再核对回答。每项满足计 100%，部分满足计 50%，不满足计 0%；待核验项保持未知。同一问题只在对应的主要检查项扣分，可选建议不扣分。</p>
        <Formula name="checklistScore" label="检查项的维度得分与总分" />
        <dl className="rag-report-symbols">
          <div><dt><Formula name="applicableDimensions" inline /></dt><dd>至少有一个适用检查项的维度集合。</dd></div>
          <div><dt><Formula name="applicableChecks" inline /></dt><dd>第 <Formula name="dimensionIndex" inline /> 个维度中的适用检查项；排除理由须在评估前确定。</dd></div>
          <div><dt><Formula name="weights" inline /></dt><dd>维度权重／检查项原始分值。</dd></div>
          <div><dt><Formula name="contribution" inline /></dt><dd>检查项的满足比例（1、½、0）／该维度得分。</dd></div>
        </dl>
        <p>排除不适用项后，按剩余检查项的分值比例计算维度得分，再汇总总分。只有全部适用检查项完成判断，才显示总分；任一项待核验时，总分留空。自动评估结果保留一位小数。</p>
      </div>
      <div className="rag-report-rule-method" id="rule-rag-eval-1-3">
        <h4>人工评审与合成示例</h4>
        <p>每个维度使用 0–4 级：不满足、少量满足、部分满足、基本满足、充分满足。等级必须附判断理由和证据定位。</p>
        <Formula name="manualScore" label="等级评审总分" />
        <p className="rag-report-formula-note"><Formula name="applicableDimensions" inline /> 为适用维度集合，<Formula name="dimensionWeight" inline /> 为维度权重，<Formula name="level" inline /> 为 0–4 级判断。全部六维适用时，分母为 100。</p>
        <p>所有适用维度具备有效判断、理由和证据后，才得到原始总分；显示分数四舍五入为整数。不适用维度需事先批准并记录理由，不能在评审时临时排除。</p>
      </div>
      <div className="rag-report-rule-method" id="rule-rag-eval-1-2">
        <h4>历史规则</h4>
        <p>早期采用等级计分并按分数划分结论的记录，保留以下阈值。这些阈值要求判断完整、关键风险全部通过，并按未取整的原始分判断；不用于当前自动评估与人工评审。</p>
        <div className="rag-report-table-scroll" role="region" aria-label="历史规则的分数阈值" tabIndex={0}>
          <table className="rag-report-rule-table rag-report-rule-table--compact">
            <thead><tr><th scope="col">原始分</th><th scope="col">历史结论</th></tr></thead>
            <tbody>{([
              ["excellent", "优秀"], ["usable", "可用"], ["improve", "需要改进"], ["unusable", "不可用"],
            ] as const).map(([name, label]) => <tr key={name}><td><Formula name={name} inline /></td><td>{label}</td></tr>)}</tbody>
          </table>
        </div>
        <p>历史报告保留原结论，不按新规则改判。无法识别的历史规则仅展示原始记录，不重新计分。</p>
      </div>
    </section>

    <section className="rag-report-rule-section" aria-labelledby="verdicts">
      <h3 id="verdicts" tabIndex={-1}>风险与结论</h3>
      <p>当前自动评估与人工评审不以分数阈值单独决定回答是否可用。</p>
      <ul className="rag-report-rule-list rag-report-verdicts">
        <li><span className="rag-evaluation-status-orb is-usable" aria-hidden="true" /><span><strong>可用：</strong>核心任务完成、必要证据完整，关键风险均通过；存在非关键问题时标记“可用·待改进”。</span></li>
        <li><span className="rag-evaluation-status-orb is-pending" aria-hidden="true" /><span><strong>待核验：</strong>必要判断或证据不足，暂不判为可用。缺少证据不等于已经证实错误。</span></li>
        <li><span className="rag-evaluation-status-orb is-unusable" aria-hidden="true" /><span><strong>需修复：</strong>关键风险成立、发现重大问题或核心任务明确失败。高分不抵消这些问题。</span></li>
      </ul>
      <div className="rag-report-table-scroll" role="region" aria-label="关键回答风险" tabIndex={0}>
        <table className="rag-report-rule-table">
          <thead><tr><th scope="col">关键风险</th><th scope="col">通过条件</th></tr></thead>
          <tbody>{RAG_GATES.map(item => <tr key={item.id}><th scope="row">{item.label}</th><td>{item.description}</td></tr>)}</tbody>
        </table>
      </div>
      <p>建议不等于事实承诺，但其中的电话、操作步骤和企业承诺仍须核验。只检查当前任务所需的信息，不要求无关扩展。</p>
    </section>

    <section className="rag-report-rule-section" aria-labelledby="uncertainty">
      <h3 id="uncertainty" tabIndex={-1}>缺失证据</h3>
      <p>未判定项保留在适用范围内，不删除，也不补成满分。评审覆盖率表示已经完成判断的权重比例，不是回答正确率。</p>
      <h4>自动评估的覆盖率</h4>
      <Formula name="checklistCoverage" label="检查项的评审覆盖率" />
      <p className="rag-report-formula-note"><Formula name="judgedChecks" inline /> 为 <Formula name="applicableChecks" inline /> 中已判定的检查项。满足、部分满足和不满足均算已判定，待核验不算。计算沿用各维度内的归一权重。</p>
      <h4>等级评审的覆盖率与可能范围</h4>
      <Formula name="manualCoverage" label="等级评审覆盖率" />
      <Formula name="manualBounds" label="缺失判断时的数学可能得分范围" />
      <p className="rag-report-formula-note"><Formula name="judgedDimensions" inline /> 为已具备等级、理由和证据的适用维度集合，<Formula name="totalWeight" inline /> 为适用总权重。<Formula name="lower" inline /> 只累计已知得分；<Formula name="upper" inline /> 再加入未知维度可能取得的全部权重。</p>
      <p>这个范围用于等级评审，包括采用等级计分的历史记录，表示缺失判断可能带来的上下限，不是统计置信区间。按检查项计分的自动报告只展示已有分数与覆盖率，不推算额外区间。</p>
      <p>即使评分覆盖率达到 100%，关键风险或任务结果仍可能待核验。评分项缺失、重复或全部不适用时，不能计算有效总分。</p>
    </section>

    <section className="rag-report-rule-section" aria-labelledby="limits">
      <h3 id="limits" tabIndex={-1}>使用边界与验收参数</h3>
      <p>单次回答分、企业 RAG 系统分和网站建设评估相互独立。正式验收需要有代表性的测试集和独立复核，不能只凭合成示例、单人自评或少量测试。回答评估结论仅供质量改进参考，不代表网站获准发布。</p>
      <p>以下指标是正式验收的初始参考，不是本次回答得分或实测结果。调整指标时，应记录原值、原因和批准情况，便于后续核对。</p>
      <div className="rag-report-table-scroll" role="region" aria-label="初始验收参数" tabIndex={0}>
        <table className="rag-report-rule-table">
          <thead><tr><th scope="col">参数</th><th scope="col">初始基线</th></tr></thead>
          <tbody>{RAG_ACCEPTANCE_PARAMS.map(item => <tr key={item.label}><th scope="row">{item.label}</th><td>{item.label === "误报率 / 无法判定率 / 执行失败率" ? <><Formula name="acceptanceRates" inline />（初始观察目标）</> : item.value}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  </section>;
}
