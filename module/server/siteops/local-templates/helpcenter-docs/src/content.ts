export type PaletteName = "azure" | "warm" | "navy" | "forest" | "plum";

export type DocsArticle = {
  id: string;
  title: string;
  excerpt: string;
  updatedAt: string;
  sourceTitle: string;
};

export type DocsCategory = {
  id: string;
  title: string;
  description: string;
  articles: DocsArticle[];
};

export const siteMeta = {
  brand: "FrontMind 帮助中心",
  palette: "navy" as PaletteName,
  pageTitle: "帮助文档",
  pageSummary:
    "按分类整理的企业知识库文档，所有内容保持可追溯的引用来源。",
  lastUpdated: "2026-10-20",
};

export const categories: DocsCategory[] = [
  {
    id: "getting-started",
    title: "快速上手",
    description: "注册登录、开通服务与首次配置。",
    articles: [
      {
        id: "gs-register",
        title: "如何注册企业账号",
        excerpt: "使用企业邮箱注册，管理员审核通过后即可开通工作区。",
        updatedAt: "2026-10-18",
        sourceTitle: "《快速上手指南》",
      },
      {
        id: "gs-first-project",
        title: "创建第一个项目",
        excerpt: "从工作区新建项目，选择模板并关联知识库后开始使用。",
        updatedAt: "2026-10-17",
        sourceTitle: "《快速上手指南》",
      },
    ],
  },
  {
    id: "billing",
    title: "账单与付款",
    description: "付款方式、发票与退款说明。",
    articles: [
      {
        id: "pay-methods",
        title: "企业目前支持哪些付款方式？",
        excerpt: "对公转账支持月结 30 天，线上支付覆盖支付宝与微信。",
        updatedAt: "2026-10-18",
        sourceTitle: "《企业服务手册》付款与结算",
      },
      {
        id: "pay-refund",
        title: "退款申请流程与到账周期",
        excerpt: "1 个工作日内审核，原路退回 3 至 7 个工作日到账。",
        updatedAt: "2026-10-15",
        sourceTitle: "《售后服务条款》退款",
      },
      {
        id: "pay-invoice",
        title: "如何开具增值税发票",
        excerpt: "普通发票当天开出，专票 1 至 3 个工作日。",
        updatedAt: "2026-10-12",
        sourceTitle: "《财务须知》",
      },
    ],
  },
  {
    id: "delivery",
    title: "服务与交付",
    description: "服务范围、交付流程与验收标准。",
    articles: [
      {
        id: "dl-scope",
        title: "服务范围与交付标准说明",
        excerpt: "标准交付包含方案确认、执行实施与验收报告三个阶段。",
        updatedAt: "2026-10-12",
        sourceTitle: "《服务交付白皮书》",
      },
      {
        id: "dl-progress",
        title: "如何查询服务进度",
        excerpt: "项目页实时展示各阶段状态，关键节点会推送通知。",
        updatedAt: "2026-10-09",
        sourceTitle: "《项目协作手册》",
      },
    ],
  },
  {
    id: "security",
    title: "账户与安全",
    description: "密码、权限与企业数据安全。",
    articles: [
      {
        id: "sec-password",
        title: "忘记密码怎么办？",
        excerpt: "通过绑定手机或邮箱验证后即可重置密码。",
        updatedAt: "2026-10-10",
        sourceTitle: "《账户安全指引》",
      },
      {
        id: "sec-roles",
        title: "如何给团队成员分配角色权限",
        excerpt: "管理员可添加成员并授予管理员、工程师或只读角色。",
        updatedAt: "2026-10-10",
        sourceTitle: "《管理后台操作指南》",
      },
    ],
  },
];

export const faqs = [
  {
    id: "faq-hours",
    question: "在线客服的服务时间是什么时候？",
    answer: "工作日 9:00 至 18:00 在线，节假日留言会在次一工作日优先处理。",
  },
  {
    id: "faq-trial",
    question: "是否支持先试用再购买？",
    answer: "企业版提供 14 天全功能试用，试用期结束前会提前通知，不会自动扣费。",
  },
];

export const support = {
  title: "没有找到答案？",
  summary: "把问题发给支持团队，工作日通常 2 小时内回复。",
  action: "联系支持",
};
