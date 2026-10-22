import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  Bot,
  Check,
  CircleAlert,
  FileText,
  Globe2,
  LayoutTemplate,
  MessageCircle,
  Monitor,
  PanelTop,
  Send,
  Smartphone,
  Sparkles,
  X,
} from "lucide-react";
import {
  previewKnowledgeCollectionCount,
  previewKnowledgeFragmentCount,
  previewRagAnswer,
  previewRagQuestion,
} from "./preview-copy";
import "./simplified-product-preview.css";

export type BuildStep = "template" | "structure" | "assistant" | "evaluation";
type PreviewDevice = "desktop" | "mobile";
type SiteLanguage = "zh-CN" | "en-US";

type SimplifiedWebsiteBuilderPreviewProps = {
  initialStep?: BuildStep;
  onOpenRag?: () => void;
  onStepChange?: (step: BuildStep) => void;
};

const steps: ReadonlyArray<{
  id: BuildStep;
  number: string;
  label: string;
}> = [
  { id: "template", number: "1", label: "选择模板" },
  { id: "structure", number: "2", label: "确认结构" },
  { id: "assistant", number: "3", label: "AI 助手" },
  { id: "evaluation", number: "4", label: "建设评估" },
];

type EvaluationStatus =
  | "confirmed"
  | "passed"
  | "partial"
  | "failed"
  | "unexecuted"
  | "pending"
  | "blocked"
  | "not-applicable";

type EvaluationCheck = {
  id: string;
  title: string;
  detail: string;
  status: EvaluationStatus;
  statusLabel: string;
  weight?: number;
  critical?: boolean;
  actionLabel?: string;
  onAction?: () => void;
};

const evaluationStatusCoefficient: Record<EvaluationStatus, number> = {
  confirmed: 1,
  passed: 1,
  partial: 0.5,
  failed: 0,
  unexecuted: 0,
  pending: 0,
  blocked: 0,
  "not-applicable": 0,
};

const templates = [
  {
    id: "help-center",
    name: "知识帮助中心",
    description: "分类导航清晰，适合产品说明、服务指南与常见问题。",
    source: "外部模板库 · Help Center",
    accent: "#6f35a5",
    recommended: true,
  },
  {
    id: "docs",
    name: "简洁文档站",
    description: "强调内容阅读与搜索，适合文档数量较多的企业。",
    source: "外部模板库 · Docs",
    accent: "#315b8a",
    recommended: false,
  },
  {
    id: "portal",
    name: "企业服务门户",
    description: "首页信息更丰富，适合展示服务入口与联系渠道。",
    source: "外部模板库 · Portal",
    accent: "#3e6b57",
    recommended: false,
  },
] as const;

const accentOptions = ["#6f35a5", "#315b8a", "#3e6b57", "#a44f25"] as const;

const initialPages = [
  { id: "start", name: "快速开始", detail: "3 篇文章", enabled: true },
  { id: "services", name: "产品与服务", detail: "8 篇文章", enabled: true },
  { id: "guides", name: "使用指南", detail: "12 篇文章", enabled: true },
  { id: "faq", name: "常见问题", detail: "9 篇文章", enabled: true },
  { id: "contact", name: "联系我们", detail: "1 篇文章", enabled: true },
];

export const WEBSITE_DRAFT_STORAGE_KEY = "frontmind.website-builder.draft";

export type WebsiteDraftV1 = {
  version: 1;
  updatedAt: number;
  confirmed: boolean;
  completedStepIds: BuildStep[];
  selectedTemplateId: string;
  templateSourceUrl: string;
  disabledPageIds: string[];
  brand: {
    siteName: string;
    siteLanguage: SiteLanguage;
    brandMark: string;
    officialUrl: string;
    recognized: boolean;
    siteAccent: string;
  };
  assistant: {
    name: string;
    welcome: string;
    accent: string;
    showSources: boolean;
  };
};

const defaultDraft = (): WebsiteDraftV1 => ({
  version: 1,
  updatedAt: 0,
  confirmed: false,
  completedStepIds: [],
  selectedTemplateId: "help-center",
  templateSourceUrl: "",
  disabledPageIds: [],
  brand: {
    siteName: "FrontMind 帮助中心",
    siteLanguage: "zh-CN",
    brandMark: "FM",
    officialUrl: "",
    recognized: false,
    siteAccent: "#6f35a5",
  },
  assistant: {
    name: "FrontMind 企业助手",
    welcome: "您好，我可以根据企业资料回答产品、服务与使用问题。",
    accent: "#6f35a5",
    showSources: true,
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function loadWebsiteDraft(): WebsiteDraftV1 {
  const fallback = defaultDraft();
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(WEBSITE_DRAFT_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return fallback;

    const brand = isRecord(parsed.brand) ? parsed.brand : {};
    const assistant = isRecord(parsed.assistant) ? parsed.assistant : {};
    const templateIds = new Set(templates.map((template) => template.id));
    const pageIds = new Set(initialPages.map((page) => page.id));
    const validAccent = (value: unknown, defaultValue: string) =>
      typeof value === "string" && accentOptions.some((option) => option === value) ? value : defaultValue;
    const officialUrl = typeof brand.officialUrl === "string" && isHttpUrl(brand.officialUrl) ? brand.officialUrl : "";
    const templateSourceUrl =
      typeof parsed.templateSourceUrl === "string" && isHttpUrl(parsed.templateSourceUrl)
        ? parsed.templateSourceUrl
        : "";
    const hasValidTemplateSelection = typeof parsed.selectedTemplateId === "string"
      && templateIds.has(parsed.selectedTemplateId as (typeof templates)[number]["id"]);
    const selectedTemplateId = hasValidTemplateSelection ? parsed.selectedTemplateId as string : fallback.selectedTemplateId;
    const disabledPageIds = Array.isArray(parsed.disabledPageIds)
      ? Array.from(new Set(parsed.disabledPageIds.filter((id): id is string => typeof id === "string" && pageIds.has(id))))
      : fallback.disabledPageIds;
    const siteName = typeof brand.siteName === "string" ? brand.siteName.slice(0, 80) : fallback.brand.siteName;
    const brandMark = typeof brand.brandMark === "string" ? brand.brandMark.slice(0, 3) : fallback.brand.brandMark;
    const assistantName = typeof assistant.name === "string" ? assistant.name.slice(0, 80) : fallback.assistant.name;
    const assistantWelcome = typeof assistant.welcome === "string" ? assistant.welcome.slice(0, 240) : fallback.assistant.welcome;
    const validCompletedSteps = new Set<BuildStep>(["template", "structure", "assistant"]);
    let completedStepIds = Array.isArray(parsed.completedStepIds)
      ? Array.from(new Set(parsed.completedStepIds.filter(
          (step): step is BuildStep => typeof step === "string" && validCompletedSteps.has(step as BuildStep),
        )))
      : fallback.completedStepIds;
    const hasEnabledPage = initialPages.some((page) => !disabledPageIds.includes(page.id));
    if (!hasValidTemplateSelection) completedStepIds = completedStepIds.filter((step) => step !== "template");
    if (!hasEnabledPage || !siteName.trim() || !brandMark.trim()) {
      completedStepIds = completedStepIds.filter((step) => step !== "structure");
    }
    if (!assistantName.trim() || !assistantWelcome.trim()) {
      completedStepIds = completedStepIds.filter((step) => step !== "assistant");
    }
    const confirmed = parsed.confirmed === true
      && ["template", "structure", "assistant"].every((step) => completedStepIds.includes(step as BuildStep));

    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      confirmed,
      completedStepIds,
      selectedTemplateId,
      templateSourceUrl,
      disabledPageIds,
      brand: {
        siteName,
        siteLanguage: brand.siteLanguage === "en-US" || brand.siteLanguage === "zh-CN" ? brand.siteLanguage : fallback.brand.siteLanguage,
        brandMark,
        officialUrl,
        recognized: Boolean(officialUrl && brand.recognized === true),
        siteAccent: validAccent(brand.siteAccent, fallback.brand.siteAccent),
      },
      assistant: {
        name: assistantName,
        welcome: assistantWelcome,
        accent: validAccent(assistant.accent, fallback.assistant.accent),
        showSources: typeof assistant.showSources === "boolean" ? assistant.showSources : fallback.assistant.showSources,
      },
    };
  } catch {
    return fallback;
  }
}

export function saveWebsiteDraft(draft: WebsiteDraftV1) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(WEBSITE_DRAFT_STORAGE_KEY, JSON.stringify({ ...draft, updatedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

function MiniSitePreview({
  assistantAccent,
  assistantName,
  brandMark,
  device,
  pageNames,
  showAssistant,
  showSources,
  siteAccent,
  siteLanguage,
  siteName,
  welcome,
}: {
  assistantAccent: string;
  assistantName: string;
  brandMark: string;
  device: PreviewDevice;
  pageNames: string[];
  showAssistant: boolean;
  showSources: boolean;
  siteAccent: string;
  siteLanguage: SiteLanguage;
  siteName: string;
  welcome: string;
}) {
  const [widgetOpen, setWidgetOpen] = useState(showAssistant);
  const [question, setQuestion] = useState(previewRagQuestion);
  const [submittedQuestion, setSubmittedQuestion] = useState(previewRagQuestion);
  const siteCopy = siteLanguage === "en-US"
    ? {
        eyebrow: "ENTERPRISE KNOWLEDGE CENTER",
        title: "How can we help?",
        search: "Search documentation or ask the AI assistant",
        language: "EN",
      }
    : {
        eyebrow: "企业知识帮助中心",
        title: "您好，需要了解什么？",
        search: "搜索文档，或直接询问 AI 助手",
        language: "中文",
      };

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (!value) return;
    setSubmittedQuestion(value);
    setQuestion("");
    setWidgetOpen(true);
  };

  return (
    <div className={`sfp-site-stage sfp-site-stage--${device}`}>
      <div className="sfp-browser-bar">
        <span><i /><i /><i /></span>
        <p>help.frontmind.example</p>
      </div>
      <div
        className="sfp-site-canvas"
        style={{ "--sfp-site-accent": siteAccent, "--sfp-widget-accent": assistantAccent } as CSSProperties}
      >
        <header className="sfp-site-header">
          <strong><i>{brandMark || "AI"}</i>{siteName || "企业帮助中心"}</strong>
          <nav>
            {pageNames.slice(0, device === "mobile" ? 2 : 4).map((name) => <span key={name}>{name}</span>)}
            <em>{siteCopy.language}</em>
          </nav>
        </header>
        <main>
          <span className="sfp-site-eyebrow">{siteCopy.eyebrow}</span>
          <h3>{siteCopy.title}</h3>
          <div className="sfp-site-search">{siteCopy.search}</div>
          <div className="sfp-site-category-grid">
            {pageNames.slice(0, 4).map((name, index) => (
              <article key={name}>
                <span>0{index + 1}</span>
                <strong>{name}</strong>
              </article>
            ))}
          </div>
        </main>

        <button
          className="sfp-floating-trigger"
          type="button"
          aria-label={widgetOpen ? "收起 AI 助手" : "打开 AI 助手"}
          aria-expanded={widgetOpen}
          onClick={() => setWidgetOpen((current) => !current)}
        >
          {widgetOpen ? <X size={19} /> : <MessageCircle size={20} />}
        </button>

        {widgetOpen && (
          <section className="sfp-widget" aria-label="网站 AI 助手预览">
            <header>
              <span><Sparkles size={17} /></span>
              <div><strong>{assistantName || "企业助手"}</strong></div>
              <i />
            </header>
            <div className="sfp-widget-body">
              <p className="sfp-widget-bubble">{welcome || "您好，有什么可以帮您？"}</p>
              <p className="sfp-widget-bubble sfp-widget-bubble--visitor">{submittedQuestion}</p>
              <p className="sfp-widget-bubble">
                {previewRagAnswer}
                {showSources && <button type="button">来源：产品与服务 / 服务概览</button>}
              </p>
            </div>
            <form onSubmit={submitQuestion}>
              <input
                aria-label="在网站助手中提问"
                placeholder="继续提问…"
                value={question}
                onChange={(event) => setQuestion(event.currentTarget.value)}
              />
              <button type="submit" aria-label="发送问题"><Send size={16} /></button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}

export function SimplifiedWebsiteBuilderPreview({
  initialStep = "template",
  onOpenRag,
  onStepChange,
}: SimplifiedWebsiteBuilderPreviewProps) {
  const [draftSeed] = useState<WebsiteDraftV1>(loadWebsiteDraft);
  const [activeStep, setActiveStep] = useState<BuildStep>(initialStep);
  const [isConfirmed, setIsConfirmed] = useState(draftSeed.confirmed);
  const [completedStepIds, setCompletedStepIds] = useState<BuildStep[]>(draftSeed.completedStepIds);
  const [selectedTemplateId, setSelectedTemplateId] = useState(draftSeed.selectedTemplateId);
  const [pages, setPages] = useState(() => {
    const disabledPageIds = new Set(draftSeed.disabledPageIds);
    return initialPages.map((page) => ({ ...page, enabled: !disabledPageIds.has(page.id) }));
  });
  const [siteName, setSiteName] = useState(draftSeed.brand.siteName);
  const [siteLanguage, setSiteLanguage] = useState<SiteLanguage>(draftSeed.brand.siteLanguage);
  const [brandMark, setBrandMark] = useState(draftSeed.brand.brandMark);
  const [officialUrl, setOfficialUrl] = useState(draftSeed.brand.officialUrl);
  const [brandRecognized, setBrandRecognized] = useState(draftSeed.brand.recognized);
  const [siteAccent, setSiteAccent] = useState(draftSeed.brand.siteAccent);
  const [assistantName, setAssistantName] = useState(draftSeed.assistant.name);
  const [welcome, setWelcome] = useState(draftSeed.assistant.welcome);
  const [assistantAccent, setAssistantAccent] = useState(draftSeed.assistant.accent);
  const [showSources, setShowSources] = useState(draftSeed.assistant.showSources);
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [templateUrl, setTemplateUrl] = useState(draftSeed.templateSourceUrl);
  const [notice, setNotice] = useState("");
  const [storageAvailable, setStorageAvailable] = useState(true);
  const didMountDraftRef = useRef(false);

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0];
  const enabledPages = useMemo(() => pages.filter((page) => page.enabled), [pages]);
  const completedStepSet = useMemo(() => new Set(completedStepIds), [completedStepIds]);
  const stepIndex = steps.findIndex((step) => step.id === activeStep);
  const templateReady = Boolean(selectedTemplateId);
  const structureReady = enabledPages.length > 0;
  const brandReady = Boolean(siteName.trim() && brandMark.trim());
  const assistantReady = Boolean(assistantName.trim() && welcome.trim());
  const templateComplete = templateReady && completedStepSet.has("template");
  const structureComplete = structureReady && completedStepSet.has("structure");
  const brandComplete = brandReady && completedStepSet.has("structure");
  const assistantComplete = assistantReady && completedStepSet.has("assistant");
  const canComplete = templateComplete && structureComplete && brandComplete && assistantComplete;
  const configurationConfirmedCount = [templateComplete, structureComplete, brandComplete, assistantComplete]
    .filter(Boolean).length;
  const completedSteps: Record<BuildStep, boolean> = {
    template: templateComplete,
    structure: structureComplete && brandComplete,
    assistant: assistantComplete,
    evaluation: false,
  };

  useEffect(() => setActiveStep(initialStep), [initialStep]);

  useEffect(() => {
    const saved = saveWebsiteDraft({
      version: 1,
      updatedAt: Date.now(),
      confirmed: isConfirmed,
      completedStepIds,
      selectedTemplateId,
      templateSourceUrl: templateUrl,
      disabledPageIds: pages.filter((page) => !page.enabled).map((page) => page.id),
      brand: {
        siteName,
        siteLanguage,
        brandMark,
        officialUrl,
        recognized: brandRecognized,
        siteAccent,
      },
      assistant: {
        name: assistantName,
        welcome,
        accent: assistantAccent,
        showSources,
      },
    });
    setStorageAvailable(saved);
  }, [assistantAccent, assistantName, brandMark, brandRecognized, completedStepIds, isConfirmed, officialUrl, pages, selectedTemplateId, showSources, siteAccent, siteLanguage, siteName, templateUrl, welcome]);

  useEffect(() => {
    if (!didMountDraftRef.current) {
      didMountDraftRef.current = true;
      return;
    }
    if (isConfirmed) setIsConfirmed(false);
  }, [assistantAccent, assistantName, brandMark, brandRecognized, completedStepIds, officialUrl, pages, selectedTemplateId, showSources, siteAccent, siteLanguage, siteName, templateUrl, welcome]);

  const invalidateSteps = (...stepIds: BuildStep[]) => {
    const invalidated = new Set(stepIds);
    setCompletedStepIds((current) => current.filter((step) => !invalidated.has(step)));
    setIsConfirmed(false);
  };

  const importTemplate = (event: FormEvent) => {
    event.preventDefault();
    setNotice(
      isHttpUrl(templateUrl.trim())
        ? "模板参考链接已保存。"
        : "请输入以 http:// 或 https:// 开头的外部模板链接。",
    );
  };

  const recognizeBrand = (event: FormEvent) => {
    event.preventDefault();
    const value = officialUrl.trim();
    if (!isHttpUrl(value)) {
      setBrandRecognized(false);
      setNotice("请输入以 http:// 或 https:// 开头的企业官网 URL。");
      return;
    }

    const parsed = new URL(value);
    const hostname = parsed.hostname.replace(/^www\./i, "");
    const domainName = hostname.split(".")[0] || "Enterprise";
    const isFrontMind = /frontmind/i.test(domainName);
    const displayName = isFrontMind
      ? "FrontMind"
      : domainName.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    const mark = isFrontMind
      ? "FM"
      : displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase();

    invalidateSteps("structure");
    setOfficialUrl(parsed.toString());
    setSiteName(`${displayName} 帮助中心`);
    setBrandMark(mark || "AI");
    setSiteLanguage(hostname.endsWith(".cn") ? "zh-CN" : siteLanguage);
    if (isFrontMind) setSiteAccent("#6f35a5");
    setBrandRecognized(true);
    setNotice("已根据官网 URL 生成一组品牌建议；请核对网站名称、标识、语言和主题色。" );
  };

  const goTo = (step: BuildStep) => {
    setActiveStep(step);
    setNotice("");
    onStepChange?.(step);
  };

  const goPrevious = () => {
    if (stepIndex > 0) goTo(steps[stepIndex - 1].id);
  };

  const goNext = () => {
    if (stepIndex >= steps.length - 1) return;
    if (activeStep === "template" && !templateReady) {
      setNotice("请先选择一个模板版式。");
      return;
    }
    if (activeStep === "structure" && (!structureReady || !brandReady)) {
      setNotice("请至少保留一个网站栏目，并补充网站名称和品牌标识。");
      return;
    }
    if (activeStep === "assistant" && !assistantReady) {
      setNotice("请补充助手名称和欢迎语。");
      return;
    }
    setCompletedStepIds((current) => current.includes(activeStep) ? current : [...current, activeStep]);
    goTo(steps[stepIndex + 1].id);
  };

  const configurationChecks: EvaluationCheck[] = [
    {
      id: "C01",
      title: "模板版式",
      detail: templateComplete ? `${selectedTemplate.name}已由用户确认` : "已有默认选择，但仍需在第 1 步确认",
      status: templateComplete ? "confirmed" : "unexecuted",
      statusLabel: templateComplete ? "已确认" : "未执行",
      actionLabel: templateComplete ? "查看模板" : "去确认",
      onAction: () => goTo("template"),
    },
    {
      id: "C02",
      title: "网站结构",
      detail: structureComplete ? `已确认 ${enabledPages.length} 个对外栏目` : structureReady ? "栏目已有默认值，尚未由用户确认" : "至少保留 1 个面向访客的栏目",
      status: structureComplete ? "confirmed" : "unexecuted",
      statusLabel: structureComplete ? "已确认" : "未执行",
      actionLabel: structureComplete ? "查看结构" : "去确认",
      onAction: () => goTo("structure"),
    },
    {
      id: "C03",
      title: "品牌与语言",
      detail: brandComplete ? `${siteName} · ${brandRecognized ? "官网建议已核对" : "已手动确认"}` : brandReady ? "品牌字段已有默认值，尚未由用户确认" : "请补充网站名称和品牌标识",
      status: brandComplete ? "confirmed" : "unexecuted",
      statusLabel: brandComplete ? "已确认" : "未执行",
      actionLabel: brandComplete ? "查看品牌" : "去确认",
      onAction: () => goTo("structure"),
    },
    {
      id: "C04",
      title: "AI 助手配置",
      detail: assistantComplete ? "名称、欢迎语、主题色与来源开关已确认" : assistantReady ? "助手已有默认值，尚未由用户确认" : "请补充助手名称和欢迎语",
      status: assistantComplete ? "confirmed" : "unexecuted",
      statusLabel: assistantComplete ? "已确认" : "未执行",
      actionLabel: assistantComplete ? "试用助手" : "去确认",
      onAction: () => goTo("assistant"),
    },
  ];

  const websiteQualityChecks: EvaluationCheck[] = [
    {
      id: "E06 · E07 · E08",
      title: "版本、目标问题覆盖与信息结构",
      detail: "需绑定知识与草稿版本，并用目标访客问题核对栏目和正文；当前只有栏目骨架",
      status: "pending",
      statusLabel: "待核实",
      weight: 15,
      actionLabel: "查看结构",
      onAction: () => goTo("structure"),
    },
    {
      id: "E09",
      title: "导航与联系入口",
      detail: "需逐页检查导航、返回路径和联系入口是否可达，当前尚未执行",
      status: "unexecuted",
      statusLabel: "未执行",
      weight: 7,
      actionLabel: "查看结构",
      onAction: () => goTo("structure"),
    },
    {
      id: "E15",
      title: "窄屏与键盘可用性",
      detail: "手机预览只能辅助观察，仍需完成窄屏、键盘焦点与可读性检查",
      status: "unexecuted",
      statusLabel: "未执行",
      weight: 8,
      actionLabel: "手机预览",
      onAction: () => {
        setDevice("mobile");
        goTo("assistant");
      },
    },
  ];

  const trustBoundaryChecks: EvaluationCheck[] = [
    {
      id: "E01 · E02",
      title: "企业事实与证据",
      detail: "需为身份、产品和能力声明绑定可追溯来源；示例知识不能代替正式证据",
      status: "pending",
      statusLabel: "待核实",
      weight: 15,
      critical: true,
      actionLabel: "查看知识范围",
      onAction: onOpenRag ?? (() => goTo("assistant")),
    },
    {
      id: "E03 · E18",
      title: "公开范围与来源展示",
      detail: "隐藏来源只改变展示方式，不会扩大可公开范围；仍需确认公开授权与展示边界",
      status: "pending",
      statusLabel: "待核实",
      weight: 15,
      critical: true,
      actionLabel: "查看来源设置",
      onAction: onOpenRag ?? (() => goTo("assistant")),
    },
  ];

  const ragAnswerChecks: EvaluationCheck[] = [
    {
      id: "E04 · E05",
      title: "回答引用与未知处理",
      detail: "本地原型未执行真实检索和模型回答，暂时无法判断引用相关性、正确性与拒答表现",
      status: "blocked",
      statusLabel: "受阻",
      weight: 25,
      critical: true,
      actionLabel: "打开 RAG 示例",
      onAction: onOpenRag ?? (() => goTo("assistant")),
    },
  ];

  const flowAndPublishChecks: EvaluationCheck[] = [
    {
      id: "E10 · E11 · E13 · E14",
      title: "建站流程、反馈与失败恢复",
      detail: "需走查阶段、按钮、字段反馈和失败后的恢复路径；组件测试不能代替正式评估证据",
      status: "unexecuted",
      statusLabel: "未执行",
      weight: 10,
      actionLabel: "返回流程起点",
      onAction: () => goTo("template"),
    },
    {
      id: "E12 · E17",
      title: "草稿、发布与正式生效",
      detail: "草稿确认不等于配置正式生效或公开访问验证；待上线能力接入后再执行",
      status: "unexecuted",
      statusLabel: "未执行",
      weight: 5,
      critical: true,
    },
  ];

  const scoreGroups = [
    { label: "网站内容与体验", checks: websiteQualityChecks },
    { label: "企业事实与公开边界", checks: trustBoundaryChecks },
    { label: "RAG 回答质量", checks: ragAnswerChecks },
    { label: "流程与发布边界", checks: flowAndPublishChecks },
  ];
  const scoredChecks = scoreGroups.flatMap((group) => group.checks);
  const applicableChecks = scoredChecks.filter((check) => check.status !== "not-applicable");
  const applicableWeight = applicableChecks.reduce((sum, check) => sum + (check.weight ?? 0), 0);
  const earnedWeight = applicableChecks.reduce(
    (sum, check) => sum + (check.weight ?? 0) * evaluationStatusCoefficient[check.status],
    0,
  );
  const judgedStatuses = new Set<EvaluationStatus>(["passed", "partial", "failed"]);
  const judgedChecks = applicableChecks.filter((check) => judgedStatuses.has(check.status));
  const passFailChecks = applicableChecks.filter((check) => check.status === "passed" || check.status === "failed");
  const judgedWeight = judgedChecks.reduce((sum, check) => sum + (check.weight ?? 0), 0);
  const weightedScore = applicableWeight > 0 ? Math.round((earnedWeight / applicableWeight) * 100) : 0;
  const judgmentCoverage = applicableWeight > 0 ? Math.round((judgedWeight / applicableWeight) * 100) : 0;
  const unresolvedCriticalChecks = applicableChecks.filter(
    (check) => check.critical && check.status !== "passed",
  );
  const formatPoints = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);
  const scoreGroupEarnedPoints = scoreGroups.map((group) => {
    const applicableGroupChecks = group.checks.filter((check) => check.status !== "not-applicable");
    return applicableGroupChecks.reduce(
      (sum, check) => sum + (check.weight ?? 0) * evaluationStatusCoefficient[check.status],
      0,
    );
  });
  const scoreIsProvisional = judgmentCoverage < 100;
  const recommendation = !canComplete || unresolvedCriticalChecks.length > 0 || weightedScore < 70
    ? "暂不建议发布"
    : judgmentCoverage < 100 || weightedScore < 85
      ? "待补证或修订"
      : "可进入发布确认";
  const recommendationDetail = !canComplete
    ? `配置门槛仅确认 ${configurationConfirmedCount}/4 项，且关键质量条件仍缺少正式验收证据。`
    : unresolvedCriticalChecks.length > 0
      ? "建站配置已经确认，但公开范围、事实证据、RAG 回答与发布证据等关键条件仍未闭环。"
      : judgmentCoverage < 100
        ? "关键门禁已关闭，但仍有检查维度缺少正式判定。"
        : weightedScore < 85
          ? "正式判定已经齐全，但加权得分仍需修订提升。"
          : "评分与关键门禁均满足，可进入发布确认环节；这不表示已经发布。";
  const recommendationBadge = !canComplete
    ? "配置门槛未完成"
    : unresolvedCriticalChecks.length > 0
    ? "关键条件未闭环"
    : scoreIsProvisional
      ? "仍有项目待判定"
      : "以发布确认为准";

  const renderEvaluationGroup = (title: string, checks: EvaluationCheck[]) => {
    const hasWeightedChecks = checks.some((check) => check.weight);
    return (
      <section className="sfp-eval-group">
        <header>
          <div><h3>{title}</h3></div>
          {hasWeightedChecks && (
            <span>
              {formatPoints(checks.reduce((sum, check) => sum + (check.weight ?? 0) * evaluationStatusCoefficient[check.status], 0))}/{checks.reduce((sum, check) => sum + (check.weight ?? 0), 0)} 分
            </span>
          )}
        </header>
        <div className="sfp-check-list">
          {checks.map((check) => (
            <article key={check.id} className={`is-${check.status}`}>
              <span>{check.status === "confirmed" || check.status === "passed" ? <Check size={17} /> : <CircleAlert size={17} />}</span>
              <div>
                <div className="sfp-check-title">
                  <strong>{check.title}</strong>
                  {check.critical && <em className="is-critical">关键门禁</em>}
                </div>
                <small>{check.detail}</small>
              </div>
              <div className="sfp-check-action">
                <b>{check.statusLabel}</b>
                {check.actionLabel && check.onAction && <button type="button" aria-label={`${check.actionLabel}：${check.title}`} onClick={check.onAction}>{check.actionLabel}</button>}
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  };

  return (
    <section className="sfp-root" data-step={activeStep}>
      <header className="sfp-heading">
        <div>
          <h1>从知识库快速搭建帮助中心</h1>
          <p>先完成网站建设与整体评估，再考虑域名和正式上线。</p>
        </div>
        <div className={`sfp-draft-state ${storageAvailable ? "" : "is-session-only"}`}>
          <i />
          <span>
            <strong>{isConfirmed ? "草稿已确认" : "建设中"}</strong>
            <small>{storageAvailable ? `本地草稿 · ${isConfirmed ? "草稿确认状态已保存" : "配置已自动保存"}` : "仅本次页面保存"}</small>
          </span>
        </div>
      </header>

      <ol className="sfp-steps" aria-label="网站建设流程">
        {steps.map((step) => (
          <li key={step.id} className={step.id === activeStep ? "is-active" : completedSteps[step.id] ? "is-done" : ""} data-complete={completedSteps[step.id]}>
            <button type="button" onClick={() => goTo(step.id)} aria-current={step.id === activeStep ? "step" : undefined}>
              <span>{completedSteps[step.id] && step.id !== activeStep ? <Check size={16} /> : step.number}</span>
              <span><strong>{step.label}</strong></span>
            </button>
          </li>
        ))}
      </ol>

      {notice && <div className="sfp-notice" role="status">{notice}</div>}

      <div className="sfp-step-content">
        {activeStep === "template" && (
          <div className="sfp-panel sfp-template-step">
            <div className="sfp-section-heading">
              <div><h2>选择一个模板版式</h2><p>模板提供整体版式和默认配色，网站内容仍由当前知识库生成。</p></div>
            </div>
            <div className="sfp-template-grid">
              {templates.map((template) => (
                <label key={template.id} className={template.id === selectedTemplateId ? "is-selected" : ""}>
                  <input
                    type="radio"
                    name="website-template"
                    value={template.id}
                    checked={template.id === selectedTemplateId}
                    onChange={() => {
                      invalidateSteps("template", "structure");
                      setSelectedTemplateId(template.id);
                      setSiteAccent(template.accent);
                      setBrandRecognized(false);
                    }}
                  />
                  <div className="sfp-template-thumb" style={{ "--sfp-template-accent": template.accent } as CSSProperties}>
                    <i /><div><span /><span /><span /></div><strong /><small />
                  </div>
                  <div className="sfp-template-copy">
                    <span>{template.source}</span>
                    <h3>{template.name}{template.recommended && <em>推荐</em>}</h3>
                    <p>{template.description}</p>
                    <b>{template.id === selectedTemplateId ? "已应用到当前草稿" : "选择此模板"}</b>
                  </div>
                </label>
              ))}
            </div>
            <form className="sfp-import-row" onSubmit={importTemplate}>
              <LayoutTemplate size={19} />
              <div><strong>保存外部模板参考链接</strong></div>
              <input aria-label="外部模板链接（导入版式）" placeholder="https://template.example/..." value={templateUrl} onChange={(event) => setTemplateUrl(event.currentTarget.value)} />
              <button type="submit">保存链接</button>
            </form>
          </div>
        )}

        {activeStep === "structure" && (
          <div className="sfp-workspace-grid">
            <section className="sfp-panel sfp-builder-config-panel sfp-builder-config-panel--structure">
              <div className="sfp-section-heading sfp-section-heading--compact">
                <div><h2>确认网站结构与品牌</h2><p>系统已按知识库生成栏目；补充少量品牌信息即可完成网站骨架。</p></div>
              </div>
              <form className="sfp-brand-import" onSubmit={recognizeBrand}>
                <Globe2 size={19} />
                <div>
                  <strong>从企业官网获取品牌建议</strong>
                </div>
                <input
                  type="url"
                  aria-label="企业官网 URL（生成品牌建议，可选）"
                  placeholder="https://company.example"
                  value={officialUrl}
                  onChange={(event) => {
                    invalidateSteps("structure");
                    setOfficialUrl(event.currentTarget.value);
                    setBrandRecognized(false);
                  }}
                />
                <button type="submit">生成建议</button>
              </form>
              <div className="sfp-brand-fields">
                <label className="sfp-brand-name">
                  <span>网站名称</span>
                  <input aria-label="网站名称" maxLength={80} value={siteName} onChange={(event) => { invalidateSteps("structure"); setSiteName(event.currentTarget.value); setBrandRecognized(false); }} />
                </label>
                <label>
                  <span>Logo / 品牌标识</span>
                  <input aria-label="Logo / 品牌标识" maxLength={3} value={brandMark} onChange={(event) => { invalidateSteps("structure"); setBrandMark(event.currentTarget.value.toUpperCase()); setBrandRecognized(false); }} />
                </label>
                <label>
                  <span>站点语言</span>
                  <select aria-label="站点语言" value={siteLanguage} onChange={(event) => { invalidateSteps("structure"); setSiteLanguage(event.currentTarget.value as SiteLanguage); setBrandRecognized(false); }}>
                    <option value="zh-CN">中文（简体）</option>
                    <option value="en-US">English</option>
                  </select>
                </label>
                <fieldset className="sfp-brand-color">
                  <legend>网站主题色</legend>
                  <div className="sfp-color-options">
                    {accentOptions.map((color) => (
                      <button key={color} type="button" aria-label={`选择网站主题色 ${color}`} aria-pressed={siteAccent === color} style={{ background: color }} onClick={() => { if (siteAccent !== color) invalidateSteps("structure"); setSiteAccent(color); setBrandRecognized(false); }} />
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="sfp-source-strip"><FileText size={17} /><span><strong>当前 RAG 示例知识范围</strong><small>{previewKnowledgeCollectionCount} 个知识集合已映射为 5 个网站栏目</small></span><b>已关联</b></div>
              <div className="sfp-page-list">
                {pages.map((page, index) => (
                  <div key={page.id} className={!page.enabled ? "is-muted" : ""}>
                    <span className="sfp-page-icon"><PanelTop size={16} /></span>
                    <span><strong>{page.name}</strong><small>{page.detail}</small></span>
                    <label className="sfp-switch">
                      <input
                        type="checkbox"
                        checked={page.enabled}
                        aria-label={`在网站中显示${page.name}`}
                        onChange={(event) => {
                          const enabled = event.currentTarget.checked;
                          invalidateSteps("structure");
                          setPages((current) => current.map((item) => item.id === page.id ? { ...item, enabled } : item));
                        }}
                      />
                      <i />
                    </label>
                    <em>0{index + 1}</em>
                  </div>
                ))}
              </div>
              <p className="sfp-helper">仅控制栏目显示，不修改知识库。</p>
            </section>
            <section className="sfp-preview-panel sfp-builder-preview-panel">
              <div className="sfp-preview-heading"><span><strong>即时预览</strong><small>{selectedTemplate.name} · {enabledPages.length} 个栏目</small></span><DevicePicker device={device} onChange={setDevice} /></div>
              <MiniSitePreview assistantAccent={assistantAccent} assistantName={assistantName} brandMark={brandMark} device={device} pageNames={enabledPages.map((page) => page.name)} showAssistant={false} showSources={showSources} siteAccent={siteAccent} siteLanguage={siteLanguage} siteName={siteName} welcome={welcome} />
            </section>
          </div>
        )}

        {activeStep === "assistant" && (
          <div className="sfp-workspace-grid">
            <section className="sfp-panel sfp-builder-config-panel sfp-builder-config-panel--assistant">
              <div className="sfp-section-heading sfp-section-heading--compact">
                <div><h2>配置 AI 助手</h2><p>配置网站右下角的帮助窗口并直接试用。</p></div>
              </div>
              <div className="sfp-rag-link-card">
                <span><Bot size={19} /></span>
                <div><strong>企业 RAG 示例已关联</strong><small>{previewKnowledgeCollectionCount} 个知识集合 · {previewKnowledgeFragmentCount} 个示例片段 · 网站端来源{showSources ? "已展示" : "已隐藏"}</small></div>
                <button type="button" onClick={onOpenRag}>查看 RAG 示例</button>
              </div>
              <div className="sfp-form-grid">
                <label><span>助手名称</span><input value={assistantName} onChange={(event) => { invalidateSteps("assistant"); setAssistantName(event.currentTarget.value); }} /></label>
                <label className="sfp-welcome-field"><span>欢迎语</span><textarea value={welcome} onChange={(event) => { invalidateSteps("assistant"); setWelcome(event.currentTarget.value); }} /></label>
                <fieldset>
                  <legend>助手主题色</legend>
                  <div className="sfp-color-options">
                    {accentOptions.map((color) => (
                      <button key={color} type="button" aria-label={`选择助手主题色 ${color}`} aria-pressed={assistantAccent === color} style={{ background: color }} onClick={() => { if (assistantAccent !== color) invalidateSteps("assistant"); setAssistantAccent(color); }} />
                    ))}
                  </div>
                </fieldset>
                <label className="sfp-setting-row"><span><strong>展示回答来源</strong><small>让访客可以核对回答依据</small></span><input type="checkbox" checked={showSources} onChange={(event) => { invalidateSteps("assistant"); setShowSources(event.currentTarget.checked); }} /></label>
              </div>
            </section>
            <section className="sfp-preview-panel sfp-builder-preview-panel">
              <div className="sfp-preview-heading"><span><strong>网站内效果</strong></span><DevicePicker device={device} onChange={setDevice} /></div>
              <MiniSitePreview assistantAccent={assistantAccent} assistantName={assistantName} brandMark={brandMark} device={device} pageNames={enabledPages.map((page) => page.name)} showAssistant showSources={showSources} siteAccent={siteAccent} siteLanguage={siteLanguage} siteName={siteName} welcome={welcome} />
            </section>
          </div>
        )}

        {activeStep === "evaluation" && (
          <div className="sfp-evaluation-layout">
            <section className="sfp-panel sfp-evaluation-main">
              <div className="sfp-section-heading">
                <div><h2>建设检查与评估</h2><p>按证据闭环程度加权计算 100 分；待核实、未执行和受阻项目暂不获分。</p></div>
                <aside className="sfp-eval-heading-meta">
                  <span className="sfp-eval-run-state"><i />正式验收未完成</span>
                  <span
                    className={`sfp-eval-score ${weightedScore >= 85 ? "is-high" : weightedScore >= 70 ? "is-medium" : "is-low"}`}
                    aria-label={`当前加权评估分：${weightedScore} 分，满分 100 分，${scoreIsProvisional ? "暂定分" : "最终分"}`}
                  >
                    <span><strong>{weightedScore}</strong><small>/100</small></span>
                    <em>{scoreIsProvisional ? "暂定分" : "最终分"}</em>
                  </span>
                </aside>
              </div>
              <div className="sfp-eval-context" aria-label="本次评估范围">
                <span><small>项目</small><strong>FrontMind AI 专用官网</strong></span>
                <span><small>被测对象</small><strong>当前本地网站草稿</strong></span>
                <span><small>草稿与知识版本</small><strong>{previewKnowledgeCollectionCount} 个示例集合 · 正式版本未绑定</strong></span>
                <span><small>页面与问题范围</small><strong>{enabledPages.length} 个栏目 · 目标问题清单待补</strong></span>
                <span><small>公开范围</small><strong>范围与确认人未记录</strong></span>
                <span><small>执行记录</small><strong>本地预览 · 评估人和时间待补</strong></span>
              </div>
              <div className="sfp-eval-summary is-pending">
                <CircleAlert size={22} />
                <span>
                  <strong>当前建议：{recommendation}</strong>
                  <small>{recommendationDetail}</small>
                </span>
                <b>{recommendationBadge}</b>
              </div>
              <div className="sfp-eval-metrics" aria-label="评估摘要">
                <span><small>配置门槛</small><strong>{configurationConfirmedCount}/4</strong></span>
                <span><small>判定覆盖率</small><strong>{judgmentCoverage}%</strong></span>
                <span><small>已判定通过率</small><strong>{passFailChecks.length > 0 ? `${Math.round((passFailChecks.filter((check) => check.status === "passed").length / passFailChecks.length) * 100)}%` : "无法计算"}</strong></span>
                <span><small>关键门禁待处理</small><strong>{unresolvedCriticalChecks.length}</strong></span>
              </div>
              <section className="sfp-score-formula" aria-label="加权评估分计算结果">
                <header>
                  <strong>加权评分</strong>
                  <code>{scoreGroupEarnedPoints.map(formatPoints).join(" + ")} = {formatPoints(earnedWeight)} → {weightedScore} 分</code>
                </header>
                <small className="sfp-score-weight-note">权重：网站内容与体验 30 分 · 企业事实与公开边界 30 分 · RAG 回答质量 25 分 · 流程与发布边界 15 分</small>
              </section>
              {renderEvaluationGroup("配置门槛（不计分）", configurationChecks)}
              {renderEvaluationGroup("网站内容与体验", websiteQualityChecks)}
              {renderEvaluationGroup("企业事实与公开边界", trustBoundaryChecks)}
              {renderEvaluationGroup("RAG 回答质量", ragAnswerChecks)}
              {renderEvaluationGroup("流程与发布边界", flowAndPublishChecks)}
            </section>
            <aside className="sfp-final-preview">
              <div className="sfp-preview-heading"><span><strong>当前草稿预览</strong></span><DevicePicker device={device} onChange={setDevice} /></div>
              <MiniSitePreview assistantAccent={assistantAccent} assistantName={assistantName} brandMark={brandMark} device={device} pageNames={enabledPages.map((page) => page.name)} showAssistant showSources={showSources} siteAccent={siteAccent} siteLanguage={siteLanguage} siteName={siteName} welcome={welcome} />
            </aside>
          </div>
        )}
      </div>

      <footer className="sfp-actions">
        <button type="button" className="sfp-button sfp-button--ghost" onClick={goPrevious} disabled={stepIndex === 0}>上一步</button>
        <span>{stepIndex + 1} / {steps.length} · {steps[stepIndex].label}</span>
        {activeStep === "evaluation" ? (
          <>
            <button
              type="button"
              className="sfp-button sfp-button--primary"
              disabled={!canComplete}
              aria-describedby={!canComplete ? "sfp-confirmation-requirement" : undefined}
              onClick={() => {
                setIsConfirmed(true);
                setNotice("当前建设草稿已确认。此操作只确认建站配置，不表示质量评估通过或网站已经发布。");
              }}
            >
              {isConfirmed ? "草稿已确认" : "确认当前建设草稿"}
            </button>
            {!canComplete && <span id="sfp-confirmation-requirement" className="sfp-visually-hidden">请先依次确认模板、网站结构与品牌、AI 助手配置。</span>}
          </>
        ) : (
          <button type="button" className="sfp-button sfp-button--primary" onClick={goNext}>继续</button>
        )}
      </footer>
    </section>
  );
}

function DevicePicker({ device, onChange }: { device: PreviewDevice; onChange: (device: PreviewDevice) => void }) {
  return (
    <div className="sfp-device-picker" aria-label="预览设备">
      <button type="button" aria-label="电脑预览" aria-pressed={device === "desktop"} onClick={() => onChange("desktop")}><Monitor size={16} /></button>
      <button type="button" aria-label="手机预览" aria-pressed={device === "mobile"} onClick={() => onChange("mobile")}><Smartphone size={16} /></button>
    </div>
  );
}

export default SimplifiedWebsiteBuilderPreview;
