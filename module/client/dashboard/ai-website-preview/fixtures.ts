import type { WebsitePreviewFixture } from "./types";

/**
 * 第一版预览的所有客户、版本、时间和站点内容都集中在这里。
 * 这些值仅用于离线界面演示，不能作为真实客户或生产发布数据。
 */
export const websitePreviewFixture: WebsitePreviewFixture = {
  customer: {
    projectName: "东莞台心医美",
    shortName: "台心医美",
    wordmark: "TAIXIN",
    industry: "医疗服务机构",
  },
  versions: {
    draft: "v03",
    online: "v02",
    knowledge: "v2",
    evaluationRule: "W1（建议稿）",
  },
  timestamps: {
    draftSaved: "今天 14:32",
    evaluated: "今天 14:35",
    lastPublished: "09 月 29 日 16:48",
  },
  site: {
    displayDomain: "taixin.example.com",
    pageCount: 4,
    navigation: ["机构介绍", "服务方向", "就诊指引", "联系我们"],
    eyebrow: "CARE BEGINS WITH UNDERSTANDING",
    trustPoints: ["机构信息可查", "服务介绍清晰", "问题回答有据"],
    serviceCards: [
      {
        number: "01",
        title: "机构介绍",
        description: "了解机构主体与服务定位",
      },
      {
        number: "02",
        title: "服务信息",
        description: "了解服务范围与咨询方式",
      },
    ],
    defaultDraft: {
      heroTitle: "让每一次选择，\n都有充分了解。",
      heroDescription:
        "了解我们的服务与就诊流程。\n基于公开资料，为您提供清晰的参考。",
      callToAction: "了解我们的服务",
      callToActionTarget: "服务介绍",
      accent: "#4b6657",
    },
  },
  evaluation: {
    score: 86,
    coverage: 92,
    pendingWeight: 8,
    pendingCriticalItems: 1,
    suggestedThreshold: 85,
    dimensions: [
      { id: "facts", label: "事实与来源", score: 26, weight: 30 },
      { id: "coverage", label: "内容覆盖", score: 18, weight: 20 },
      { id: "readability", label: "AI 可读性", score: 18, weight: 20 },
      { id: "interaction", label: "访问与交互", score: 16, weight: 20 },
      { id: "configuration", label: "站点配置", score: 8, weight: 10 },
    ],
  },
  flow: [
    {
      id: "workbench",
      label: "网站工作台",
      detail: "总览与待办",
      previewPage: "workbench",
    },
    {
      id: "editor",
      number: "01",
      label: "编辑网站",
      detail: "页面与内容",
      previewPage: "editor",
    },
    {
      id: "settings",
      number: "02",
      label: "站点设置",
      detail: "品牌、域名与 SEO",
    },
    {
      id: "checks",
      number: "03",
      label: "评估与检查",
      detail: "Evaluation",
    },
    {
      id: "release",
      number: "04",
      label: "版本与发布",
      detail: "对比与上线",
    },
    {
      id: "performance",
      number: "05",
      label: "运行效果",
      detail: "访问与持续评估",
    },
  ],
  pages: [
    {
      id: "home",
      label: "首页",
      sections: [
        { id: "navigation", label: "导航栏" },
        { id: "hero", label: "首屏介绍" },
        { id: "services", label: "服务概览" },
        { id: "faq-teaser", label: "常见问题" },
        { id: "footer", label: "页脚" },
      ],
    },
    { id: "services", label: "服务介绍", sections: [] },
    { id: "faq", label: "常见问题", sections: [] },
    { id: "contact", label: "联系我们", sections: [] },
  ],
};

