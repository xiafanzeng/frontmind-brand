import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type SetStateAction } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  CircleAlert,
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
import { toast } from "sonner";
import type { SiteOpsConversationPanelProps } from "../siteops/SiteOpsConversationPanel";
import {
  siteDesignPreferencesDraftSchema,
  siteDesignRecommendationMatchesRequest,
  siteDesignRouteIdSchema,
  siteDesignTemplateCoordinateSchema,
  type SiteDesignKnowledgeSnapshotCoordinate,
  type SiteDesignPreferencesDraft,
  type SiteDesignRecommendationInput,
  type SiteDesignTemplateCoordinate,
} from "../../../contracts/site-design-preferences";
import {
  siteWebsiteEvaluationInputsDraftSchema,
  type SiteWebsiteEvaluationInputsDraft,
} from "../../../contracts/website-build-inputs";
import {
  websiteBuildEvaluationDecisionSchema,
  type WebsiteBuildEvaluationDecision,
} from "../../../contracts/website-build-evaluation-run";
import {
  previewKnowledgeCollectionCount,
  previewKnowledgeFragmentCount,
} from "./preview-copy";
import {
  PreviewAssistantWidget,
  type AssistantExchangeBinding,
} from "./preview-assistant-widget";
import { SiteOpsBuildEmbedPreview } from "./siteops-build-embed-preview";
import { WebsiteDomainPublishPanel, getWebsitePublishState, type WebsitePublishTarget } from "./WebsiteDomainPublishPanel";
import { WebsiteRevisionFields } from "./WebsiteRevisionFields";
import { WebsiteOperationHistory, WebsiteRestartAction } from "./WebsiteOperationHistory";
import { usePreviewDialog } from "./qa-widget/usePreviewDialog";
import { listEvaluationReports } from "./evaluation-report-store";
import {
  WebsiteEvaluationWorkspace,
  type WebsiteEvaluationAuthorityView,
  type WebsiteEvaluationManualReviewInput,
  type WebsiteEvaluationRepairTarget,
  type WebsiteEvaluationRunStatus,
} from "./WebsiteEvaluationWorkspace";
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
export type WebsiteDesignSection = "site" | "pages" | "theme" | "assistant" | "evaluation-inputs" | "domain";

export function normalizeWebsiteDesignSection(value: unknown): WebsiteDesignSection | null {
  if (value === "site" || value === "pages" || value === "theme" || value === "assistant" || value === "evaluation-inputs" || value === "domain") {
    return value;
  }
  return null;
}

export type SimplifiedWebsiteBuilderPreviewProps = {
  initialStep?: BuildStep | LegacyBuildStep;
  /** Focuses (scrolls + highlights) one design config area on the design step. */
  initialSection?: WebsiteDesignSection | null;
  onOpenRag?: () => void;
  onStepChange?: (step: BuildStep) => void;
  /** Real SiteOps state/actions supplied by the connected production adapter. */
  siteOps?: SiteOpsConversationPanelProps;
  /** Server-authoritative run/report view. Omission never falls back to browser scoring. */
  websiteEvaluation?: WebsiteEvaluationAuthorityView | null;
  onRetryWebsiteEvaluation?: () => void;
  onLoadMoreWebsiteEvaluationHistory?: () => void;
  onSubmitWebsiteEvaluationReview?: (input: WebsiteEvaluationManualReviewInput) => Promise<void>;
  /** Local fixture hook; live mode submits a real SiteOps revision instead. */
  onReevaluateWebsiteEvaluation?: () => void | Promise<void>;
  websiteEvaluationAdmission?: {
    mode: "off" | "shadow" | "allowlist" | "live";
    required: boolean;
    userVisible: boolean;
  };
  /** Separates live drafts and audit evidence by account/workspace. */
  storageScope?: string;
};

type WebsiteAssessmentRequest = Readonly<{
  baselineBuildId: string | null;
  baselineReportId: string | null;
  acceptCurrentCompleted: boolean;
}>;

type LiveReleaseCoordinates = {
  target: WebsitePublishTarget;
  projectId: string;
  projectRevision: number;
  knowledgeSnapshotId: string | null;
  buildId: string;
  expectedHeadDeploymentId: string | null;
  evaluationRunId: string | null;
  evaluationReportId: string | null;
  evaluationReportHash: string | null;
  evaluationMode: WebsiteBuildEvaluationDecision["mode"] | null;
};

type WebsiteEvaluationInputsForm = {
  logoAssetId: string;
  logoSha256: string;
  primaryColor: string;
  secondaryColors: string;
  fontPreferences: string;
  toneKeywords: string;
  forbiddenPhrases: string;
  visitorGoal: string;
  entryRouteId: string;
  successCriteria: string;
  requiredRouteIds: string[];
  assistantRequired: boolean;
  visitorTaskConfirmed: boolean;
};

const emptyWebsiteEvaluationInputsForm = (): WebsiteEvaluationInputsForm => ({
  logoAssetId: "",
  logoSha256: "",
  primaryColor: "",
  secondaryColors: "",
  fontPreferences: "",
  toneKeywords: "",
  forbiddenPhrases: "",
  visitorGoal: "",
  entryRouteId: "",
  successCriteria: "",
  requiredRouteIds: [],
  assistantRequired: false,
  visitorTaskConfirmed: false,
});

function splitEvaluationInputList(value: string) {
  return Array.from(new Set(value
    .split(/[\n,，]/u)
    .map((item) => item.trim())
    .filter(Boolean)));
}

function liveEvaluationDecisionContext(
  evaluation: WebsiteEvaluationAuthorityView | null,
) {
  const immutableReportReady = Boolean(
    evaluation?.status === "completed"
    && evaluation.reportId
    && evaluation.reportHash,
  );
  const mode: WebsiteBuildEvaluationDecision["mode"] = !immutableReportReady
    ? "assessment_unavailable"
    : evaluation?.recommendation === "recommended"
      ? "follow_recommendation"
      : "accepted_risk";
  const riskIds = mode === "accepted_risk"
    ? Array.from(new Set([
        ...(evaluation?.criticalRiskIds ?? []),
        "quality_recommendation",
      ]))
    : mode === "assessment_unavailable"
      ? ["assessment_unavailable"]
      : [];
  return {
    mode,
    runId: evaluation?.runId ?? null,
    reportId: immutableReportReady ? evaluation?.reportId ?? null : null,
    reportHash: immutableReportReady ? evaluation?.reportHash ?? null : null,
    riskIds,
  };
}

const steps: ReadonlyArray<{
  id: BuildStep;
  label: string;
}> = [
  { id: "template", label: "选择模板" },
  { id: "design", label: "网站设计" },
  { id: "evaluation", label: "建设评估" },
];

const BUILD_STEP_INDEX: Record<BuildStep, 0 | 1 | 2> = {
  template: 0,
  design: 1,
  evaluation: 2,
};

const DRAFT_SAVE_FEEDBACK_MS = 800;

function scopedStorageKey(key: string, scope?: string) {
  return scope ? `${key}.${encodeURIComponent(scope)}` : key;
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

const defaultAssistantName = import.meta.env.DEV || import.meta.env.MODE === "preview" || import.meta.env.MODE === "test"
  ? "FrontMind 企业助手"
  : "企业知识助手";
const isGenericAssistantIdentity = (value: string) =>
  value === defaultAssistantName || /^FrontMind\s*企业助手$/u.test(value.trim());

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
      name: defaultAssistantName,
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

export function loadWebsiteDraft(
  storageScope?: string,
  { requireAssistantTrial = true }: { requireAssistantTrial?: boolean } = {},
): WebsiteDraftV2 {
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
    if (!hasEnabledPage || !siteName.trim() || !siteGoal.trim() || !assistantName.trim() || !assistantWelcome.trim() || (requireAssistantTrial && !assistantTested)) {
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
  assistantInteractive,
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
  assistantInteractive: boolean;
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
          interactive={assistantInteractive}
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
  onStepChange,
  siteOps,
  websiteEvaluation: authoritativeWebsiteEvaluation,
  websiteEvaluationAdmission: explicitWebsiteEvaluationAdmission,
  onRetryWebsiteEvaluation,
  onLoadMoreWebsiteEvaluationHistory,
  onSubmitWebsiteEvaluationReview,
  onReevaluateWebsiteEvaluation,
  storageScope,
}: SimplifiedWebsiteBuilderPreviewProps) {
  const normalizedInitialStep = normalizeWebsiteBuildStep(initialStep) ?? "template";
  const auditStorage = useMemo(() => scopedEvaluationStorage(storageScope), [storageScope]);
  const legacyWebsiteReports = useMemo(() => listEvaluationReports(auditStorage)
    .filter((report) => report.result.skillId === "website-build-evaluation")
    .map((report) => ({
      reportId: report.reportId,
      score: report.result.score,
      createdAt: report.createdAt,
      version: report.result.version,
    })), [auditStorage]);
  const [draftSeed] = useState<WebsiteDraftV2>(() => loadWebsiteDraft(storageScope, {
    requireAssistantTrial: !siteOps,
  }));
  const [activeStep, setActiveStep] = useState<BuildStep>(normalizedInitialStep);
  const [highestUnlockedStep, setHighestUnlockedStep] = useState<0 | 1 | 2>(
    () => Math.max(
      BUILD_STEP_INDEX[normalizedInitialStep],
      draftSeed.completedStepIds.includes("evaluation")
        ? BUILD_STEP_INDEX.evaluation
        : draftSeed.completedStepIds.includes("template")
          || draftSeed.completedStepIds.includes("design")
          ? BUILD_STEP_INDEX.design
          : BUILD_STEP_INDEX.template,
    ) as 0 | 1 | 2,
  );
  const [assessmentRequest, setAssessmentRequest] =
    useState<WebsiteAssessmentRequest | null>(null);
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
  const [draftSavePending, setDraftSavePending] = useState(false);
  const [liveAction, setLiveAction] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [localReevaluatePending, setLocalReevaluatePending] = useState(false);
  const [localEvaluationDraftDirty, setLocalEvaluationDraftDirty] = useState(false);
  const [revisionText, setRevisionText] = useState("");
  const [revisionFiles, setRevisionFiles] = useState<File[]>([]);
  const [revisionProgress, setRevisionProgress] = useState<number[]>([]);
  const [websiteEvaluationInputsForm, setWebsiteEvaluationInputsForm] =
    useState<WebsiteEvaluationInputsForm>(emptyWebsiteEvaluationInputsForm);
  const revisionEditSequenceRef = useRef(0);
  const hasRevisionRequirements = Boolean(revisionText.trim() || revisionFiles.length);
  const [, setStorageAvailable] = useState(true);
  const [liveReleaseOpen, setLiveReleaseOpen] = useState(false);
  const [releaseAcknowledgedRiskIds, setReleaseAcknowledgedRiskIds] = useState<string[]>([]);
  const [releaseReason, setReleaseReason] = useState("");
  const [liveReleaseCoordinates, setLiveReleaseCoordinates] =
    useState<LiveReleaseCoordinates | null>(null);
  const [repairFocusTarget, setRepairFocusTarget] =
    useState<WebsiteEvaluationRepairTarget | null>(null);
  const didMountDraftRef = useRef(false);
  const draftSavePendingRef = useRef(false);
  const lastSiteOpsNoticeRef = useRef("");
  const lastErrorToastRef = useRef("");
  const appliedLiveBriefKeyRef = useRef<string | null>(null);
  const designEditSequenceRef = useRef(0);
  const liveBriefHydrationRef = useRef<{
    projectId: string;
    editSequence: number;
  } | null>(null);
  // Edit sequence at the last successful structured save; a build embed is
  // only shown while the design draft has no unsaved edits on top of it.
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
    setLiveReleaseOpen(false);
    setLiveReleaseCoordinates(null);
    setReleaseAcknowledgedRiskIds([]);
    setReleaseReason("");
  };
  const releaseDialogRef = usePreviewDialog(
    liveReleaseOpen,
    closeReleaseConfirmation,
  );
  const [assistantTrialOpen, setAssistantTrialOpen] = useState(false);
  const closeAssistantTrial = useCallback(() => setAssistantTrialOpen(false), []);
  const assistantTrialDialogRef = usePreviewDialog(assistantTrialOpen, closeAssistantTrial);

  const liveObservation = siteOps?.observation ?? null;
  const websiteEvaluationAdmission = explicitWebsiteEvaluationAdmission
    ?? liveObservation?.websiteEvaluationAdmission
    ?? (siteOps
      ? { mode: "off" as const, required: false, userVisible: false }
      : { mode: "live" as const, required: true, userVisible: true });
  const websiteEvaluationRequired = websiteEvaluationAdmission.required;
  const websiteEvaluationVisible = websiteEvaluationAdmission.userVisible;
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
  const liveBuildStatus = latestBuild?.status ?? liveObservation?.interactionState ?? "loading";
  const liveBuildInFlight = siteOps
    && (liveBuildStatus === "preparing"
      || liveBuildStatus === "visual_searching"
      || liveBuildStatus === "design_compiling"
      || liveBuildStatus === "contract_ready"
      || liveBuildStatus === "building"
      || liveBuildStatus === "qa_running");
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
  const liveBuildCompleted = Boolean(latestBuild?.previewUrl && liveRevisionEditable && !liveBuildInFlight);
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
  // The last completed site remains available through the page-header link
  // while design edits or a new build are pending. The explicit assistant
  // trial only counts against the newest build with the design draft synced.
  const displayedBuild = liveObservation?.builds.find(
    (build) => build.previewUrl,
  ) ?? null;
  useEffect(() => {
    if (activeStep !== "design" || !displayedBuild) closeAssistantTrial();
  }, [activeStep, displayedBuild?.id, closeAssistantTrial]);
  const designDraftSynced = latestBuild?.previewUrl
    ? !hasRevisionRequirements
      && (!latestBuild.designPreferences || !currentProjectDesignPreferences
        || latestBuild.designPreferences.draftHash === currentProjectDesignPreferences.draftHash)
      && (!liveBriefHydrationRef.current
        || designEditSequenceRef.current === liveBriefHydrationRef.current.editSequence)
    : false;
  const embeddableBuild = displayedBuild
    ? {
        id: displayedBuild.id,
        ordinal: displayedBuild.ordinal,
        status: displayedBuild.status,
        previewUrl: displayedBuild.previewUrl,
        sourceUrl: displayedBuild.sourceUrl,
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
  const visitorTaskDraftReady = Boolean(
    websiteEvaluationInputsForm.visitorGoal.trim()
    && websiteEvaluationInputsForm.entryRouteId
    && splitEvaluationInputList(websiteEvaluationInputsForm.successCriteria).length > 0
    && websiteEvaluationInputsForm.requiredRouteIds.includes(
      websiteEvaluationInputsForm.entryRouteId,
    ),
  );
  // A completed server build confirms the live configuration independently of
  // the owner's assistant trial. Trial evidence stays separate and truthful;
  // the illustrative offline flow retains its existing trial requirement.
  const assistantVerified = assistantReady && assistantTested;
  const templateComplete = templateReady && (completedStepSet.has("template") || Boolean(siteOps && liveBuildCompleted));
  const designComplete = structureReady && brandReady && assistantReady && (siteOps
    ? liveBuildCompleted && designDraftSynced
    : assistantVerified && completedStepSet.has("design"));
  // These checks never feed the 40/40/20 weighted score. In live mode, complete
  // configuration gates draft confirmation while the real trial is recorded
  // separately; opening an assessment never claims that trial has passed.
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
      actionLabel: "查看页面",
    },
    {
      id: "C03",
      title: "网站设置",
      passed: brandReady && designComplete,
      detail: brandReady
        ? designComplete ? "网站名称、建站目标与主题已确认。" : "设计步骤尚未整体确认。"
        : "网站名称或建站目标待补全。",
      onAction: () => goTo("design", "site"),
      actionLabel: "查看设置",
    },
    {
      id: "C04",
      title: "助手试聊",
      passed: assistantVerified && (Boolean(siteOps) || designComplete),
      detail: assistantVerified
        ? "助手配置有效且已完成一次真实问答。"
        : siteOps
          ? "尚未完成真实试聊，可随时试用助手；不影响查看建设评估。"
          : "需在预览中完成一次助手问答。",
      onAction: () => goTo("design", "assistant"),
      actionLabel: "查看助手",
    },
  ];
  const completedSteps: Record<BuildStep, boolean> = {
    template: templateComplete,
    design: designComplete,
    evaluation: highestUnlockedStep === BUILD_STEP_INDEX.evaluation
      && authoritativeWebsiteEvaluation?.status === "completed",
  };
  // Real-build progress strip: elapsed time and the finest stage the server
  // exposes (buildPhase beats the coarse execution-step stage).
  const [buildClockNow, setBuildClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (!liveBuildInFlight) return;
    const timer = window.setInterval(() => setBuildClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [liveBuildInFlight]);
  const liveBuildProgress = useMemo(() => {
    if (!liveBuildInFlight || !latestBuild) return null;
    const runningStep = (liveObservation?.executionSteps ?? [])
      .filter((step) => step.buildId === latestBuild.id && step.status === "running")
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
    const startedAt = Date.parse(
      runningStep?.startedAt ?? latestBuild.createdAt,
    );
    const elapsedMs = buildClockNow - startedAt;
    if (!Number.isFinite(startedAt) || elapsedMs < 0) return null;
    const phaseLabel: Record<string, string> = {
      source_waiting: "等待 AI 生成源码",
      source_repairing: "AI 正在修正源码",
      provider_sync_delayed: "同步 AI 进度",
      source_validating: "校验源码",
      compiling: "编译与质检网站",
      persisting_preview: "保存预览",
    };
    const stepLabel: Record<string, string> = {
      preparing: "准备构建任务",
      design_compiling: "生成设计方案",
      content_building: "生成页面内容",
      qa_running: "质量检查",
    };
    const stageText = (latestBuild.buildPhase && phaseLabel[latestBuild.buildPhase])
      ?? (runningStep && stepLabel[runningStep.stage])
      ?? (liveBuildStatus === "qa_running" ? "质量检查" : "正在生成网站");
    const expectedMs = 20 * 60_000;
    const percent = Math.max(
      3,
      Math.min(95, Math.round((elapsedMs / expectedMs) * 100)),
    );
    const minutes = Math.floor(elapsedMs / 60_000);
    const seconds = Math.floor((elapsedMs % 60_000) / 1_000);
    const elapsedText = minutes > 0
      ? `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`
      : `${seconds} 秒`;
    return { stageText, percent, elapsedText };
  }, [liveBuildInFlight, latestBuild, liveObservation?.executionSteps, liveBuildStatus, buildClockNow]);

  const livePublishEligible = Boolean(liveObservation
    && getWebsitePublishState(liveObservation, liveReleaseCoordinates?.target ?? "global_excluding_cn").eligible);

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
      const trustedCompanyName = brief.companyName.trim();
      const briefAssistantName = trustedCompanyName
        ? `${trustedCompanyName} AI 助手`
        : "企业知识助手";
      const nextAssistantName = designPreferences?.assistant.name
        ?? (firstHydrationForProject && isGenericAssistantIdentity(current.assistantName)
          ? briefAssistantName
          : current.assistantName);
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
    const brandKit = brief.brandKitV1;
    const visitorTask = brief.visitorTaskV1;
    const defaultEntryRoute = brief.routes.find(
      (route) => route.sourceDocumentIds.length > 0,
    )?.id ?? "";
    setWebsiteEvaluationInputsForm({
      logoAssetId: brandKit?.logo?.assetId ?? "",
      logoSha256: brandKit?.logo?.sha256 ?? "",
      primaryColor: brandKit?.primaryColor ?? "",
      secondaryColors: brandKit?.secondaryColors.join("\n") ?? "",
      fontPreferences: brandKit?.fontPreferences.join("\n") ?? "",
      toneKeywords: brandKit?.toneKeywords.join("\n") ?? "",
      forbiddenPhrases: brandKit?.forbiddenPhrases.join("\n") ?? "",
      visitorGoal: visitorTask?.goal ?? brief.conversionGoal,
      entryRouteId: visitorTask?.entryRouteId ?? defaultEntryRoute,
      successCriteria: visitorTask?.successCriteria.join("\n") ?? "",
      requiredRouteIds: visitorTask?.requiredRouteIds
        ?? (defaultEntryRoute ? [defaultEntryRoute] : []),
      assistantRequired: visitorTask?.assistantRequired ?? false,
      // Confirmation coordinates are never copied into the browser payload.
      // Their presence only proves the server previously confirmed this draft.
      visitorTaskConfirmed: Boolean(visitorTask),
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
    setHighestUnlockedStep((current) => current === BUILD_STEP_INDEX.evaluation
      ? BUILD_STEP_INDEX.design
      : current);
    setAssessmentRequest(null);
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

  useEffect(() => {
    if (!notice) return;
    toast.message(notice);
    setNotice("");
  }, [notice]);

  useEffect(() => {
    const message = siteOps?.notice?.trim() ?? "";
    if (!message || lastSiteOpsNoticeRef.current === message) return;
    lastSiteOpsNoticeRef.current = message;
    toast.message(message);
  }, [siteOps?.notice]);

  useEffect(() => {
    const message = (liveError || siteOps?.error || "").trim();
    if (!message) {
      lastErrorToastRef.current = "";
      return;
    }
    if (lastErrorToastRef.current === message) return;
    lastErrorToastRef.current = message;
    toast.error(message, siteOps?.onRefresh
      ? {
          action: {
            label: "重新载入",
            onClick: () => { void siteOps.onRefresh?.(); },
          },
        }
      : undefined);
  }, [liveError, siteOps?.error, siteOps?.onRefresh]);

  useEffect(() => {
    if (BUILD_STEP_INDEX[normalizedInitialStep] <= highestUnlockedStep) {
      setActiveStep(normalizedInitialStep);
    }
    // A newly completed assessment only unlocks the third step. It must not
    // navigate away from the design step by replaying the original prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedInitialStep]);
  useEffect(
    () => setFocusedSection(normalizeWebsiteDesignSection(initialSection)),
    [initialSection],
  );
  // Focus the most precise server-provided repair coordinate available.
  useEffect(() => {
    if (activeStep !== "design") return;
    const exactRoute = repairFocusTarget?.routeId
      ? Array.from(document.querySelectorAll<HTMLElement>("[data-route-id]"))
          .find((candidate) => candidate.dataset.routeId === repairFocusTarget.routeId)
      : null;
    const exactAnchor = repairFocusTarget?.anchor
      ? document.getElementById(repairFocusTarget.anchor)
      : null;
    const targetSection = normalizeWebsiteDesignSection(
      repairFocusTarget?.sectionId ?? focusedSection,
    );
    const node = exactRoute
      ?? exactAnchor
      ?? (targetSection
        ? document.querySelector<HTMLElement>(`[data-design-section="${targetSection}"]`)
        : null);
    if (!node) return;
    const disclosure = node instanceof HTMLDetailsElement
      ? node
      : node.closest("details");
    if (disclosure instanceof HTMLDetailsElement) disclosure.open = true;
    node.scrollIntoView?.({ behavior: "smooth", block: "center" });
    node.classList.add(exactRoute || exactAnchor ? "is-repair-focus" : "is-section-focus");
    const timer = window.setTimeout(() => {
      node.classList.remove("is-repair-focus");
      node.classList.remove("is-section-focus");
    }, 2_400);
    return () => {
      window.clearTimeout(timer);
      node.classList.remove("is-repair-focus");
      node.classList.remove("is-section-focus");
    };
  }, [activeStep, focusedSection, repairFocusTarget]);

  const persistCurrentDraft = useCallback(() => {
    const saved = saveWebsiteDraft({
      version: 2,
      updatedAt: Date.now(),
      confirmed: isConfirmed,
      completedStepIds: isLiveBuilder
        ? [
            ...(templateComplete ? ["template" as const] : []),
            ...(designComplete ? ["design" as const] : []),
          ]
        : completedStepIds,
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
    return saved;
  }, [assistantAccent, assistantFollowsSite, assistantName, assistantTested, completedStepIds, designComplete, isConfirmed, isLiveBuilder, pages, selectedTemplateId, siteAccent, siteGoal, siteName, storageScope, templateComplete, templateUrl, welcome]);

  useEffect(() => {
    persistCurrentDraft();
  }, [persistCurrentDraft]);

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
    setLocalEvaluationDraftDirty(true);
    const invalidated = new Set(stepIds);
    if (invalidated.has("template")) {
      setHighestUnlockedStep(0);
    } else if (invalidated.has("design")) {
      setHighestUnlockedStep((current) => current === 2 ? 1 : current);
    }
    if (invalidated.has("template") || invalidated.has("design")) {
      setAssessmentRequest(null);
    }
    setCompletedStepIds((current) => current.filter((step) => !invalidated.has(step)));
    setIsConfirmed(false);
  };

  const updateWebsiteEvaluationInputs = (
    next: Partial<WebsiteEvaluationInputsForm>,
    visitorTaskChanged = false,
  ) => {
    invalidateSteps("design");
    setWebsiteEvaluationInputsForm((current) => ({
      ...current,
      ...next,
      ...(visitorTaskChanged ? { visitorTaskConfirmed: false } : {}),
    }));
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

  const goTo = (step: BuildStep, section?: WebsiteDesignSection, unlock = false) => {
    if (!unlock && BUILD_STEP_INDEX[step] > highestUnlockedStep) {
      toast.message(step === "evaluation"
        ? "建设评估完成后即可进入第三步"
        : "请先完成模板选择");
      return;
    }
    if (unlock) {
      const targetIndex = BUILD_STEP_INDEX[step];
      setHighestUnlockedStep((current) => current < targetIndex ? targetIndex : current);
    }
    if (section) setFocusedSection(section);
    setActiveStep(step);
    setNotice("");
    onStepChange?.(step);
  };

  const saveCurrentDraft = async () => {
    if (draftSavePendingRef.current) return;
    draftSavePendingRef.current = true;
    setDraftSavePending(true);
    try {
      // Persist immediately, then keep the feedback state visible long enough
      // for the shared left-to-right shimmer to register perceptually.
      const saved = persistCurrentDraft();
      await new Promise<void>((resolve) => window.setTimeout(resolve, DRAFT_SAVE_FEEDBACK_MS));
      if (saved) {
        toast.success("草稿已保存");
      } else {
        toast.error("草稿暂时无法写入浏览器，本次页面中的修改仍会保留。");
      }
    } finally {
      draftSavePendingRef.current = false;
      setDraftSavePending(false);
    }
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

  const createWebsiteEvaluationInputsDraft = (): SiteWebsiteEvaluationInputsDraft => {
    if (!websiteEvaluationInputsForm.visitorTaskConfirmed) {
      throw new Error("请先确认核心访客任务，再开始生成或提交改版。");
    }
    const hasLogoCoordinate = Boolean(
      websiteEvaluationInputsForm.logoAssetId.trim()
      || websiteEvaluationInputsForm.logoSha256.trim(),
    );
    if (
      hasLogoCoordinate
      && (!websiteEvaluationInputsForm.logoAssetId.trim()
        || !websiteEvaluationInputsForm.logoSha256.trim())
    ) {
      throw new Error("Logo 坐标需要同时填写公开资产 ID 和 SHA-256。");
    }
    const hasBrandKit = Boolean(
      hasLogoCoordinate
      || websiteEvaluationInputsForm.primaryColor.trim()
      || websiteEvaluationInputsForm.secondaryColors.trim()
      || websiteEvaluationInputsForm.fontPreferences.trim()
      || websiteEvaluationInputsForm.toneKeywords.trim()
      || websiteEvaluationInputsForm.forbiddenPhrases.trim(),
    );
    const candidate = {
      brandKitV1: hasBrandKit
        ? {
            schemaVersion: 1 as const,
            ...(hasLogoCoordinate
              ? {
                  logo: {
                    assetId: websiteEvaluationInputsForm.logoAssetId.trim(),
                    sha256: websiteEvaluationInputsForm.logoSha256.trim().toLowerCase(),
                  },
                }
              : {}),
            ...(websiteEvaluationInputsForm.primaryColor.trim()
              ? { primaryColor: websiteEvaluationInputsForm.primaryColor.trim() }
              : {}),
            secondaryColors: splitEvaluationInputList(
              websiteEvaluationInputsForm.secondaryColors,
            ),
            fontPreferences: splitEvaluationInputList(
              websiteEvaluationInputsForm.fontPreferences,
            ),
            toneKeywords: splitEvaluationInputList(
              websiteEvaluationInputsForm.toneKeywords,
            ),
            forbiddenPhrases: splitEvaluationInputList(
              websiteEvaluationInputsForm.forbiddenPhrases,
            ),
          }
        : null,
      visitorTaskV1: {
        schemaVersion: 1 as const,
        goal: websiteEvaluationInputsForm.visitorGoal.trim(),
        entryRouteId: websiteEvaluationInputsForm.entryRouteId,
        successCriteria: splitEvaluationInputList(
          websiteEvaluationInputsForm.successCriteria,
        ),
        requiredRouteIds: websiteEvaluationInputsForm.requiredRouteIds,
        assistantRequired: websiteEvaluationInputsForm.assistantRequired,
      },
    };
    const parsed = siteWebsiteEvaluationInputsDraftSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues[0]?.message
          ? `建设评估输入无效：${parsed.error.issues[0].message}`
          : "建设评估输入无效，请检查访客任务和 Brand Kit。",
      );
    }
    return parsed.data;
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
      ...(websiteEvaluationRequired
        ? { websiteEvaluationInputs: createWebsiteEvaluationInputsDraft() }
        : {}),
    });
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
    if (websiteEvaluationRequired) {
      try {
        createWebsiteEvaluationInputsDraft();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "请先补全并确认核心访客任务。");
        return false;
      }
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
    if (websiteEvaluationRequired) {
      try {
        createWebsiteEvaluationInputsDraft();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "请先补全并确认核心访客任务。");
        return false;
      }
    }
    const submittedEditSequence = designEditSequenceRef.current;
    const submittedRevisionSequence = revisionEditSequenceRef.current;
    const submittedText = revisionText.trim();
    const submittedFiles = [...revisionFiles];
    const submissionStillCurrent = () =>
      designEditSequenceRef.current === submittedEditSequence
      && revisionEditSequenceRef.current === submittedRevisionSequence;
    setLiveAction("submit_revision");
    setLiveError(null);
    try {
      await saveLiveDesignPreferences();
      if (!submissionStillCurrent()) {
        setNotice("保存期间网站设计已更新；新内容已保留，请重新提交最新改版。");
        return false;
      }
      await siteOps.onSubmitRevision({
        text: submittedText || buildLiveSiteOpsRevisionMessage(),
        files: submittedFiles,
        onProgress: (index, percent) => setRevisionProgress((current) => {
          const next = [...current];
          next[index] = percent;
          return next;
        }),
      });
      if (!submissionStillCurrent()) {
        setNotice("改版任务提交期间网站设计已更新；当前页面不会将旧草稿标记完成，请重新提交最新设计。");
        return false;
      }
      liveBriefHydrationRef.current = {
        projectId: liveObservation.project.id,
        editSequence: submittedEditSequence,
      };
      setRevisionText("");
      setRevisionFiles([]);
      setRevisionProgress([]);
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
    if (activeStep === "template") {
      setCompletedStepIds((current) => current.includes("template")
        ? current
        : [...current, "template"]);
      goTo("design", undefined, true);
      return;
    }
    if (activeStep === "design" && highestUnlockedStep >= BUILD_STEP_INDEX.evaluation) {
      goTo("evaluation");
      return;
    }
    const nextAssessmentRequest: WebsiteAssessmentRequest = {
      baselineBuildId: currentWebsiteEvaluation?.buildId ?? latestBuild?.id ?? null,
      baselineReportId: currentWebsiteEvaluation?.reportId ?? null,
      acceptCurrentCompleted: Boolean(
        siteOps
        && currentWebsiteEvaluation?.status === "completed"
        && currentWebsiteEvaluation.reportId,
      ),
    };
    if (activeStep === "design" && siteOps && templateSelectionOpen) {
      // First real build: submit and stay until its automatic evaluation has
      // produced an immutable report. The third step remains locked meanwhile.
      const accepted = await submitLiveConfigurationAndBuild();
      if (!accepted) return;
      setAssessmentRequest({ ...nextAssessmentRequest, acceptCurrentCompleted: false });
      setNotice("网站已开始生成并将自动评估；评估完成后才会解锁第三步。");
      return;
    }
    if (activeStep === "design" && siteOps && liveRevisionEditable) {
      if (!designDraftSynced || hasRevisionRequirements) {
        const accepted = await submitLiveRevision();
        if (!accepted) return;
        setAssessmentRequest({ ...nextAssessmentRequest, acceptCurrentCompleted: false });
        setNotice("改版要求已提交；新版本评估完成后才会重新解锁第三步。");
        return;
      }
    }
    if (activeStep === "design" && siteOps && !templateSelectionOpen && !liveBuildCompleted) {
      setNotice(liveBuildInFlight ? "网站正在生成，构建与检查状态可在建设评估中查看。" : "网站尚未生成完成，请先完成网站生成。");
      return;
    }
    if (activeStep === "design" && !siteOps && !assistantTested) {
      // The offline demo keeps its illustrative trial gate.
      setNotice("请先在右侧统一预览中提问一次并得到回答，完成助手试用后再继续。");
      return;
    }
    if (activeStep !== "design") return;
    setCompletedStepIds((current) => current.includes("design")
      ? current
      : [...current, "design"]);
    if (siteOps) {
      setAssessmentRequest(nextAssessmentRequest);
      if (websiteEvaluationRunStatus === "failed" && onRetryWebsiteEvaluation) {
        onRetryWebsiteEvaluation();
        setNotice("已重新提交建设评估；完成前第三步保持锁定。");
      } else if (nextAssessmentRequest.acceptCurrentCompleted) {
        setNotice("当前网站版本已完成评估，正在解锁第三步。");
      } else {
        setNotice("已等待当前网站的自动评估；完成前第三步保持锁定。");
      }
      return;
    }
    if (!onReevaluateWebsiteEvaluation) {
      setNotice("当前本地预览未启用自动评估。");
      return;
    }
    setAssessmentRequest({ ...nextAssessmentRequest, acceptCurrentCompleted: false });
    setLocalReevaluatePending(true);
    try {
      await onReevaluateWebsiteEvaluation();
    } catch (error) {
      setAssessmentRequest(null);
      toast.error(error instanceof Error ? error.message : "建设评估未能开始，请重试。");
    } finally {
      setLocalReevaluatePending(false);
    }
  };

  const currentWebsiteEvaluation = authoritativeWebsiteEvaluation
    && websiteEvaluationVisible
    && (!siteOps || (latestBuild && authoritativeWebsiteEvaluation.buildId === latestBuild.id))
    ? authoritativeWebsiteEvaluation
    : null;
  const websiteEvaluationRunStatus: WebsiteEvaluationRunStatus = siteOps && !websiteEvaluationVisible
    ? "disabled"
    : ["failed", "attention_required", "cancelled"].includes(liveBuildStatus)
    ? "build_failed"
    : liveBuildInFlight
      ? "building"
      : currentWebsiteEvaluation?.status
        ?? (siteOps && latestBuild ? "not_evaluated" : "idle");
  const displayedWebsiteEvaluation = currentWebsiteEvaluation?.status === websiteEvaluationRunStatus
    ? currentWebsiteEvaluation
    : null;
  useEffect(() => {
    if (!assessmentRequest
      || websiteEvaluationRunStatus !== "completed"
      || !currentWebsiteEvaluation?.reportId) {
      return;
    }
    const completedFreshAssessment = assessmentRequest.acceptCurrentCompleted
      || currentWebsiteEvaluation.reportId !== assessmentRequest.baselineReportId
      || currentWebsiteEvaluation.buildId !== assessmentRequest.baselineBuildId;
    if (!completedFreshAssessment) return;
    setHighestUnlockedStep(BUILD_STEP_INDEX.evaluation);
    setCompletedStepIds((current) => {
      const next = new Set(current);
      next.add("template");
      next.add("design");
      return [...next];
    });
    setAssessmentRequest(null);
    setNotice("");
    setActiveStep("evaluation");
    onStepChange?.("evaluation");
    toast.success("建设评估已完成，正在查看结果");
  }, [
    assessmentRequest,
    currentWebsiteEvaluation?.buildId,
    currentWebsiteEvaluation?.reportId,
    onStepChange,
    websiteEvaluationRunStatus,
  ]);
  const recommendation = displayedWebsiteEvaluation?.verdict ?? "尚无权威评估";
  const failedBuildStep = [...(liveObservation?.executionSteps ?? [])]
    .filter((step) => step.buildId === latestBuild?.id
      && ["failed", "attention_required", "cancelled"].includes(step.status))
    .sort((left, right) => Date.parse(right.completedAt ?? right.startedAt)
      - Date.parse(left.completedAt ?? left.startedAt))[0];
  const buildFailureSummary = [
    failedBuildStep
      ? `${failedBuildStep.label}（${failedBuildStep.stage}）${failedBuildStep.status === "cancelled" ? "已取消" : "未完成"}`
      : null,
    liveError || siteOps?.error || siteOps?.notice || null,
  ].filter((item): item is string => Boolean(item)).join("；")
    || "网站构建没有形成可检查的完整版本，请返回设计步骤检查输入并重新生成。";
  const repairWebsiteEvaluationTarget = (target: WebsiteEvaluationRepairTarget) => {
    setRepairFocusTarget(target);
    if (target.kind === "knowledge") {
      onOpenRag?.();
      if (!onOpenRag) goTo("design", "pages");
      return;
    }
    if (target.kind === "assistant") {
      goTo("design", "assistant");
      return;
    }
    if (target.kind === "route") {
      goTo("design", "pages");
      return;
    }
    if (target.kind === "brand_kit") {
      goTo("design", "evaluation-inputs");
      return;
    }
    if (target.kind === "design_preferences") {
      goTo("design", "theme");
      return;
    }
    const section = normalizeWebsiteDesignSection(target.sectionId);
    goTo("design", section ?? undefined);
  };

  const openReleaseConfirmation = (target: WebsitePublishTarget = "global_excluding_cn") => {
    const publishState = liveObservation ? getWebsitePublishState(liveObservation, target) : null;
    if (siteOps && (!publishState?.eligible || liveInteractionPending || hasRevisionRequirements || !designDraftSynced)) {
      setNotice(liveInteractionPending ? "操作正在进行，请稍后重试。"
        : hasRevisionRequirements || !designDraftSynced ? "请先提交当前设计修改，等待新版本构建完成后再发布。"
          : publishState?.reason ?? "正在读取发布条件，请刷新后重试。");
      return;
    }
    if (siteOps) {
      if (!liveObservation || !latestBuild) return;
      const evaluation = websiteEvaluationVisible
        ? liveEvaluationDecisionContext(currentWebsiteEvaluation)
        : null;
      setLiveReleaseCoordinates({
        target,
        projectId: liveObservation.project.id,
        projectRevision: liveObservation.project.revision,
        knowledgeSnapshotId:
          liveObservation.project.currentKnowledgeSnapshotId ?? null,
        buildId: latestBuild.id,
        expectedHeadDeploymentId: publishState?.headDeploymentId ?? null,
        evaluationRunId: evaluation?.runId ?? null,
        evaluationReportId: evaluation?.reportId ?? null,
        evaluationReportHash: evaluation?.reportHash ?? null,
        evaluationMode: evaluation?.mode ?? null,
      });
      setReleaseAcknowledgedRiskIds([]);
      setReleaseReason("");
      setLiveReleaseOpen(true);
      return;
    }
    setNotice("本地候选不生成浏览器评分或发布决定；请连接服务端权威评估后再确认发布。");
  };

  const confirmReleaseDecision = async () => {
    if (siteOps) {
      const target = liveReleaseCoordinates?.target ?? "global_excluding_cn";
      const publishState = liveObservation ? getWebsitePublishState(liveObservation, target) : null;
      const currentEvaluation = websiteEvaluationVisible
        ? liveEvaluationDecisionContext(currentWebsiteEvaluation)
        : null;
      const currentCoordinates = liveObservation && latestBuild
        ? {
            target,
            projectId: liveObservation.project.id,
            projectRevision: liveObservation.project.revision,
            knowledgeSnapshotId:
              liveObservation.project.currentKnowledgeSnapshotId ?? null,
            buildId: latestBuild.id,
            expectedHeadDeploymentId: publishState?.headDeploymentId ?? null,
            evaluationRunId: currentEvaluation?.runId ?? null,
            evaluationReportId: currentEvaluation?.reportId ?? null,
            evaluationReportHash: currentEvaluation?.reportHash ?? null,
            evaluationMode: currentEvaluation?.mode ?? null,
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
        || !publishState?.eligible
        || liveInteractionPending
        || !designDraftSynced
        || hasRevisionRequirements
      ) {
        closeReleaseConfirmation();
        setNotice("真实发布条件已经变化，未提交请求也未写入成功审计；请返回检查状态。");
        return;
      }
      const missingAcknowledgement = currentEvaluation?.riskIds.some(
        (riskId) => !releaseAcknowledgedRiskIds.includes(riskId),
      ) ?? false;
      if (
        currentEvaluation
        && currentEvaluation.mode !== "follow_recommendation"
        && (missingAcknowledgement || !releaseReason.trim())
      ) {
        setNotice("请逐项确认当前风险并填写继续发布的理由。");
        return;
      }
      const evaluationDecision = currentEvaluation
        ? websiteBuildEvaluationDecisionSchema.parse({
            mode: currentEvaluation.mode,
            buildId: liveReleaseCoordinates.buildId,
            runId: currentEvaluation.runId,
            reportId: currentEvaluation.reportId,
            reportHash: currentEvaluation.reportHash,
            acknowledgedRiskIds: currentEvaluation.mode === "follow_recommendation"
              ? []
              : currentEvaluation.riskIds,
            reason: currentEvaluation.mode === "follow_recommendation"
              ? ""
              : releaseReason.trim(),
          })
        : null;
      const action = target === "mainland_cn" ? "publish_mainland" : "publish_global";
      const published = await runLiveAction(action, {
        action,
        input: {
          buildId: liveReleaseCoordinates.buildId,
          expectedHeadDeploymentId:
            liveReleaseCoordinates.expectedHeadDeploymentId ?? undefined,
          ...(evaluationDecision ? { evaluationDecision } : {}),
        },
      });
      if (!published) return;
      closeReleaseConfirmation();
      setNotice("服务端已原子受理发布与评估决定；部署结果将继续同步，尚不表示已经上线。");
      return;
    }
    setNotice("本地候选不会在浏览器记录发布决定。");
  };
  const currentLiveEvaluationDecision = websiteEvaluationVisible
    ? liveEvaluationDecisionContext(currentWebsiteEvaluation)
    : null;
  const liveReleaseRiskOptions = (currentLiveEvaluationDecision?.riskIds ?? []).map((riskId) => {
    if (riskId === "quality_recommendation") {
      return {
        id: riskId,
        title: "评估建议先修复",
        summary: "当前报告结论不是“推荐发布”。",
      };
    }
    if (riskId === "assessment_unavailable") {
      return {
        id: riskId,
        title: "评估结果不可用",
        summary: "当前评估尚未完成、已失败或没有不可变报告。",
      };
    }
    const risk = currentWebsiteEvaluation?.risks.find((item) => item.id === riskId);
    return {
      id: riskId,
      title: risk?.title ?? riskId,
      summary: risk?.summary ?? "该关键风险来自当前不可变评估报告。",
    };
  });
  const liveReleaseInformed = Boolean(
    currentLiveEvaluationDecision
    && currentLiveEvaluationDecision.mode !== "follow_recommendation",
  );
  const liveReleaseCanConfirm = !liveReleaseInformed || (
    liveReleaseRiskOptions.every((risk) => releaseAcknowledgedRiskIds.includes(risk.id))
    && Boolean(releaseReason.trim())
  );

  const assessmentAwaitingCompletion = Boolean(
    assessmentRequest
    && highestUnlockedStep < BUILD_STEP_INDEX.evaluation
    && !["failed", "build_failed", "disabled"].includes(websiteEvaluationRunStatus),
  );
  const designActionRunning = Boolean(
    liveAction === "configure_and_build"
    || liveAction === "submit_revision"
    || liveBuildInFlight
    || localReevaluatePending
    || assessmentAwaitingCompletion,
  );
  const liveDesignHasNewChanges = Boolean(
    liveRevisionEditable && (!designDraftSynced || hasRevisionRequirements),
  );
  const completedEvaluationAvailable = websiteEvaluationRunStatus === "completed"
    && Boolean(currentWebsiteEvaluation?.reportId);
  const designPrimaryMode: "generate" | "regenerate" | "evaluate" = highestUnlockedStep === BUILD_STEP_INDEX.evaluation
    && completedEvaluationAvailable
    ? "evaluate"
    : siteOps
      ? templateSelectionOpen
        ? "generate"
        : liveDesignHasNewChanges
          ? "regenerate"
          : completedEvaluationAvailable
            ? "evaluate"
            : "generate"
      : "generate";
  const workflowPrimaryLabel = activeStep === "template"
    ? "进入设计"
    : activeStep === "evaluation"
      ? "完成发布"
      : designActionRunning
        ? "正在生成"
        : designPrimaryMode === "generate"
          ? "开始评估"
          : designPrimaryMode === "regenerate"
            ? "重新生成"
            : "查看评估";
  const workflowPrimaryDisabled = activeStep === "template"
    ? !templateReady || Boolean(siteOps && liveInteractionPending)
    : activeStep === "evaluation"
      ? Boolean(siteOps && liveInteractionPending)
      : Boolean(
          designActionRunning
          || (designPrimaryMode !== "evaluate" && (!assistantReady || !brandReady || !structureReady))
          || (siteOps && (
            liveInteractionPending
            || (designPrimaryMode === "generate" && !templateSelectionOpen && !liveBuildCompleted)
          ))
        );
  const workflowPrimaryTestId = siteOps && activeStep === "design"
    ? designPrimaryMode === "generate" && templateSelectionOpen
      ? "website-build-start"
      : designPrimaryMode === "regenerate"
        ? "website-revision-submit"
        : undefined
    : undefined;

  const handleWebsiteResetAccepted = () => {
    setRevisionText("");
    setRevisionFiles([]);
    setRevisionProgress([]);
    revisionEditSequenceRef.current += 1;
    liveBriefHydrationRef.current = null;
    appliedLiveBriefKeyRef.current = null;
    setAssistantTested(false);
    setCompletedStepIds([]);
    setHighestUnlockedStep(BUILD_STEP_INDEX.template);
    setAssessmentRequest(null);
    setIsConfirmed(false);
    goTo("template");
  };

  const handleWorkflowBack = () => {
    if (activeStep === "evaluation") {
      goTo("design");
      return;
    }
    if (activeStep === "design") goTo("template");
  };

  const handleWorkflowPrimary = async () => {
    if (activeStep === "evaluation") {
      openReleaseConfirmation();
      return;
    }
    if (activeStep === "design" && designPrimaryMode === "evaluate") {
      if (completedEvaluationAvailable && highestUnlockedStep < BUILD_STEP_INDEX.evaluation) {
        setAssessmentRequest(null);
        setCompletedStepIds((current) => current.includes("design")
          ? current
          : [...current, "design"]);
        goTo("evaluation", undefined, true);
      } else {
        goTo("evaluation");
      }
      return;
    }
    await goNext();
  };

  const reevaluatePending = siteOps
    ? liveAction === "submit_revision" || liveBuildInFlight
    : localReevaluatePending;
  const reevaluateDisabledReason = reevaluatePending
    ? "正在生成新网站版本"
    : websiteEvaluationRunStatus !== "completed"
      ? "当前报告完成后才能重新评估"
      : siteOps
        ? !liveRevisionEditable
          ? "当前构建暂不支持重新评估"
          : !liveDesignHasNewChanges
            ? "请先修改网站内容或设置"
            : !structureReady || !brandReady || !assistantReady
              ? "请先补全页面、网站与助手设置"
              : websiteEvaluationRequired
                && (!visitorTaskDraftReady || !websiteEvaluationInputsForm.visitorTaskConfirmed)
                ? "请先确认核心访客任务"
                : null
        : !onReevaluateWebsiteEvaluation
          ? "当前本地预览未启用重新评估"
          : !localEvaluationDraftDirty
            ? "请先修改网站内容或设置"
            : null;

  const reevaluateWebsite = async () => {
    if (reevaluateDisabledReason) {
      toast.message(reevaluateDisabledReason);
      return;
    }
    if (siteOps) {
      await submitLiveRevision();
      return;
    }
    if (!onReevaluateWebsiteEvaluation) return;
    setLocalReevaluatePending(true);
    try {
      await onReevaluateWebsiteEvaluation();
      setLocalEvaluationDraftDirty(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重新评估未能开始，请重试。");
    } finally {
      setLocalReevaluatePending(false);
    }
  };

  return (
    <section
      className="sfp-root"
      data-step={activeStep}
      data-testid={siteOps ? "website-builder-live-root" : undefined}
    >
      <div className="sfp-workflow-row">
        <div className="sfp-workflow-leading-actions" role="group" aria-label="草稿与返回">
          <button
            type="button"
            className={`sfp-button sfp-button--primary sfp-workflow-save${draftSavePending ? " is-running" : ""}`}
            aria-busy={draftSavePending || undefined}
            disabled={draftSavePending}
            onClick={() => { void saveCurrentDraft(); }}
          >
            {draftSavePending ? "正在保存" : "保存"}
          </button>
          <button
            type="button"
            className="sfp-workflow-back sfp-button sfp-button--ghost"
            aria-label="返回"
            disabled={activeStep === "template"}
            onClick={handleWorkflowBack}
          >
            <ArrowLeft aria-hidden="true" size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="sfp-workspace-bar">
          <ol className="sfp-steps" aria-label="网站建设流程">
            {steps.map((step) => {
              const locked = BUILD_STEP_INDEX[step.id] > highestUnlockedStep;
              const stateClass = step.id === activeStep ? "is-active" : completedSteps[step.id] ? "is-done" : "";
              return (
              <li key={step.id} className={`${stateClass}${locked ? " is-locked" : ""}`} data-complete={completedSteps[step.id]}>
                <button type="button" disabled={locked} onClick={() => goTo(step.id)} aria-current={step.id === activeStep ? "step" : undefined}>
                  <span className="sfp-step-label"><strong>{step.label}</strong></span>
                </button>
              </li>
              );
            })}
          </ol>
        </div>
        <div className="sfp-workflow-actions" role="group" aria-label="网站流程操作">
          <button
            type="button"
            className={`sfp-button sfp-button--primary${activeStep === "design" && designActionRunning ? " is-running" : ""}`}
            data-testid={workflowPrimaryTestId}
            aria-busy={activeStep === "design" && designActionRunning || undefined}
            disabled={workflowPrimaryDisabled}
            onClick={() => { void handleWorkflowPrimary(); }}
          >
            {workflowPrimaryLabel}
          </button>
        </div>
      </div>

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
            {siteOps
              && liveObservation
              && liveObservation.rebuildRequest.allowed
              && !templateSelectionOpen
              && liveCandidates.length > 0
              && latestBuild
              && !liveBuildInFlight && (
              <div className="sfp-live-start" data-testid="siteops-template-catalog-refresh">
                <RefreshCw size={20} />
                <span>
                  <strong>当前展示的是本次制作已冻结的模板</strong>
                  <small>模板目录升级不会改写历史任务；重新开始后可从当前知识库载入最新版，已发布网站继续运行。</small>
                </span>
                <WebsiteRestartAction
                  siteOps={{ ...siteOps, interactionPending: liveInteractionPending }}
                  onResetAccepted={handleWebsiteResetAccepted}
                  triggerLabel="使用最新版模板"
                  dialogTitle="重新开始并使用最新版模板"
                  dialogDescription="这会清理当前未发布的制作任务、模板选择和未提交的修改，并返回当前知识库起点；之后重新载入模板时会使用当时可用的最新版目录。已经发布的网站继续运行，域名、备案和阿里云连接会保留。"
                  testId="siteops-template-catalog-refresh-action"
                />
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
          <div className={`sfp-workspace-grid${siteOps ? " sfp-workspace-grid--management" : ""}`}>
            <section className="sfp-panel sfp-builder-config-panel sfp-builder-config-panel--design">
              <div className="sfp-section-heading sfp-section-heading--compact">
                <div><h2>网站设计</h2></div>
              </div>
              <div className="sfp-design-section" data-design-section="site">
                <header><span>1</span><div><h3>网站基础</h3></div></header>
              <div className="sfp-brand-fields">
                <label className="sfp-brand-name">
                  <span className="sfp-field-heading">
                    <span className="sfp-field-title">网站名称</span>
                    {siteOps && recommendationFieldEdited.siteName && (
                      <small className="sfp-recommend-flag is-edited" data-testid="website-site-name-recommend-flag">
                        已修改
                        {canRestoreRecommendedField("siteName") && (
                          <button type="button" className="sfp-recommend-restore" aria-label="恢复推荐的网站名称" onClick={() => restoreRecommendedField("siteName")}>恢复推荐</button>
                        )}
                      </small>
                    )}
                  </span>
                  <input aria-label="网站名称" data-testid="website-site-name" maxLength={80} value={siteName} disabled={Boolean(siteOps && !liveConfigurationEditable)} onChange={(event) => { manuallyEditedRecommendationFieldsRef.current.add("siteName"); invalidateSteps("design"); setSiteName(event.currentTarget.value); }} />
                </label>
                <label className="sfp-brand-name">
                  <span className="sfp-field-heading">
                    <span className="sfp-field-title">站点简介 / 建站目标</span>
                    {siteOps && recommendationFieldEdited.siteGoal && (
                      <small className="sfp-recommend-flag is-edited" data-testid="website-site-goal-recommend-flag">
                        已修改
                        {canRestoreRecommendedField("siteGoal") && (
                          <button type="button" className="sfp-recommend-restore" aria-label="恢复推荐的建站目标" onClick={() => restoreRecommendedField("siteGoal")}>恢复推荐</button>
                        )}
                      </small>
                    )}
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
                </div>
              )}
              </div>

              <div className="sfp-design-section" data-design-section="pages">
                <header><span>2</span><div><h3>页面与栏目</h3></div></header>
                <div className="sfp-knowledge-summary" data-testid="website-design-knowledge-summary">
                  <FileText size={17} />
                  <span><strong>{siteOps ? liveObservation?.knowledgeSnapshots[0]?.label ?? "当前已发布知识库" : "当前 RAG 预览知识范围"}</strong>{!siteOps && <small>{previewKnowledgeCollectionCount} 个知识集合 · {previewKnowledgeFragmentCount} 个预览片段</small>}</span>
                </div>
                {siteOps && recommendationFieldEdited.featuredRoutes && (
                  <p className="sfp-recommend-row" data-testid="website-routes-recommend-flag">
                    <span>主栏目已手动调整</span>
                    {canRestoreRecommendedField("featuredRoutes") && (
                      <button type="button" className="sfp-recommend-restore" aria-label="恢复推荐的主栏目" onClick={() => restoreRecommendedField("featuredRoutes")}>恢复推荐</button>
                    )}
                  </p>
                )}
                <details className="sfp-page-disclosure">
                  <summary>共 {pages.length} 个栏目，{enabledPages.length} 个启用</summary>
              <div className="sfp-page-list">
                {pages.map((page, index) => (
                  <div key={page.id} data-route-id={page.id} className={!page.enabled ? "is-muted" : ""}>
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
                <header><span>3</span><div><h3>主题颜色</h3><p>{siteOps ? "提交生成后生效。" : "颜色实时预览。"}</p></div></header>
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
                      <span><strong>跟随网站主题色</strong></span>
                    </label>
                  </fieldset>
                </div>
              </div>

              <div className="sfp-design-section" data-design-section="assistant">
                <header><span>4</span><div><h3>助手设置</h3></div></header>
                <div className="sfp-form-grid">
                  <label><span className="sfp-field-heading"><span className="sfp-field-title">助手名称</span></span><input aria-label="助手名称" data-testid="website-assistant-name" maxLength={80} value={assistantName} disabled={Boolean(siteOps && !liveConfigurationEditable)} onChange={(event) => { invalidateSteps("design"); setAssistantName(event.currentTarget.value); setAssistantTested(false); }} /></label>
                  <label className="sfp-welcome-field"><span className="sfp-field-heading"><span className="sfp-field-title">欢迎语</span></span><textarea aria-label="欢迎语" data-testid="website-assistant-welcome" maxLength={500} value={welcome} disabled={Boolean(siteOps && !liveConfigurationEditable)} onChange={(event) => { invalidateSteps("design"); setWelcome(event.currentTarget.value); setAssistantTested(false); }} /></label>
                </div>
                {!siteOps && <div className={`sfp-assistant-trial ${assistantTested ? "is-done" : ""}`}>
                  {assistantTested ? <Check size={17} /> : <CircleAlert size={17} />}
                  <span>
                    <strong>{assistantTested ? "助手试用已完成" : "助手试用未完成"}</strong>
                    <small>{assistantTested
                      ? "已在右侧预览中完成一次问答；修改名称或欢迎语后需重新试用。"
                      : "请在右侧预览中提问一次并得到回答，再进入建设评估。"}</small>
                  </span>
                </div>}
              </div>

              {siteOps && websiteEvaluationRequired && (
                <div className="sfp-design-section sfp-evaluation-inputs" data-design-section="evaluation-inputs">
                  <header>
                    <span>5</span>
                    <div>
                      <h3>建设评估输入</h3>
                      <p>Brand Kit 可选；核心访客任务必须确认，与下一次构建一起冻结。</p>
                    </div>
                  </header>
                  <details className="sfp-evaluation-inputs__group">
                    <summary>Brand Kit（可选）</summary>
                    <div className="sfp-form-grid sfp-evaluation-inputs__fields">
                      <label>
                        <span className="sfp-field-heading"><span className="sfp-field-title">公开 Logo 资产 ID</span></span>
                        <input
                          aria-label="公开 Logo 资产 ID"
                          list="website-public-logo-assets"
                          maxLength={191}
                          value={websiteEvaluationInputsForm.logoAssetId}
                          disabled={!liveConfigurationEditable}
                          onChange={(event) => updateWebsiteEvaluationInputs({ logoAssetId: event.currentTarget.value })}
                        />
                        <datalist id="website-public-logo-assets">
                          {(liveObservation?.brief?.publicAssetIds ?? []).map((assetId) => (
                            <option key={assetId} value={assetId} />
                          ))}
                        </datalist>
                      </label>
                      <label>
                        <span className="sfp-field-heading"><span className="sfp-field-title">Logo SHA-256</span></span>
                        <input
                          aria-label="Logo SHA-256"
                          maxLength={64}
                          value={websiteEvaluationInputsForm.logoSha256}
                          disabled={!liveConfigurationEditable}
                          onChange={(event) => updateWebsiteEvaluationInputs({ logoSha256: event.currentTarget.value })}
                        />
                      </label>
                      <label>
                        <span className="sfp-field-heading"><span className="sfp-field-title">主品牌色</span></span>
                        <input
                          aria-label="主品牌色"
                          placeholder="#6f35a5"
                          maxLength={7}
                          value={websiteEvaluationInputsForm.primaryColor}
                          disabled={!liveConfigurationEditable}
                          onChange={(event) => updateWebsiteEvaluationInputs({ primaryColor: event.currentTarget.value })}
                        />
                      </label>
                      <label>
                        <span className="sfp-field-heading"><span className="sfp-field-title">辅助色</span></span>
                        <textarea
                          aria-label="辅助色"
                          placeholder="每行一个六位色值"
                          value={websiteEvaluationInputsForm.secondaryColors}
                          disabled={!liveConfigurationEditable}
                          onChange={(event) => updateWebsiteEvaluationInputs({ secondaryColors: event.currentTarget.value })}
                        />
                      </label>
                      <label>
                        <span className="sfp-field-heading"><span className="sfp-field-title">字体偏好</span></span>
                        <textarea
                          aria-label="字体偏好"
                          placeholder="每行一个字体"
                          value={websiteEvaluationInputsForm.fontPreferences}
                          disabled={!liveConfigurationEditable}
                          onChange={(event) => updateWebsiteEvaluationInputs({ fontPreferences: event.currentTarget.value })}
                        />
                      </label>
                      <label>
                        <span className="sfp-field-heading"><span className="sfp-field-title">语调关键词</span></span>
                        <textarea
                          aria-label="语调关键词"
                          placeholder="专业、克制、清晰"
                          value={websiteEvaluationInputsForm.toneKeywords}
                          disabled={!liveConfigurationEditable}
                          onChange={(event) => updateWebsiteEvaluationInputs({ toneKeywords: event.currentTarget.value })}
                        />
                      </label>
                      <label className="sfp-evaluation-inputs__wide">
                        <span className="sfp-field-heading"><span className="sfp-field-title">禁用表达</span></span>
                        <textarea
                          aria-label="禁用表达"
                          placeholder="每行一条"
                          value={websiteEvaluationInputsForm.forbiddenPhrases}
                          disabled={!liveConfigurationEditable}
                          onChange={(event) => updateWebsiteEvaluationInputs({ forbiddenPhrases: event.currentTarget.value })}
                        />
                      </label>
                    </div>
                  </details>
                  <fieldset className="sfp-evaluation-inputs__group">
                    <legend>核心访客任务（必填）</legend>
                    <div className="sfp-form-grid sfp-evaluation-inputs__fields">
                      <label className="sfp-evaluation-inputs__wide">
                        <span className="sfp-field-heading"><span className="sfp-field-title">任务目标</span></span>
                        <textarea
                          aria-label="核心访客任务目标"
                          maxLength={500}
                          value={websiteEvaluationInputsForm.visitorGoal}
                          disabled={!liveConfigurationEditable}
                          onChange={(event) => updateWebsiteEvaluationInputs({ visitorGoal: event.currentTarget.value }, true)}
                        />
                      </label>
                      <label>
                        <span className="sfp-field-heading"><span className="sfp-field-title">入口路由</span></span>
                        <select
                          aria-label="核心访客任务入口路由"
                          value={websiteEvaluationInputsForm.entryRouteId}
                          disabled={!liveConfigurationEditable}
                          onChange={(event) => {
                            const entryRouteId = event.currentTarget.value;
                            updateWebsiteEvaluationInputs({
                              entryRouteId,
                              requiredRouteIds: entryRouteId
                                ? Array.from(new Set([
                                    entryRouteId,
                                    ...websiteEvaluationInputsForm.requiredRouteIds,
                                  ]))
                                : websiteEvaluationInputsForm.requiredRouteIds,
                            }, true);
                          }}
                        >
                          <option value="">请选择</option>
                          {pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
                        </select>
                      </label>
                      <label>
                        <span className="sfp-field-heading"><span className="sfp-field-title">成功条件</span></span>
                        <textarea
                          aria-label="核心访客任务成功条件"
                          placeholder="每行一条"
                          maxLength={4_000}
                          value={websiteEvaluationInputsForm.successCriteria}
                          disabled={!liveConfigurationEditable}
                          onChange={(event) => updateWebsiteEvaluationInputs({ successCriteria: event.currentTarget.value }, true)}
                        />
                      </label>
                    </div>
                    <fieldset className="sfp-evaluation-inputs__routes">
                      <legend>必经路由</legend>
                      {pages.map((page) => (
                        <label key={page.id}>
                          <input
                            type="checkbox"
                            checked={websiteEvaluationInputsForm.requiredRouteIds.includes(page.id)}
                            disabled={!liveConfigurationEditable || page.id === websiteEvaluationInputsForm.entryRouteId}
                            onChange={(event) => updateWebsiteEvaluationInputs({
                              requiredRouteIds: event.currentTarget.checked
                                ? Array.from(new Set([...websiteEvaluationInputsForm.requiredRouteIds, page.id]))
                                : websiteEvaluationInputsForm.requiredRouteIds.filter((routeId) => routeId !== page.id),
                            }, true)}
                          />
                          <span>{page.name}</span>
                        </label>
                      ))}
                    </fieldset>
                    <label className="sfp-evaluation-inputs__toggle">
                      <input
                        type="checkbox"
                        checked={websiteEvaluationInputsForm.assistantRequired}
                        disabled={!liveConfigurationEditable}
                        onChange={(event) => updateWebsiteEvaluationInputs({ assistantRequired: event.currentTarget.checked }, true)}
                      />
                      <span>核心任务必须使用 AI 助手</span>
                    </label>
                    <label className="sfp-evaluation-inputs__confirm">
                      <input
                        type="checkbox"
                        aria-label="确认核心访客任务"
                        checked={websiteEvaluationInputsForm.visitorTaskConfirmed}
                        disabled={!liveConfigurationEditable || !visitorTaskDraftReady}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          invalidateSteps("design");
                          setWebsiteEvaluationInputsForm((current) => ({
                            ...current,
                            visitorTaskConfirmed: checked,
                          }));
                        }}
                      />
                      <span>
                        <strong>我已核对任务目标、入口、成功条件与必经路由</strong>
                        <small>服务端会在保存时生成确认坐标；浏览器不会伪造确认时间或用户 ID。</small>
                      </span>
                    </label>
                  </fieldset>
                </div>
              )}
            </section>
            {siteOps ? (
              <section className="sfp-panel sfp-builder-tools-panel" aria-label="建站管理">
                <div className="sfp-section-heading sfp-section-heading--compact">
                  <div><h2>建站管理</h2></div>
                </div>
              {siteOps && liveBuildProgress && (
                <div
                  className="sfp-build-progress"
                  data-testid="siteops-build-progress"
                  role="progressbar"
                  aria-label="真实网站构建进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={liveBuildProgress.percent}
                >
                  <span className="sfp-build-progress__track"><i style={{ width: `${liveBuildProgress.percent}%` }} /></span>
                  <span className="sfp-build-progress__meta">
                    <strong>{liveBuildProgress.stageText}</strong>
                    <small>已进行 {liveBuildProgress.elapsedText} · 预计约 20 分钟</small>
                  </span>
                </div>
              )}
                <div className="sfp-assistant-test-action">
                  <div className={`sfp-assistant-trial ${assistantTested ? "is-done" : ""}`}>
                    {assistantTested ? <Check size={17} /> : <CircleAlert size={17} />}
                    <span>
                      <strong>{assistantTested ? "助手试用已完成" : "助手试用未完成"}</strong>
                      {!embeddableBuild
                        ? <small>网站生成后可试用。</small>
                        : !embedTrialBinding
                          ? <small>可试用已有版本；当前设计生成后再记录结果。</small>
                          : !assistantTested ? <small>可选，不影响评估。</small> : null}
                    </span>
                  </div>
                  <button type="button" className="sfp-button sfp-button--ghost" disabled={!embeddableBuild} onClick={() => setAssistantTrialOpen(true)}>
                    <Bot size={16} /> 试用 AI 助手
                  </button>
                </div>
              {siteOps && latestBuild && (
                <WebsiteRevisionFields
                  text={revisionText}
                  files={revisionFiles}
                  progress={revisionProgress}
                  disabled={!liveRevisionEditable || liveInteractionPending}
                  onChange={(text, files) => {
                    revisionEditSequenceRef.current += 1;
                    setRevisionText(text);
                    setRevisionFiles(files);
                    setRevisionProgress([]);
                    setAssistantTested(false);
                    invalidateSteps("design");
                  }}
                />
              )}
              {siteOps && <WebsiteDomainPublishPanel siteOps={siteOps} onRequestPublish={openReleaseConfirmation} disabled={liveInteractionPending} publishBlockedReason={hasRevisionRequirements || Boolean(latestBuild?.previewUrl && !designDraftSynced) ? "请先提交设计修改，等待新版本构建完成后再发布。" : undefined} />}
              {siteOps && <WebsiteOperationHistory siteOps={{ ...siteOps, interactionPending: liveInteractionPending }} onResetAccepted={handleWebsiteResetAccepted} />}
              </section>
            ) : (
              <section className="sfp-preview-panel sfp-builder-preview-panel" aria-label="网站与助手统一预览" data-testid="website-design-preview">
                <div className="sfp-preview-heading"><span><strong>知识驱动统一预览</strong><small>{selectedTemplate.name} · {enabledPages.length} 个主栏目</small></span><DevicePicker device={device} onChange={setDevice} /></div>
                <MiniSitePreview
                  assistantInteractive={!siteOps}
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
              </section>
            )}
          </div>
        )}

        {activeStep === "evaluation" && (
          <WebsiteEvaluationWorkspace
            status={websiteEvaluationRunStatus}
            score={websiteEvaluationRunStatus === "completed" ? displayedWebsiteEvaluation?.score ?? null : null}
            verdict={recommendation}
            summary={websiteEvaluationRunStatus === "build_failed"
              ? buildFailureSummary
              : displayedWebsiteEvaluation?.summary ?? "服务端权威报告尚未就绪；浏览器不会代为计分。"}
            reportId={displayedWebsiteEvaluation?.reportId ?? null}
            reportUrl={displayedWebsiteEvaluation?.reportUrl ?? null}
            evidenceUpdatedLabel={displayedWebsiteEvaluation?.evidenceUpdatedLabel
              ?? (latestBuild?.createdAt
              ? new Date(latestBuild.createdAt).toLocaleString("zh-CN")
              : "尚无可确认的证据更新时间")}
            judgmentCoverage={displayedWebsiteEvaluation?.judgmentCoverage ?? 0}
            dimensions={displayedWebsiteEvaluation?.dimensions ?? []}
            risks={displayedWebsiteEvaluation?.risks ?? []}
            technicalChecks={configurationChecks}
            history={displayedWebsiteEvaluation?.history ?? []}
            historyHasMore={displayedWebsiteEvaluation?.historyHasMore}
            historyLoadingMore={displayedWebsiteEvaluation?.historyLoadingMore}
            reviews={displayedWebsiteEvaluation?.reviews}
            reviewsLoading={displayedWebsiteEvaluation?.reviewsLoading}
            reviewsError={displayedWebsiteEvaluation?.reviewsError}
            legacyReports={legacyWebsiteReports}
            onRepairTarget={repairWebsiteEvaluationTarget}
            onRetry={onRetryWebsiteEvaluation}
            onReevaluate={reevaluateWebsite}
            reevaluatePending={reevaluatePending}
            reevaluateDisabledReason={reevaluateDisabledReason}
            onLoadMoreHistory={onLoadMoreWebsiteEvaluationHistory}
            onManualReview={onSubmitWebsiteEvaluationReview}
          />
        )}
      </div>

      {siteOps && assistantTrialOpen && embeddableBuild && (
        <div className="sfp-release-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAssistantTrial(); }}>
          <section ref={assistantTrialDialogRef} className="sfp-release-dialog sfp-assistant-trial-dialog" role="dialog" aria-modal="true" aria-label="试用 AI 助手" tabIndex={-1}>
            <button type="button" className="sfp-release-dialog__close" aria-label="关闭助手试用" onClick={closeAssistantTrial}><X size={18} /></button>
            <h2>试用 AI 助手</h2>
            <p>在网站右下角打开助手，发送问题并查看真实回答及来源。</p>
            <SiteOpsBuildEmbedPreview build={embeddableBuild} device="desktop" expectedTrialBinding={embedTrialBinding} onTrialComplete={handleRealTrialComplete} routes={embedRoutes} />
          </section>
        </div>
      )}
      {liveReleaseOpen && (
        <div className="sfp-release-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeReleaseConfirmation(); }}>
          <section ref={releaseDialogRef} className="sfp-release-dialog" role="dialog" aria-modal="true" aria-label="发布确认" tabIndex={-1}>
            <button type="button" className="sfp-release-dialog__close" aria-label="关闭发布确认" onClick={closeReleaseConfirmation}><X size={18} /></button>
            <small>发布与评估决定将由服务端原子记录</small>
            <h2>确认是否继续发布</h2>
            {siteOps && (
              <>
                <p>
                  {!currentLiveEvaluationDecision
                    ? "当前项目未向用户启用建设评估，本次继续使用原有技术发布门禁。"
                    : currentLiveEvaluationDecision.mode === "follow_recommendation"
                    ? "当前不可变报告结论为“推荐发布”。"
                    : currentLiveEvaluationDecision.mode === "accepted_risk"
                      ? "当前不可变报告结论为“修复后发布”或“暂缓发布”；如继续发布，需要逐项确认风险并说明理由。"
                      : "当前没有可用的不可变评估报告；如继续发布，需要明确确认评估不可用并说明理由。"}
                </p>
                <dl>
                  <div><dt>发布目标</dt><dd>{liveReleaseCoordinates?.target === "mainland_cn" ? "中国大陆站点" : "海外站点"} · 构建 #{latestBuild?.ordinal}</dd></div>
                  <div>
                    <dt>网站评估</dt>
                    <dd>
                      {currentLiveEvaluationDecision?.reportId && currentWebsiteEvaluation
                        ? `${currentWebsiteEvaluation.score}/100 · ${currentWebsiteEvaluation.verdict}`
                        : "当前无可用报告"}
                    </dd>
                  </div>
                  {currentLiveEvaluationDecision && (
                    <div><dt>评估坐标</dt><dd>{currentLiveEvaluationDecision.reportId ?? "assessment_unavailable"}</dd></div>
                  )}
                </dl>
                {liveReleaseRiskOptions.length > 0 && (
                  <fieldset className="sfp-release-acknowledgements">
                    <legend>需要逐项确认</legend>
                    {liveReleaseRiskOptions.map((risk) => (
                      <label key={risk.id}>
                        <input
                          type="checkbox"
                          aria-label={`确认风险：${risk.title}`}
                          checked={releaseAcknowledgedRiskIds.includes(risk.id)}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked;
                            setReleaseAcknowledgedRiskIds((current) => checked
                              ? Array.from(new Set([...current, risk.id]))
                              : current.filter((riskId) => riskId !== risk.id));
                          }}
                        />
                        <span><strong>{risk.title}</strong><small>{risk.summary}</small></span>
                      </label>
                    ))}
                  </fieldset>
                )}
                {liveReleaseInformed && (
                  <label className="sfp-release-reason">
                    <span>继续发布理由</span>
                    <textarea
                      aria-label="继续发布理由"
                      maxLength={2_000}
                      value={releaseReason}
                      onChange={(event) => setReleaseReason(event.currentTarget.value)}
                    />
                  </label>
                )}
              </>
            )}
            <div className="sfp-release-note"><CircleAlert size={18} /><span>继续会提交{liveReleaseCoordinates?.target === "mainland_cn" ? "中国大陆" : "海外"}站点发布；服务端会重新检查构建、报告哈希、部署头和技术门禁。</span></div>
            <div className="sfp-release-dialog__actions">
              <button type="button" className="sfp-button sfp-button--ghost" onClick={closeReleaseConfirmation}>返回网站设计</button>
              <button type="button" className="sfp-button sfp-button--primary" disabled={Boolean(liveInteractionPending || !livePublishEligible || !designDraftSynced || !liveReleaseCanConfirm)} onClick={confirmReleaseDecision}>{liveAction === "publish_global" || liveAction === "publish_mainland" ? "正在提交真实发布…" : liveReleaseInformed ? "确认风险并继续发布" : "确认继续发布"}</button>
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
