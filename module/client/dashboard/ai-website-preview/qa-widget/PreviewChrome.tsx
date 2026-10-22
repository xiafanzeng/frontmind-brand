import type { ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  Bot,
  ChevronDown,
  CircleUserRound,
  Crosshair,
  Folder,
  Globe2,
  Megaphone,
  PenLine,
  Settings2,
  Sparkles,
} from "lucide-react";
import { qaWidgetFixture, type PreviewModuleTarget } from "./fixtures";

type PreviewChromeProps = {
  activeModule: "enterprise-qa" | "widget-config";
  onNavigate: (target: PreviewModuleTarget) => void;
  subnavigation: ReactNode;
  children: ReactNode;
};

const suiteItems = [
  { label: "品牌建设", Icon: BookOpen, active: false },
  { label: "意图优化", Icon: Crosshair, active: false },
  { label: "进度监控", Icon: BarChart3, active: false },
  { label: "内容制作", Icon: PenLine, active: false },
  { label: "媒体发布", Icon: Megaphone, active: false },
  { label: "AI 专用官网", Icon: Globe2, active: true },
] as const;

export function PreviewChrome({
  activeModule,
  onNavigate,
  subnavigation,
  children,
}: PreviewChromeProps) {
  const { customer, product } = qaWidgetFixture;
  return (
    <div className="aqwp-shell">
      <aside className="aqwp-sidebar" aria-label="FrontMind 产品导航">
        <div className="aqwp-brand" aria-label={product.name}>
          <span className="aqwp-brand__mark">FM</span>
          <span className="aqwp-brand__name">{product.name}</span>
          <sup>®</sup>
        </div>

        <div className="aqwp-suite-title">
          <span className="aqwp-suite-title__icon"><Sparkles /></span>
          <span>AI 智能品牌优化</span>
          <ChevronDown className="aqwp-suite-title__chevron" />
        </div>

        <nav className="aqwp-sidebar__nav">
          {suiteItems.map(({ label, Icon, active }) => (
            <button
              className={`aqwp-side-link${active ? " is-active" : ""}`}
              type="button"
              key={label}
              aria-current={active ? "page" : undefined}
              onClick={() => active && onNavigate("website")}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
          <div className="aqwp-side-link aqwp-side-link--agent">
            <Bot />
            <span>通用智能体</span>
          </div>
        </nav>

        <div className="aqwp-sidebar__bottom">
          <button className="aqwp-project-card" type="button">
            <Folder />
            <span>
              <strong>项目总览</strong>
              <small>{customer.projectName}</small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
          <div className="aqwp-account">
            <CircleUserRound />
            <span>本地预览用户</span>
            <Settings2 />
          </div>
        </div>
      </aside>

      <main className="aqwp-main">
        <header className="aqwp-topbar">
          <strong className="aqwp-topbar__title">{product.moduleName}</strong>
          <nav className="aqwp-topnav" aria-label="AI 官网模块">
            <button
              type="button"
              className={activeModule === "enterprise-qa" ? "is-active" : ""}
              aria-current={activeModule === "enterprise-qa" ? "page" : undefined}
              onClick={() => onNavigate("enterprise-qa")}
            >
              企业问答
            </button>
            <button type="button" onClick={() => onNavigate("website")}>
              网站管理
            </button>
            <button
              type="button"
              className={activeModule === "widget-config" ? "is-active" : ""}
              aria-current={activeModule === "widget-config" ? "page" : undefined}
              onClick={() => onNavigate("widget-config")}
            >
              AI 部件
            </button>
          </nav>
          <div className="aqwp-topbar__meta">
            <span>任务中心</span>
            <span>{product.designVersion}</span>
          </div>
        </header>
        {subnavigation}
        {children}
      </main>
    </div>
  );
}

