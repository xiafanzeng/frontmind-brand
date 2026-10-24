export type HelpCategory = {
  id: string;
  title: string;
  description: string;
  articleCount: number;
  icon: "book" | "credit" | "truck" | "shield" | "account" | "chat";
};

export type HelpArticle = {
  id: string;
  title: string;
  excerpt: string;
  tag: string;
  updatedAt: string;
  sourceTitle: string;
};

export type HelpFaq = {
  id: string;
  question: string;
  answer: string;
};

export const siteMeta = {
  brand: "FrontMind 帮助中心",
  slogan: "有问题，随时查",
  heroTitle: "我们能帮你什么？",
  heroSummary: "搜索帮助文档，或按分类浏览常见问题的解决办法。",
  quickLinks: ["付款方式", "退款流程", "开通服务", "联系客服"],
};

export const categories: HelpCategory[] = [
  {
    id: "getting-started",
    title: "快速上手",
    description: "注册登录、开通服务与首次配置的完整指引。",
    articleCount: 8,
    icon: "book",
  },
  {
    id: "billing",
    title: "账单与付款",
    description: "付款方式、发票开具、账单周期与退款说明。",
    articleCount: 12,
    icon: "credit",
  },
  {
    id: "delivery",
    title: "服务与交付",
    description: "服务范围、交付流程、进度查询与验收标准。",
    articleCount: 9,
    icon: "truck",
  },
  {
    id: "security",
    title: "账户与安全",
    description: "密码找回、权限分配与企业数据安全策略。",
    articleCount: 7,
    icon: "shield",
  },
  {
    id: "account",
    title: "企业与团队",
    description: "成员管理、角色权限与多项目协作设置。",
    articleCount: 6,
    icon: "account",
  },
  {
    id: "contact",
    title: "联系支持",
    description: "服务时间、响应时效与各渠道的联系方式。",
    articleCount: 5,
    icon: "chat",
  },
];

export const featuredArticles: HelpArticle[] = [
  {
    id: "payment-methods",
    title: "企业目前支持哪些付款方式？",
    excerpt: "对公转账支持月结 30 天，线上支付覆盖支付宝与微信，大额订单可走银行汇票。",
    tag: "账单与付款",
    updatedAt: "2026-10-18",
    sourceTitle: "《企业服务手册》付款与结算",
  },
  {
    id: "refund-policy",
    title: "退款申请流程与到账周期",
    excerpt: "提交申请后 1 个工作日内审核，审核通过后原路退回，一般 3 至 7 个工作日到账。",
    tag: "账单与付款",
    updatedAt: "2026-10-15",
    sourceTitle: "《售后服务条款》退款",
  },
  {
    id: "service-scope",
    title: "服务范围与交付标准说明",
    excerpt: "标准交付包含方案确认、执行实施与验收报告三个阶段，可按需扩展。",
    tag: "服务与交付",
    updatedAt: "2026-10-12",
    sourceTitle: "《服务交付白皮书》",
  },
  {
    id: "team-roles",
    title: "如何给团队成员分配角色权限",
    excerpt: "管理员可在企业与团队中添加成员并授予管理员、工程师或只读角色。",
    tag: "企业与团队",
    updatedAt: "2026-10-10",
    sourceTitle: "《管理后台操作指南》",
  },
];

export const faqs: HelpFaq[] = [
  {
    id: "faq-hours",
    question: "在线客服的服务时间是什么时候？",
    answer: "工作日 9:00 至 18:00 在线，节假日留言会在次一工作日优先处理。",
  },
  {
    id: "faq-invoice",
    question: "如何开具增值税发票？",
    answer: "在账单与付款分类提交开票信息，普通发票当天开出，专票 1 至 3 个工作日。",
  },
  {
    id: "faq-password",
    question: "忘记密码怎么办？",
    answer: "登录页点击忘记密码，通过绑定手机或邮箱验证后即可重置。",
  },
  {
    id: "faq-trial",
    question: "是否支持先试用再购买？",
    answer: "企业版提供 14 天全功能试用，试用期结束前会提前通知，不会自动扣费。",
  },
];

export const contactBand = {
  title: "没有找到想要的答案？",
  summary: "把问题发给支持团队，工作时间内通常 2 小时内回复。",
  action: "联系客服",
};
