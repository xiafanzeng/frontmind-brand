export type PreviewModuleTarget =
  | "enterprise-qa"
  | "website"
  | "widget-config"
  | "widget-test"
  | "widget-evaluation"
  | "widget-runtime";

export type EvaluationDimension = {
  readonly id: string;
  readonly label: string;
  readonly earned: number;
  readonly total: number;
};

export type KnowledgeSource = {
  readonly id: "identity" | "services";
  readonly marker: number;
  readonly title: string;
  readonly description: string;
  readonly location: string;
  readonly excerpt: string;
};

export type WidgetTheme = {
  readonly id: "purple" | "moss" | "blue";
  readonly label: string;
  readonly color: string;
};

export type WidgetDraft = {
  name: string;
  welcome: string;
  suggestions: [string, string, string];
  themeId: WidgetTheme["id"];
  enabled: boolean;
  showReferences: boolean;
};

const evaluationDisclaimer =
  "本页分数、权重与门槛均为本地设计示例，不代表线上检测结果。";

export const qaWidgetFixture = {
  product: {
    name: "FrontMind",
    moduleName: "AI 专用官网",
    designVersion: "第一版预开发",
  },
  customer: {
    projectName: "东莞台心医美",
    assistantName: "台心企业助手",
    organization:
      "台心医美为东莞台心医院（医学美容科）旗下的医学美容中心。",
    domain: "taixin.example.com",
  },
  versions: {
    sessionKnowledge: "v1",
    latestKnowledge: "v2",
    widgetDraft: "w03",
    widgetLive: "w02",
    websitePage: "v03",
    qaRule: "Q1",
    widgetRule: "WG1",
    widgetTestSet: "T1",
  },
  qa: {
    sessionId: "S-032",
    answerId: "A-032",
    updatedAt: "今天 14:32",
    question: "请介绍机构、主要服务，以及如何预约咨询。",
    title: "了解台心医美，从机构与服务开始",
    services: ["整形美容", "皮肤美容", "无创美容", "植发养护"],
    missingKnowledge:
      "当前资料尚未确认预约入口，暂不提供具体电话或链接。需要补充经确认的预约渠道，才能完整回答这部分问题。",
    evaluation: {
      score: 94,
      coverage: 100,
      checkedUnits: "15 / 15",
      label: "示例评分",
      summary: "依据清楚，仍可补全",
      pendingItems: 1,
      evaluatedAt: "今天 14:36",
      disclaimer: evaluationDisclaimer,
      dimensions: [
        { id: "facts", label: "事实有据", earned: 40, total: 40 },
        { id: "coverage", label: "问题覆盖", earned: 24, total: 30 },
        { id: "traceability", label: "引用可追溯", earned: 20, total: 20 },
        { id: "boundary", label: "回答边界", earned: 10, total: 10 },
      ] satisfies readonly EvaluationDimension[],
    },
    sources: [
      {
        id: "identity",
        marker: 1,
        title: "企业身份总览",
        description: "机构名称、所属主体与服务定位",
        location: "公开资料 · § 1.1",
        excerpt:
          "台心医美为东莞台心医院（医学美容科）旗下的医学美容中心。",
      },
      {
        id: "services",
        marker: 2,
        title: "服务介绍与咨询须知",
        description: "服务方向与具体方案的咨询边界",
        location: "公开资料 · § 2.1–2.2",
        excerpt:
          "服务方向包括整形美容、皮肤美容、无创美容及植发养护。具体服务方案需由专业人员结合实际情况评估。",
      },
    ] satisfies readonly KnowledgeSource[],
  },
  widget: {
    defaultDraft: {
      name: "台心企业助手",
      welcome:
        "您好，欢迎了解台心医美。\n我可以帮您查询机构介绍、服务信息与就诊流程。",
      suggestions: [
        "如何了解机构服务？",
        "就诊前需要准备什么？",
        "如何预约咨询？",
      ],
      themeId: "purple",
      enabled: true,
      showReferences: true,
    } satisfies WidgetDraft,
    themes: [
      { id: "purple", label: "品牌紫", color: "#752ba3" },
      { id: "moss", label: "苔绿", color: "#4b6657" },
      { id: "blue", label: "深蓝", color: "#465c86" },
    ] satisfies readonly WidgetTheme[],
    evaluation: {
      score: 92,
      coverage: 100,
      passedCases: 18,
      totalCases: 20,
      completeness: "9 / 10",
      label: "示例评分",
      disclaimer: evaluationDisclaimer,
    },
    sampleExchange: {
      question: "回答中的信息从哪里来？",
      answer: "我会根据企业公开资料回答，并提供相应的资料依据。",
      source: "企业身份总览",
    },
  },
} as const;

export const cloneWidgetDraft = (source: Readonly<Omit<WidgetDraft, "suggestions">> & { readonly suggestions: readonly [string, string, string] }): WidgetDraft => ({
  ...source,
  suggestions: [...source.suggestions],
});

export const widgetDraftsEqual = (left: WidgetDraft, right: WidgetDraft) =>
  JSON.stringify(left) === JSON.stringify(right);

