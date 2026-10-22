import { useState } from "react";
import { Globe2 } from "lucide-react";
import {
  requestWorkspaceNavigation,
  useWorkspaceDraftGuard,
} from "../../host";
import { websitePreviewFixture } from "./fixtures";
import { FlowNavigation, LocalOnlyBadge } from "./preview-components";
import type {
  AiWebsitePreviewPage,
  WebsiteDraft,
  WebsitePreviewFixture,
} from "./types";
import { WebsiteEditorPreview } from "./WebsiteEditorPreview";
import { WebsiteWorkbenchPreview } from "./WebsiteWorkbenchPreview";
import "./ai-website-preview.css";

const WEBSITE_PREVIEW_STORAGE_PREFIX = "frontmind.aiWebsite.preview.v1";

function websitePreviewStorageKey(fixture: WebsitePreviewFixture) {
  return `${WEBSITE_PREVIEW_STORAGE_PREFIX}.${encodeURIComponent(fixture.customer.projectName)}.${fixture.versions.draft}.websiteDraft`;
}

function websiteDraftsEqual(left: WebsiteDraft, right: WebsiteDraft) {
  return (
    left.heroTitle === right.heroTitle &&
    left.heroDescription === right.heroDescription &&
    left.callToAction === right.callToAction &&
    left.callToActionTarget === right.callToActionTarget &&
    left.accent === right.accent
  );
}

function readSavedWebsiteDraft(fixture: WebsitePreviewFixture): WebsiteDraft {
  if (typeof window === "undefined") return fixture.site.defaultDraft;
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(websitePreviewStorageKey(fixture)) ?? "null",
    );
    if (
      value &&
      typeof value === "object" &&
      "heroTitle" in value && typeof value.heroTitle === "string" &&
      "heroDescription" in value && typeof value.heroDescription === "string" &&
      "callToAction" in value && typeof value.callToAction === "string" &&
      "callToActionTarget" in value && typeof value.callToActionTarget === "string" &&
      "accent" in value && typeof value.accent === "string"
    ) {
      return value as WebsiteDraft;
    }
  } catch {
    // A damaged preview cache must never prevent the local workbench opening.
  }
  return fixture.site.defaultDraft;
}

export type WebsiteManagementPreviewProps = {
  page?: AiWebsitePreviewPage;
  initialPage?: AiWebsitePreviewPage;
  onPageChange?: (page: AiWebsitePreviewPage) => void;
  fixture?: WebsitePreviewFixture;
  className?: string;
  embedded?: boolean;
};

export function WebsiteManagementPreview({
  page,
  initialPage = "workbench",
  onPageChange,
  fixture = websitePreviewFixture,
  className = "",
  embedded = false,
}: WebsiteManagementPreviewProps) {
  const [internalPage, setInternalPage] =
    useState<AiWebsitePreviewPage>(initialPage);
  const [draft, setDraft] = useState<WebsiteDraft>(() => readSavedWebsiteDraft(fixture));
  const [savedDraft, setSavedDraft] = useState<WebsiteDraft>(() => readSavedWebsiteDraft(fixture));
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const activePage = page ?? internalPage;
  const evaluationStale = !websiteDraftsEqual(
    savedDraft,
    fixture.site.defaultDraft,
  );

  const navigate = (nextPage: AiWebsitePreviewPage) => {
    requestWorkspaceNavigation(() => {
      if (nextPage === "workbench" && hasUnsavedChanges) {
        setDraft(savedDraft);
        setHasUnsavedChanges(false);
      }
      if (page === undefined) {
        setInternalPage(nextPage);
      }
      onPageChange?.(nextPage);
    });
  };

  const updateDraft = (nextDraft: WebsiteDraft) => {
    setDraft(nextDraft);
    setHasUnsavedChanges(true);
  };

  const saveDraft = () => {
    setSavedDraft(draft);
    setHasUnsavedChanges(false);
    try {
      window.localStorage.setItem(websitePreviewStorageKey(fixture), JSON.stringify(draft));
    } catch {
      // The in-memory preview remains usable when storage is unavailable.
    }
    return true;
  };

  const discardDraft = () => {
    setDraft(savedDraft);
    setHasUnsavedChanges(false);
    return true;
  };

  useWorkspaceDraftGuard({
    dirty: hasUnsavedChanges,
    label: "AI 官网本地预览草稿",
    save: async () => saveDraft(),
    discard: async () => discardDraft(),
  });

  return (
    <section
      className={`ai-website-preview ${className}`.trim()}
      data-preview-page={activePage}
    >
      {!embedded && (
        <header className="awp-module-header">
          <div>
            <span className="awp-module-header__icon">
              <Globe2 aria-hidden="true" size={18} />
            </span>
            <span>
              <strong>AI 专用官网</strong>
              <small>网站管理预开发</small>
            </span>
          </div>
          <LocalOnlyBadge />
        </header>
      )}

      <FlowNavigation
        activePage={activePage}
        fixture={fixture}
        onNavigate={navigate}
      />

      {activePage === "workbench" ? (
        <WebsiteWorkbenchPreview
          draft={savedDraft}
          evaluationStale={evaluationStale}
          fixture={fixture}
          onNavigate={navigate}
        />
      ) : (
        <WebsiteEditorPreview
          draft={draft}
          evaluationStale={evaluationStale}
          fixture={fixture}
          hasUnsavedChanges={hasUnsavedChanges}
          onDraftChange={updateDraft}
          onNavigate={navigate}
          onSave={saveDraft}
        />
      )}
    </section>
  );
}

