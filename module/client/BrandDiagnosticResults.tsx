import { useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  MessagesSquare,
  ShieldCheck,
} from "lucide-react";
import {
  DIAGNOSTIC_CATEGORIES,
  DIAGNOSTIC_LABELS,
  type DiagnosticCategory,
  type DiagnosticRunView,
} from "../contracts/diagnostics";
import type { SemanticAuditResult } from "../contracts/semantic-audit";

export const DIAGNOSTIC_VERDICTS = {
  supported: "与知识一致",
  contradicted: "与当前知识库不一致",
  omitted: "回答遗漏",
  unverifiable: "无法核验",
} as const;
type Verdict = keyof typeof DIAGNOSTIC_VERDICTS;
export const isDiagnosticPending = (status?: string) =>
  !!status && ["queued", "submitting", "running"].includes(status);

export function DiagnosticSemanticAudit({
  audit,
  status,
  error,
  allowRequest,
  disabled,
  onRequest,
  onKnowledge,
  onAnswers,
  onAnswer,
}: {
  audit?: SemanticAuditResult;
  status?: string;
  error?: string;
  allowRequest: boolean;
  disabled: boolean;
  onRequest: () => void;
  onKnowledge: (path: string) => void;
  onAnswers: (metric: string) => void;
  onAnswer: (sampleId: string) => void;
}) {
  const pending = isDiagnosticPending(status);
  return (
    <section className="bd-audit" aria-label="本题五维语义资产审计">
      <div className="bd-subheading">
        <div>
          <span className="bd-eyebrow">本题证据表现</span>
          <h4>五维语义资产审计</h4>
        </div>
        <span className="bd-pill">模型评估</span>
      </div>
      {audit ? (
        <>
          <p className="bd-note">
            基于本题 {audit.samples} / {audit.plannedSamples}{" "}
            份回答。模型判断按固定权重换算为分值，不能等同于真实推荐率；有效样本覆盖由采集数量计算。
          </p>
          <div className="bd-audit-dimensions">
            {audit.dimensions.map((dimension, index) => (
              <details key={dimension.id} className="bd-audit-dimension">
                <summary>
                  <span className="bd-audit-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="bd-audit-main">
                    <div className="bd-audit-label">
                      <strong>{dimension.label}</strong>
                      {dimension.score === null ? (
                        <small>
                          {dimension.status === "not_applicable"
                            ? "本题不适用"
                            : `依据不足 · ${dimension.assessed}/${dimension.total} 项可评`}
                        </small>
                      ) : (
                        <span>
                          {dimension.score} / {dimension.maximum}
                        </span>
                      )}
                    </div>
                    {dimension.score !== null && (
                      <div
                        className="bd-audit-track"
                        role="meter"
                        aria-label={`${dimension.label}模型评分`}
                        aria-valuenow={dimension.score}
                        aria-valuemin={0}
                        aria-valuemax={dimension.maximum}
                      >
                        <span
                          style={{
                            width: `${Math.max(0, Math.min(100, (dimension.score / dimension.maximum) * 100))}%`,
                          }}
                        />
                      </div>
                    )}
                    <p>{dimension.finding}</p>
                  </div>
                  <ChevronRight size={16} />
                </summary>
                <div className="bd-audit-indicators">
                  {audit.metrics
                    .filter((metric) => metric.dimension === dimension.id)
                    .map((metric) => (
                      <article className="bd-audit-indicator" key={metric.id}>
                        <header>
                          <strong>{metric.label}</strong>
                          <span>
                            {metric.status === "not_applicable"
                              ? "不适用"
                              : metric.score === null
                                ? "依据不足"
                                : metric.method === "calculated"
                                  ? `${audit.samples}/${audit.plannedSamples} 份 · ${metric.score}/${metric.weight} 分`
                                  : `${metric.value === 1 ? "充分" : metric.value === 0.5 ? "部分" : "未达到"} · ${metric.score}/${metric.weight} 分`}
                          </span>
                        </header>
                        <p>{metric.explanation}</p>
                        {metric.satisfied && (
                          <p>
                            <strong>支持依据：</strong>
                            {metric.satisfied}
                          </p>
                        )}
                        {metric.limitations && (
                          <p>
                            <strong>缺口与边界：</strong>
                            {metric.limitations}
                          </p>
                        )}
                        {!!metric.knowledgeRefs.length && (
                          <div className="bd-audit-evidence">
                            <span>知识依据</span>
                            {metric.knowledgeRefs.map((ref, refIndex) => (
                              <div key={`${ref.docPath}-${refIndex}`}>
                                <blockquote>{ref.excerpt}</blockquote>
                                <button
                                  className="bd-link"
                                  onClick={() => onKnowledge(ref.docPath)}
                                >
                                  查看知识节点 <ArrowUpRight size={13} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {!!metric.answerRefs.length && (
                          <>
                            <button
                              className="bd-link"
                              onClick={() => onAnswers(`audit:${metric.id}`)}
                            >
                              查看{" "}
                              {
                                new Set(
                                  metric.answerRefs.map((ref) => ref.sampleId),
                                ).size
                              }{" "}
                              份回答依据 <ChevronRight size={13} />
                            </button>
                            <div className="bd-audit-evidence">
                              {metric.answerRefs
                                .slice(0, 2)
                                .map((ref, refIndex) => (
                                  <div key={`${ref.sampleId}-${refIndex}`}>
                                    <blockquote>{ref.excerpt}</blockquote>
                                    <button
                                      className="bd-link"
                                      onClick={() => onAnswer(ref.sampleId)}
                                    >
                                      打开对应回答 <ChevronRight size={13} />
                                    </button>
                                  </div>
                                ))}
                            </div>
                          </>
                        )}
                      </article>
                    ))}
                </div>
              </details>
            ))}
          </div>
          <p className="bd-note">
            点击维度展开评分依据。缺少依据的项目不补零、不重新分配权重；四类问题不合成为企业总分。
          </p>
        </>
      ) : (
        <div className="bd-audit-empty" aria-live="polite">
          <p>
            {pending
              ? "正在使用本题已保存的回答进行语义评估。"
              : status === "failed"
                ? "本题语义评估尚未完成，分类指标和原始回答已保留。"
                : "本题分类指标已保存，可继续查看五维语义表现。"}
          </p>
          {error && status === "failed" && (
            <p className="bd-invalid">{error}</p>
          )}
          {allowRequest && !pending && (
            <button disabled={disabled} onClick={onRequest}>
              {status === "failed"
                ? "复用回答，重试语义评估"
                : "复用回答，补充语义评估"}
            </button>
          )}
          {!allowRequest && !pending && (
            <p className="bd-note">
              系统将自动继续本题语义评估，无需再次采集。
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function DiagnosticOverview({
  run,
  onAnswers,
}: {
  run: DiagnosticRunView;
  onAnswers: (category: DiagnosticCategory, metric?: string) => void;
}) {
  const completed = DIAGNOSTIC_CATEGORIES.filter(
    (category) => run.results[category],
  ).length;
  const comparisons = DIAGNOSTIC_CATEGORIES.flatMap(
    (category) => run.results[category]?.assessment.topics ?? [],
  );
  const primary = {
    industry_ranking: "recommend",
    competitor_comparison: "subject",
    reputation: "negative",
    product_scenario: "coverage",
  };
  return (
    <section
      className="bd-overview"
      aria-labelledby="diagnostic-overview-title"
    >
      <div className="bd-subheading">
        <div>
          <span className="bd-eyebrow">本轮回答表现</span>
          <h3 id="diagnostic-overview-title">当前评估总览</h3>
        </div>
        <span className="bd-pill">{completed} / 4 类诊断已返回</span>
      </div>
      <p className="bd-note">
        {run.subject} · 知识版本 {run.basis.version} · 已保存{" "}
        {run.completedSamples} / {run.expectedSamples}{" "}
        份回答。各类单独解读，不合成为企业总分。
      </p>
      <div className="bd-overview-grid">
        {DIAGNOSTIC_CATEGORIES.map((category) => {
          const result = run.results[category];
          const metric = result?.metrics.find(
            (item) => item.id === primary[category],
          );
          return (
            <article
              className={`bd-overview-card bd-result--${category}`}
              key={category}
            >
              <a href={`#result-${category}`}>
                <span className="bd-category-dot" />
                {DIAGNOSTIC_LABELS[category]}
                <ArrowUpRight size={16} />
              </a>
              {metric ? (
                <button
                  className="bd-overview-metric"
                  onClick={() => onAnswers(category, metric.id)}
                >
                  <span>{metric.label}</span>
                  <strong>
                    {metric.value ?? "—"}
                    <small>{metric.value === null ? "" : metric.unit}</small>
                  </strong>
                  <small>
                    {metric.denominator !== undefined
                      ? `统计基数 ${metric.denominator} · `
                      : ""}
                    点击查看依据
                  </small>
                </button>
              ) : (
                <p className="bd-overview-pending">
                  {run.phase === "stopped"
                    ? "本类尚未完成"
                    : "等待本类诊断结果"}
                </p>
              )}
              <p>
                {result?.assessment.summary ??
                  "回答齐全并通过校验后，展示本类发现与证据。"}
              </p>
              {result && (
                <small>
                  有效样本 {result.samples} / {run.platforms.length * 5}
                </small>
              )}
            </article>
          );
        })}
      </div>
      {!!comparisons.length && (
        <div className="bd-overview-evidence">
          <strong>知识对照 · {comparisons.length} 个抽选要点</strong>
          <div>
            {(Object.keys(DIAGNOSTIC_VERDICTS) as Verdict[]).map((verdict) => (
              <span
                className={`bd-verdict bd-verdict--${verdict}`}
                key={verdict}
              >
                {DIAGNOSTIC_VERDICTS[verdict]}{" "}
                {
                  comparisons.filter((topic) => topic.verdict === verdict)
                    .length
                }
              </span>
            ))}
          </div>
          <p>
            按各题抽选要点计数，同一事实可能在不同问题中出现，不代表全知识库覆盖率。
          </p>
        </div>
      )}
    </section>
  );
}

export function DiagnosticKnowledgeComparison({
  run,
  categoryScope,
  onKnowledge,
  onAnswers,
  onAnswer,
}: {
  run: DiagnosticRunView;
  categoryScope?: DiagnosticCategory;
  onKnowledge: (path?: string) => void;
  onAnswers: (category: DiagnosticCategory, metric: string) => void;
  onAnswer: (category: DiagnosticCategory, sampleId: string) => void;
}) {
  const [category, setCategory] = useState<DiagnosticCategory | "all">("all");
  const [verdict, setVerdict] = useState<Verdict | "all">("all");
  const topics = DIAGNOSTIC_CATEGORIES.flatMap((category) =>
    (run.results[category]?.assessment.topics ?? []).map((topic, index) => ({
      ...topic,
      category,
      index,
    })),
  );
  const selectedCategory = categoryScope ?? category;
  const scoped = topics.filter(
    (topic) =>
      selectedCategory === "all" || topic.category === selectedCategory,
  );
  const visible = scoped.filter(
    (topic) => verdict === "all" || topic.verdict === verdict,
  );
  const evidenceCount = new Set(
    scoped.flatMap((topic) => topic.answerRefs.map((ref) => ref.sampleId)),
  ).size;
  return (
    <section
      id={
        categoryScope
          ? `diagnostic-comparison-${categoryScope}`
          : "diagnostic-comparison"
      }
      className="bd-comparison"
      aria-labelledby={`diagnostic-comparison-title-${categoryScope ?? "all"}`}
    >
      <div className="bd-subheading">
        <div>
          <span className="bd-eyebrow">
            <ShieldCheck size={14} /> 语义审计依据
          </span>
          <h3 id={`diagnostic-comparison-title-${categoryScope ?? "all"}`}>
            知识库对照
          </h3>
          <p>知识库说了什么，AI 如何回答，差异的依据在哪里。</p>
        </div>
        {!categoryScope && (
          <label>
            诊断类别
            <select
              aria-label="筛选知识对照类别"
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as typeof category)
              }
            >
              <option value="all">全部四类</option>
              {DIAGNOSTIC_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {DIAGNOSTIC_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="bd-comparison-scope">
        <span>
          <strong>{scoped.length}</strong> 个对照要点
        </span>
        <span>
          <strong>{evidenceCount}</strong> 份关联回答
        </span>
        <span>
          本轮知识版本 <strong>{run.basis.version}</strong>
        </span>
      </div>
      <p className="bd-note">
        对照基准来自本轮冻结知识。与知识一致不代表已获外部证实；“无法核验”不等于错误，待核实事实仍保留其边界。
      </p>
      <div className="bd-comparison-filters" aria-label="筛选知识对照判断">
        <button
          aria-pressed={verdict === "all"}
          onClick={() => setVerdict("all")}
        >
          全部 <strong>{scoped.length}</strong>
        </button>
        {(Object.keys(DIAGNOSTIC_VERDICTS) as Verdict[]).map((item) => (
          <button
            key={item}
            data-verdict={item}
            aria-pressed={verdict === item}
            onClick={() => setVerdict(item)}
          >
            {DIAGNOSTIC_VERDICTS[item]}{" "}
            <strong>
              {scoped.filter((topic) => topic.verdict === item).length}
            </strong>
          </button>
        ))}
      </div>
      <div className="bd-comparison-list">
        {visible.map((topic) => (
          <article
            key={`${topic.category}-${topic.index}`}
            className="bd-comparison-card"
          >
            <header>
              <div>
                <span className="bd-pill">
                  {DIAGNOSTIC_LABELS[topic.category]}
                </span>
                <h4>{topic.topic}</h4>
              </div>
              <span className={`bd-verdict bd-verdict--${topic.verdict}`}>
                {DIAGNOSTIC_VERDICTS[topic.verdict]}
              </span>
            </header>
            <div className="bd-comparison-columns">
              <section>
                <h5>
                  <BookOpen size={16} /> 当前知识库
                </h5>
                {topic.kbExcerpt ? (
                  <blockquote>{topic.kbExcerpt}</blockquote>
                ) : (
                  <p className="bd-note">当前知识库未提供可定位的相关依据。</p>
                )}
                {topic.docPath && (
                  <button
                    className="bd-link"
                    onClick={() => onKnowledge(topic.docPath!)}
                  >
                    查看知识节点 <ArrowUpRight size={14} />
                  </button>
                )}
              </section>
              <section>
                <h5>
                  <MessagesSquare size={16} /> 本轮 AI 回答
                </h5>
                {topic.answerRefs.length ? (
                  <>
                    {topic.answerRefs.slice(0, 2).map((ref, index) => (
                      <div
                        className="bd-comparison-excerpt"
                        key={`${ref.sampleId}-${index}`}
                      >
                        <blockquote>{ref.excerpt}</blockquote>
                        <button
                          className="bd-link"
                          onClick={() => onAnswer(topic.category, ref.sampleId)}
                        >
                          查看这份回答 <ChevronRight size={14} />
                        </button>
                      </div>
                    ))}
                    {topic.answerRefs.length > 2 && (
                      <button
                        className="bd-link"
                        onClick={() =>
                          onAnswers(topic.category, `topic:${topic.index}`)
                        }
                      >
                        查看全部 {topic.answerRefs.length} 份回答依据{" "}
                        <ChevronRight size={14} />
                      </button>
                    )}
                  </>
                ) : (
                  <p className="bd-note">
                    {topic.verdict === "omitted"
                      ? "本轮回答未覆盖该知识要点。"
                      : "当前没有可定位的回答摘录，保留判断限制。"}
                  </p>
                )}
              </section>
            </div>
            <p className="bd-comparison-conclusion">
              <strong>对照判断</strong>
              {topic.explanation}
            </p>
          </article>
        ))}
        {!visible.length && (
          <div className="bd-empty">
            {topics.length
              ? "当前筛选下没有对照要点。"
              : "分类诊断完成后，将在这里逐项展示知识与回答的对照。"}
          </div>
        )}
      </div>
    </section>
  );
}
