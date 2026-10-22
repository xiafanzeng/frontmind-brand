import { useEffect, useState } from "react";
import { requestWorkspaceNavigation } from "../../../host";
import { EnterpriseQaPreview, EnterpriseQaSubnavigation } from "./EnterpriseQaPreview";
import { PreviewChrome } from "./PreviewChrome";
import { WidgetConfigPreview, WidgetSubnavigation } from "./WidgetConfigPreview";
import type { PreviewModuleTarget } from "./fixtures";
import "./qa-widget-preview.css";

export type QaWidgetPreviewPage = "enterprise-qa" | "widget-config";

export type QaWidgetPreviewProps = {
  initialPage?: QaWidgetPreviewPage;
  onNavigate?: (target: PreviewModuleTarget) => void;
  className?: string;
  embedded?: boolean;
};

export function QaWidgetPreview({
  initialPage = "enterprise-qa",
  onNavigate,
  className = "",
  embedded = false,
}: QaWidgetPreviewProps) {
  const [activePage, setActivePage] = useState<QaWidgetPreviewPage>(initialPage);
  const [notice, setNotice] = useState("");

  useEffect(() => setActivePage(initialPage), [initialPage]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const navigate = (target: PreviewModuleTarget) => {
    if (target === "enterprise-qa" || target === "widget-config") {
      requestWorkspaceNavigation(() => {
        setActivePage(target);
        onNavigate?.(target);
      });
      return;
    }
    if (target === "website") {
      requestWorkspaceNavigation(() => {
        if (onNavigate) onNavigate(target);
        else setNotice("网站管理使用内部导航回调；接入第一版总预览后会在同一应用中打开。");
      });
      return;
    }
    const messages: Record<Exclude<PreviewModuleTarget, QaWidgetPreviewPage | "website">, string> = {
      "widget-test": "对话测试将在下一视图接入；当前实时预览已可试用建议提问。",
      "widget-evaluation": "完整评估与应用页将在下一视图接入；当前可查看示例评分快照。",
      "widget-runtime": "运行效果需要真实埋点数据，第一版仅预留流程入口。",
    };
    setNotice(messages[target]);
  };

  const subnavigation = activePage === "enterprise-qa" ? (
    <EnterpriseQaSubnavigation />
  ) : (
    <WidgetSubnavigation onNavigate={navigate} />
  );
  const page = activePage === "enterprise-qa" ? (
    <EnterpriseQaPreview onNavigate={navigate} onNotice={setNotice} />
  ) : (
    <WidgetConfigPreview onNavigate={navigate} onNotice={setNotice} />
  );

  return (
    <div
      className={`aqwp-root${embedded ? " aqwp-root--embedded" : ""} ${className}`.trim()}
      data-preview-page={activePage}
    >
      {embedded ? (
        <div className="aqwp-embedded">{subnavigation}{page}</div>
      ) : (
        <PreviewChrome
          activeModule={activePage}
          onNavigate={navigate}
          subnavigation={subnavigation}
        >
          {page}
        </PreviewChrome>
      )}
      {notice && <div className="aqwp-toast" role="status">{notice}</div>}
    </div>
  );
}

export default QaWidgetPreview;

