export type AiWebsitePreviewPage = "workbench" | "editor";

export type WebsitePreviewDevice = "desktop" | "mobile";

export type WebsiteEditorTab = "content" | "style";

export type WebsiteDraft = {
  heroTitle: string;
  heroDescription: string;
  callToAction: string;
  callToActionTarget: string;
  accent: string;
};

export type WebsiteEvaluationDimension = {
  id: string;
  label: string;
  score: number;
  weight: number;
};

export type WebsiteFlowStep = {
  id: string;
  number?: string;
  label: string;
  detail: string;
  previewPage?: AiWebsitePreviewPage;
};

export type WebsiteTreePage = {
  id: string;
  label: string;
  sections: ReadonlyArray<{ id: string; label: string }>;
};

export type WebsitePreviewFixture = {
  customer: {
    projectName: string;
    shortName: string;
    wordmark: string;
    industry: string;
  };
  versions: {
    draft: string;
    online: string;
    knowledge: string;
    evaluationRule: string;
  };
  timestamps: {
    draftSaved: string;
    evaluated: string;
    lastPublished: string;
  };
  site: {
    displayDomain: string;
    pageCount: number;
    navigation: ReadonlyArray<string>;
    eyebrow: string;
    trustPoints: ReadonlyArray<string>;
    serviceCards: ReadonlyArray<{
      number: string;
      title: string;
      description: string;
    }>;
    defaultDraft: WebsiteDraft;
  };
  evaluation: {
    score: number;
    coverage: number;
    pendingWeight: number;
    pendingCriticalItems: number;
    suggestedThreshold: number;
    dimensions: ReadonlyArray<WebsiteEvaluationDimension>;
  };
  flow: ReadonlyArray<WebsiteFlowStep>;
  pages: ReadonlyArray<WebsiteTreePage>;
};

