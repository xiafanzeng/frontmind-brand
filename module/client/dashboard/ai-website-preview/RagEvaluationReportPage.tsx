import { lazy, Suspense, useEffect, useState } from "react";
import type { EnterpriseRagEvaluationCoordinate } from "../enterprise-rag-evaluation-api";
import { RagEvaluationReportRules } from "./RagEvaluationReportRules";
import { RagEvaluationReportRecords } from "./RagEvaluationReportRecords";
import { ragPreviewFixturesEnabled } from "./rag-preview-fixture-loader";
import "../../brand-apple-theme.css";
import "./rag-evaluation-report.css";

const contents = [
  ["evaluation-scope", "评估对象"], ["dimensions", "六维权重"],
  ["calculation", "计算方法"], ["verdicts", "风险与结论"],
  ["uncertainty", "缺失证据"], ["limits", "使用边界与验收参数"],
] as const;

const LazyRagEvaluationPreviewRecord = ragPreviewFixturesEnabled
  ? lazy(() => import("./RagEvaluationPreviewRecord"))
  : null;

function PreviewExampleRecord({ exampleId }: { exampleId: string }) {
  if (!LazyRagEvaluationPreviewRecord) {
    return <section id="records"><h2>02 评估记录</h2><p className="rag-report-message" role="alert">当前构建不提供本地预览记录。</p></section>;
  }
  return <Suspense fallback={<section id="records"><h2>02 评估记录</h2><p className="rag-report-message" role="status">正在加载本地示例…</p></section>}><LazyRagEvaluationPreviewRecord exampleId={exampleId} /></Suspense>;
}

export default function RagEvaluationReportPage({ storageScopeKey, preview, coordinate, exampleId, contextError, returnUrl, brandMarkSrc }: {
  storageScopeKey: string;
  preview: boolean;
  coordinate?: EnterpriseRagEvaluationCoordinate;
  exampleId?: string;
  contextError: string | null;
  returnUrl: string;
  brandMarkSrc: string;
}) {
  const [activeSection, setActiveSection] = useState("rules");
  const error = contextError ?? (!preview && exampleId !== undefined
    ? "报告链接无效。请从企业知识问答打开真实评估记录。"
    : exampleId !== undefined && coordinate
    ? "示例报告不能混用真实回答标识。" : null);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "企业 RAG 评估说明与记录 · FrontMind";
    let cancelled = false;
    let interacted = false;
    const markInteraction = () => { interacted = true; };
    const updateSection = () => {
      const recordTop = document.getElementById("records")?.getBoundingClientRect().top ?? Infinity;
      setActiveSection(recordTop <= 180 ? "records" : "rules");
    };
    window.addEventListener("wheel", markInteraction, { passive: true });
    window.addEventListener("touchstart", markInteraction, { passive: true });
    window.addEventListener("keydown", markInteraction);
    window.addEventListener("pointerdown", markInteraction);
    window.addEventListener("scroll", updateSection, { passive: true });
    // Wait for math fonts once, so a deep link lands below the sticky header.
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (cancelled || interacted) return;
      const hash = window.location.hash.slice(1);
      if (["rules", "records", ...contents.map(([id]) => id)].includes(hash)) {
        document.getElementById(hash)?.scrollIntoView({ block: "start", behavior: "instant" });
      }
      updateSection();
    });
    return () => {
      cancelled = true;
      document.title = previousTitle;
      window.removeEventListener("wheel", markInteraction);
      window.removeEventListener("touchstart", markInteraction);
      window.removeEventListener("keydown", markInteraction);
      window.removeEventListener("pointerdown", markInteraction);
      window.removeEventListener("scroll", updateSection);
    };
  }, []);

  return <div className="fm-brand-theme rag-report" data-testid="rag-report-page">
    <a className="rag-report-skip" href="#report-content">跳到报告正文</a>
    <header className="rag-report-topbar">
      <div className="rag-report-topbar-inner">
        <a className="rag-report-brand" href={returnUrl} aria-label="FrontMind 企业 RAG"><img src={brandMarkSrc} alt="FrontMind" /></a>
        <nav aria-label="报告章节"><a href="#rules" aria-current={activeSection === "rules" ? "location" : undefined}>评分规则</a><a href="#records" aria-current={activeSection === "records" ? "location" : undefined}>评估记录</a></nav>
        <a className="rag-report-return" href={returnUrl}>返回企业 RAG</a>
      </div>
    </header>
    <div className="rag-report-wrap">
      <header className="rag-report-hero">
        <p className="rag-report-kicker">FrontMind · 回答质量评估</p>
        <h1>企业 RAG<br />评估说明与记录</h1>
        <p className="rag-report-intro">了解回答如何评分，查看评估依据与结论。</p>
        {preview && <p className="rag-report-caption">示例</p>}
      </header>
      <div className="rag-report-layout">
        <aside className="rag-report-contents" aria-label="报告目录">
          <a href="#rules" aria-current={activeSection === "rules" ? "location" : undefined}>01 评分规则</a>
          <ol>{contents.map(([id, title]) => <li key={id}><a href={`#${id}`}>{title}</a></li>)}</ol>
          <a href="#records" aria-current={activeSection === "records" ? "location" : undefined}>02 评估记录</a>
        </aside>
        <main id="report-content" className="rag-report-content" tabIndex={-1}>
          <RagEvaluationReportRules preview={preview} />
          {error ? <section id="records"><h2>02 评估记录</h2><p className="rag-report-message" role="alert">{error}</p></section>
            : preview && exampleId !== undefined ? <PreviewExampleRecord exampleId={exampleId} />
            : <RagEvaluationReportRecords key={`${storageScopeKey}:${coordinate?.sourceQaTaskId ?? ""}:${coordinate?.turnId ?? ""}`} storageScopeKey={storageScopeKey} preview={preview} coordinate={coordinate} />}
        </main>
      </div>
      <footer className="rag-report-footer">FrontMind · 评估结论用于改进回答，不代替正式验收。</footer>
    </div>
  </div>;
}
