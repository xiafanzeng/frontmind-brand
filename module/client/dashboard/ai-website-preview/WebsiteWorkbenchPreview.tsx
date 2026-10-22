import { useState } from "react";
import {
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  ExternalLink,
  Layers3,
  PenLine,
  Settings2,
} from "lucide-react";
import { websitePreviewFixture } from "./fixtures";
import {
  ContextStrip,
  EvaluationPanel,
  LocalActionNotice,
  OnlineVersionCard,
  PreviewButton,
  PreviewPill,
  WebsiteCanvas,
} from "./preview-components";
import type {
  AiWebsitePreviewPage,
  WebsiteDraft,
  WebsitePreviewFixture,
} from "./types";

export type WebsiteWorkbenchPreviewProps = {
  fixture?: WebsitePreviewFixture;
  draft?: WebsiteDraft;
  evaluationStale?: boolean;
  onNavigate?: (page: AiWebsitePreviewPage) => void;
};

export function WebsiteWorkbenchPreview({
  fixture = websitePreviewFixture,
  draft = fixture.site.defaultDraft,
  evaluationStale = false,
  onNavigate = () => undefined,
}: WebsiteWorkbenchPreviewProps) {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="awp-workbench">
      <div className="awp-page-main">
        <header className="awp-page-heading">
          <div>
            <h1>网站工作台</h1>
            <p>
              {fixture.customer.projectName} · 从编辑到上线，持续量化官网质量
            </p>
          </div>
          <div className="awp-heading-actions">
            <PreviewButton
              onClick={() => setNotice("站点设置将在后续预览开放；当前没有修改任何线上配置。")}
            >
              <Settings2 aria-hidden="true" size={16} />
              站点设置
            </PreviewButton>
            <PreviewButton variant="primary" onClick={() => onNavigate("editor")}>
              <PenLine aria-hidden="true" size={16} />
              编辑网站
            </PreviewButton>
          </div>
        </header>

        {notice && <LocalActionNotice>{notice}</LocalActionNotice>}

        <ContextStrip fixture={fixture} />

        <section className="awp-preview-card">
          <div className="awp-card-heading">
            <div>
              <span className="awp-card-heading__icon">
                <ExternalLink aria-hidden="true" size={17} />
              </span>
              <h2>官网草稿预览</h2>
              <PreviewPill tone="violet">
                {fixture.versions.draft} · 未发布
              </PreviewPill>
            </div>
            <button onClick={() => onNavigate("editor")} type="button">
              继续编辑 <ExternalLink aria-hidden="true" size={14} />
            </button>
          </div>
          <div className="awp-browser-bar">
            <span>
              <i />
              <i />
              <i />
            </span>
            <p>草稿内容尚未对访客生效</p>
          </div>
          <div className="awp-preview-card__canvas">
            <WebsiteCanvas compact draft={draft} fixture={fixture} />
          </div>
          <footer className="awp-preview-card__footer">
            <span>首页 / 服务介绍 / 常见问题 / 联系我们</span>
            <span>{fixture.site.pageCount} 个页面</span>
          </footer>
        </section>

        <div className="awp-overview-grid">
          <button
            onClick={() => setNotice("版本与发布仅做界面预留；第一版不会向线上提交。")}
            type="button"
          >
            <span className="awp-overview-grid__icon">
              <Layers3 aria-hidden="true" size={19} />
            </span>
            <span>
              <strong>版本与发布</strong>
              <small>对比版本得分、变更与发布结果</small>
            </span>
            <ArrowRight aria-hidden="true" size={17} />
          </button>
          <button
            onClick={() => setNotice("运行数据尚未接入；缺失数据不会被当作零分。")}
            type="button"
          >
            <span className="awp-overview-grid__icon">
              <ChartNoAxesColumnIncreasing aria-hidden="true" size={19} />
            </span>
            <span>
              <strong>
                运行 Evaluation <PreviewPill>待接入</PreviewPill>
              </strong>
              <small>访问体验、问答解决与联系点击</small>
            </span>
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </div>

        <footer className="awp-page-footnote">
          网站内容更新后，在发布检查中确认对应版本。
          <span>01 / WEBSITE MANAGEMENT</span>
        </footer>
      </div>

      <aside className="awp-inspector awp-workbench__rail">
        <EvaluationPanel fixture={fixture} stale={evaluationStale} />
        <OnlineVersionCard fixture={fixture} />
        <PreviewButton
          className="awp-wide-button"
          onClick={() => setNotice("版本页将在后续预览开放，当前线上版本没有变化。")}
          variant="soft"
        >
          <Layers3 aria-hidden="true" size={16} />
          查看版本得分与发布
        </PreviewButton>
      </aside>
    </div>
  );
}

