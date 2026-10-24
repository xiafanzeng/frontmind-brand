export type PaletteName = "azure" | "warm" | "navy" | "forest" | "plum";

export type MinimalArticle = {
  id: string;
  category: string;
  title: string;
  excerpt: string;
  sourceTitle: string;
  updatedAt: string;
};

export type MinimalFaq = {
  id: string;
  question: string;
  answer: string;
};

export const siteMeta = {
  brand: "FrontMind 帮助中心",
  palette: "forest" as PaletteName,
  title: "帮助与常见问题",
  summary:
    "这里汇总了最常被问到的问题与解答。所有回答都来自已发布的企业知识库，并保留原始出处。",
};

export const articles: MinimalArticle[] = [
  {
    id: "payment-methods",
    category: "账单与付款",
    title: "企业目前支持哪些付款方式？",
    excerpt:
      "对公转账适用于合同客户，支持月结 30 天；线上支付覆盖支付宝与微信支付，单笔限额 5 万元；大额订单可使用银行汇款。",
    sourceTitle: "《企业服务手册》付款与结算",
    updatedAt: "10-18",
  },
  {
    id: "refund-policy",
    category: "账单与付款",
    title: "退款申请流程与到账周期",
    excerpt:
      "在账单中心提交退款申请后 1 个工作日内完成审核，审核通过后按原支付渠道退回，一般 3 至 7 个工作日到账。",
    sourceTitle: "《售后服务条款》退款",
    updatedAt: "10-15",
  },
  {
    id: "service-scope",
    category: "服务与交付",
    title: "服务范围与交付标准说明",
    excerpt:
      "标准交付包含方案确认、执行实施与验收报告三个阶段；定制需求在立项阶段约定范围与里程碑。",
    sourceTitle: "《服务交付白皮书》",
    updatedAt: "10-12",
  },
  {
    id: "team-roles",
    category: "账户与安全",
    title: "如何给团队成员分配角色权限",
    excerpt:
      "管理员进入企业与团队页面添加成员，可授予管理员、工程师或只读角色，角色可随时调整。",
    sourceTitle: "《管理后台操作指南》",
    updatedAt: "10-10",
  },
  {
    id: "contact-hours",
    category: "联系支持",
    title: "在线客服的服务时间与响应时效",
    excerpt:
      "工作日 9:00 至 18:00 在线接待，通常 2 小时内回复；节假日留言在次一工作日优先处理。",
    sourceTitle: "《客户服务承诺》",
    updatedAt: "10-08",
  },
];

export const faqs: MinimalFaq[] = [
  {
    id: "faq-password",
    question: "忘记密码怎么办？",
    answer: "登录页点击“忘记密码”，通过绑定手机或邮箱验证后即可重置。",
  },
  {
    id: "faq-trial",
    question: "是否支持先试用再购买？",
    answer: "企业版提供 14 天全功能试用，试用期结束前会提前通知，不会自动扣费。",
  },
  {
    id: "faq-hours",
    question: "如何开具增值税发票？",
    answer: "在账单与付款中提交开票信息，普通发票当天开出，专票 1 至 3 个工作日。",
  },
];

export const footer = {
  contact: "support@frontmind.cn",
  note: "内容依据企业知识库生成，保持可追溯引用。",
};
