import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  Bot,
  Check,
  CircleAlert,
  ExternalLink,
  FileText,
  Globe2,
  LayoutTemplate,
  Loader2,
  MessageCircle,
  Monitor,
  PanelTop,
  RefreshCw,
  Send,
  Smartphone,
  Sparkles,
  X,
} from "lucide-react";
import type { SiteOpsConversationPanelProps } from "../siteops/SiteOpsConversationPanel";
import {
  previewKnowledgeCollectionCount,
  previewKnowledgeFragmentCount,
  previewRagAnswer,
  previewRagQuestion,
} from "./preview-copy";
import { usePreviewDialog } from "./qa-widget/usePreviewDialog";
import {
  findLatestEvaluationReport,
  getEvaluationReportById,
  listEvaluationReports,
  saveEvaluationReport,
  savePublishDecisionWithReports,
  type EvaluationReportSnapshot,
  type EvaluationSubjectRef,
} from "./evaluation-report-store";
import {
  websiteBuildEvaluationSkill,
  type WebsiteBuildEvaluationCheckStatus,
  type WebsiteBuildEvaluationOutput,
} from "./website-build-evaluation-skill";
import {
  buildWebsiteEvaluationJudgmentsFromSiteOps,
  siteOpsWebsiteEvaluationObservedAt,
  siteOpsWebsiteEvaluationVersion,
} from "./website-build-siteops-evidence";
import { scopedEvaluationStorage } from "./scoped-evaluation-storage";
import "./simplified-product-preview.css";

export type BuildStep = "template" | "structure" | "assistant" | "evaluation";
type PreviewDevice = "desktop" | "mobile";
type SiteLanguage = "zh-CN" | "en-US";

export type SimplifiedWebsiteBuilderPreviewProps = {
  initialStep?: BuildStep;
  onOpenRag?: () => void;
  /** Opens the established SiteOps UI for Aliyun, domain and release controls. */
  onOpenSiteOpsRelease?: () => void;
  onStepChange?: (step: BuildStep) => void;
  /** Real SiteOps state/actions supplied by the connected production adapter. */
  siteOps?: SiteOpsConversationPanelProps;
  /** Separates live drafts and audit evidence by account/workspace. */
  storageScope?: string;
};

type LiveReleaseCoordinates = {
  projectId: string;
  projectRevision: number;
  knowledgeSnapshotId: string | null;
  buildId: string;
  expectedHeadDeploymentId: string | null;
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

const WEBSITE_CHECK_STATUS_LABELS: Record<WebsiteBuildEvaluationCheckStatus, string> = {
  passed: "已通过",
  partial: "部分通过",
  failed: "未通过",
  pending: "待执行",
  not_applicable: "不适用",
};

function sameEvaluationSubject(
  left: EvaluationSubjectRef,
  right: EvaluationSubjectRef,
) {
  return left.kind === right.kind && left.id === right.id && left.version === right.version;
}

type WebsiteEvaluationReportState = {
  report: EvaluationReportSnapshot;
  persisted: boolean;
};

function recoverOrSaveWebsiteEvaluationReport(input: {
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined;
  subject: EvaluationSubjectRef;
  result: WebsiteBuildEvaluationOutput;
}): WebsiteEvaluationReportState {
  const resultJson = JSON.stringify(input.result);
  const recovered = listEvaluationReports(input.storage).find((report) =>
    report.result.skillId === input.result.skillId
    && sameEvaluationSubject(report.subject, input.subject)
    && JSON.stringify(report.result) === resultJson,
  );
  if (recovered) return { report: recovered, persisted: true };
  const report: EvaluationReportSnapshot = {
    reportId: `website-report-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    subject: input.subject,
    result: input.result,
  };
  return {
    report,
    persisted: saveEvaluationReport(report, input.storage),
  };
}

const LIVE_SITEOPS_STATUS_LABELS: Record<string, string> = {
  loading: "正在连接真实建站服务",
  select_snapshot: "等待关联知识库",
  collecting_brief: "等待载入真实模板",
  visual_searching: "正在载入真实模板",
  awaiting_visual_selection: "请选择真实模板",
  preparing: "正在准备网站",
  building: "正在生成网站",
  preview_ready: "真实预览已生成",
  approved: "网站已通过构建检查",
  live: "网站已发布",
  attention_required: "建站需要处理",
  failed: "建站失败",
  cancelled: "建站已取消",
};

const LINKED_RAG_REPORT_STORAGE_KEY = "frontmind.website-builder.linked-rag-report.v1";

function draftVersion(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `draft-v1-${(hash >>> 0).toString(16)}`;
}

function scopedStorageKey(key: string, scope?: string) {
  return scope ? `${key}.${encodeURIComponent(scope)}` : key;
}

function loadLinkedRagReportId(
  storageScope?: string,
  auditStorage?: Pick<Storage, "getItem" | "setItem"> | null,
) {
  try {
    const reportId = localStorage.getItem(
      scopedStorageKey(LINKED_RAG_REPORT_STORAGE_KEY, storageScope),
    );
    return reportId && getEvaluationReportById(reportId, auditStorage)?.result.skillId === "enterprise-rag-evaluation" ? reportId : null;
  } catch {
    return null;
  }
}

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
    siteGoal: string;
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
    siteGoal: "帮助访客快速找到可信的企业资料、产品与服务答案",
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

export function loadWebsiteDraft(storageScope?: string): WebsiteDraftV1 {
  const fallback = defaultDraft();
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(
      scopedStorageKey(WEBSITE_DRAFT_STORAGE_KEY, storageScope),
    );
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
    const siteGoal = typeof brand.siteGoal === "string" ? brand.siteGoal.slice(0, 200) : fallback.brand.siteGoal;
    const brandMark = typeof brand.brandMark === "string" ? brand.brandMark.slice(0, 3) : fallback.brand.brandMark;
    const assistantName = typeof assistant.name === "string" ? assistant.name.slice(0, 60) : fallback.assistant.name;
    const assistantWelcome = typeof assistant.welcome === "string" ? assistant.welcome.slice(0, 140) : fallback.assistant.welcome;
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
        siteGoal,
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

export function saveWebsiteDraft(draft: WebsiteDraftV1, storageScope?: string) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      scopedStorageKey(WEBSITE_DRAFT_STORAGE_KEY, storageScope),
      JSON.stringify({ ...draft, updatedAt: Date.now() }),
    );
    return true;
  } catch {
    return false;
  }
}

function configurationLine(value: string, max: number) {
  return value.replace(/\s+/gu, " ").trim().slice(0, max);
}

export function buildLiveSiteOpsConfigurationMessage(input: {
  siteName: string;
  siteLanguage: SiteLanguage;
  siteGoal: string;
  siteAccent: string;
  assistantName: string;
  welcome: string;
  assistantAccent: string;
}) {
  const generationGoal = [
    // Keep every preference inside SiteBrief.conversionGoal's 500-character
    // protocol limit; never truncate the tail fields after joining.
    configurationLine(input.siteGoal, 200),
    `网站主题色 ${input.siteAccent}`,
    `AI 助手名称 ${configurationLine(input.assistantName, 60)}`,
    `AI 助手欢迎语 ${configurationLine(input.welcome, 140)}`,
    `AI 助手主题色 ${input.assistantAccent}`,
  ].join("；");
  return [
    `网站名称: ${configurationLine(input.siteName, 80)}`,
    `站点语言: ${input.siteLanguage}`,
    `建站目标: ${generationGoal}`,
  ].join("\n");
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
  onOpenSiteOpsRelease,
  onStepChange,
  siteOps,
  storageScope,
}: SimplifiedWebsiteBuilderPreviewProps) {
  const auditStorage = useMemo(() => scopedEvaluationStorage(storageScope), [storageScope]);
  const [draftSeed] = useState<WebsiteDraftV1>(() => loadWebsiteDraft(storageScope));
  const [activeStep, setActiveStep] = useState<BuildStep>(initialStep);
  const [isConfirmed, setIsConfirmed] = useState(draftSeed.confirmed);
  const [completedStepIds, setCompletedStepIds] = useState<BuildStep[]>(draftSeed.completedStepIds);
  const [selectedTemplateId, setSelectedTemplateId] = useState(draftSeed.selectedTemplateId);
  const [pages, setPages] = useState(() => {
    const disabledPageIds = new Set(draftSeed.disabledPageIds);
    return initialPages.map((page) => ({ ...page, enabled: !disabledPageIds.has(page.id) }));
  });
  const [siteName, setSiteName] = useState(draftSeed.brand.siteName);
  const [siteGoal, setSiteGoal] = useState(draftSeed.brand.siteGoal);
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
  const [liveAction, setLiveAction] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [linkedRagReportId, setLinkedRagReportId] = useState<string | null>(
    () => loadLinkedRagReportId(storageScope, auditStorage),
  );
  const [liveEvaluationReportState, setLiveEvaluationReportState] =
    useState<WebsiteEvaluationReportState | null>(null);
  const liveEvaluationReport = liveEvaluationReportState?.report ?? null;
  const liveEvaluationReportPersisted = liveEvaluationReportState?.persisted === true;
  const [releaseReport, setReleaseReport] = useState<EvaluationReportSnapshot | null>(null);
  const [liveReleaseCoordinates, setLiveReleaseCoordinates] =
    useState<LiveReleaseCoordinates | null>(null);
  const didMountDraftRef = useRef(false);
  const appliedLiveBriefKeyRef = useRef<string | null>(null);
  const closeReleaseConfirmation = () => {
    setReleaseReport(null);
    setLiveReleaseCoordinates(null);
  };
  const releaseDialogRef = usePreviewDialog(
    releaseReport !== null,
    closeReleaseConfirmation,
  );

  const liveObservation = siteOps?.observation ?? null;
  const liveCandidates = useMemo(
    () => liveObservation
      ? [
          ...liveObservation.visualCandidatePages.flatMap((page) => page.candidates),
          ...liveObservation.visualCandidates,
        ].filter(
          (candidate, index, candidates) =>
            candidates.findIndex((item) => item.id === candidate.id) === index,
        )
      : [],
    [liveObservation],
  );
  const templateOptions = useMemo(
    () => siteOps
      ? [...liveCandidates]
          .sort(
            (left, right) =>
              Number(right.executionAdmitted !== false) -
              Number(left.executionAdmitted !== false),
          )
          .map((candidate, index) => ({
            id: candidate.id,
            name: candidate.title,
            description: candidate.executionAdmissionMode === "preview_reference_fallback"
              ? `${candidate.note ? `${candidate.note}；` : ""}基于冻结预览图重建，不代表原仓源码的实际构建。`
              : candidate.note || "真实建站模板；选择后将使用当前已发布知识库生成网站。",
            source: candidate.executionAdmissionMode === "preview_reference_fallback"
              ? "安全视觉参考"
              : "真实可执行模板",
            accent: accentOptions[index % accentOptions.length],
            recommended: candidate.id === liveCandidates.find(
              (item) => item.executionAdmitted !== false,
            )?.id,
            previewUrl: candidate.previewUrl,
            executionAdmitted: candidate.executionAdmitted !== false,
            executionAdmissionMode: candidate.executionAdmissionMode ?? null,
            executionUnavailableReason: candidate.executionUnavailableReason ?? null,
          }))
      : templates.map((template) => ({
          ...template,
          previewUrl: null,
          executionAdmitted: true,
          executionAdmissionMode: null,
          executionUnavailableReason: null,
        })),
    [liveCandidates, siteOps],
  );
  const isLiveBuilder = Boolean(siteOps);
  const serverSelectedCandidateId = liveCandidates.find((candidate) => candidate.selected)?.id ?? null;
  const templateSelectionOpen = liveObservation?.interactionState === "awaiting_visual_selection";
  const effectiveSelectedTemplateId = isLiveBuilder
    ? serverSelectedCandidateId ?? (templateSelectionOpen ? selectedTemplateId : "")
    : selectedTemplateId;
  const selectedTemplate = templateOptions.find((template) => template.id === effectiveSelectedTemplateId)
    ?? (!isLiveBuilder || templateSelectionOpen
      ? templateOptions.find((template) => template.executionAdmitted)
      : undefined)
    ?? {
      ...templates[0],
      id: "server-selection-pending",
      name: "等待服务端确认模板",
      description: "当前构建尚未返回已绑定的模板坐标。",
      source: "真实 SiteOps",
      previewUrl: null,
      executionAdmitted: false,
      executionAdmissionMode: null,
      executionUnavailableReason: "服务端尚未确认当前构建模板。",
    };
  const selectedTemplateUsesPreviewFallback =
    selectedTemplate.executionAdmissionMode === "preview_reference_fallback";
  const latestBuild = liveObservation?.builds[0] ?? null;
  const liveWebsiteJudgments = useMemo(
    () => liveObservation
      ? buildWebsiteEvaluationJudgmentsFromSiteOps(liveObservation)
      : null,
    [liveObservation],
  );
  const liveEvaluationObservedAt = liveObservation
    ? siteOpsWebsiteEvaluationObservedAt(liveObservation)
    : null;
  const selectedTemplatePreviewUrl = useMemo(() => {
    if (!siteOps || !selectedTemplate.executionAdmitted || !selectedTemplate.previewUrl) return null;
    const marker = "/style-previews/";
    const at = selectedTemplate.previewUrl.indexOf(marker);
    if (at === -1) return null;
    return `${selectedTemplate.previewUrl.slice(0, at)}/template-previews/${encodeURIComponent(selectedTemplate.id)}`;
  }, [selectedTemplate.executionAdmitted, selectedTemplate.id, selectedTemplate.previewUrl, siteOps]);
  const liveRevisionEditable = Boolean(
    latestBuild?.id
    && liveObservation
    && [
      "preview_ready",
      "approved",
      "live",
      "failed",
      "attention_required",
    ].includes(liveObservation.interactionState),
  );
  const liveConfigurationEditable = templateSelectionOpen || liveRevisionEditable;
  const latestGlobalDeployment = liveObservation?.deployments.find(
    (deployment) => deployment.target === "global_excluding_cn" && deployment.status === "active",
  ) ?? null;
  const authoritativeGlobalHeadId =
    liveObservation?.project.globalLiveDeploymentId
    ?? latestGlobalDeployment?.id
    ?? null;
  const pendingGlobalDeployment = liveObservation?.deployments.find(
    (deployment) => deployment.target === "global_excluding_cn"
      && ["reserved", "deploying", "verifying"].includes(deployment.status),
  ) ?? null;
  const liveVisualRetryAction = liveObservation?.visualGeneration.status === "retryable_error"
    ? liveObservation.visualGeneration.retryAction
      ?? (liveObservation.visualGeneration.generatedPages === 0 ? "start" : "supplemental")
    : null;
  const liveInteractionPending = Boolean(siteOps?.interactionPending || liveAction);
  const enabledPages = useMemo(() => pages.filter((page) => page.enabled), [pages]);
  const completedStepSet = useMemo(() => new Set(completedStepIds), [completedStepIds]);
  const stepIndex = steps.findIndex((step) => step.id === activeStep);
  const templateReady = isLiveBuilder
    ? Boolean(
        effectiveSelectedTemplateId
        && liveCandidates.some(
          (candidate) => candidate.id === effectiveSelectedTemplateId && candidate.executionAdmitted !== false,
        ),
      )
    : Boolean(selectedTemplateId);
  const structureReady = enabledPages.length > 0;
  const brandReady = Boolean(siteName.trim() && siteGoal.trim() && (isLiveBuilder || brandMark.trim()));
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
  const websiteSubject = latestBuild && liveObservation
    ? {
        kind: "website-build",
        id: latestBuild.id,
        version: siteOpsWebsiteEvaluationVersion(liveObservation),
      }
    : {
        kind: "website-build",
        id: "frontmind-ai-website",
        version: draftVersion({
          selectedTemplateId: effectiveSelectedTemplateId,
          templateUrl,
          enabledPageIds: enabledPages.map((page) => page.id),
          siteName,
          siteGoal,
          siteLanguage,
          brandMark,
          officialUrl,
          brandRecognized,
          siteAccent,
          assistantName,
          welcome,
          assistantAccent,
          showSources,
        }),
      };

  const liveBuildStatus = latestBuild?.status ?? liveObservation?.interactionState ?? "loading";
  const liveBuildApproved = latestBuild?.status === "approved";
  const liveDnsReady = liveObservation?.domainState?.dnsStatus === "active";
  const currentBuildAlreadyLive = Boolean(
    latestBuild && latestGlobalDeployment?.buildId === latestBuild.id,
  );
  const livePublishEligible = Boolean(
    liveBuildApproved
    && liveDnsReady
    && !pendingGlobalDeployment
    && !currentBuildAlreadyLive,
  );

  useEffect(() => {
    if (!siteOps || !liveObservation?.brief) return;
    const brief = liveObservation.brief;
    const briefKey = JSON.stringify(brief);
    if (appliedLiveBriefKeyRef.current === briefKey) return;
    appliedLiveBriefKeyRef.current = briefKey;
    setPages(brief.routes.map((route) => ({
      id: route.id,
      name: route.title,
      detail: `${route.sourceDocumentIds.length} 个知识来源`,
      enabled: true,
    })));
    setSiteName(brief.companyName);
    setSiteGoal(brief.conversionGoal.split("；网站主题色 ")[0]?.trim() || brief.conversionGoal);
    setSiteLanguage(brief.primaryLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US");
    const mark = brief.companyName
      .split(/\s+/u)
      .map((part) => part[0])
      .join("")
      .slice(0, 3)
      .toUpperCase();
    if (mark) setBrandMark(mark);
  }, [liveObservation?.brief, siteOps]);

  useEffect(() => {
    if (!siteOps) return;
    // Keep an explicit user selection of any selectable template; only fall
    // back to the first admitted candidate while nothing valid is selected.
    const hasSelectableSelection = liveCandidates.some(
      (candidate) =>
        candidate.id === selectedTemplateId &&
        candidate.executionAdmitted !== false,
    );
    const nextTemplateId = serverSelectedCandidateId
      ?? (templateSelectionOpen && !hasSelectableSelection
        ? liveCandidates.find((candidate) => candidate.executionAdmitted !== false)?.id
        : null);
    if (!nextTemplateId || selectedTemplateId === nextTemplateId) return;
    setSelectedTemplateId(nextTemplateId);
  }, [liveCandidates, selectedTemplateId, serverSelectedCandidateId, siteOps, templateSelectionOpen]);

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
        siteGoal,
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
    }, storageScope);
    setStorageAvailable(saved);
  }, [assistantAccent, assistantName, brandMark, brandRecognized, completedStepIds, isConfirmed, officialUrl, pages, selectedTemplateId, showSources, siteAccent, siteGoal, siteLanguage, siteName, storageScope, templateUrl, welcome]);

  useEffect(() => {
    if (!didMountDraftRef.current) {
      didMountDraftRef.current = true;
      return;
    }
    if (isConfirmed) setIsConfirmed(false);
  }, [assistantAccent, assistantName, brandMark, brandRecognized, completedStepIds, officialUrl, pages, selectedTemplateId, showSources, siteAccent, siteGoal, siteLanguage, siteName, templateUrl, welcome]);

  const runLiveAction = async (
    key: string,
    input: Parameters<NonNullable<SiteOpsConversationPanelProps["onAction"]>>[0],
  ) => {
    if (!siteOps?.onAction || liveInteractionPending) return false;
    setLiveAction(key);
    setLiveError(null);
    try {
      await siteOps.onAction(input);
      return true;
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "建站操作没有完成，请重试。");
      return false;
    } finally {
      setLiveAction(null);
    }
  };

  const advanceLiveSetup = async () => {
    if (!liveObservation) {
      await siteOps?.onRefresh?.();
      return;
    }
    if (liveObservation.interactionState === "select_snapshot") {
      await runLiveAction("select_snapshot", { action: "select_snapshot", input: {} });
      return;
    }
    if (liveObservation.interactionState === "collecting_brief") {
      await runLiveAction("start_visual_search", { action: "start_visual_search", input: {} });
    }
  };

  const retryLiveVisualSearch = async () => {
    if (!liveVisualRetryAction) return;
    const action = liveVisualRetryAction === "start"
      ? "start_visual_search"
      : "reselect_visual";
    await runLiveAction(action, { action, input: {} });
  };

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

  const submitLiveConfigurationAndBuild = async () => {
    if (
      !siteOps?.onSubmitRevision
      || !siteOps.onAction
      || !liveObservation
      || liveObservation.interactionState !== "awaiting_visual_selection"
      || liveInteractionPending
    ) {
      setNotice("真实建站服务当前不能保存配置并开始生成，请刷新状态后重试。");
      return false;
    }
    const selectedCandidate = liveCandidates.find(
      (candidate) => candidate.id === selectedTemplateId,
    );
    if (!selectedCandidate || selectedCandidate.executionAdmitted === false) {
      setNotice(selectedCandidate?.executionUnavailableReason || "请选择一个可用于真实生成的模板。");
      return false;
    }
    setLiveAction("configure_and_build");
    setLiveError(null);
    try {
      await siteOps.onSubmitRevision({
        text: buildLiveSiteOpsConfigurationMessage({
          siteName,
          siteLanguage,
          siteGoal,
          siteAccent,
          assistantName,
          welcome,
          assistantAccent,
        }),
        files: [],
        onProgress: () => undefined,
      });
      await siteOps.onAction({
        action: "select_visual",
        input: { sampleId: selectedCandidate.id },
      });
      setNotice("真实建站配置已保存，已使用所选模板提交生成；页面会同步服务端状态。");
      return true;
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "真实建站配置或生成任务提交失败，请重试。");
      return false;
    } finally {
      setLiveAction(null);
    }
  };

  const submitLiveRevision = async () => {
    if (
      !siteOps?.onSubmitRevision
      || !liveObservation
      || !liveRevisionEditable
      || liveInteractionPending
    ) {
      setNotice("当前真实构建不能提交修改，请等待构建完成或刷新状态后重试。");
      return false;
    }
    setLiveAction("submit_revision");
    setLiveError(null);
    try {
      await siteOps.onSubmitRevision({
        text: buildLiveSiteOpsConfigurationMessage({
          siteName,
          siteLanguage,
          siteGoal,
          siteAccent,
          assistantName,
          welcome,
          assistantAccent,
        }),
        files: [],
        onProgress: () => undefined,
      });
      setNotice("真实改版要求已提交；旧预览会保留到新版本完成，页面会同步新的构建状态。");
      return true;
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "真实改版要求提交失败，请重试。");
      return false;
    } finally {
      setLiveAction(null);
    }
  };

  const goNext = async () => {
    if (stepIndex >= steps.length - 1) return;
    if (activeStep === "template" && !templateReady) {
      setNotice("请先选择一个模板版式。");
      return;
    }
    if (activeStep === "structure" && (!structureReady || !brandReady)) {
      setNotice(siteOps
        ? "请确认真实页面路由，并补充网站名称与站点简介 / 建站目标。"
        : "请至少保留一个网站栏目，并补充网站名称、站点简介和品牌标识。");
      return;
    }
    if (activeStep === "assistant" && !assistantReady) {
      setNotice("请补充助手名称和欢迎语。");
      return;
    }
    if (
      activeStep === "assistant"
      && siteOps
      && liveObservation?.interactionState === "awaiting_visual_selection"
    ) {
      const accepted = await submitLiveConfigurationAndBuild();
      if (!accepted) return;
    }
    if (activeStep === "assistant" && siteOps && liveRevisionEditable) {
      const accepted = await submitLiveRevision();
      if (!accepted) return;
    }
    setCompletedStepIds((current) => current.includes(activeStep) ? current : [...current, activeStep]);
    goTo(steps[stepIndex + 1].id);
  };

  const defaultWebsiteQualityChecks: EvaluationCheck[] = [
    {
      id: "website-content-structure",
      title: "版本、目标问题覆盖与信息结构",
      detail: "需绑定知识与草稿版本，并用目标访客问题核对栏目和正文；当前只有栏目骨架",
      status: "pending",
      statusLabel: "待核实",
      weight: 20,
      actionLabel: "查看结构",
      onAction: () => goTo("structure"),
    },
    {
      id: "website-navigation-contact",
      title: "导航与联系入口",
      detail: "需逐页检查导航、返回路径和联系入口是否可达，当前尚未执行",
      status: "unexecuted",
      statusLabel: "未执行",
      weight: 10,
      actionLabel: "查看结构",
      onAction: () => goTo("structure"),
    },
    {
      id: "website-responsive-accessibility",
      title: "窄屏与键盘可用性",
      detail: "手机预览只能辅助观察，仍需完成窄屏、键盘焦点与可读性检查",
      status: "unexecuted",
      statusLabel: "未执行",
      weight: 10,
      actionLabel: "手机预览",
      onAction: () => {
        setDevice("mobile");
        goTo("assistant");
      },
    },
  ];

  const defaultTrustBoundaryChecks: EvaluationCheck[] = [
    {
      id: "website-facts-evidence",
      title: "企业事实与证据",
      detail: "需为身份、产品和能力声明绑定可追溯来源；示例知识不能代替正式证据",
      status: "pending",
      statusLabel: "待核实",
      weight: 20,
      critical: true,
      actionLabel: "查看知识范围",
      onAction: onOpenRag ?? (() => goTo("assistant")),
    },
    {
      id: "website-public-boundary",
      title: "公开范围与来源展示",
      detail: "隐藏来源只改变展示方式，不会扩大可公开范围；仍需确认公开授权与展示边界",
      status: "pending",
      statusLabel: "待核实",
      weight: 20,
      critical: true,
      actionLabel: "查看来源设置",
      onAction: onOpenRag ?? (() => goTo("assistant")),
    },
  ];

  const defaultFlowAndPublishChecks: EvaluationCheck[] = [
    {
      id: "website-flow-recovery",
      title: "建站流程、反馈与失败恢复",
      detail: "需走查阶段、按钮、字段反馈和失败后的恢复路径；组件测试不能代替正式评估证据",
      status: "unexecuted",
      statusLabel: "未执行",
      weight: 15,
      actionLabel: "返回流程起点",
      onAction: () => goTo("template"),
    },
    {
      id: "website-draft-release-state",
      title: "草稿、发布与正式生效",
      detail: "草稿确认、发布决定和真实部署是三个独立状态；当前原型只记录发布决定",
      status: "unexecuted",
      statusLabel: "未执行",
      weight: 5,
      critical: true,
    },
  ];

  const liveJudgmentsById = new Map(
    (liveWebsiteJudgments ?? []).map((item) => [item.checkId, item]),
  );
  const applyLiveJudgments = (checks: EvaluationCheck[]) => checks.map((check) => {
    const liveJudgment = liveJudgmentsById.get(
      check.id as Parameters<typeof websiteBuildEvaluationSkill.evaluate>[0]["judgments"][number]["checkId"],
    );
    if (!liveJudgment) return check;
    return {
      ...check,
      detail: liveJudgment.summary,
      status: liveJudgment.status === "not_applicable"
        ? "not-applicable" as const
        : liveJudgment.status,
      statusLabel: WEBSITE_CHECK_STATUS_LABELS[liveJudgment.status],
    };
  });
  const websiteQualityChecks = applyLiveJudgments(defaultWebsiteQualityChecks);
  const trustBoundaryChecks = applyLiveJudgments(defaultTrustBoundaryChecks);
  const flowAndPublishChecks = applyLiveJudgments(defaultFlowAndPublishChecks);

  const scoreGroups = [
    { id: "content-experience", label: "网站内容与体验", checks: websiteQualityChecks },
    { id: "facts-public-boundary", label: "企业事实与公开边界", checks: trustBoundaryChecks },
    { id: "flow-release-clarity", label: "流程与发布说明", checks: flowAndPublishChecks },
  ];
  const scoredChecks = scoreGroups.flatMap((group) => group.checks);
  const applicableChecks = scoredChecks.filter((check) => check.status !== "not-applicable");
  const judgedChecks = applicableChecks.filter((check) =>
    check.status === "passed" || check.status === "partial" || check.status === "failed",
  );
  const linkedRagReport = linkedRagReportId ? getEvaluationReportById(linkedRagReportId, auditStorage) : null;
  const latestRagReport = findLatestEvaluationReport(
    { skillId: "enterprise-rag-evaluation" },
    auditStorage,
  );
  const toSkillStatus = (status: EvaluationStatus): WebsiteBuildEvaluationCheckStatus => {
    if (status === "not-applicable") return "not_applicable";
    if (status === "passed" || status === "partial" || status === "failed") return status;
    return "pending";
  };
  const websiteEvaluation = websiteBuildEvaluationSkill.evaluate({
    judgments: liveWebsiteJudgments ?? scoredChecks.map((check) => ({
      checkId: check.id as Parameters<typeof websiteBuildEvaluationSkill.evaluate>[0]["judgments"][number]["checkId"],
      status: toSkillStatus(check.status),
      summary: check.detail,
      evidenceIds: ["passed", "partial", "failed"].includes(check.status) ? [`website-preview:${check.id}`] : [],
    })),
    relatedReportIds: linkedRagReport ? [linkedRagReport.reportId] : [],
  });
  const earnedWeight = websiteEvaluation.dimensions.reduce((sum, dimension) => sum + (dimension.score ?? 0), 0);
  const weightedScore = websiteEvaluation.score;
  const judgmentCoverage = Math.round(websiteEvaluation.coverage);
  const unresolvedCriticalChecks = websiteEvaluation.risks.filter((risk) => risk.severity === "critical" || risk.severity === "high");
  const formatPoints = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);
  const scoreGroupEarnedPoints = websiteEvaluation.dimensions.map((dimension) => dimension.score ?? 0);
  const scoreIsProvisional = websiteEvaluation.status !== "completed";
  const recommendation = {
    recommended: "建议发布",
    publish_with_risk: "可知情发布",
    not_recommended: "暂不建议发布",
  }[websiteEvaluation.recommendation];
  const recommendationDetail = websiteEvaluation.summary;
  const recommendationBadge = "仅作建议，不限制发布";
  const websiteEvaluationFingerprint = JSON.stringify(websiteEvaluation);

  useEffect(() => {
    if (!siteOps || websiteEvaluation.status === "not_run") {
      setLiveEvaluationReportState(null);
      return;
    }
    const reportState = recoverOrSaveWebsiteEvaluationReport({
      storage: auditStorage,
      subject: websiteSubject,
      result: websiteEvaluation,
    });
    setLiveEvaluationReportState((current) =>
      current?.report.reportId === reportState.report.reportId
      && current.persisted === reportState.persisted
        ? current
        : reportState,
    );
  }, [
    auditStorage,
    siteOps,
    websiteEvaluation.status,
    websiteEvaluationFingerprint,
    websiteSubject.id,
    websiteSubject.kind,
    websiteSubject.version,
  ]);

  const linkLatestRagReport = () => {
    if (!latestRagReport) {
      setNotice("尚无已保存的企业 RAG 评估快照。先完成一次人工评审后即可显式关联。");
      return;
    }
    setLinkedRagReportId(latestRagReport.reportId);
    try {
      localStorage.setItem(
        scopedStorageKey(LINKED_RAG_REPORT_STORAGE_KEY, storageScope),
        latestRagReport.reportId,
      );
    } catch { /* session state still works */ }
    setNotice("已关联最新企业 RAG 评估快照；该结果只作参考，不参与网站建设得分。");
  };

  const unlinkRagReport = () => {
    setLinkedRagReportId(null);
    try {
      localStorage.removeItem(
        scopedStorageKey(LINKED_RAG_REPORT_STORAGE_KEY, storageScope),
      );
    } catch { /* session state still works */ }
    setNotice("已取消关联企业 RAG 评估；网站建设评分和发布选择均不受影响。");
  };

  const openReleaseConfirmation = () => {
    if (siteOps && !livePublishEligible) {
      setNotice(
        !liveBuildApproved
          ? "真实网站仍在生成或检查中；只有当前已批准构建才能发布。"
          : !liveDnsReady
            ? "域名 DNS 尚未处于 active 状态，不能提交真实发布。"
            : pendingGlobalDeployment
              ? "海外站点已有发布任务进行中，请等待服务端完成。"
              : "当前构建已经在线，无需重复发布。",
      );
      return;
    }
    let report: EvaluationReportSnapshot;
    if (siteOps) {
      const reportState = liveEvaluationReportState
        && sameEvaluationSubject(liveEvaluationReportState.report.subject, websiteSubject)
        && JSON.stringify(liveEvaluationReportState.report.result) === websiteEvaluationFingerprint
        ? liveEvaluationReportState
        : recoverOrSaveWebsiteEvaluationReport({
            storage: auditStorage,
            subject: websiteSubject,
            result: websiteEvaluation,
          });
      setLiveEvaluationReportState(reportState);
      report = reportState.report;
    } else {
      report = {
        reportId: `website-report-${crypto.randomUUID()}`,
        createdAt: new Date().toISOString(),
        subject: websiteSubject,
        result: websiteEvaluation,
      };
    }
    setLiveReleaseCoordinates(
      siteOps && liveObservation && latestBuild
        ? {
            projectId: liveObservation.project.id,
            projectRevision: liveObservation.project.revision,
            knowledgeSnapshotId:
              liveObservation.project.currentKnowledgeSnapshotId ?? null,
            buildId: latestBuild.id,
            expectedHeadDeploymentId: authoritativeGlobalHeadId,
          }
        : null,
    );
    setReleaseReport(report);
  };

  const confirmReleaseDecision = async () => {
    if (!releaseReport) return;
    const relatedReports = releaseReport.result.relatedReportIds.flatMap((reportId) => {
      const report = getEvaluationReportById(reportId, auditStorage);
      return report ? [report] : [];
    });
    const reports = [releaseReport, ...relatedReports];
    const riskIds = Array.from(new Set(reports.flatMap((report) => report.result.risks.map((risk) => risk.id))));
    const acceptedRisk = riskIds.length > 0 || reports.some((report) => report.result.recommendation !== "recommended");
    const decision = {
      decisionId: `publish-decision-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      subject: releaseReport.subject,
      action: "publish" as const,
      mode: acceptedRisk ? "accepted_risk" as const : "follow_recommendation" as const,
      evaluationReportIds: reports.map((report) => report.reportId),
      acknowledgedRiskIds: acceptedRisk ? riskIds : [],
      riskAcknowledged: acceptedRisk,
      note: siteOps ? "SiteOps publish_global request acknowledged by the server." : null,
    };
    if (siteOps) {
      const currentCoordinates = liveObservation && latestBuild
        ? {
            projectId: liveObservation.project.id,
            projectRevision: liveObservation.project.revision,
            knowledgeSnapshotId:
              liveObservation.project.currentKnowledgeSnapshotId ?? null,
            buildId: latestBuild.id,
            expectedHeadDeploymentId: authoritativeGlobalHeadId,
          }
        : null;
      if (
        !liveReleaseCoordinates
        || !currentCoordinates
        || Object.keys(liveReleaseCoordinates).some(
          (key) =>
            liveReleaseCoordinates[key as keyof LiveReleaseCoordinates]
            !== currentCoordinates[key as keyof LiveReleaseCoordinates],
        )
        || !livePublishEligible
      ) {
        closeReleaseConfirmation();
        setNotice("真实发布条件已经变化，未提交请求也未写入成功审计；请返回检查状态。");
        return;
      }
      const published = await runLiveAction("publish_global", {
        action: "publish_global",
        input: {
          buildId: liveReleaseCoordinates.buildId,
          expectedHeadDeploymentId:
            liveReleaseCoordinates.expectedHeadDeploymentId ?? undefined,
        },
      });
      if (!published) return;
      const saved = savePublishDecisionWithReports({
        reports: [releaseReport],
        decision,
      }, auditStorage);
      if (saved) {
        setLiveEvaluationReportState({ report: releaseReport, persisted: true });
      }
      closeReleaseConfirmation();
      setNotice(`${saved ? "服务端已受理发布，并记录本次发布决定" : "服务端已受理发布，但本地审计存储不可用"}；部署结果将继续同步，尚不表示已经上线。`);
      return;
    }
    const saved = savePublishDecisionWithReports({
      reports: [releaseReport],
      decision,
    }, auditStorage);
    closeReleaseConfirmation();
    setNotice(`${saved ? "已记录发布决定" : "已确认继续发布，但浏览器记录存储不可用"}；当前原型未执行真实部署。`);
  };

  const releaseRelatedReports = releaseReport?.result.relatedReportIds.flatMap((reportId) => {
    const report = getEvaluationReportById(reportId, auditStorage);
    return report ? [report] : [];
  }) ?? [];
  const releaseRisks = releaseReport
    ? [releaseReport, ...releaseRelatedReports].flatMap((report) => report.result.risks)
    : [];
  const releaseHasRisks = Boolean(releaseReport && (
    releaseRisks.length > 0
    || [releaseReport, ...releaseRelatedReports].some((report) => report.result.recommendation !== "recommended")
  ));

  const renderEvaluationGroup = (dimensionId: string, title: string, checks: EvaluationCheck[]) => {
    const hasWeightedChecks = checks.some((check) => check.weight);
    const dimension = websiteEvaluation.dimensions.find((item) => item.id === dimensionId);
    return (
      <section className="sfp-eval-group">
        <header>
          <div><h3>{title}</h3></div>
          {hasWeightedChecks && (
            <span>
              {formatPoints(dimension?.score ?? 0)}/{dimension?.maxScore ?? checks.reduce((sum, check) => sum + (check.weight ?? 0), 0)} 分
            </span>
          )}
        </header>
        <div className="sfp-check-list">
          {checks.map((check) => (
            <article
              key={check.id}
              className={`is-${check.status}`}
              data-testid={siteOps ? "website-evaluation-check" : undefined}
            >
              <span>{check.status === "passed" ? <Check size={17} /> : <CircleAlert size={17} />}</span>
              <div>
                <div className="sfp-check-title">
                  <strong>{check.title}</strong>
                  {check.critical && <em className="is-critical">关键风险</em>}
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
    <section
      className="sfp-root"
      data-step={activeStep}
      data-testid={siteOps ? "website-builder-live-root" : undefined}
    >
      <header className="sfp-heading">
        <div>
          <h1>从知识库快速搭建帮助中心</h1>
          <p>先完成网站建设与整体评估，再考虑域名和正式上线。</p>
        </div>
        <div className={`sfp-draft-state ${storageAvailable ? "" : "is-session-only"}`}>
          <i />
          <span>
            <strong>
              {siteOps
                ? LIVE_SITEOPS_STATUS_LABELS[liveBuildStatus] ?? liveBuildStatus
                : isConfirmed ? "草稿已确认" : "建设中"}
            </strong>
            <small>
              {siteOps
                ? `真实 SiteOps · 项目版本 ${liveObservation?.project.revision ?? "—"}`
                : storageAvailable ? `本地草稿 · ${isConfirmed ? "草稿确认状态已保存" : "配置已自动保存"}` : "仅本次页面保存"}
            </small>
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

      {(notice || siteOps?.notice) && <div className="sfp-notice" role="status">{notice || siteOps?.notice}</div>}
      {(liveError || siteOps?.error) && (
        <div className="sfp-notice" role="alert">
          {liveError || siteOps?.error}
          {siteOps?.onRefresh && (
            <button type="button" onClick={() => siteOps.onRefresh?.()}>
              <RefreshCw size={15} />重新载入
            </button>
          )}
        </div>
      )}
      {siteOps && (
        <div className="sfp-live-status" data-testid="siteops-build-status" role="status">
          <span>
            {liveInteractionPending || siteOps.refreshing ? <Loader2 className="sfp-spin" size={17} /> : <i />}
            <strong>{LIVE_SITEOPS_STATUS_LABELS[liveBuildStatus] ?? liveBuildStatus}</strong>
            <small>
              {latestBuild
                ? `真实构建 #${latestBuild.ordinal} · ${latestBuild.buildDelivery?.qaStatus ?? "检查中"}`
                : liveObservation?.knowledgeSnapshots[0]?.label ?? "正在读取当前知识库"}
            </small>
          </span>
          {latestBuild?.previewUrl && (
            <a
              data-testid="siteops-preview-link"
              href={latestBuild.previewUrl}
              target="frontmind-siteops-preview"
              rel="noreferrer"
            >
              打开真实网站预览<ExternalLink size={15} />
            </a>
          )}
        </div>
      )}
      {siteOps && liveBuildApproved && onOpenSiteOpsRelease && (
        <div className="sfp-siteops-release-entry">
          <span>
            <Globe2 size={18} aria-hidden="true" />
            <strong>构建已批准，可继续配置域名并上线</strong>
          </span>
          <button type="button" onClick={onOpenSiteOpsRelease}>
            打开域名与发布设置
          </button>
        </div>
      )}

      <div className="sfp-step-content">
        {activeStep === "template" && (
          <div className="sfp-panel sfp-template-step">
            <div className="sfp-section-heading">
              <div><h2>选择一个模板版式</h2><p>{siteOps ? "以下模板来自真实 SiteOps 目录；先选择版式，再确认真实 brief 配置，最后提交生成。" : "模板提供整体版式和默认配色，网站内容仍由当前知识库生成。"}</p></div>
            </div>
            {siteOps && (
              <div className="sfp-live-start">
                {!liveObservation ? (
                  <>
                    <Loader2 className="sfp-spin" size={20} />
                    <span><strong>正在打开真实建站项目</strong><small>读取当前已发布知识库与建站状态</small></span>
                    {siteOps.onRefresh && !siteOps.loading && (
                      <button data-testid="siteops-advance" type="button" onClick={() => siteOps.onRefresh?.()}>重新载入</button>
                    )}
                  </>
                ) : liveVisualRetryAction ? (
                  <>
                    <CircleAlert size={20} />
                    <span>
                      <strong>
                        {liveVisualRetryAction === "start"
                          ? "真实模板首次载入未完成"
                          : "后续模板载入未完成"}
                      </strong>
                      <small>
                        {liveVisualRetryAction === "start"
                          ? "上次载入失败，可从头重试"
                          : `已保留 ${liveCandidates.length} 个候选，可继续载入下一页`}
                      </small>
                    </span>
                    <button
                      data-testid="siteops-visual-retry"
                      type="button"
                      disabled={liveInteractionPending}
                      onClick={() => void retryLiveVisualSearch()}
                    >
                      {liveAction === "start_visual_search" || liveAction === "reselect_visual"
                        ? "正在重试…"
                        : liveVisualRetryAction === "start"
                          ? "重新载入真实模板"
                          : "继续载入下一页"}
                    </button>
                  </>
                ) : liveObservation.interactionState === "select_snapshot" ? (
                  <>
                    <FileText size={20} />
                    <span><strong>从当前已发布知识库开始</strong><small>生成任务会冻结本次使用的知识版本</small></span>
                    <button data-testid="siteops-advance" type="button" disabled={liveInteractionPending} onClick={advanceLiveSetup}>
                      {liveAction === "select_snapshot" ? "正在关联…" : "从知识库开始建站"}
                    </button>
                  </>
                ) : liveObservation.interactionState === "collecting_brief" ? (
                  <>
                    <LayoutTemplate size={20} />
                    <span><strong>知识范围已关联</strong><small>载入真实模板目录后选择可执行版式</small></span>
                    <button data-testid="siteops-advance" type="button" disabled={liveInteractionPending} onClick={advanceLiveSetup}>
                      {liveAction === "start_visual_search" ? "正在载入…" : "载入真实模板"}
                    </button>
                  </>
                ) : liveObservation.interactionState === "visual_searching" ? (
                  <>
                    <Loader2 className="sfp-spin" size={20} />
                    <span><strong>正在载入真实模板</strong><small>任务会自动更新，无需刷新页面</small></span>
                  </>
                ) : (
                  <>
                    <Check size={20} />
                    <span><strong>真实模板目录已就绪</strong><small>{liveCandidates.length} 个候选，{liveCandidates.filter((candidate) => candidate.executionAdmitted !== false).length} 个可执行{liveCandidates.some((candidate) => candidate.executionAdmissionMode === "preview_reference_fallback") ? `（${liveCandidates.filter((candidate) => candidate.executionAdmissionMode === "preview_reference_fallback").length} 个安全视觉参考）` : ""}</small></span>
                  </>
                )}
              </div>
            )}
            <div className="sfp-template-grid">
              {templateOptions.map((template) => (
                <label
                  key={template.id}
                  data-testid="website-template-card"
                  className={`${template.id === selectedTemplateId ? "is-selected" : ""}${template.executionAdmitted ? "" : " is-disabled"}`}
                >
                  <input
                    type="radio"
                    name="website-template"
                    value={template.id}
                    checked={template.id === effectiveSelectedTemplateId}
                    disabled={!template.executionAdmitted || liveInteractionPending || Boolean(siteOps && !templateSelectionOpen)}
                    onChange={() => {
                      if (siteOps && !templateSelectionOpen) return;
                      invalidateSteps("template", "structure");
                      setSelectedTemplateId(template.id);
                      setSiteAccent(template.accent);
                      setBrandRecognized(false);
                    }}
                  />
                  <div className="sfp-template-thumb" style={{ "--sfp-template-accent": template.accent } as CSSProperties}>
                    {template.previewUrl
                      ? <img src={template.previewUrl} alt="" />
                      : <><i /><div><span /><span /><span /></div><strong /><small /></>}
                  </div>
                  <div className="sfp-template-copy">
                    <span>{template.source}</span>
                    <h3>{template.name}{template.recommended && <em>推荐</em>}</h3>
                    <p>{template.description}</p>
                    <b>
                      {!template.executionAdmitted
                        ? template.executionUnavailableReason || "暂不可用于真实生成"
                        : template.executionAdmissionMode === "preview_reference_fallback"
                          ? template.id === effectiveSelectedTemplateId
                            ? serverSelectedCandidateId === template.id ? "基于冻结预览图重建 · 服务端已绑定" : "基于冻结预览图重建 · 已选中"
                            : siteOps && !templateSelectionOpen ? "基于冻结预览图重建 · 当前阶段不可重新选择" : "基于冻结预览图重建 · 可选择"
                        : template.id === effectiveSelectedTemplateId
                          ? serverSelectedCandidateId === template.id ? "服务端已绑定此模板" : "已选中，继续配置真实 brief"
                          : siteOps && !templateSelectionOpen ? "当前阶段不可重新选择" : "选择此模板"}
                    </b>
                  </div>
                </label>
              ))}
            </div>
            {!siteOps && <form className="sfp-import-row" onSubmit={importTemplate}>
              <LayoutTemplate size={19} />
              <div><strong>保存外部模板参考链接</strong></div>
              <input aria-label="外部模板链接（导入版式）" placeholder="https://template.example/..." value={templateUrl} onChange={(event) => setTemplateUrl(event.currentTarget.value)} />
              <button type="submit">保存链接</button>
            </form>}
          </div>
        )}

        {activeStep === "structure" && (
          <div className="sfp-workspace-grid">
            <section className="sfp-panel sfp-builder-config-panel sfp-builder-config-panel--structure">
              <div className="sfp-section-heading sfp-section-heading--compact">
                <div><h2>确认网站结构与品牌</h2><p>{siteOps ? "网站名称、语言和站点简介会保存到真实 SiteOps brief；主题色作为生成偏好提交，是否采用以真实预览为准。" : "系统已按知识库生成栏目；补充少量品牌信息即可完成网站骨架。"}</p></div>
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
                  disabled={Boolean(siteOps && !liveConfigurationEditable)}
                  onChange={(event) => {
                    invalidateSteps("structure");
                    setOfficialUrl(event.currentTarget.value);
                    setBrandRecognized(false);
                  }}
                />
                <button type="submit" disabled={Boolean(siteOps && !liveConfigurationEditable)}>生成建议</button>
              </form>
              <div className="sfp-brand-fields">
                <label className="sfp-brand-name">
                  <span>网站名称{siteOps && <small>真实 brief 字段</small>}</span>
                  <input aria-label="网站名称" data-testid="website-site-name" maxLength={80} value={siteName} disabled={Boolean(siteOps && !liveConfigurationEditable)} onChange={(event) => { invalidateSteps("structure"); setSiteName(event.currentTarget.value); setBrandRecognized(false); }} />
                </label>
                <label className="sfp-brand-name">
                  <span>站点简介 / 建站目标{siteOps && <small>真实 brief 字段</small>}</span>
                  <textarea aria-label="站点简介 / 建站目标" data-testid="website-site-goal" maxLength={200} value={siteGoal} disabled={Boolean(siteOps && !liveConfigurationEditable)} onChange={(event) => { invalidateSteps("structure"); setSiteGoal(event.currentTarget.value); }} />
                </label>
                <label>
                  <span>Logo / 品牌标识{siteOps && <small>仅本地示意，不进入真实生成协议</small>}</span>
                  <input aria-label="Logo / 品牌标识" maxLength={3} value={brandMark} onChange={(event) => { invalidateSteps("structure"); setBrandMark(event.currentTarget.value.toUpperCase()); setBrandRecognized(false); }} />
                </label>
                <label>
                  <span>站点语言{siteOps && <small>真实 brief 字段</small>}</span>
                  <select aria-label="站点语言" value={siteLanguage} disabled={Boolean(siteOps && !liveConfigurationEditable)} onChange={(event) => { invalidateSteps("structure"); setSiteLanguage(event.currentTarget.value as SiteLanguage); setBrandRecognized(false); }}>
                    <option value="zh-CN">中文（简体）</option>
                    <option value="en-US">English</option>
                  </select>
                </label>
                <fieldset className="sfp-brand-color">
                  <legend>网站主题色{siteOps && <small>生成偏好，以真实预览为准</small>}</legend>
                  <div className="sfp-color-options">
                    {accentOptions.map((color) => (
                      <button key={color} type="button" disabled={Boolean(siteOps && !liveConfigurationEditable)} aria-label={`选择网站主题色 ${color}`} aria-pressed={siteAccent === color} style={{ background: color }} onClick={() => { if (siteAccent !== color) invalidateSteps("structure"); setSiteAccent(color); setBrandRecognized(false); }} />
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="sfp-source-strip"><FileText size={17} /><span><strong>{siteOps ? liveObservation?.knowledgeSnapshots[0]?.label ?? "当前已发布知识库" : "当前 RAG 示例知识范围"}</strong><small>{siteOps ? `${liveObservation?.brief?.routes.length ?? 0} 个真实页面路由 · 项目版本 ${liveObservation?.project.revision ?? "—"}` : `${previewKnowledgeCollectionCount} 个知识集合已映射为 5 个网站栏目`}</small></span><b>{siteOps ? "真实绑定" : "已关联"}</b></div>
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
                        disabled={Boolean(siteOps)}
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
              <p className="sfp-helper">{siteOps ? "真实路由来自冻结知识版本；需要改版时可在真实预览生成后提交修改要求。" : "仅控制栏目显示，不修改知识库。"}</p>
            </section>
            <section className="sfp-preview-panel sfp-builder-preview-panel">
              {selectedTemplatePreviewUrl ? (
                <>
                  <div className="sfp-preview-heading"><span><strong>{selectedTemplateUsesPreviewFallback ? "安全视觉参考" : "真实模板预览"}</strong><small>{selectedTemplate.name} · {selectedTemplateUsesPreviewFallback ? "基于冻结预览图重建；并非原仓实际构建" : "已准入模板的实际构建"}；网站文案以知识库生成结果为准</small></span><DevicePicker device={device} onChange={setDevice} /></div>
                  <TemplatePreviewFrame device={device} previewUrl={selectedTemplatePreviewUrl} referenceFallback={selectedTemplateUsesPreviewFallback} templateName={selectedTemplate.name} />
                </>
              ) : (
                <>
                  <div className="sfp-preview-heading"><span><strong>{siteOps ? "本地配置示意（非真实预览）" : "即时预览"}</strong><small>{selectedTemplate.name} · {enabledPages.length} 个栏目{siteOps ? " · 真实效果请打开上方预览链接" : ""}</small></span><DevicePicker device={device} onChange={setDevice} /></div>
                  <MiniSitePreview assistantAccent={assistantAccent} assistantName={assistantName} brandMark={brandMark} device={device} pageNames={enabledPages.map((page) => page.name)} showAssistant={false} showSources={showSources} siteAccent={siteAccent} siteLanguage={siteLanguage} siteName={siteName} welcome={welcome} />
                </>
              )}
            </section>
          </div>
        )}

        {activeStep === "assistant" && (
          <div className="sfp-workspace-grid">
            <section className="sfp-panel sfp-builder-config-panel sfp-builder-config-panel--assistant">
              <div className="sfp-section-heading sfp-section-heading--compact">
                <div><h2>配置 AI 助手</h2><p>{siteOps ? "名称、欢迎语与主题色会作为真实生成偏好提交；当前协议不保证模板包含可交互助手，以真实预览为准。" : "配置网站右下角的帮助窗口并直接试用。"}</p></div>
              </div>
              <div className="sfp-rag-link-card">
                <span><Bot size={19} /></span>
                <div><strong>{siteOps ? "企业知识问答入口" : "企业 RAG 示例已关联"}</strong><small>{siteOps ? `${liveObservation?.knowledgeSnapshots[0]?.label ?? "当前发布知识"} · 问答入口仍由真实 RAG 服务提供` : `${previewKnowledgeCollectionCount} 个知识集合 · ${previewKnowledgeFragmentCount} 个示例片段 · 网站端来源${showSources ? "已展示" : "已隐藏"}`}</small></div>
                <button type="button" onClick={onOpenRag}>{siteOps ? "打开真实企业问答" : "查看 RAG 示例"}</button>
              </div>
              <div className="sfp-form-grid">
                <label><span>助手名称{siteOps && <small>生成偏好</small>}</span><input aria-label="助手名称" data-testid="website-assistant-name" maxLength={60} value={assistantName} disabled={Boolean(siteOps && !liveConfigurationEditable)} onChange={(event) => { invalidateSteps("assistant"); setAssistantName(event.currentTarget.value); }} /></label>
                <label className="sfp-welcome-field"><span>欢迎语{siteOps && <small>生成偏好，以真实预览为准</small>}</span><textarea aria-label="欢迎语" data-testid="website-assistant-welcome" maxLength={140} value={welcome} disabled={Boolean(siteOps && !liveConfigurationEditable)} onChange={(event) => { invalidateSteps("assistant"); setWelcome(event.currentTarget.value); }} /></label>
                <fieldset>
                  <legend>助手主题色{siteOps && <small>生成偏好，以真实预览为准</small>}</legend>
                  <div className="sfp-color-options">
                    {accentOptions.map((color) => (
                      <button key={color} type="button" disabled={Boolean(siteOps && !liveConfigurationEditable)} aria-label={`选择助手主题色 ${color}`} aria-pressed={assistantAccent === color} style={{ background: color }} onClick={() => { if (assistantAccent !== color) invalidateSteps("assistant"); setAssistantAccent(color); }} />
                    ))}
                  </div>
                </fieldset>
                <label className="sfp-setting-row"><span><strong>展示回答来源</strong><small>{siteOps ? "仅本地示意；当前 SiteOps 生成协议不支持此开关" : "让访客可以核对回答依据"}</small></span><input type="checkbox" checked={showSources} onChange={(event) => { invalidateSteps("assistant"); setShowSources(event.currentTarget.checked); }} /></label>
              </div>
            </section>
            <section className="sfp-preview-panel sfp-builder-preview-panel">
              {selectedTemplatePreviewUrl ? (
                <>
                  <div className="sfp-preview-heading"><span><strong>{selectedTemplateUsesPreviewFallback ? "安全视觉参考" : "真实模板预览"}</strong><small>{selectedTemplate.name} · {selectedTemplateUsesPreviewFallback ? "基于冻结预览图重建；并非原仓实际构建" : "已准入模板的实际构建"}；助手样式以生成结果为准</small></span><DevicePicker device={device} onChange={setDevice} /></div>
                  <TemplatePreviewFrame device={device} previewUrl={selectedTemplatePreviewUrl} referenceFallback={selectedTemplateUsesPreviewFallback} templateName={selectedTemplate.name} />
                </>
              ) : (
                <>
                  <div className="sfp-preview-heading"><span><strong>{siteOps ? "本地助手示意（非真实预览）" : "网站内效果"}</strong><small>{siteOps ? "真实模板是否采用这些偏好，请以服务端预览为准" : ""}</small></span><DevicePicker device={device} onChange={setDevice} /></div>
                  <MiniSitePreview assistantAccent={assistantAccent} assistantName={assistantName} brandMark={brandMark} device={device} pageNames={enabledPages.map((page) => page.name)} showAssistant showSources={showSources} siteAccent={siteAccent} siteLanguage={siteLanguage} siteName={siteName} welcome={welcome} />
                </>
              )}
            </section>
          </div>
        )}

        {activeStep === "evaluation" && (
          <div className="sfp-evaluation-layout">
            <section className="sfp-panel sfp-evaluation-main">
              <div className="sfp-section-heading">
                <div><h2>建设检查与评估</h2><p>网站专属检查按 40/40/20 加权；RAG 评估独立关联，不参与网站得分。</p></div>
                <aside className="sfp-eval-heading-meta">
                  <span className="sfp-eval-run-state" data-testid={siteOps ? "website-evaluation-status" : undefined}><i />{
                    siteOps
                      ? websiteEvaluation.status === "completed"
                        ? liveEvaluationReportPersisted
                          ? "真实证据评估已完成并保存"
                          : liveEvaluationReport
                            ? "真实证据评估已完成（仅本次会话，未持久化）"
                            : "真实证据评估已完成"
                        : websiteEvaluation.status === "pending"
                          ? "真实证据评估待补全"
                          : websiteEvaluation.status === "failed"
                            ? "真实证据评估输入异常"
                            : "等待真实 SiteOps 证据"
                      : "质量评估未完成"
                  }</span>
                  <span
                    className={`sfp-eval-score ${(weightedScore ?? 0) >= 85 ? "is-high" : (weightedScore ?? 0) >= 70 ? "is-medium" : "is-low"}`}
                    aria-label={`当前加权评估分：${weightedScore ?? "未形成"}，满分 100 分，${scoreIsProvisional ? "暂定结果" : "最终分"}`}
                    data-testid={siteOps ? "website-evaluation-score" : undefined}
                  >
                    <span><strong>{weightedScore ?? "—"}</strong><small>/100</small></span>
                    <em>{scoreIsProvisional ? "暂定结果" : "最终分"}</em>
                  </span>
                </aside>
              </div>
              <div className="sfp-eval-context" aria-label="本次评估范围">
                <span><small>项目</small><strong>FrontMind AI 专用官网</strong></span>
                <span><small>被测对象</small><strong>{siteOps ? latestBuild ? `真实构建 #${latestBuild.ordinal}` : "真实建站项目" : "当前本地网站草稿"}</strong></span>
                <span><small>草稿与知识版本</small><strong>{siteOps ? liveObservation?.knowledgeSnapshots[0]?.label ?? "等待真实知识版本" : `${previewKnowledgeCollectionCount} 个示例集合 · 正式版本未绑定`}</strong></span>
                <span><small>页面与问题范围</small><strong>{siteOps
                  ? `${liveObservation?.brief?.routes.length ?? 0} 个真实路由 · ${new Set(liveObservation?.brief?.routes.flatMap((route) => route.sourceDocumentIds) ?? []).size} 个知识来源`
                  : `${enabledPages.length} 个栏目 · 目标问题清单待补`}</strong></span>
                <span><small>公开范围</small><strong>{siteOps
                  ? latestGlobalDeployment?.publicUrl
                    ? `已公开 · ${latestGlobalDeployment.publicUrl}`
                    : liveObservation?.domainState?.displayDomain
                      ? `${liveObservation.domainState.displayDomain} · DNS ${liveObservation.domainState.dnsStatus ?? "未确认"} · 尚无 active 公开部署`
                      : "未选择域名 · 尚无 active 公开部署"
                  : "范围与确认人未记录"}</strong></span>
                <span><small>执行记录</small><strong data-testid={siteOps ? "website-evaluation-report-id" : undefined}>{siteOps
                  ? liveEvaluationReport
                    ? liveEvaluationReportPersisted
                      ? `可恢复报告 ${liveEvaluationReport.reportId} · 证据更新 ${liveEvaluationObservedAt ? new Date(liveEvaluationObservedAt).toLocaleString("zh-CN") : "—"}`
                      : `本次会话评估未持久化 · 证据更新 ${liveEvaluationObservedAt ? new Date(liveEvaluationObservedAt).toLocaleString("zh-CN") : "—"}`
                    : `真实 SiteOps · ${LIVE_SITEOPS_STATUS_LABELS[liveBuildStatus] ?? liveBuildStatus}`
                  : "本地预览 · 评估人和时间待补"}</strong></span>
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
                <span><small>配置确认</small><strong>{configurationConfirmedCount}/4</strong></span>
                <span><small>判定覆盖率</small><strong>{judgmentCoverage}%</strong></span>
                <span><small>完全通过率</small><strong>{judgedChecks.length > 0 ? `${Math.round((judgedChecks.filter((check) => check.status === "passed").length / judgedChecks.length) * 100)}%` : "无法计算"}</strong></span>
                <span><small>关键风险提示</small><strong>{unresolvedCriticalChecks.length}</strong></span>
              </div>
              <section className="sfp-score-formula" aria-label="加权评估分计算结果">
                <header>
                  <strong>加权评分</strong>
                  <code>{scoreGroupEarnedPoints.map(formatPoints).join(" + ")} = {formatPoints(earnedWeight)} → {weightedScore ?? "—"} 分</code>
                </header>
                <small className="sfp-score-weight-note">权重：网站内容与体验 40 分 · 企业事实与公开边界 40 分 · 流程与发布说明 20 分</small>
              </section>
              <section className="sfp-rag-evaluation-reference" aria-label="关联的企业 RAG 评估">
                <div>
                  <span><Bot size={18} /></span>
                  <p>
                    <strong>企业 RAG 评估 · 独立结果</strong>
                    <small>{linkedRagReport ? `已关联 ${linkedRagReport.result.score ?? "—"}/100 · ${linkedRagReport.result.version}` : "未关联评估快照；不影响网站得分或发布选择"}</small>
                    {linkedRagReport && <small>报告 ID：{linkedRagReport.reportId}</small>}
                  </p>
                </div>
                <div>
                  {linkedRagReport
                    ? <button type="button" onClick={unlinkRagReport}>取消关联</button>
                    : <button type="button" onClick={linkLatestRagReport}>{latestRagReport ? "关联最新 RAG 评估" : "查找 RAG 评估"}</button>}
                  {onOpenRag && <button type="button" onClick={onOpenRag}>打开 RAG 评估</button>}
                </div>
              </section>
              {renderEvaluationGroup("content-experience", "网站内容与体验", websiteQualityChecks)}
              {renderEvaluationGroup("facts-public-boundary", "企业事实与公开边界", trustBoundaryChecks)}
              {renderEvaluationGroup("flow-release-clarity", "流程与发布说明", flowAndPublishChecks)}
            </section>
            <aside className="sfp-final-preview">
              <div className="sfp-preview-heading"><span><strong>{siteOps ? "本地配置示意（非真实预览）" : "当前草稿预览"}</strong><small>{siteOps ? "真实成品请使用上方服务端预览链接核验" : ""}</small></span><DevicePicker device={device} onChange={setDevice} /></div>
              <MiniSitePreview assistantAccent={assistantAccent} assistantName={assistantName} brandMark={brandMark} device={device} pageNames={enabledPages.map((page) => page.name)} showAssistant showSources={showSources} siteAccent={siteAccent} siteLanguage={siteLanguage} siteName={siteName} welcome={welcome} />
            </aside>
          </div>
        )}
      </div>

      <footer className="sfp-actions">
        <button type="button" className="sfp-button sfp-button--ghost" onClick={goPrevious} disabled={stepIndex === 0}>上一步</button>
        <span>{stepIndex + 1} / {steps.length} · {steps[stepIndex].label}</span>
        {activeStep === "evaluation" ? (
          <div className="sfp-action-cluster">
            <button
              type="button"
              className="sfp-button sfp-button--ghost"
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
            <button
              type="button"
              className="sfp-button sfp-button--primary"
              disabled={Boolean(siteOps && (!livePublishEligible || liveInteractionPending))}
              onClick={openReleaseConfirmation}
            >
              {siteOps
                ? !liveBuildApproved
                  ? "等待真实构建检查"
                  : !liveDnsReady
                    ? "等待域名 DNS 生效"
                    : pendingGlobalDeployment
                      ? "海外站点发布中"
                      : currentBuildAlreadyLive
                        ? "当前构建已在线"
                        : "进入发布确认"
                : "进入发布确认"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="sfp-button sfp-button--primary"
            data-testid={siteOps && activeStep === "assistant"
              ? templateSelectionOpen
                ? "website-build-start"
                : liveRevisionEditable
                  ? "website-revision-submit"
                  : undefined
              : undefined}
            disabled={Boolean(siteOps && (
              liveInteractionPending
              || (activeStep === "template" && !templateReady)
              || (activeStep === "assistant" && templateSelectionOpen && (!assistantReady || !brandReady))
              || (activeStep === "assistant" && liveRevisionEditable && (!assistantReady || !brandReady))
            ))}
            onClick={goNext}
          >
            {siteOps && activeStep === "template"
              ? "继续配置真实 brief"
              : siteOps && activeStep === "assistant" && templateSelectionOpen
                ? liveAction === "configure_and_build" ? "正在保存配置并生成…" : "保存真实配置并生成网站"
                : siteOps && activeStep === "assistant" && liveRevisionEditable
                  ? liveAction === "submit_revision" ? "正在提交修改…" : "提交修改并重新生成"
                : "继续"}
          </button>
        )}
      </footer>
      {releaseReport && (
        <div className="sfp-release-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeReleaseConfirmation(); }}>
          <section ref={releaseDialogRef} className="sfp-release-dialog" role="dialog" aria-modal="true" aria-label="发布确认" tabIndex={-1}>
            <button type="button" className="sfp-release-dialog__close" aria-label="关闭发布确认" onClick={closeReleaseConfirmation}><X size={18} /></button>
            <small>发布决定与质量评估分开记录</small>
            <h2>确认是否继续发布</h2>
            <p>网站评估当前为“{recommendation}”，{releaseRelatedReports.length > 0 ? "并已冻结关联的企业 RAG 评估快照" : "未关联企业 RAG 评估快照"}。这些结果只提供质量建议，不会替你决定。</p>
            <dl>
              <div><dt>网站评估</dt><dd>{releaseReport.result.score ?? "—"}/100 · {releaseReport.result.version}</dd></div>
              <div><dt>关联 RAG</dt><dd>{releaseRelatedReports.length > 0 ? `${releaseRelatedReports[0].result.score ?? "—"}/100 · ${releaseRelatedReports[0].result.version} · ${releaseRelatedReports[0].reportId}` : "未关联"}</dd></div>
              <div><dt>风险提示</dt><dd>{releaseRisks.length} 项</dd></div>
            </dl>
            {releaseRisks.length > 0 && <ul>{releaseRisks.map((risk) => <li key={risk.id}><strong>{risk.title}</strong><span>{risk.summary}</span></li>)}</ul>}
            <div className="sfp-release-note"><CircleAlert size={18} /><span>{siteOps ? "继续会向真实 SiteOps 提交海外站点发布；服务端仍会检查构建版本、部署目标和域名条件。" : "继续只会记录你的发布决定；当前原型不会执行真实部署。真实发布仍需通过构建、部署目标和域名配置等技术检查。"}</span></div>
            <div className="sfp-release-dialog__actions">
              <button type="button" className="sfp-button sfp-button--ghost" onClick={closeReleaseConfirmation}>返回评估</button>
              <button type="button" className="sfp-button sfp-button--primary" disabled={liveAction === "publish_global" || Boolean(siteOps && !livePublishEligible)} onClick={confirmReleaseDecision}>{liveAction === "publish_global" ? "正在提交真实发布…" : releaseHasRisks ? "我已了解风险，继续发布" : "确认继续发布"}</button>
            </div>
          </section>
        </div>
      )}
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

function TemplatePreviewFrame({
  device,
  previewUrl,
  referenceFallback = false,
  templateName,
}: {
  device: PreviewDevice;
  previewUrl: string;
  referenceFallback?: boolean;
  templateName: string;
}) {
  return (
    <div className={`sfp-site-stage sfp-template-preview-stage${device === "mobile" ? " sfp-site-stage--mobile" : ""}`}>
      <div className="sfp-browser-bar">
        <span><i /><i /><i /></span>
        <p>{templateName} · {referenceFallback ? "基于冻结预览图重建" : "真实可执行模板"}</p>
      </div>
      <iframe
        className="sfp-template-preview-frame"
        src={previewUrl}
        title={`${templateName} ${referenceFallback ? "安全视觉参考预览" : "真实模板预览"}`}
        loading="lazy"
      />
    </div>
  );
}

export default SimplifiedWebsiteBuilderPreview;
