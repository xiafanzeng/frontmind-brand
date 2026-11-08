import { useEffect, useMemo, useState } from "react";

import {
  WEBSITE_BUILD_EVALUATION_CHECKS,
  WEBSITE_BUILD_EVALUATION_DIMENSIONS,
  type WebsiteBuildEvaluationCheckId,
  type WebsiteBuildEvaluationDimensionId,
  type WebsiteBuildEvaluationReport,
} from "../../../contracts/website-build-evaluation-run";
import { liveWebsiteEvaluationApi } from "../website-evaluation-api";
import { websiteEvaluationVerdictLabel } from "./website-evaluation-copy";
import "../../brand-apple-theme.css";
import "./website-evaluation-report.css";

const ANCHOR_LABELS = {
  0: "未达标",
  0.5: "部分达标",
  1: "已达标",
} as const;

const TARGET_LABELS = {
  route: "路由与页面",
  brand_kit: "Brand Kit",
  design_preferences: "视觉配置",
  knowledge: "知识与事实",
  assistant: "助手配置",
  build: "网站构建",
} as const;

type ReportLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; report: WebsiteBuildEvaluationReport };

export function websiteEvaluationReportUrl(reportId: string) {
  const query = new URLSearchParams({
    view: "website",
    websiteReport: reportId,
  });
  return `/?${query.toString()}`;
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "权威评估报告暂时无法读取，请稍后重试。";
}

function findingTargetLabel(
  target: WebsiteBuildEvaluationReport["findings"][number]["target"],
) {
  return [
    TARGET_LABELS[target.kind],
    target.routeId ? `路由 ${target.routeId}` : null,
    target.sectionId ? `区块 ${target.sectionId}` : null,
    target.anchor ? `定位 ${target.anchor}` : null,
  ].filter(Boolean).join(" · ");
}

function EvidenceIds({ ids }: { ids: readonly string[] }) {
  return (
    <ul className="website-report-evidence-ids" aria-label="证据 ID">
      {ids.map((id) => <li key={id}><code>{id}</code></li>)}
    </ul>
  );
}

function ReportLoading() {
  return (
    <main id="website-report-content" className="website-report-state" tabIndex={-1}>
      <div className="website-report-waiting" role="status" aria-live="polite">
        <span className="website-report-waiting-mark" aria-hidden="true"><i /><i /></span>
        <span><strong>正在读取权威报告</strong><small>仅恢复服务端已完成的不可变结果。</small></span>
      </div>
    </main>
  );
}

function ReportError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main id="website-report-content" className="website-report-state" tabIndex={-1}>
      <div className="website-report-error" role="alert">
        <small>报告未打开</small>
        <h1>暂时无法读取建设评估</h1>
        <p>{message}</p>
        <button type="button" onClick={onRetry}>重试</button>
      </div>
    </main>
  );
}

function ReportContents({ report }: { report: WebsiteBuildEvaluationReport }) {
  const judgments = useMemo(
    () => new Map(report.judgments.map((judgment) => [judgment.checkId, judgment])),
    [report.judgments],
  );
  const checksByDimension = useMemo(() => {
    const grouped = new Map<
      WebsiteBuildEvaluationDimensionId,
      Array<(typeof WEBSITE_BUILD_EVALUATION_CHECKS)[number]>
    >();
    for (const dimension of WEBSITE_BUILD_EVALUATION_DIMENSIONS) {
      grouped.set(
        dimension.id,
        WEBSITE_BUILD_EVALUATION_CHECKS.filter(
          (check) => check.dimensionId === dimension.id,
        ),
      );
    }
    return grouped;
  }, []);

  return (
    <main id="website-report-content" className="website-report-main" tabIndex={-1}>
      <header className="website-report-hero">
        <div>
          <p className="website-report-kicker">FrontMind · 建设评估权威报告</p>
          <h1>网站建设评估</h1>
          <p>{report.summary}</p>
          <dl className="website-report-coordinate">
            <div><dt>当前构建</dt><dd>#{report.buildOrdinal}</dd></div>
            <div><dt>完成时间</dt><dd>{formatDate(report.completedAt)}</dd></div>
            <div><dt>报告 ID</dt><dd><code>{report.reportId}</code></dd></div>
          </dl>
        </div>
        <section className={`website-report-score is-${report.verdict}`} aria-label={`网站建设评估最终分 ${report.score} 分`}>
          <span><strong data-testid="website-report-score">{report.score}</strong><small>/100</small></span>
          <p>评估结论</p>
          <h2>{websiteEvaluationVerdictLabel(report.verdict)}</h2>
          {report.criticalRisks.length > 0 && <small>关键风险仅降低结论，未改写真实分数。</small>}
        </section>
      </header>

      <section id="dimensions" className="website-report-section" aria-labelledby="website-report-dimensions-title">
        <header><p>01</p><div><h2 id="website-report-dimensions-title">六维结果</h2><span>每维四项锚点，显示服务端报告中的归一化得分。</span></div></header>
        <div className="website-report-dimensions">
          {report.dimensions.map((dimension) => (
            <article key={dimension.id}>
              <span><strong>{dimension.label}</strong><small>权重 {dimension.weight}%</small></span>
              <p><strong data-testid={`website-report-dimension-${dimension.id}`}>{dimension.normalizedScore}</strong><small>/100</small></p>
              <div className="website-report-score-track" aria-hidden="true"><i style={{ width: `${dimension.normalizedScore}%` }} /></div>
            </article>
          ))}
        </div>
      </section>

      <section id="anchors" className="website-report-section" aria-labelledby="website-report-anchors-title">
        <header><p>02</p><div><h2 id="website-report-anchors-title">24 项锚点与证据</h2><span>锚点值只可为 0、0.5 或 1；证据 ID 来自冻结 manifest。</span></div></header>
        <div className="website-report-anchor-groups">
          {WEBSITE_BUILD_EVALUATION_DIMENSIONS.map((dimension) => (
            <section key={dimension.id} aria-labelledby={`website-report-anchor-${dimension.id}`}>
              <h3 id={`website-report-anchor-${dimension.id}`}>{dimension.label}</h3>
              <div>
                {(checksByDimension.get(dimension.id) ?? []).map((check) => {
                  const judgment = judgments.get(check.id as WebsiteBuildEvaluationCheckId);
                  if (!judgment) return null;
                  return (
                    <article key={check.id} data-testid="website-report-anchor">
                      <header>
                        <span><strong>{check.label}</strong><small>{check.requirement}</small></span>
                        <b className={`is-anchor-${String(judgment.anchor).replace(".", "-")}`}>{judgment.anchor} · {ANCHOR_LABELS[judgment.anchor]}</b>
                      </header>
                      <p>{judgment.rationale}</p>
                      <EvidenceIds ids={judgment.evidenceIds} />
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section id="risks" className="website-report-section" aria-labelledby="website-report-risks-title">
        <header><p>03</p><div><h2 id="website-report-risks-title">关键风险</h2><span>风险可调整发布建议，不会改动报告分数。</span></div></header>
        {report.criticalRisks.length ? (
          <div className="website-report-risks">
            {report.criticalRisks.map((risk) => (
              <article key={risk.id}>
                <span>关键风险</span><h3>{risk.title}</h3><p>{risk.summary}</p>
                <small>关联检查：{risk.checkIds.join("、")}</small>
                <EvidenceIds ids={risk.evidenceIds} />
              </article>
            ))}
          </div>
        ) : <p className="website-report-empty">本报告未记录关键风险。</p>}
      </section>

      <section id="repairs" className="website-report-section" aria-labelledby="website-report-repairs-title">
        <header><p>04</p><div><h2 id="website-report-repairs-title">修复计划</h2><span>目标保留路由、区块和配置坐标，便于回到建站流程处理。</span></div></header>
        {report.findings.length ? (
          <ol className="website-report-findings">
            {report.findings.map((finding) => (
              <li key={finding.id}>
                <article>
                  <header><span className={`is-${finding.severity}`}>{finding.severity}</span><small>{findingTargetLabel(finding.target)}</small></header>
                  <h3>{finding.title}</h3>
                  <p>{finding.summary}</p>
                  <dl><div><dt>影响</dt><dd>{finding.impact}</dd></div><div><dt>建议动作</dt><dd>{finding.suggestedAction}</dd></div></dl>
                  <EvidenceIds ids={finding.evidenceIds} />
                </article>
              </li>
            ))}
          </ol>
        ) : <p className="website-report-empty">本报告没有需要单独列出的修复项。</p>}
      </section>

      <section id="coverage" className="website-report-section" aria-labelledby="website-report-coverage-title">
        <header><p>05</p><div><h2 id="website-report-coverage-title">证据覆盖</h2><span>未提供可选 Brand Kit 只影响品牌参考覆盖，不改变评分分母。</span></div></header>
        <dl className="website-report-coverage">
          <div><dt>必需证据</dt><dd>{report.coverage.requiredEvidencePercent}%</dd></div>
          <div><dt>关键路由三视口</dt><dd>{report.coverage.routeViewportPercent}%</dd></div>
          <div><dt>品牌参考</dt><dd>{report.coverage.brandReferencePercent}%</dd></div>
          <div><dt>关键路由</dt><dd>{report.coverage.criticalRouteIds.join("、")}</dd></div>
          <div><dt>结构检查路由</dt><dd>{report.coverage.structuralRouteIds.join("、") || "无"}</dd></div>
          <div><dt>冻结视口</dt><dd>{report.coverage.viewports.join("、")}</dd></div>
        </dl>
      </section>

      <section id="versions" className="website-report-section" aria-labelledby="website-report-versions-title">
        <header><p>06</p><div><h2 id="website-report-versions-title">版本与不可变坐标</h2><span>历史报告仅在规则、裁判和证据版本相同时可比较。</span></div></header>
        <dl className="website-report-versions">
          <div><dt>规则版本</dt><dd>{report.evaluator.ruleVersion}</dd></div>
          <div><dt>裁判版本</dt><dd>{report.evaluator.judgeVersion}</dd></div>
          <div><dt>证据版本</dt><dd>{report.evaluator.evidenceVersion}</dd></div>
          <div><dt>Skill 版本</dt><dd>{report.evaluator.skillVersion}</dd></div>
          <div><dt>裁判模型</dt><dd>{report.evaluator.provider} · {report.evaluator.model}</dd></div>
          <div><dt>证据指纹</dt><dd><code>{report.evidenceFingerprint}</code></dd></div>
          <div><dt>报告哈希</dt><dd><code>{report.reportHash}</code></dd></div>
          <div><dt>Skill 哈希</dt><dd><code>{report.evaluator.skillHash}</code></dd></div>
          <div><dt>裁判输出哈希</dt><dd><code>{report.evaluator.outputHash}</code></dd></div>
        </dl>
        {report.relatedRagReportIds.length > 0 && <p className="website-report-reference">关联的企业 RAG 报告仅作背景参考：{report.relatedRagReportIds.join("、")}</p>}
      </section>
    </main>
  );
}

export type WebsiteEvaluationReportPageProps = {
  reportId: string;
  returnUrl: string;
  /** Local preview only: renders a frozen fixture without reading the live API. */
  readonly initialReport?: WebsiteBuildEvaluationReport | null;
};

export default function WebsiteEvaluationReportPage({
  reportId,
  returnUrl,
  initialReport = null,
}: WebsiteEvaluationReportPageProps) {
  const [retrySequence, setRetrySequence] = useState(0);
  const [state, setState] = useState<ReportLoadState>(() => initialReport?.reportId === reportId.trim()
    ? { status: "ready", report: initialReport }
    : { status: "loading" });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "网站建设评估报告 · FrontMind";
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    const normalizedReportId = reportId.trim();
    if (!normalizedReportId || normalizedReportId.length > 255) {
      setState({ status: "error", message: "报告链接无效，请从建设评估页重新打开。" });
      return;
    }
    if (initialReport) {
      setState(initialReport.reportId === normalizedReportId
        ? { status: "ready", report: initialReport }
        : { status: "error", message: "本地报告与当前链接不匹配，请从建设评估页重新打开。" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    void liveWebsiteEvaluationApi.report(normalizedReportId).then(
      (report) => {
        if (!cancelled) setState({ status: "ready", report });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) });
      },
    );
    return () => { cancelled = true; };
  }, [initialReport, reportId, retrySequence]);

  return (
    <div className="fm-brand-theme website-evaluation-report" data-testid="website-evaluation-report-page">
      <a className="website-report-skip" href="#website-report-content">跳到报告正文</a>
      <header className="website-report-topbar">
        <div>
          <a className="website-report-brand" href={returnUrl} aria-label="FrontMind 网站建设">FrontMind</a>
          <nav aria-label="报告章节">
            <a href="#dimensions">六维</a><a href="#anchors">24 项锚点</a><a href="#risks">风险与修复</a><a href="#versions">版本</a>
          </nav>
          <a className="website-report-return" href={returnUrl}>返回网站建设</a>
        </div>
      </header>
      <div className="website-report-wrap">
        {state.status === "loading" && <ReportLoading />}
        {state.status === "error" && <ReportError message={state.message} onRetry={() => setRetrySequence((value) => value + 1)} />}
        {state.status === "ready" && <ReportContents report={state.report} />}
        <footer className="website-report-footer">本报告保留服务端权威结果；企业 RAG 报告不进入网站建设得分。</footer>
      </div>
    </div>
  );
}
