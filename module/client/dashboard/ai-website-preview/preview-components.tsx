import type { CSSProperties, ReactNode } from "react";
import {
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  FileText,
  Globe2,
  Grid2X2,
  Monitor,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import type {
  AiWebsitePreviewPage,
  WebsiteDraft,
  WebsitePreviewDevice,
  WebsitePreviewFixture,
} from "./types";

export function PreviewButton({
  children,
  variant = "default",
  onClick,
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  variant?: "default" | "primary" | "soft" | "warning" | "ghost";
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      className={`awp-button awp-button--${variant} ${className}`.trim()}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

export function PreviewPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "violet" | "success" | "warning";
}) {
  return <span className={`awp-pill awp-pill--${tone}`}>{children}</span>;
}

export function LocalOnlyBadge() {
  return (
    <span className="awp-local-badge">
      <Monitor aria-hidden="true" size={13} />
      本地预览 · 未连接线上
    </span>
  );
}

export function FlowNavigation({
  fixture,
  activePage,
  onNavigate,
}: {
  fixture: WebsitePreviewFixture;
  activePage: AiWebsitePreviewPage;
  onNavigate: (page: AiWebsitePreviewPage) => void;
}) {
  return (
    <section className="awp-flow" aria-label="网站管理流程">
      <div className="awp-flow__intro">
        <span>网站管理流程</span>
        <small>第一版开放前两步，后续步骤已预留</small>
      </div>
      <div className="awp-flow__steps">
        {fixture.flow.map((step) => {
          const isActive = step.previewPage === activePage;
          const isAvailable = Boolean(step.previewPage);
          return (
            <button
              aria-current={isActive ? "step" : undefined}
              className={`awp-flow-step ${step.number ? "awp-flow-step--route" : ""} ${isActive ? "is-active" : ""}`.trim()}
              disabled={!isAvailable}
              key={step.id}
              onClick={() => step.previewPage && onNavigate(step.previewPage)}
              title={isAvailable ? `进入${step.label}` : `${step.label}将在后续预览中开放`}
              type="button"
            >
              <span className="awp-flow-step__number">
                {step.number ?? <Grid2X2 aria-hidden="true" size={15} />}
              </span>
              <span>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
              {isActive && <em>当前</em>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function DeviceSwitch({
  value,
  onChange,
}: {
  value: WebsitePreviewDevice;
  onChange: (value: WebsitePreviewDevice) => void;
}) {
  return (
    <div className="awp-device-switch" aria-label="预览设备" role="group">
      <button
        aria-label="桌面预览"
        aria-pressed={value === "desktop"}
        onClick={() => onChange("desktop")}
        type="button"
      >
        <Monitor aria-hidden="true" size={15} />
      </button>
      <button
        aria-label="手机预览"
        aria-pressed={value === "mobile"}
        onClick={() => onChange("mobile")}
        type="button"
      >
        <Smartphone aria-hidden="true" size={15} />
      </button>
    </div>
  );
}

export function WebsiteCanvas({
  fixture,
  draft,
  compact = false,
  device = "desktop",
  selectedPage = "home",
  selectedSection,
}: {
  fixture: WebsitePreviewFixture;
  draft: WebsiteDraft;
  compact?: boolean;
  device?: WebsitePreviewDevice;
  selectedPage?: string;
  selectedSection?: string;
}) {
  const style = { "--awp-site-accent": draft.accent } as CSSProperties;
  const selected = (section: string) =>
    selectedPage === "home" && selectedSection === section ? "is-selected" : "";

  return (
    <div
      className={`awp-site ${compact ? "is-compact" : ""} ${device === "mobile" ? "is-mobile" : ""}`}
      style={style}
    >
      <div className={`awp-site__nav ${selected("navigation")}`}>
        <div className="awp-site__brand">
          <strong>{fixture.customer.wordmark}</strong>
          <small>{fixture.customer.shortName}</small>
        </div>
        <div className="awp-site__links" aria-hidden="true">
          {fixture.site.navigation.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>

      {selectedPage === "home" ? (
        <>
          <section className={`awp-site__hero ${selected("hero")}`}>
            <div className="awp-site__hero-copy">
              <span>{fixture.site.eyebrow}</span>
              <h2>
                {draft.heroTitle.split("\n").map((line, index) => (
                  <span key={`${line}-${index}`}>{line}</span>
                ))}
              </h2>
              <p>
                {draft.heroDescription.split("\n").map((line, index) => (
                  <span key={`${line}-${index}`}>{line}</span>
                ))}
              </p>
              <span className="awp-site__cta">
                {draft.callToAction} <span aria-hidden="true">↗</span>
              </span>
            </div>
            <div className="awp-site__art" aria-hidden="true">
              <i />
              <b />
              <span />
            </div>
            {selectedSection === "hero" && !compact && (
              <span className="awp-site__selection-label">首屏介绍</span>
            )}
          </section>
          <div className="awp-site__trust">
            {fixture.site.trustPoints.map((point) => (
              <span key={point}>{point}</span>
            ))}
          </div>
          <section className={`awp-site__services ${selected("services")}`}>
            <h3>从了解开始，找到适合的服务</h3>
            <div>
              {fixture.site.serviceCards.map((card) => (
                <article key={card.number}>
                  <b>{card.number}</b>
                  <strong>{card.title}</strong>
                  <p>{card.description}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="awp-site__inner-page">
          <span>{fixture.customer.shortName}</span>
          <h2>
            {fixture.pages.find((page) => page.id === selectedPage)?.label ?? "页面预览"}
          </h2>
          <p>此页面已纳入第一版信息架构，详细内容将在后续迭代中继续完善。</p>
          <div className="awp-site__placeholder-lines">
            <i />
            <i />
            <i />
          </div>
        </section>
      )}
    </div>
  );
}

export function EvaluationPanel({
  fixture,
  stale = false,
}: {
  fixture: WebsitePreviewFixture;
  stale?: boolean;
}) {
  const { evaluation } = fixture;
  const scoreStyle = {
    "--awp-score-progress": `${evaluation.score * 3.6}deg`,
  } as CSSProperties;

  return (
    <section className="awp-evaluation" aria-label="Evaluation 示例评分">
      <div className="awp-evaluation__head">
        <div>
          <h2>Evaluation</h2>
          <PreviewPill tone={stale ? "warning" : "violet"}>
            {stale ? "旧快照 · 待复评" : "示例评分"}
          </PreviewPill>
        </div>
        <span className="awp-evaluation__scope-link">
          官网质量 <ChevronRight aria-hidden="true" size={14} />
        </span>
      </div>
      <p className="awp-evaluation__scope">
        草稿 {fixture.versions.draft} · 知识库 {fixture.versions.knowledge} · 规则{" "}
        {fixture.versions.evaluationRule}
      </p>
      <div className="awp-evaluation__summary">
        <div className="awp-score-ring" style={scoreStyle}>
          <span>
            <strong>{evaluation.score}</strong>
            <small>/100</small>
          </span>
        </div>
        <div>
          <h3>{stale ? "草稿已变化 · 得分待复评" : "已确认得分 · 暂定"}</h3>
          <p>5 个维度持续量化，得分与发布条件分别判断。</p>
          <PreviewPill tone="warning">
            {evaluation.pendingCriticalItems} 项关键条件待核实
          </PreviewPill>
        </div>
      </div>
      <div className="awp-evaluation__coverage">
        <span>
          判定覆盖 <b>{evaluation.coverage}%</b>
        </span>
        <span>
          待确定 <b>{evaluation.pendingWeight} 分权重</b>
        </span>
      </div>
      <div className="awp-evaluation__dimensions">
        {evaluation.dimensions.map((dimension) => (
          <div key={dimension.id}>
            <span>
              {dimension.label}
              <b>
                {dimension.score} / {dimension.weight}
              </b>
            </span>
            <i>
              <em style={{ width: `${(dimension.score / dimension.weight) * 100}%` }} />
            </i>
          </div>
        ))}
      </div>
      <div className="awp-evaluation__foot">
        <span>评估快照：{fixture.timestamps.evaluated}</span>
        <span>分数与权重均为设计示例</span>
      </div>
      <div className="awp-evaluation__gate">
        <div>
          <ShieldCheck aria-hidden="true" size={17} />
          <strong>发布条件</strong>
          <PreviewPill tone="warning">暂不可发布</PreviewPill>
        </div>
        <p>
          {stale
            ? `旧评估快照曾达建议门槛 ${evaluation.suggestedThreshold}；当前草稿须复评，且联系方式待核实。`
            : `当前示例得分已达建议门槛 ${evaluation.suggestedThreshold}，但联系方式仍缺确认依据。`}
        </p>
      </div>
      <div className="awp-example-disclaimer">
        <CircleAlert aria-hidden="true" size={15} />
        这是离线方案演示，不代表真实检测结果，也不会触发发布。
      </div>
    </section>
  );
}

export function ContextStrip({ fixture }: { fixture: WebsitePreviewFixture }) {
  return (
    <div className="awp-context-strip">
      <div>
        <span className="awp-context-strip__icon">
          <FileText aria-hidden="true" size={17} />
        </span>
        <span>
          <strong>当前草稿 {fixture.versions.draft}</strong>
          <small>保存于{fixture.timestamps.draftSaved}</small>
        </span>
      </div>
      <div>
        <span className="awp-context-strip__icon">
          <BookOpen aria-hidden="true" size={17} />
        </span>
        <span>
          <strong>知识库 {fixture.versions.knowledge}</strong>
          <small>仅使用公开资料</small>
        </span>
      </div>
      <div>
        <span>
          <strong>发布检查</strong>
          <small>1 项信息待核实</small>
        </span>
        <span className="awp-context-strip__link">查看 →</span>
      </div>
    </div>
  );
}

export function OnlineVersionCard({ fixture }: { fixture: WebsitePreviewFixture }) {
  return (
    <section className="awp-online-card">
      <div>
        <h3>当前线上版本</h3>
        <PreviewPill tone="success">{fixture.versions.online}</PreviewPill>
      </div>
      <p>
        <Globe2 aria-hidden="true" size={15} />
        {fixture.site.displayDomain}
        <PreviewPill>示例地址</PreviewPill>
      </p>
      <small>最近发布：{fixture.timestamps.lastPublished}</small>
    </section>
  );
}

export function LocalActionNotice({ children }: { children: ReactNode }) {
  return (
    <div className="awp-action-notice" role="status">
      <Check aria-hidden="true" size={16} />
      {children}
    </div>
  );
}

