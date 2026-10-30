import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type SetStateAction } from "react";
import {
  Bot,
  Check,
  CircleAlert,
  ExternalLink,
  FileText,
  Globe2,
  LayoutTemplate,
  Loader2,
  Monitor,
  PanelTop,
  RefreshCw,
  Smartphone,
  X,
} from "lucide-react";
import type { SiteOpsConversationPanelProps } from "../siteops/SiteOpsConversationPanel";
import {
  siteDesignPreferencesDraftSchema,
  siteDesignRecommendationMatchesRequest,
  siteDesignRouteIdSchema,
  siteDesignTemplateCoordinateSchema,
  type SiteDesignKnowledgeSnapshotCoordinate,
  type SiteDesignPreferencesDraft,
  type SiteDesignPreviewBlock,
  type SiteDesignRecommendationInput,
  type SiteDesignTemplateCoordinate,
} from "../../../contracts/site-design-preferences";
import {
  previewKnowledgeCollectionCount,
  previewKnowledgeFragmentCount,
} from "./preview-copy";
import {
  PreviewAssistantWidget,
  type AssistantExchangeBinding,
} from "./preview-assistant-widget";
import { SiteDesignDraftPreview } from "./site-design-draft-preview";
import { SiteOpsBuildEmbedPreview } from "./siteops-build-embed-preview";
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

export type BuildStep = "template" | "design" | "evaluation";
export type LegacyBuildStep = "structure" | "assistant";
type PreviewDevice = "desktop" | "mobile";
type SiteLanguage = "zh-CN" | "en-US";

export function normalizeWebsiteBuildStep(value: unknown): BuildStep | null {
  if (value === "template" || value === "design" || value === "evaluation") return value;
  if (value === "structure" || value === "assistant") return "design";
  return null;
}

/** Design-step focus area. Legacy step=structure maps to the site section and
 * step=assistant to the assistant section; evaluation repair entries target
 * the exact area they audit. */
export type WebsiteDesignSection = "site" | "pages" | "theme" | "assistant";

export function normalizeWebsiteDesignSection(value: unknown): WebsiteDesignSection | null {
  if (value === "site" || value === "pages" || value === "theme" || value === "assistant") {
    return value;
  }
  return null;
}

export type SimplifiedWebsiteBuilderPreviewProps = {
  initialStep?: BuildStep | LegacyBuildStep;
  /** Focuses (scrolls + highlights) one design config area on the design step. */
  initialSection?: WebsiteDesignSection | null;
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
  { id: "design", number: "2", label: "网站设计" },
  { id: "evaluation", number: "3", label: "建设评估" },
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
  return `draft-v2-${(hash >>> 0).toString(16)}`;
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

type WebsiteDraftV1 = {
  version: 1;
  updatedAt: number;
  confirmed: boolean;
  completedStepIds: Array<BuildStep | LegacyBuildStep>;
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
    followSiteAccent: boolean;
    showSources: boolean;
    tested: boolean;
  };
};

export type RecommendationField = "siteName" | "siteGoal" | "featuredRoutes";

const RECOMMENDATION_FIELDS: readonly RecommendationField[] = [
  "siteName",
  "siteGoal",
  "featuredRoutes",
];

export type WebsiteDesignDraft = {
  siteName: string;
  siteGoal: string;
  featuredPageIds: string[];
  siteAccent: string;
  assistant: {
    name: string;
    welcome: string;
    accent: string;
    followSiteAccent: boolean;
    tested: boolean;
  };
  /**
   * Design fields the user has edited away from a recommendation. Persisted so
   * a re-entered page keeps saved user values instead of letting a fresh
   * recommendation overwrite them.
   */
  recommendationEditedFields?: RecommendationField[];
};

export type WebsiteDraftV2 = {
  version: 2;
  updatedAt: number;
  confirmed: boolean;
  completedStepIds: BuildStep[];
  selectedTemplateId: string;
  templateSourceUrl: string;
  design: WebsiteDesignDraft;
};

const defaultDraft = (): WebsiteDraftV2 => ({
  version: 2,
  updatedAt: 0,
  confirmed: false,
  completedStepIds: [],
  selectedTemplateId: "help-center",
  templateSourceUrl: "",
  design: {
    siteName: "FrontMind 帮助中心",
    siteGoal: "帮助访客快速找到可信的企业资料、产品与服务答案",
    // Columns default to fully selected; the draft records explicit opt-outs.
    featuredPageIds: initialPages.map((page) => page.id),
    siteAccent: "#6f35a5",
    assistant: {
      name: "FrontMind 企业助手",
      welcome: "您好，我可以根据企业资料回答产品、服务与使用问题。",
      accent: "#6f35a5",
      followSiteAccent: true,
      tested: false,
    },
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

function persistedTemplateId(value: unknown) {
  const parsed = siteDesignTemplateCoordinateSchema.shape.id.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function persistedRouteIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const candidate of value) {
    const parsed = siteDesignRouteIdSchema.safeParse(candidate);
    if (!parsed.success || result.includes(parsed.data)) continue;
    result.push(parsed.data);
    if (result.length === 3) break;
  }
  return result;
}

function persistedRecommendationEditedFields(value: unknown) {
  if (!Array.isArray(value)) return [];
  const result: RecommendationField[] = [];
  for (const candidate of value) {
    if (
      RECOMMENDATION_FIELDS.includes(candidate as RecommendationField)
      && !result.includes(candidate as RecommendationField)
    ) {
      result.push(candidate as RecommendationField);
    }
  }
  return result;
}

export function loadWebsiteDraft(storageScope?: string): WebsiteDraftV2 {
  const fallback = defaultDraft();
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(
      scopedStorageKey(WEBSITE_DRAFT_STORAGE_KEY, storageScope),
    );
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || (parsed.version !== 1 && parsed.version !== 2)) return fallback;

    const legacy = parsed.version === 1;
    const legacyBrand = legacy && isRecord(parsed.brand) ? parsed.brand : {};
    const design = !legacy && isRecord(parsed.design) ? parsed.design : {};
    const assistantValue = legacy ? parsed.assistant : design.assistant;
    const assistant = isRecord(assistantValue) ? assistantValue : {};
    const pageIds = new Set(initialPages.map((page) => page.id));
    // Accept any contract-valid hex: a saved server accent outside the demo
    // palette must survive a local draft round-trip unchanged instead of being
    // silently clamped back to the default swatch.
    const validAccent = (value: unknown, defaultValue: string) =>
      typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value)
        ? value
        : defaultValue;
    const templateSourceUrl =
      typeof parsed.templateSourceUrl === "string" && isHttpUrl(parsed.templateSourceUrl)
        ? parsed.templateSourceUrl
        : "";
    // Candidate and route IDs are opaque server-owned identifiers. Validate
    // them with the same storage-safe bounds as the SiteDesign contract
    // instead of restricting a live draft to the built-in demo catalog.
    const parsedTemplateId = persistedTemplateId(parsed.selectedTemplateId);
    const hasValidTemplateSelection = parsedTemplateId !== null;
    const selectedTemplateId = parsedTemplateId ?? fallback.selectedTemplateId;
    const legacyDisabledPageIds = legacy && Array.isArray(parsed.disabledPageIds)
      ? new Set(parsed.disabledPageIds.filter((id): id is string => typeof id === "string" && pageIds.has(id)))
      : new Set<string>();
    const rawFeaturedPageIds = legacy
      ? initialPages.filter((page) => !legacyDisabledPageIds.has(page.id)).map((page) => page.id)
      : Array.isArray(design.featuredPageIds) ? design.featuredPageIds : fallback.design.featuredPageIds;
    const featuredPageIds = legacy
      ? Array.from(new Set(rawFeaturedPageIds.filter(
          (id): id is string => typeof id === "string" && pageIds.has(id),
        )))
      : persistedRouteIds(rawFeaturedPageIds);
    const source = legacy ? legacyBrand : design;
    const siteName = typeof source.siteName === "string" ? source.siteName.slice(0, 80) : fallback.design.siteName;
    const siteGoal = typeof source.siteGoal === "string" ? source.siteGoal.slice(0, 200) : fallback.design.siteGoal;
    const siteAccent = validAccent(source.siteAccent, fallback.design.siteAccent);
    const assistantName = typeof assistant.name === "string" ? assistant.name.slice(0, 80) : fallback.design.assistant.name;
    const assistantWelcome = typeof assistant.welcome === "string" ? assistant.welcome.slice(0, 500) : fallback.design.assistant.welcome;
    const assistantAccent = validAccent(assistant.accent, fallback.design.assistant.accent);
    const assistantFollowsSite = typeof assistant.followSiteAccent === "boolean"
      ? assistant.followSiteAccent
      : assistantAccent === siteAccent;
    // Legacy trial state was not bound to a knowledge/template coordinate, so
    // preserve its design fields but require one fresh exchange after migration.
    const assistantTested = !legacy && assistant.tested === true && Boolean(assistantName.trim()) && Boolean(assistantWelcome.trim());
    const rawCompletedStepIds = Array.isArray(parsed.completedStepIds)
      ? parsed.completedStepIds.filter((step): step is string => typeof step === "string")
      : [];
    let completedStepIds: BuildStep[] = [];
    if (rawCompletedStepIds.includes("template")) completedStepIds.push("template");
    if (
      rawCompletedStepIds.includes("design")
      || (legacy && rawCompletedStepIds.includes("structure") && rawCompletedStepIds.includes("assistant"))
    ) completedStepIds.push("design");
    const hasEnabledPage = featuredPageIds.length > 0;
    if (!hasValidTemplateSelection) completedStepIds = completedStepIds.filter((step) => step !== "template");
    if (!hasEnabledPage || !siteName.trim() || !siteGoal.trim() || !assistantName.trim() || !assistantWelcome.trim() || !assistantTested) {
      completedStepIds = completedStepIds.filter((step) => step !== "design");
    }
    const confirmed = parsed.confirmed === true
      && ["template", "design"].every((step) => completedStepIds.includes(step as BuildStep));
    // Legacy V1 name and goal were confirmed by the user in the retired
    // structure step, so migrated drafts count them as user-edited: a new
    // recommendation must not silently replace them. Legacy page picks use the
    // built-in route ids that never match live opaque routes, so routes stay
    // recommendable.
    const recommendationEditedFields = legacy
      ? ["siteName", "siteGoal"] as RecommendationField[]
      : persistedRecommendationEditedFields(design.recommendationEditedFields);

    return {
      version: 2,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      confirmed,
      completedStepIds,
      selectedTemplateId,
      templateSourceUrl,
      design: {
        siteName,
        siteGoal,
        featuredPageIds,
        siteAccent,
        assistant: {
          name: assistantName,
          welcome: assistantWelcome,
          accent: assistantAccent,
          followSiteAccent: assistantFollowsSite,
          tested: assistantTested,
        },
        recommendationEditedFields,
      },
    };
  } catch {
    return fallback;
  }
}

export function saveWebsiteDraft(draft: WebsiteDraftV2, storageScope?: string) {
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

export const EMPTY_SITE_DESIGN_DRAFT_HASH = "0".repeat(64);

const EMPTY_DRAFT_PREVIEW_BLOCKS = new Map<string, SiteDesignPreviewBlock>();

/**
 * The revision message only starts a new revision. Website/assistant settings
 * are persisted through SiteDesignPreferences and must never be encoded into
 * conversionGoal or another legacy free-text field.
 */
export function buildLiveSiteOpsRevisionMessage() {
  return "请按已保存的网站设计配置生成新版本。";
}

export function canApplySiteDesignRecommendation(input: {
  request: SiteDesignRecommendationInput;
  response: unknown;
  designRevision: number;
  draftHash: string;
  editSequenceAtRequest: number;
  currentEditSequence: number;
  /**
   * A user-initiated refresh applies per recommendation field only: fields the
   * user edited keep their values while unedited fields adopt the refreshed
   * suggestion. The automatic entry request stays strict and is dropped as a
   * whole as soon as any design edit happened after it was issued.
   */
  allowEditsSinceRequest?: boolean;
}) {
  return (input.allowEditsSinceRequest
    || input.editSequenceAtRequest === input.currentEditSequence)
    && siteDesignRecommendationMatchesRequest(
      input.request,
      input.response,
      {
        designRevision: input.designRevision,
        draftHash: input.draftHash,
      },
    );
}

function siteDesignRecommendationCoordinateKey(input: {
  knowledgeSnapshot: SiteDesignKnowledgeSnapshotCoordinate;
  template: SiteDesignTemplateCoordinate;
}) {
  return JSON.stringify({
    knowledgeSnapshot: input.knowledgeSnapshot,
    template: input.template,
  });
}

type AppliedSiteDesignRecommendation = {
  coordinateKey: string;
  siteName: string | null;
  siteGoal: string | null;
  featuredRouteIds: string[];
  pageProjection: WebsitePageDraft[];
};

type PreviewPage = { name: string; detail: string };
type WebsitePageDraft = {
  id: string;
  name: string;
  detail: string;
  enabled: boolean;
  importanceRank?: number;
  recommendationReason?: string;
};
type EditableWebsiteDesignDraft = {
  pages: WebsitePageDraft[];
  siteName: string;
  siteGoal: string;
  siteAccent: string;
  assistantName: string;
  welcome: string;
  assistantAccent: string;
  assistantFollowsSite: boolean;
  assistantTested: boolean;
};

function resolveStateAction<T>(current: T, next: SetStateAction<T>) {
  return typeof next === "function"
    ? (next as (value: T) => T)(current)
    : next;
}

function MiniSitePreview({
  assistantAccent,
  assistantName,
  brandMark,
  device,
  exchangeBinding,
  onExchange,
  pages,
  showAssistant,
  showSources,
  siteAccent,
  siteDomain,
  siteLanguage,
  siteName,
  templateId,
  welcome,
}: {
  assistantAccent: string;
  assistantName: string;
  brandMark: string;
  device: PreviewDevice;
  exchangeBinding: AssistantExchangeBinding;
  onExchange?: (
    question: string,
    answered: boolean,
    binding: AssistantExchangeBinding,
  ) => void;
  pages: PreviewPage[];
  showAssistant: boolean;
  showSources: boolean;
  siteAccent: string;
  siteDomain: string;
  siteLanguage: SiteLanguage;
  siteName: string;
  templateId: string;
  welcome: string;
}) {
  const siteCopy = siteLanguage === "en-US"
    ? {
        eyebrow: "ENTERPRISE KNOWLEDGE CENTER",
        title: "How can we help?",
        search: "Search documentation or ask the AI assistant",
        language: "EN",
        toc: "Contents",
        contact: "Contact us",
        services: "Our services",
        contactNote: "Talk to our team for service advice",
      }
    : {
        eyebrow: "企业知识帮助中心",
        title: "您好，需要了解什么？",
        search: "搜索文档，或直接询问 AI 助手",
        language: "中文",
        toc: "目录",
        contact: "联系我们",
        services: "查看服务",
        contactNote: "联系我们获取服务建议",
      };

  const renderMain = () => {
    if (templateId === "docs") {
      return (
        <>
          <div className="sfp-site-docs-topbar">
            <span className="sfp-site-eyebrow">{siteCopy.eyebrow}</span>
            <div className="sfp-site-search">{siteCopy.search}</div>
          </div>
          <div className="sfp-site-docs-layout">
            <aside aria-label="文档目录">
              <strong>{siteCopy.toc}</strong>
              {pages.map((page, index) => (
                <span key={page.name} className={index === 0 ? "is-active" : ""}>{page.name}<small>{page.detail}</small></span>
              ))}
            </aside>
            <div className="sfp-site-docs-article">
              <h3>{pages[0]?.name ?? siteCopy.title}</h3>
              <p className="sfp-site-docs-lead">{siteCopy.title}</p>
              <i /><i /><i className="is-short" /><i />
              <em className="sfp-site-docs-callout">{siteCopy.search}</em>
            </div>
          </div>
        </>
      );
    }
    if (templateId === "portal") {
      return (
        <>
          <div className="sfp-site-hero">
            <span className="sfp-site-eyebrow">{siteCopy.eyebrow}</span>
            <h3>{siteCopy.title}</h3>
            <div className="sfp-site-hero-actions">
              <span>{siteCopy.services}</span>
              <span>{siteCopy.contact}</span>
            </div>
          </div>
          <div className="sfp-site-service-grid">
            {pages.slice(0, device === "mobile" ? 2 : 3).map((page, index) => (
              <article key={page.name}>
                <span>0{index + 1}</span>
                <div><strong>{page.name}</strong><small>{page.detail}</small></div>
              </article>
            ))}
          </div>
          <div className="sfp-site-contact-strip">
            <span>{siteCopy.contactNote}</span>
            <em>{siteCopy.language}</em>
          </div>
        </>
      );
    }
    return (
      <>
        <span className="sfp-site-eyebrow">{siteCopy.eyebrow}</span>
        <h3>{siteCopy.title}</h3>
        <div className="sfp-site-search">{siteCopy.search}</div>
        <div className="sfp-site-category-grid">
          {pages.slice(0, 4).map((page, index) => (
            <article key={page.name}>
              <span>0{index + 1}</span>
              <div><strong>{page.name}</strong><small>{page.detail}</small></div>
            </article>
          ))}
        </div>
      </>
    );
  };

  return (
    <div className={`sfp-site-stage sfp-site-stage--${device}`}>
      <div className="sfp-browser-bar">
        <span><i /><i /><i /></span>
        <p>{siteDomain}</p>
      </div>
      <div
        className="sfp-site-canvas"
        data-template={templateId}
        style={{ "--sfp-site-accent": siteAccent, "--sfp-widget-accent": assistantAccent } as CSSProperties}
      >
        <header className="sfp-site-header">
          <strong><i>{brandMark || "AI"}</i>{siteName || "企业帮助中心"}</strong>
          <nav>
            {pages.slice(0, device === "mobile" ? 2 : 4).map((page) => <span key={page.name}>{page.name}</span>)}
            <em>{siteCopy.language}</em>
          </nav>
        </header>
        <main>
          {renderMain()}
        </main>

        <PreviewAssistantWidget
          assistantName={assistantName}
          exchangeBinding={exchangeBinding}
          initiallyOpen={showAssistant}
          onExchange={onExchange}
          showSources={showSources}
          welcome={welcome}
        />
      </div>
    </div>
  );
}

export function SimplifiedWebsiteBuilderPreview({
  initialStep = "template",
  initialSection,
  onOpenRag,
  onOpenSiteOpsRelease,
  onStepChange,
  siteOps,
  storageScope,
}: SimplifiedWebsiteBuilderPreviewProps) {
  const normalizedInitialStep = normalizeWebsiteBuildStep(initialStep) ?? "template";
  const auditStorage = useMemo(() => scopedEvaluationStorage(storageScope), [storageScope]);
  const [draftSeed] = useState<WebsiteDraftV2>(() => loadWebsiteDraft(storageScope));
  const [activeStep, setActiveStep] = useState<BuildStep>(normalizedInitialStep);
  const [focusedSection, setFocusedSection] = useState<WebsiteDesignSection | null>(
    () => normalizeWebsiteDesignSection(initialSection),
  );
  const [isConfirmed, setIsConfirmed] = useState(draftSeed.confirmed);
  const [completedStepIds, setCompletedStepIds] = useState<BuildStep[]>(draftSeed.completedStepIds);
  const [selectedTemplateId, setSelectedTemplateId] = useState(draftSeed.selectedTemplateId);
  const [designDraft, setDesignDraft] = useState<EditableWebsiteDesignDraft>(() => {
    const featuredPageIds = new Set(draftSeed.design.featuredPageIds);
    const hasStaticFeaturedPage = initialPages.some((page) => featuredPageIds.has(page.id));
    const staticFallbackPageIds = new Set(defaultDraft().design.featuredPageIds);
    return {
      // Opaque live route IDs are retained in draftSeed for real brief
      // hydration. Before the real brief arrives, live mode renders no demo
      // routes. Static mode safely falls back only when a non-empty draft
      // contains no built-in route; an explicit empty selection stays empty.
      pages: siteOps
        ? []
        : initialPages.map((page) => ({
            ...page,
            enabled: draftSeed.design.featuredPageIds.length === 0
              ? false
              : hasStaticFeaturedPage
                ? featuredPageIds.has(page.id)
                : staticFallbackPageIds.has(page.id),
          })),
      siteName: draftSeed.design.siteName,
      siteGoal: draftSeed.design.siteGoal,
      siteAccent: draftSeed.design.siteAccent,
      assistantName: draftSeed.design.assistant.name,
      welcome: draftSeed.design.assistant.welcome,
      assistantAccent: draftSeed.design.assistant.accent,
      assistantFollowsSite: draftSeed.design.assistant.followSiteAccent,
      assistantTested: draftSeed.design.assistant.tested,
    };
  });
  const {
    pages,
    siteName,
    siteGoal,
    siteAccent,
    assistantName,
    welcome,
    assistantAccent,
    assistantFollowsSite,
    assistantTested,
  } = designDraft;
  const setPages = useCallback((next: SetStateAction<WebsitePageDraft[]>) => {
    setDesignDraft((current) => ({ ...current, pages: resolveStateAction(current.pages, next) }));
  }, []);
  const setSiteName = useCallback((next: SetStateAction<string>) => {
    setDesignDraft((current) => ({ ...current, siteName: resolveStateAction(current.siteName, next) }));
  }, []);
  const setSiteGoal = useCallback((next: SetStateAction<string>) => {
    setDesignDraft((current) => ({ ...current, siteGoal: resolveStateAction(current.siteGoal, next) }));
  }, []);
  const setSiteAccent = useCallback((next: SetStateAction<string>) => {
    setDesignDraft((current) => ({ ...current, siteAccent: resolveStateAction(current.siteAccent, next) }));
  }, []);
  const setAssistantName = useCallback((next: SetStateAction<string>) => {
    setDesignDraft((current) => ({ ...current, assistantName: resolveStateAction(current.assistantName, next) }));
  }, []);
  const setWelcome = useCallback((next: SetStateAction<string>) => {
    setDesignDraft((current) => ({ ...current, welcome: resolveStateAction(current.welcome, next) }));
  }, []);
  const setAssistantAccent = useCallback((next: SetStateAction<string>) => {
    setDesignDraft((current) => ({ ...current, assistantAccent: resolveStateAction(current.assistantAccent, next) }));
  }, []);
  const setAssistantFollowsSite = useCallback((next: SetStateAction<boolean>) => {
    setDesignDraft((current) => ({ ...current, assistantFollowsSite: resolveStateAction(current.assistantFollowsSite, next) }));
  }, []);
  const setAssistantTested = useCallback((next: SetStateAction<boolean>) => {
    setDesignDraft((current) => ({ ...current, assistantTested: resolveStateAction(current.assistantTested, next) }));
  }, []);
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
  const designEditSequenceRef = useRef(0);
  const liveBriefHydrationRef = useRef<{
    projectId: string;
    editSequence: number;
  } | null>(null);
  // Edit sequence at the last successful structured save; a build embed is
  // only shown while the design draft has no unsaved edits on top of it.
  const savedDesignSequenceRef = useRef<number | null>(null);
  const currentAssistantTrialBindingRef = useRef<AssistantExchangeBinding>({
    designEditSequence: 0,
    assistantName,
    welcome,
  });
  const assistantTrialBinding: AssistantExchangeBinding = {
    designEditSequence: designEditSequenceRef.current,
    assistantName,
    welcome,
  };
  currentAssistantTrialBindingRef.current = assistantTrialBinding;
  // Seeded from the persisted draft so returning users keep their saved edits
  // instead of letting a fresh recommendation overwrite them.
  const manuallyEditedRecommendationFieldsRef = useRef<Set<RecommendationField>>(
    new Set(draftSeed.design.recommendationEditedFields ?? []),
  );
  const recommendationRequestRef = useRef<{
    requestId: string;
    editSequence: number;
    userInitiated: boolean;
    /** False when saved server preferences own the form; the response then
     * feeds only the real-data draft preview. */
    applyToForm: boolean;
  } | null>(null);
  const handledRecommendationRequestIdsRef = useRef(new Set<string>());
  const lastRecommendationCoordinateRef = useRef<string | null>(null);
  const [appliedRecommendation, setAppliedRecommendation] =
    useState<AppliedSiteDesignRecommendation | null>(null);
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
  const priorLiveBriefHydration = liveBriefHydrationRef.current;
  const canHydrateCurrentServerDesign = !priorLiveBriefHydration
    || priorLiveBriefHydration.projectId !== liveObservation?.project.id
    || priorLiveBriefHydration.editSequence === designEditSequenceRef.current;
  const serverDesignTemplate = canHydrateCurrentServerDesign
    ? liveObservation?.brief?.designPreferences?.template ?? null
    : null;
  const serverPreferredCandidateId = serverDesignTemplate
    ? liveCandidates.find((candidate) =>
        candidate.templateCoordinate?.id === serverDesignTemplate.id
        && candidate.templateCoordinate.version === serverDesignTemplate.version,
      )?.id ?? null
    : null;
  const staticSelectedTemplateId = templates.some(
    (template) => template.id === selectedTemplateId,
  )
    ? selectedTemplateId
    : defaultDraft().selectedTemplateId;
  const effectiveSelectedTemplateId = isLiveBuilder
    ? serverPreferredCandidateId
      ?? serverSelectedCandidateId
      ?? (templateSelectionOpen ? selectedTemplateId : "")
    : staticSelectedTemplateId;
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
  const latestBuild = liveObservation?.builds[0] ?? null;
  // Only the editable project brief participates in OCC and recommendation
  // suppression. A build-level copy is a frozen historical snapshot and must
  // never advance the current project's design revision/hash.
  const currentProjectDesignPreferences =
    liveObservation?.brief?.designPreferences ?? null;
  const frozenBuildDesignPreferences = latestBuild?.designPreferences ?? null;
  const currentDesignRevision =
    currentProjectDesignPreferences?.designRevision ?? 0;
  const currentDesignDraftHash =
    currentProjectDesignPreferences?.draftHash ?? EMPTY_SITE_DESIGN_DRAFT_HASH;
  const activeKnowledgeSnapshotCoordinate =
    liveObservation?.knowledgeSnapshots.find(
      (snapshot) =>
        snapshot.id === liveObservation.project.currentKnowledgeSnapshotId &&
        snapshot.active,
    )?.coordinate ?? null;
  const selectedLiveCandidate = liveCandidates.find(
    (candidate) => candidate.id === effectiveSelectedTemplateId,
  ) ?? null;
  const selectedTemplateCoordinate =
    selectedLiveCandidate?.templateCoordinate
    ?? currentProjectDesignPreferences?.template
    ?? frozenBuildDesignPreferences?.template
    ?? null;
  const designRecommendation = siteOps?.designRecommendation ?? null;
  const currentRecommendationCoordinate =
    activeKnowledgeSnapshotCoordinate && selectedLiveCandidate?.templateCoordinate
      ? {
          knowledgeSnapshot: activeKnowledgeSnapshotCoordinate,
          template: selectedLiveCandidate.templateCoordinate,
        }
      : null;
  // A published knowledge snapshot or template change after a recommendation
  // was applied makes that suggestion stale: keep the current values and let
  // the user decide whether to fetch fresh ones.
  const recommendationStale = Boolean(
    appliedRecommendation
      && currentRecommendationCoordinate
      && siteDesignRecommendationCoordinateKey(currentRecommendationCoordinate)
        !== appliedRecommendation.coordinateKey,
  );
  const liveWebsiteJudgments = useMemo(
    () => liveObservation
      ? buildWebsiteEvaluationJudgmentsFromSiteOps(liveObservation)
      : null,
    [liveObservation],
  );
  const liveEvaluationObservedAt = liveObservation
    ? siteOpsWebsiteEvaluationObservedAt(liveObservation)
    : null;
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
  const authoritativeGlobalHeadId =
    liveObservation?.project.globalLiveDeploymentId
    ?? null;
  const latestGlobalDeployment = authoritativeGlobalHeadId
    ? liveObservation?.deployments.find(
        (deployment) =>
          deployment.id === authoritativeGlobalHeadId
          && deployment.target === "global_excluding_cn"
          && deployment.status === "active",
      ) ?? null
    : null;
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
  const recommendationFieldEdited = {
    siteName: manuallyEditedRecommendationFieldsRef.current.has("siteName"),
    siteGoal: manuallyEditedRecommendationFieldsRef.current.has("siteGoal"),
    featuredRoutes: manuallyEditedRecommendationFieldsRef.current.has("featuredRoutes"),
  } as const;
  const canRestoreRecommendedField = (field: RecommendationField) => {
    if (!appliedRecommendation) return false;
    if (field === "siteName") return appliedRecommendation.siteName !== null;
    if (field === "siteGoal") return appliedRecommendation.siteGoal !== null;
    return appliedRecommendation.featuredRouteIds.length > 0
      && appliedRecommendation.pageProjection.length > 0;
  };
  const completedStepSet = useMemo(() => new Set(completedStepIds), [completedStepIds]);
  const stepIndex = steps.findIndex((step) => step.id === activeStep);
  const effectiveAssistantAccent = assistantFollowsSite ? siteAccent : assistantAccent;
  const siteLanguage: SiteLanguage = liveObservation?.brief?.primaryLanguage.toLowerCase().startsWith("zh") === false
    ? "en-US"
    : "zh-CN";
  const brandMark = useMemo(() => {
    const mark = siteName
      .trim()
      .split(/\s+/u)
      .map((part) => part[0])
      .join("")
      .slice(0, 3)
      .toUpperCase();
    return mark || "AI";
  }, [siteName]);
  const showSources = true;
  const previewPages = useMemo(
    () => enabledPages.map((page) => ({ name: page.name, detail: page.detail })),
    [enabledPages],
  );
  // Real-data draft preview source: blocks projected by the read-only
  // recommendation API from the current published knowledge snapshot. The
  // draft preview never falls back to fixture pages.
  const draftPreviewData = useMemo(() => {
    const request = designRecommendation?.request ?? null;
    const response = designRecommendation?.data ?? null;
    if (
      !request ||
      !response ||
      response.requestContext.requestId !== request.requestContext.requestId
    ) {
      return null;
    }
    const routeIds = new Set(
      liveObservation?.brief?.routes.map((route) => route.id) ?? [],
    );
    const blocksByRoute = new Map<string, SiteDesignPreviewBlock>();
    for (const block of response.previewBlocks) {
      if (routeIds.has(block.routeId)) blocksByRoute.set(block.routeId, block);
    }
    return { blocksByRoute, knowledgeVersion: response.knowledgeSnapshot.version };
  }, [designRecommendation?.data, designRecommendation?.request, liveObservation?.brief?.routes]);
  const draftPreviewPages = useMemo(
    () => enabledPages.map((page) => ({ id: page.id, name: page.name })),
    [enabledPages],
  );
  // Two-stage preview: once a real build with a dist exists it stays embedded
  // even while the design draft has unsaved edits or a newer build is still
  // generating — the owner always sees a real site, clearly labeled as not yet
  // reflecting pending changes. The assistant trial, however, is only credited
  // against the frozen coordinates of the newest build with the draft synced,
  // so an edit-and-retry loop can never bank a trial from a stale site.
  const displayedBuild = liveObservation?.builds.find(
    (build) => build.previewUrl,
  ) ?? null;
  const designDraftSynced = latestBuild?.previewUrl
    ? !liveBriefHydrationRef.current
      || designEditSequenceRef.current === liveBriefHydrationRef.current.editSequence
      || designEditSequenceRef.current === savedDesignSequenceRef.current
    : false;
  const embeddableBuild = displayedBuild
    ? {
        id: displayedBuild.id,
        ordinal: displayedBuild.ordinal,
        status: displayedBuild.status,
        previewUrl: displayedBuild.previewUrl,
        knowledgeSnapshotVersion: displayedBuild.knowledgeSnapshot?.version ?? null,
      }
    : null;
  const embedShowsLatestBuild = Boolean(
    displayedBuild && displayedBuild.id === latestBuild?.id,
  );
  const embedRoutes = useMemo(
    () => (displayedBuild?.brief?.routes ?? liveObservation?.brief?.routes ?? [])
      .map((route) => ({ id: route.id, slug: route.slug, title: route.title })),
    [displayedBuild?.brief?.routes, liveObservation?.brief?.routes],
  );
  // Frozen coordinates a legitimate trial report must match. The trial is only
  // banked while the embedded site IS the newest build and the draft is synced;
  // pending edits or an in-flight rebuild keep the preview visible but lock
  // the trial gate.
  const embedTrialBinding = embeddableBuild
    && embedShowsLatestBuild
    && designDraftSynced
    && latestBuild?.designPreferences
    && Boolean(assistantName.trim() && welcome.trim())
    ? {
        buildId: latestBuild.id,
        knowledgeArchiveHash: latestBuild.knowledgeSnapshot?.archiveHash ?? null,
        designRevision: latestBuild.designPreferences.designRevision,
        draftHash: latestBuild.designPreferences.draftHash,
        assistantName,
        welcome,
      }
    : null;
  const handleRealTrialComplete = useCallback(() => {
    setAssistantTested(true);
    setNotice("已在真实构建预览中完成一次助手问答，真实试聊已记录。");
  }, []);
  const handleAssistantExchange = (
    _question: string,
    answered: boolean,
    submittedBinding: AssistantExchangeBinding,
  ) => {
    const currentBinding = currentAssistantTrialBindingRef.current;
    if (
      !answered
      || submittedBinding.designEditSequence !== currentBinding.designEditSequence
      || submittedBinding.assistantName !== currentBinding.assistantName
      || submittedBinding.welcome !== currentBinding.welcome
    ) {
      return;
    }
    setAssistantTested(true);
  };
  const previewDomain = latestGlobalDeployment?.publicUrl
    ? (() => {
        try {
          return new URL(latestGlobalDeployment.publicUrl).hostname;
        } catch {
          return "preview.frontmind.example";
        }
      })()
    : liveObservation?.domainState?.displayDomain || "preview.frontmind.example";
  const templateReady = isLiveBuilder
    ? Boolean(
        effectiveSelectedTemplateId
        && liveCandidates.some(
          (candidate) => candidate.id === effectiveSelectedTemplateId && candidate.executionAdmitted !== false,
        ),
      )
    : Boolean(selectedTemplateId);
  const structureReady = enabledPages.length > 0;
  const brandReady = Boolean(siteName.trim() && siteGoal.trim());
  const assistantReady = Boolean(assistantName.trim() && welcome.trim());
  // 两种模式都要求在助手预览中完成一次真实问答试用，步骤才算配置完成；
  // SiteOps 真实提交仍按原有时序在试用通过后执行。
  const assistantVerified = assistantReady && assistantTested;
  const templateComplete = templateReady && completedStepSet.has("template");
  const designComplete = structureReady && brandReady && assistantVerified && completedStepSet.has("design");
  const canComplete = templateComplete && designComplete;
  // Four NON-scoring configuration checks. They gate the draft confirmation
  // only; they never feed the 40/40/20 weighted website score.
  const configurationChecks: Array<{
    id: "C01" | "C02" | "C03" | "C04";
    title: string;
    passed: boolean;
    detail: string;
    onAction: () => void;
    actionLabel: string;
  }> = [
    {
      id: "C01",
      title: "模板选择",
      passed: templateComplete,
      detail: templateComplete ? "已选择模板版式。" : "尚未选择模板版式。",
      onAction: () => goTo("template"),
      actionLabel: "查看模板",
    },
    {
      id: "C02",
      title: "页面结构",
      passed: structureReady && designComplete,
      detail: structureReady
        ? designComplete ? "主栏目与真实页面已确认。" : "设计步骤尚未整体确认。"
        : "尚未启用任何主栏目。",
      onAction: () => goTo("design", "pages"),
      actionLabel: "查看页面与栏目",
    },
    {
      id: "C03",
      title: "网站信息与主题",
      passed: brandReady && designComplete,
      detail: brandReady
        ? designComplete ? "网站名称、建站目标与主题已确认。" : "设计步骤尚未整体确认。"
        : "网站名称或建站目标待补全。",
      onAction: () => goTo("design", "site"),
      actionLabel: "查看网站基础",
    },
    {
      id: "C04",
      title: "助手配置与真实试聊",
      passed: assistantVerified && designComplete,
      detail: assistantVerified
        ? "助手配置有效且已完成一次真实问答。"
        : siteOps
          ? "需在真实构建预览中完成一次助手问答。"
          : "需在预览中完成一次助手问答。",
      onAction: () => goTo("design", "assistant"),
      actionLabel: "查看助手设置",
    },
  ];
  const configurationConfirmedCount = configurationChecks
    .filter((check) => check.passed)
    .length;
  const completedSteps: Record<BuildStep, boolean> = {
    template: templateComplete,
    design: designComplete,
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
          design: {
            featuredPageIds: enabledPages.map((page) => page.id),
            siteName,
            siteGoal,
            siteAccent,
            assistant: {
              name: assistantName,
              welcome,
              accentMode: assistantFollowsSite ? "follow_site" : "custom",
              customAccent: assistantAccent,
            },
          },
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
    const projectId = liveObservation.project.id;
    const briefKey = JSON.stringify({ projectId, brief });
    if (appliedLiveBriefKeyRef.current === briefKey) return;
    const previousHydration = liveBriefHydrationRef.current;
    const firstHydrationForProject = previousHydration?.projectId !== projectId;
    // A server echo for an older save must not replace edits made while that
    // request was pending. The first hydration remains authoritative when the
    // project already has persisted designPreferences.
    if (
      !firstHydrationForProject
      && previousHydration
      && designEditSequenceRef.current !== previousHydration.editSequence
    ) {
      return;
    }
    appliedLiveBriefKeyRef.current = briefKey;
    const designPreferences = brief.designPreferences ?? null;
    const featuredRouteIds = new Set(
      designPreferences?.featuredRouteIds ?? [],
    );
    setDesignDraft((current) => {
      const localFeaturedRouteIds = new Set(
        firstHydrationForProject
          ? draftSeed.design.featuredPageIds
          : current.pages.filter((page) => page.enabled).map((page) => page.id),
      );
      // Columns default to fully selected. On first hydration the local seed
      // only wins when it is a non-empty subset of this project's live route
      // IDs (a returning browser draft). A static demo seed can never be such
      // a subset, so a fresh session starts with every column enabled.
      const liveRouteIds = new Set(brief.routes.map((route) => route.id));
      const localSelectionTargetsLiveRoutes = !firstHydrationForProject
        || (localFeaturedRouteIds.size > 0
          && [...localFeaturedRouteIds].every((id) => liveRouteIds.has(id)));
      const nextAssistantName = designPreferences?.assistant.name ?? current.assistantName;
      const nextWelcome = designPreferences?.assistant.welcome ?? current.welcome;
      const assistantIdentityChanged =
        nextAssistantName !== current.assistantName || nextWelcome !== current.welcome;
      return {
        ...current,
        // Only source-backed routes are eligible for the navigation: the save
        // contract rejects featured routes without knowledge sources, so a
        // source-less placeholder route must never appear as a toggleable
        // column.
        pages: brief.routes
          .filter((route) => route.sourceDocumentIds.length > 0)
          .map((route) => ({
            id: route.id,
            name: route.title,
            detail: `${route.sourceDocumentIds.length} 个知识来源`,
            // Persisted server preferences win. Otherwise retain the route IDs
            // from the local unified draft until the user saves them.
            enabled: designPreferences
              ? featuredRouteIds.has(route.id)
              : localSelectionTargetsLiveRoutes
                ? localFeaturedRouteIds.has(route.id)
                : true,
          })),
        // A saved user edit outranks both the brief fallback and a later
        // recommendation; unedited fields still hydrate from the real brief.
        siteName: designPreferences?.siteName
          ?? (manuallyEditedRecommendationFieldsRef.current.has("siteName")
            ? current.siteName
            : brief.companyName),
        siteGoal: designPreferences?.siteGoal
          ?? (manuallyEditedRecommendationFieldsRef.current.has("siteGoal")
            ? current.siteGoal
            : brief.conversionGoal),
        siteAccent: designPreferences?.siteAccent ?? current.siteAccent,
        assistantName: nextAssistantName,
        welcome: nextWelcome,
        assistantFollowsSite: designPreferences
          ? designPreferences.assistant.accentMode === "follow_site"
          : current.assistantFollowsSite,
        // customAccent is intentionally retained while follow_site is active.
        assistantAccent: designPreferences?.assistant.customAccent
          ?? current.assistantAccent,
        assistantTested: assistantIdentityChanged ? false : current.assistantTested,
      };
    });
    liveBriefHydrationRef.current = {
      projectId,
      editSequence: designEditSequenceRef.current,
    };
  }, [draftSeed.design.featuredPageIds, liveObservation?.brief, liveObservation?.project.id, siteOps]);

  useEffect(() => {
    if (!siteOps) return;
    // Keep an explicit user selection of any selectable template; only fall
    // back to the first admitted candidate while nothing valid is selected.
    const hasSelectableSelection = liveCandidates.some(
      (candidate) =>
        candidate.id === selectedTemplateId &&
        candidate.executionAdmitted !== false,
    );
    const nextTemplateId = serverPreferredCandidateId
      ?? serverSelectedCandidateId
      ?? (templateSelectionOpen && !hasSelectableSelection
        ? liveCandidates.find((candidate) => candidate.executionAdmitted !== false)?.id
        : null);
    if (!nextTemplateId || selectedTemplateId === nextTemplateId) return;
    setSelectedTemplateId(nextTemplateId);
  }, [liveCandidates, selectedTemplateId, serverPreferredCandidateId, serverSelectedCandidateId, siteOps, templateSelectionOpen]);

  const requestFreshDesignRecommendation = (
    userInitiated: boolean,
    applyToForm: boolean,
  ) => {
    if (!siteOps?.onRequestDesignRecommendation || !currentRecommendationCoordinate) {
      return;
    }
    const request: SiteDesignRecommendationInput = {
      schemaVersion: 1,
      requestContext: {
        requestId: `site-design-${crypto.randomUUID()}`,
        baseDesignRevision: currentDesignRevision,
        baseDraftHash: currentDesignDraftHash,
      },
      knowledgeSnapshot: currentRecommendationCoordinate.knowledgeSnapshot,
      template: currentRecommendationCoordinate.template,
    };
    lastRecommendationCoordinateRef.current = JSON.stringify({
      knowledgeSnapshot: request.knowledgeSnapshot,
      template: request.template,
      baseDesignRevision: request.requestContext.baseDesignRevision,
      baseDraftHash: request.requestContext.baseDraftHash,
    });
    recommendationRequestRef.current = {
      requestId: request.requestContext.requestId,
      editSequence: designEditSequenceRef.current,
      userInitiated,
      applyToForm,
    };
    siteOps.onRequestDesignRecommendation(request);
  };

  useEffect(() => {
    if (
      !siteOps?.onRequestDesignRecommendation ||
      !templateSelectionOpen ||
      !currentRecommendationCoordinate
    ) {
      return;
    }
    const coordinateKey = JSON.stringify({
      knowledgeSnapshot: currentRecommendationCoordinate.knowledgeSnapshot,
      template: currentRecommendationCoordinate.template,
      baseDesignRevision: currentDesignRevision,
      baseDraftHash: currentDesignDraftHash,
    });
    if (lastRecommendationCoordinateRef.current === coordinateKey) return;
    // After a recommendation has been applied, a knowledge or template change
    // only marks it stale; the user decides whether to fetch fresh suggestions.
    if (appliedRecommendation !== null) return;

    // Saved server preferences own the form values; the request then serves
    // the real-data draft preview only.
    requestFreshDesignRecommendation(false, !currentProjectDesignPreferences);
    // requestFreshDesignRecommendation closes over the same inputs as this
    // effect's dependencies.
  }, [
    appliedRecommendation,
    currentDesignDraftHash,
    currentDesignRevision,
    currentProjectDesignPreferences,
    currentRecommendationCoordinate,
    siteOps,
    templateSelectionOpen,
  ]);

  useEffect(() => {
    const request = designRecommendation?.request;
    const response = designRecommendation?.data;
    if (
      !request ||
      !response ||
      response.requestContext.requestId !== request.requestContext.requestId ||
      handledRecommendationRequestIdsRef.current.has(
        request.requestContext.requestId,
      )
    ) {
      return;
    }
    const attempt = recommendationRequestRef.current;
    handledRecommendationRequestIdsRef.current.add(
      request.requestContext.requestId,
    );
    const currentCoordinatesMatch = Boolean(
      liveConfigurationEditable
      && currentRecommendationCoordinate
      && JSON.stringify(request.knowledgeSnapshot) ===
        JSON.stringify(currentRecommendationCoordinate.knowledgeSnapshot)
      && JSON.stringify(request.template) ===
        JSON.stringify(currentRecommendationCoordinate.template),
    );
    if (
      !attempt ||
      attempt.requestId !== request.requestContext.requestId ||
      !attempt.applyToForm ||
      !currentCoordinatesMatch ||
      !canApplySiteDesignRecommendation({
        request,
        response,
        designRevision: currentDesignRevision,
        draftHash: currentDesignDraftHash,
        editSequenceAtRequest: attempt.editSequence,
        currentEditSequence: designEditSequenceRef.current,
        allowEditsSinceRequest: attempt.userInitiated,
      })
    ) {
      return;
    }
    const availableRouteIds = new Set(
      liveObservation?.brief?.routes.map((route) => route.id) ?? [],
    );
    if (
      response.candidates.some(
        (candidate) => !availableRouteIds.has(candidate.id),
      )
    ) {
      return;
    }

    const editedFields = manuallyEditedRecommendationFieldsRef.current;
    const previewBlocksByRoute = new Map(
      response.previewBlocks.map((block) => [block.routeId, block]),
    );
    const featuredRouteIds = new Set(response.featuredRouteIds);
    const pageProjection = response.candidates.map((candidate) => {
      const block = previewBlocksByRoute.get(candidate.id);
      return {
        id: candidate.id,
        name: candidate.title,
        detail: block?.title
          ?? `${candidate.evidenceDocumentCount} 个知识来源`,
        enabled: featuredRouteIds.has(candidate.id),
        importanceRank: candidate.importanceRank,
        recommendationReason: candidate.recommendationReason,
      };
    });
    setDesignDraft((current) => ({
      ...current,
      pages: editedFields.has("featuredRoutes")
        ? current.pages
        : pageProjection,
      // A successful "needs confirmation" response is authoritative about
      // missing evidence. Empty values remain empty instead of retaining a
      // server-brief fallback that could look like a recommendation.
      siteName: editedFields.has("siteName")
        ? current.siteName
        : response.siteName.value ?? "",
      siteGoal: editedFields.has("siteGoal")
        ? current.siteGoal
        : response.siteGoal.value ?? "",
    }));
    setAppliedRecommendation({
      coordinateKey: siteDesignRecommendationCoordinateKey({
        knowledgeSnapshot: request.knowledgeSnapshot,
        template: request.template,
      }),
      siteName: response.siteName.value,
      siteGoal: response.siteGoal.value,
      featuredRouteIds: response.featuredRouteIds,
      pageProjection,
    });
    setCompletedStepIds((current) => current.filter((step) => step !== "design"));
    setIsConfirmed(false);
    if (attempt.userInitiated) {
      setNotice("已刷新推荐；手动修改过的字段保持不变。");
    } else {
      setNotice(
        response.featuredRouteIds.length > 0
          ? `已按当前发布知识启用全部 ${response.featuredRouteIds.length} 个栏目；可在列表中按需关闭。`
          : "知识不足以自动选出主栏目，请从真实页面列表中手动选择。",
      );
    }
  }, [
    currentDesignDraftHash,
    currentDesignRevision,
    currentRecommendationCoordinate,
    designRecommendation?.data,
    designRecommendation?.request,
    liveConfigurationEditable,
    liveObservation?.brief?.routes,
  ]);

  useEffect(() => setActiveStep(normalizedInitialStep), [normalizedInitialStep]);
  useEffect(
    () => setFocusedSection(normalizeWebsiteDesignSection(initialSection)),
    [initialSection],
  );
  // Focus one design config area: scroll it into view and flash a highlight.
  useEffect(() => {
    if (activeStep !== "design" || !focusedSection) return;
    const node = document.querySelector<HTMLElement>(
      `[data-design-section="${focusedSection}"]`,
    );
    if (!node) return;
    node.scrollIntoView?.({ behavior: "smooth", block: "center" });
    node.classList.add("is-section-focus");
    const timer = window.setTimeout(() => {
      node.classList.remove("is-section-focus");
    }, 2_400);
    return () => {
      window.clearTimeout(timer);
      node.classList.remove("is-section-focus");
    };
  }, [activeStep, focusedSection]);

  useEffect(() => {
    const saved = saveWebsiteDraft({
      version: 2,
      updatedAt: Date.now(),
      confirmed: isConfirmed,
      completedStepIds,
      selectedTemplateId,
      templateSourceUrl: templateUrl,
      design: {
        siteName,
        siteGoal,
        featuredPageIds: pages.filter((page) => page.enabled).map((page) => page.id),
        siteAccent,
        assistant: {
          name: assistantName,
          welcome,
          // Preserve the last custom color while the UI follows siteAccent.
          accent: assistantAccent,
          followSiteAccent: assistantFollowsSite,
          tested: assistantTested,
        },
        recommendationEditedFields: [
          ...manuallyEditedRecommendationFieldsRef.current,
        ],
      },
    }, storageScope);
    setStorageAvailable(saved);
  }, [assistantAccent, assistantFollowsSite, assistantName, assistantTested, completedStepIds, isConfirmed, pages, selectedTemplateId, siteAccent, siteGoal, siteName, storageScope, templateUrl, welcome]);

  useEffect(() => {
    if (!didMountDraftRef.current) {
      didMountDraftRef.current = true;
      return;
    }
    if (isConfirmed) setIsConfirmed(false);
  }, [assistantAccent, assistantFollowsSite, assistantName, completedStepIds, pages, selectedTemplateId, siteAccent, siteGoal, siteName, templateUrl, welcome]);

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
    designEditSequenceRef.current += 1;
    const invalidated = new Set(stepIds);
    setCompletedStepIds((current) => current.filter((step) => !invalidated.has(step)));
    setIsConfirmed(false);
  };

  // A plain refetch only helps while the failed request still targets the
  // current knowledge snapshot and template; otherwise issue a fresh request
  // so the server never sees a stale coordinate (409).
  const retryDesignRecommendation = () => {
    const failedRequest = designRecommendation?.request ?? null;
    const failedStillCurrent = Boolean(
      failedRequest
        && currentRecommendationCoordinate
        && JSON.stringify(failedRequest.knowledgeSnapshot)
          === JSON.stringify(currentRecommendationCoordinate.knowledgeSnapshot)
        && JSON.stringify(failedRequest.template)
          === JSON.stringify(currentRecommendationCoordinate.template),
    );
    if (failedStillCurrent) {
      void siteOps?.onRetryDesignRecommendation?.();
      return;
    }
    requestFreshDesignRecommendation(true, !currentProjectDesignPreferences);
  };

  const restoreRecommendedField = (field: RecommendationField) => {
    const recommendation = appliedRecommendation;
    if (!recommendation) return;
    if (field === "siteName") {
      if (recommendation.siteName === null) return;
      manuallyEditedRecommendationFieldsRef.current.delete("siteName");
      invalidateSteps("design");
      setSiteName(recommendation.siteName);
      return;
    }
    if (field === "siteGoal") {
      if (recommendation.siteGoal === null) return;
      manuallyEditedRecommendationFieldsRef.current.delete("siteGoal");
      invalidateSteps("design");
      setSiteGoal(recommendation.siteGoal);
      return;
    }
    if (
      recommendation.featuredRouteIds.length === 0
      || recommendation.pageProjection.length === 0
    ) {
      return;
    }
    manuallyEditedRecommendationFieldsRef.current.delete("featuredRoutes");
    invalidateSteps("design");
    const featured = new Set(recommendation.featuredRouteIds);
    const projectionById = new Map(
      recommendation.pageProjection.map((page) => [page.id, page]),
    );
    // Restore exactly the recommended featured routes. Pages added after the
    // recommendation stay listed but leave the main navigation.
    setPages((current) => current.map((page) => {
      const projected = projectionById.get(page.id);
      return projected
        ? { ...projected, enabled: featured.has(page.id) }
        : { ...page, enabled: false };
    }));
  };

  const importTemplate = (event: FormEvent) => {
    event.preventDefault();
    setNotice(
      isHttpUrl(templateUrl.trim())
        ? "模板参考链接已保存。"
        : "请输入以 http:// 或 https:// 开头的外部模板链接。",
    );
  };

  const goTo = (step: BuildStep, section?: WebsiteDesignSection) => {
    if (section) setFocusedSection(section);
    setActiveStep(step);
    setNotice("");
    onStepChange?.(step);
  };

  const goPrevious = () => {
    if (stepIndex > 0) goTo(steps[stepIndex - 1].id);
  };

  const createLiveDesignPreferencesDraft = () => {
    if (!structureReady) {
      throw new Error("请至少选择一个真实主栏目后再保存网站设计。");
    }
    if (!activeKnowledgeSnapshotCoordinate) {
      throw new Error("当前发布知识缺少稳定坐标，请刷新后重试。");
    }
    const templateCoordinate = templateSelectionOpen
      ? selectedLiveCandidate?.templateCoordinate ?? null
      : selectedTemplateCoordinate;
    if (!templateCoordinate) {
      throw new Error("所选模板缺少稳定坐标，请重新选择模板。");
    }
    const draft = siteDesignPreferencesDraftSchema.safeParse({
      schemaVersion: 1,
      siteName: siteName.trim(),
      siteGoal: siteGoal.trim(),
      featuredRouteIds: pages
        .filter((page) => page.enabled)
        .map((page) => page.id),
      siteAccent,
      assistant: {
        name: assistantName.trim(),
        welcome: welcome.trim(),
        accentMode: assistantFollowsSite ? "follow_site" : "custom",
        customAccent: assistantAccent,
      },
      knowledgeSnapshot: activeKnowledgeSnapshotCoordinate,
      template: templateCoordinate,
    });
    if (!draft.success) {
      throw new Error(
        draft.error.issues[0]?.message
          ? `网站设计配置无效：${draft.error.issues[0].message}`
          : "网站设计配置无效，请检查后重试。",
      );
    }
    return draft.data satisfies SiteDesignPreferencesDraft;
  };

  const saveLiveDesignPreferences = async () => {
    if (!siteOps?.onSaveDesignPreferences || !liveObservation) {
      throw new Error("真实建站服务当前不能保存网站设计，请刷新后重试。");
    }
    const observation = await siteOps.onSaveDesignPreferences({
      conversationId: liveObservation.project.conversationId,
      expectedProjectRevision: liveObservation.project.revision,
      expectedDesignRevision: currentDesignRevision,
      draft: createLiveDesignPreferencesDraft(),
    });
    savedDesignSequenceRef.current = designEditSequenceRef.current;
    return observation;
  };

  const submitLiveConfigurationAndBuild = async () => {
    if (
      !siteOps?.onSaveDesignPreferences
      || !siteOps.onAction
      || !liveObservation
      || liveObservation.interactionState !== "awaiting_visual_selection"
      || liveInteractionPending
      || !structureReady
    ) {
      setNotice(!structureReady
        ? "请至少选择一个真实主栏目后再开始生成。"
        : "真实建站服务当前不能保存配置并开始生成，请刷新状态后重试。");
      return false;
    }
    const selectedCandidate = liveCandidates.find(
      (candidate) => candidate.id === selectedTemplateId,
    );
    if (!selectedCandidate || selectedCandidate.executionAdmitted === false) {
      setNotice(selectedCandidate?.executionUnavailableReason || "请选择一个可用于真实生成的模板。");
      return false;
    }
    const submittedEditSequence = designEditSequenceRef.current;
    const submissionStillCurrent = () =>
      designEditSequenceRef.current === submittedEditSequence;
    setLiveAction("configure_and_build");
    setLiveError(null);
    try {
      await saveLiveDesignPreferences();
      if (!submissionStillCurrent()) {
        setNotice("保存期间网站设计已更新；新内容已保留，请重新提交后再开始生成。");
        return false;
      }
      await siteOps.onAction({
        action: "select_visual",
        input: { sampleId: selectedCandidate.id },
      });
      if (!submissionStillCurrent()) {
        setNotice("生成任务提交期间网站设计已更新；当前页面不会将旧草稿标记完成，请重新提交最新设计。");
        return false;
      }
      liveBriefHydrationRef.current = {
        projectId: liveObservation.project.id,
        editSequence: submittedEditSequence,
      };
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
      !siteOps?.onSaveDesignPreferences
      || !siteOps.onSubmitRevision
      || !liveObservation
      || !liveRevisionEditable
      || liveInteractionPending
      || !structureReady
    ) {
      setNotice(!structureReady
        ? "请至少选择一个真实主栏目后再提交修改。"
        : "当前真实构建不能提交修改，请等待构建完成或刷新状态后重试。");
      return false;
    }
    const submittedEditSequence = designEditSequenceRef.current;
    const submissionStillCurrent = () =>
      designEditSequenceRef.current === submittedEditSequence;
    setLiveAction("submit_revision");
    setLiveError(null);
    try {
      await saveLiveDesignPreferences();
      if (!submissionStillCurrent()) {
        setNotice("保存期间网站设计已更新；新内容已保留，请重新提交最新改版。");
        return false;
      }
      await siteOps.onSubmitRevision({
        text: buildLiveSiteOpsRevisionMessage(),
        files: [],
        onProgress: () => undefined,
      });
      if (!submissionStillCurrent()) {
        setNotice("改版任务提交期间网站设计已更新；当前页面不会将旧草稿标记完成，请重新提交最新设计。");
        return false;
      }
      liveBriefHydrationRef.current = {
        projectId: liveObservation.project.id,
        editSequence: submittedEditSequence,
      };
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
    if (activeStep === "design" && (!structureReady || !brandReady)) {
      setNotice("请至少选择一个主栏目，并补充网站名称与站点简介 / 建站目标。");
      return;
    }
    if (activeStep === "design" && !assistantReady) {
      setNotice("请补充助手名称和欢迎语。");
      return;
    }
    if (activeStep === "design" && siteOps && templateSelectionOpen) {
      // First real build: submit and stay. The real trial can only happen in
      // the embedded build preview once it exists.
      const accepted = await submitLiveConfigurationAndBuild();
      if (!accepted) return;
      setNotice("真实预览已开始生成；构建完成后请在右侧真实构建预览中完成一次助手问答，再继续进入建设评估。");
      return;
    }
    if (activeStep === "design" && siteOps && liveRevisionEditable) {
      if (!designDraftSynced) {
        const accepted = await submitLiveRevision();
        if (!accepted) return;
        setNotice("改版要求已提交；新版本生成后请在右侧完成一次助手问答，再继续进入建设评估。");
        return;
      }
      if (!assistantTested) {
        setNotice("请先在右侧真实构建预览中向助手提问并得到真实回答，完成真实试聊后再继续。");
        return;
      }
    }
    if (activeStep === "design" && !siteOps && !assistantTested) {
      // The offline demo keeps its illustrative trial gate.
      setNotice("请先在右侧统一预览中提问一次并得到回答，完成助手试用后再继续。");
      return;
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
      onAction: () => goTo("design", "pages"),
    },
    {
      id: "website-navigation-contact",
      title: "导航与联系入口",
      detail: "需逐页检查导航、返回路径和联系入口是否可达，当前尚未执行",
      status: "unexecuted",
      statusLabel: "未执行",
      weight: 10,
      actionLabel: "查看结构",
      onAction: () => goTo("design", "pages"),
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
        goTo("design");
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
      onAction: onOpenRag ?? (() => goTo("design")),
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
      onAction: onOpenRag ?? (() => goTo("design")),
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
      setNotice("尚无可关联的企业 RAG 评估快照。先在企业 RAG 页完成一次自动评估或人工复核。");
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
      {/* The live workspace keeps its own page chrome; the demo heading and
          status card would only duplicate the live status strip below. */}
      {!siteOps && (
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
      )}

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
                  className={`${template.id === effectiveSelectedTemplateId ? "is-selected" : ""}${template.executionAdmitted ? "" : " is-disabled"}`}
                >
                  <input
                    type="radio"
                    name="website-template"
                    value={template.id}
                    checked={template.id === effectiveSelectedTemplateId}
                    disabled={!template.executionAdmitted || liveInteractionPending || Boolean(siteOps && !templateSelectionOpen)}
                    onChange={() => {
                      if (siteOps && !templateSelectionOpen) return;
                      invalidateSteps("template", "design");
                      setSelectedTemplateId(template.id);
                      setSiteAccent(template.accent);
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

        {activeStep === "design" && (
          <div className="sfp-workspace-grid">
            <section className="sfp-panel sfp-builder-config-panel sfp-builder-config-panel--design">
              <div className="sfp-section-heading sfp-section-heading--compact">
                <div><h2>网站设计</h2><p>网站结构、主题与助手共用同一份设计草稿；语言由服务端根据当前知识确定。</p></div>
              </div>
              <div className="sfp-design-section" data-design-section="site">
                <header><span>1</span><div><h3>网站基础</h3><p>推荐内容来自当前发布知识，您可以继续编辑。</p></div></header>
              <div className="sfp-brand-fields">
                <label className="sfp-brand-name">
                  <span>
                    网站名称
                    {siteOps && (recommendationFieldEdited.siteName ? (
                      <small className="sfp-recommend-flag is-edited" data-testid="website-site-name-recommend-flag">
                        已修改
                        {canRestoreRecommendedField("siteName") && (
                          <button type="button" className="sfp-recommend-restore" aria-label="恢复推荐的网站名称" onClick={() => restoreRecommendedField("siteName")}>恢复推荐</button>
                        )}
                      </small>
                    ) : appliedRecommendation ? (
                      <small className="sfp-recommend-flag" data-testid="website-site-name-recommend-flag">根据企业资料推荐</small>
                    ) : (
                      <small>真实 brief 字段</small>
                    ))}
                  </span>
                  <input aria-label="网站名称" data-testid="website-site-name" maxLength={80} value={siteName} disabled={Boolean(siteOps && !liveConfigurationEditable)} onChange={(event) => { manuallyEditedRecommendationFieldsRef.current.add("siteName"); invalidateSteps("design"); setSiteName(event.currentTarget.value); }} />
                </label>
                <label className="sfp-brand-name">
                  <span>
                    站点简介 / 建站目标
                    {siteOps && (recommendationFieldEdited.siteGoal ? (
                      <small className="sfp-recommend-flag is-edited" data-testid="website-site-goal-recommend-flag">
                        已修改
                        {canRestoreRecommendedField("siteGoal") && (
                          <button type="button" className="sfp-recommend-restore" aria-label="恢复推荐的建站目标" onClick={() => restoreRecommendedField("siteGoal")}>恢复推荐</button>
                        )}
                      </small>
                    ) : appliedRecommendation ? (
                      <small className="sfp-recommend-flag" data-testid="website-site-goal-recommend-flag">根据企业资料推荐</small>
                    ) : (
                      <small>真实 brief 字段</small>
                    ))}
                  </span>
                  <textarea aria-label="站点简介 / 建站目标" data-testid="website-site-goal" maxLength={200} value={siteGoal} disabled={Boolean(siteOps && !liveConfigurationEditable)} onChange={(event) => { manuallyEditedRecommendationFieldsRef.current.add("siteGoal"); invalidateSteps("design"); setSiteGoal(event.currentTarget.value); }} />
                </label>
              </div>
              {siteOps && designRecommendation?.loading && (
                <p className="sfp-helper" role="status">正在按当前发布知识生成网站名称、建站目标和主栏目推荐…</p>
              )}
              {siteOps && !designRecommendation?.loading && designRecommendation?.error && (
                <div className="sfp-inline-error" role="alert">
                  <span>自动推荐暂时不可用；手动填写的内容不会丢失。</span>
                  <button type="button" onClick={retryDesignRecommendation}>重试推荐</button>
                </div>
              )}
              {siteOps && liveConfigurationEditable && !designRecommendation?.loading && recommendationStale && (
                <div className="sfp-recommend-stale" role="status" data-testid="website-recommendation-stale">
                  <span>当前知识或模板版本已更新，新建议可用；已修改的字段不会被覆盖。</span>
                  <button type="button" onClick={() => requestFreshDesignRecommendation(true, !currentProjectDesignPreferences)}>刷新推荐</button>
                </div>
              )}
              {siteOps && liveConfigurationEditable && !designRecommendation?.loading && !recommendationStale && appliedRecommendation && (
                <div className="sfp-recommend-refresh" data-testid="website-recommendation-refresh">
                  <button type="button" onClick={() => requestFreshDesignRecommendation(true, !currentProjectDesignPreferences)}>刷新推荐</button>
                  <small>重新获取建议；手动修改过的字段保持不变。</small>
                </div>
              )}
              </div>

              <div className="sfp-design-section" data-design-section="pages">
                <header><span>2</span><div><h3>页面与栏目</h3><p>全部栏目默认加入导航；可按需关闭个别栏目。</p></div></header>
                <div className="sfp-knowledge-summary" data-testid="website-design-knowledge-summary">
                  <FileText size={17} />
                  <span><strong>{siteOps ? liveObservation?.knowledgeSnapshots[0]?.label ?? "当前已发布知识库" : "当前 RAG 示例知识范围"}</strong><small>{siteOps ? `项目版本 ${liveObservation?.project.revision ?? "—"} · ${pages.length} 个真实页面` : `${previewKnowledgeCollectionCount} 个知识集合 · ${previewKnowledgeFragmentCount} 个示例片段`}</small></span>
                </div>
                {siteOps && (recommendationFieldEdited.featuredRoutes ? (
                  <p className="sfp-recommend-row" data-testid="website-routes-recommend-flag">
                    <span>主栏目已手动调整</span>
                    {canRestoreRecommendedField("featuredRoutes") && (
                      <button type="button" className="sfp-recommend-restore" aria-label="恢复推荐的主栏目" onClick={() => restoreRecommendedField("featuredRoutes")}>恢复推荐</button>
                    )}
                  </p>
                ) : appliedRecommendation ? (
                  <p className="sfp-recommend-row" data-testid="website-routes-recommend-flag">主栏目根据企业资料推荐</p>
                ) : null)}
                <details className="sfp-page-disclosure">
                  <summary>共 {pages.length} 个栏目，{enabledPages.length} 个启用</summary>
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
                        disabled={Boolean(siteOps && !liveConfigurationEditable)}
                        onChange={(event) => {
                          const enabled = event.currentTarget.checked;
                          manuallyEditedRecommendationFieldsRef.current.add("featuredRoutes");
                          invalidateSteps("design");
                          setPages((current) => current.map((item) => item.id === page.id ? { ...item, enabled } : item));
                        }}
                      />
                      <i />
                    </label>
                    <em>{page.importanceRank ? `#${page.importanceRank}` : `0${index + 1}`}</em>
                  </div>
                ))}
              </div>
                </details>
              </div>

              <div className="sfp-design-section" data-design-section="theme">
                <header><span>3</span><div><h3>主题颜色</h3><p>网站与助手颜色会一起出现在右侧统一预览。</p></div></header>
                <div className="sfp-design-color-grid">
                  <fieldset>
                    <legend>网站主题色</legend>
                    <div className="sfp-color-options">
                      {accentOptions.map((color) => (
                        <button key={color} type="button" aria-label={`选择网站主题色 ${color}`} aria-pressed={siteAccent === color} style={{ background: color }} onClick={() => { if (siteAccent === color) return; invalidateSteps("design"); setSiteAccent(color); }} />
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>助手主题色{assistantFollowsSite ? "（跟随网站）" : "（自定义）"}</legend>
                    <div className="sfp-color-options">
                      {accentOptions.map((color) => (
                        <button key={color} type="button" aria-label={`选择助手主题色 ${color}`} aria-pressed={!assistantFollowsSite && assistantAccent === color} style={{ background: color }} onClick={() => { if (!assistantFollowsSite && assistantAccent === color) return; invalidateSteps("design"); setAssistantAccent(color); setAssistantFollowsSite(false); }} />
                      ))}
                    </div>
                    <label className="sfp-color-follow">
                      <input type="checkbox" checked={assistantFollowsSite} onChange={(event) => { invalidateSteps("design"); setAssistantFollowsSite(event.currentTarget.checked); }} />
                      <span><strong>跟随网站主题色</strong><small>切换回自定义时会恢复上一次选择的助手颜色。</small></span>
                    </label>
                  </fieldset>
                </div>
              </div>

              <div className="sfp-design-section" data-design-section="assistant">
                <header><span>4</span><div><h3>助手设置</h3><p>助手问答使用同一知识快照，来源按产品策略始终可核对。</p></div></header>
                <div className="sfp-form-grid">
                  <label><span>助手名称{siteOps && <small>真实设计字段</small>}</span><input aria-label="助手名称" data-testid="website-assistant-name" maxLength={80} value={assistantName} disabled={Boolean(siteOps && !liveConfigurationEditable)} onChange={(event) => { invalidateSteps("design"); setAssistantName(event.currentTarget.value); setAssistantTested(false); }} /></label>
                  <label className="sfp-welcome-field"><span>欢迎语{siteOps && <small>真实设计字段</small>}</span><textarea aria-label="欢迎语" data-testid="website-assistant-welcome" maxLength={500} value={welcome} disabled={Boolean(siteOps && !liveConfigurationEditable)} onChange={(event) => { invalidateSteps("design"); setWelcome(event.currentTarget.value); setAssistantTested(false); }} /></label>
                </div>
                <div className={`sfp-assistant-trial ${assistantTested ? "is-done" : ""}`}>
                  {assistantTested ? <Check size={17} /> : <CircleAlert size={17} />}
                  <span>
                    <strong>{assistantTested ? "助手试用已完成" : "助手试用未完成"}</strong>
                    <small>{assistantTested
                      ? siteOps
                        ? "已在右侧真实构建预览中完成一次真实问答；修改名称、欢迎语或知识版本后需重新试用。"
                        : "已在右侧预览中完成一次问答；修改名称或欢迎语后需重新试用。"
                      : siteOps
                        ? "请在右侧真实构建预览中向助手提问并得到真实回答；本地草稿问答不计入试用。"
                        : "请在右侧预览中提问一次并得到回答，再进入建设评估。"}</small>
                  </span>
                </div>
              </div>
            </section>
            <section className="sfp-preview-panel sfp-builder-preview-panel" aria-label="网站与助手统一预览" data-testid="website-design-preview">
              <div className="sfp-preview-heading"><span><strong>{isLiveBuilder ? (embeddableBuild ? (embedShowsLatestBuild ? (designDraftSynced ? "真实构建预览" : "真实构建预览 · 有未提交修改") : "真实构建预览 · 新版本生成中") : "真实数据草稿") : "知识驱动统一预览"}</strong><small>{selectedTemplate.name} · {enabledPages.length} 个主栏目{siteOps ? (embeddableBuild ? (embedShowsLatestBuild ? (designDraftSynced ? " · 已嵌入真实构建产物" : " · 预览为最近一次真实构建，提交修改后自动更新") : " · 正在生成新版本，当前显示上一版真实构建") : " · 内容来自当前知识投影，构建完成后以真实构建预览为准") : ""}</small></span><DevicePicker device={device} onChange={setDevice} /></div>
              {isLiveBuilder && embeddableBuild ? (
                <SiteOpsBuildEmbedPreview
                  build={embeddableBuild}
                  device={device}
                  expectedTrialBinding={embedTrialBinding}
                  onTrialComplete={handleRealTrialComplete}
                  routes={embedRoutes}
                />
              ) : isLiveBuilder ? (
                <SiteDesignDraftPreview
                  assistantAccent={effectiveAssistantAccent}
                  assistantName={assistantName}
                  blocksByRoute={draftPreviewData?.blocksByRoute ?? EMPTY_DRAFT_PREVIEW_BLOCKS}
                  brandMark={brandMark}
                  device={device}
                  error={designRecommendation?.error ?? null}
                  knowledgeVersion={draftPreviewData?.knowledgeVersion ?? null}
                  loading={Boolean(designRecommendation?.loading)}
                  pages={draftPreviewPages}
                  siteAccent={siteAccent}
                  siteDomain={previewDomain}
                  siteName={siteName}
                  stale={recommendationStale}
                  templateName={selectedTemplate.name}
                  welcome={welcome}
                />
              ) : (
                <MiniSitePreview
                  assistantAccent={effectiveAssistantAccent}
                  assistantName={assistantName}
                  brandMark={brandMark}
                  device={device}
                  exchangeBinding={assistantTrialBinding}
                  onExchange={handleAssistantExchange}
                  pages={previewPages}
                  showAssistant
                  showSources={showSources}
                  siteAccent={siteAccent}
                  siteDomain={previewDomain}
                  siteLanguage={siteLanguage}
                  siteName={siteName}
                  templateId={effectiveSelectedTemplateId}
                  welcome={welcome}
                />
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
              <section className="sfp-config-checks" aria-label="配置检查项" data-testid="website-config-checks">
                <header>
                  <strong>配置检查项</strong>
                  <small>非计分检查，只作为草稿确认门槛；不参与 40/40/20 加权评分，RAG 评估也不进入网站得分。</small>
                </header>
                <ul>
                  {configurationChecks.map((check) => (
                    <li key={check.id} className={check.passed ? "is-passed" : ""}>
                      <span className="sfp-config-check-id">{check.id}</span>
                      <div>
                        <strong>{check.title}</strong>
                        <small>{check.detail}</small>
                      </div>
                      <b>{check.passed ? "已确认" : "待确认"}</b>
                      <button type="button" onClick={check.onAction}>{check.actionLabel}</button>
                    </li>
                  ))}
                </ul>
              </section>
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
            {!canComplete && <span id="sfp-confirmation-requirement" className="sfp-visually-hidden">请先依次确认模板和网站设计。</span>}
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
            data-testid={siteOps && activeStep === "design"
              ? templateSelectionOpen
                ? "website-build-start"
                : liveRevisionEditable
                  ? "website-revision-submit"
                  : undefined
              : undefined}
            disabled={Boolean(siteOps && (
              liveInteractionPending
              || (activeStep === "template" && !templateReady)
              || (activeStep === "design" && templateSelectionOpen && (!assistantReady || !brandReady || !structureReady))
              || (activeStep === "design" && liveRevisionEditable && (!assistantReady || !brandReady || !structureReady))
            ))}
            onClick={goNext}
          >
            {siteOps && activeStep === "template"
              ? "继续配置真实 brief"
              : siteOps && activeStep === "design" && templateSelectionOpen
                ? liveAction === "configure_and_build" ? "正在保存配置并生成…" : "保存真实配置并生成网站"
                : siteOps && activeStep === "design" && liveRevisionEditable
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

export default SimplifiedWebsiteBuilderPreview;
