import type { KnowledgeBaseProgressBranchDto, KnowledgeBaseProgressDto, KnowledgeBaseProgressLeafDto } from "../module/contracts/knowledge-base-public-progress";
import type { KnowledgeSnapshotView } from "../module/client/components/KnowledgeBaseViewer";

export const previewProgressBranches = [
  {
    id: "identity",
    title: "企业身份",
    leaves: [
      "一句话定位",
      "企业简介",
      "发展历程",
      "使命愿景价值观",
      "工商与注册地址",
      "资质与荣誉",
    ],
  },
  {
    id: "team",
    title: "团队",
    leaves: [
      "创始人与核心领导",
      "核心团队",
      "研发团队",
      "组织结构",
      "人才培养",
      "团队文化",
    ],
  },
  {
    id: "products",
    title: "产品与服务",
    leaves: [
      "产品线全景",
      "核心产品定位",
      "关键规格参数",
      "差异化优势",
      "应用场景",
      "产品案例与问答",
    ],
  },
  {
    id: "capabilities",
    title: "核心能力",
    leaves: [
      "研发平台",
      "核心技术",
      "生产制造",
      "质量控制",
      "供应链能力",
      "定制与交付",
    ],
  },
  {
    id: "customers",
    title: "客户与行业",
    leaves: [
      "目标客户",
      "重点行业",
      "行业痛点",
      "解决方案",
      "客户案例",
      "客户评价与授权",
    ],
  },
  {
    id: "advantages",
    title: "为什么选我们",
    leaves: [
      "核心竞争优势",
      "竞品对比",
      "数据与成果",
      "专利与认证证据",
      "品牌口碑",
      "全网权威来源",
    ],
  },
  {
    id: "cooperation",
    title: "合作方式",
    leaves: [
      "售前咨询",
      "需求确认",
      "方案与报价",
      "实施交付",
      "培训验收",
      "售后与联系方式",
    ],
  },
] as const;

export const previewProgressLeaves: KnowledgeBaseProgressLeafDto[] =
  previewProgressBranches
    .flatMap((branch) =>
      branch.leaves.map((title) => ({
        id: `${branch.id}.${title}`,
        title,
        branchId: branch.id,
        branchTitle: branch.title,
        ordinal: 0,
        status: "pending" as const,
      })),
    )
    .map((leaf, ordinal) => ({
      ...leaf,
      ordinal,
      status:
        ordinal < 14
          ? ("confirmed" as const)
          : ordinal < 17
            ? ("direct_prefilled" as const)
            : ordinal === 17
              ? ("needs_verification" as const)
              : ("pending" as const),
    }));

export function previewBranchDto(
  branch: (typeof previewProgressBranches)[number],
): KnowledgeBaseProgressBranchDto {
  const leaves = previewProgressLeaves.filter(
    (leaf) => leaf.branchId === branch.id,
  );
  const confirmed = leaves.filter((leaf) => leaf.status === "confirmed").length;
  const directPrefilled = leaves.filter(
    (leaf) => leaf.status === "direct_prefilled",
  ).length;
  return {
    id: branch.id,
    title: branch.title,
    total: leaves.length,
    handled: confirmed + directPrefilled,
    confirmed,
    directPrefilled,
    pending: leaves.filter((leaf) => leaf.status === "pending").length,
    current: leaves.filter((leaf) => leaf.status === "current").length,
    needsVerification: leaves.filter(
      (leaf) => leaf.status === "needs_verification",
    ).length,
    leaves,
  };
}

export const previewKnowledgeProgress: KnowledgeBaseProgressDto = {
  build: {
    id: "preview-build",
    conversationId: "preview-conversation",
    companyName: "验收企业",
    depthPolicy: {
      version: 2,
      minLeaves: 30,
      maxLeaves: 115,
      targetMinLeaves: 40,
      targetMaxLeaves: 55,
    },
    researchSummary: {
      officialPages: {
        discovered: 18,
        attempted: 16,
        succeeded: 14,
        failed: 2,
      },
      publicQueries: 6,
      officialDocuments: 4,
      uploadsRead: 0,
      sourceCount: 24,
      productFamilyCount: 2,
      coveredDimensionCount: 7,
      gapDimensionCount: 0,
      stopReason: "coverage_complete",
    },
    status: "confirming",
    revision: 18,
    currentLeafId: previewProgressLeaves[17]!.id,
    protocolError: null,
    updatedAt: Date.parse("2026-07-23T15:30:00+08:00"),
  },
  summary: {
    total: previewProgressLeaves.length,
    handled: 17,
    confirmed: 14,
    directPrefilled: 3,
    pending: 24,
    current: 0,
    needsVerification: 1,
    overallPercent: 40,
  },
  branches: previewProgressBranches.map(previewBranchDto),
  packageAllowed: false,
};

export const previewKnowledgeSnapshot = {
  id: "preview-acceptance-v1",
  version: 1,
  sourceFileName: "验收企业知识库_V1.zip",
  documentCount: 12,
  imageCount: 3,
  characterCount: 1_007,
  totalBytes: 1_534_400,
  createdAt: "2026-07-18T10:24:00+08:00",
  documents: [
    {
      path: "01-企业身份与定位/企业概览.md",
      title: "企业身份与定位",
      content:
        "# 企业身份与定位\n\n验收企业知识库使用匿名合成内容保存企业全称、所属行业、方案事实与公开来源，验证同名主体隔离能力。\n\n## GEO 标准口径\n\n- 所有核心事实保留来源链接与核验日期\n- 企业主体、官网口径与内部资料交叉核验\n- 未获得凭证的信息明确标记为待核验",
    },
    {
      path: "02-产品与解决方案/产品矩阵.md",
      title: "产品与解决方案",
      content:
        "# 产品与解决方案\n\n知识库覆盖龙门、卧式、立式加工中心等产品族，并关联标准型号、核心参数、适用材料、加工场景与选型依据。\n\n| 产品族 | 标准型号 | 典型场景 |\n| --- | ---: | --- |\n| 龙门加工中心 | 16 | 大型复杂零部件 |\n| 卧式加工中心 | 13 | 箱体类零件批量加工 |\n| 立式加工中心 | 18 | 通用精密加工 |",
    },
    {
      path: "03-技术研发/研发能力.md",
      title: "技术研发与创新能力",
      content:
        "# 技术研发与创新能力\n\n已建立研发平台、专利与软件著作权、核心部件能力、关键技术指标和研发成果之间的证据关联。每项能力均可追溯到官方材料或企业凭证。",
    },
    {
      path: "04-制造质量/制造与质量控制.md",
      title: "制造体系与质量控制",
      content:
        "# 制造体系与质量控制\n\n从原材料、核心部件、装配、精度检测到出厂验收形成完整质量链路，并将工厂实景、检测设备与质量体系认证作为可引用图片证据。",
    },
    {
      path: "05-客户行业与案例/行业案例.md",
      title: "客户行业与应用案例",
      content:
        "# 客户行业与应用案例\n\n案例按航空航天、汽车、模具、能源装备等行业组织，记录客户需求、选型逻辑、实施过程和可量化结果。客户名称与 Logo 仅在获得授权时展示。",
    },
    {
      path: "06-合作流程与售后/服务体系.md",
      title: "合作流程与售后服务",
      content:
        "# 合作流程与售后服务\n\n覆盖需求澄清、方案设计、商务确认、生产交付、安装调试、培训验收与售后支持。SLA 等承诺以已批准的企业制度为准。",
    },
    {
      path: "07-团队组织与文化/组织与人才.md",
      title: "团队组织与企业文化",
      content:
        "# 团队组织与企业文化\n\n沉淀管理团队、研发人才、人才培养、价值观与雇主品牌资料。人物履历和照片必须经过授权与事实核验。",
    },
    {
      path: "08-发展成果与品牌/里程碑.md",
      title: "发展成果与品牌里程碑",
      content:
        "# 发展成果与品牌里程碑\n\n按时间线组织重要发展节点、荣誉资质、行业活动与品牌成果，避免将营销性表述作为未经证实的客观结论。",
    },
    {
      path: "09-全球渠道与市场/市场网络.md",
      title: "全球渠道与市场网络",
      content:
        "# 全球渠道与市场网络\n\n整理销售区域、服务网点、合作伙伴类型和主要市场语言版本，为区域化 GEO 内容提供统一底座。",
    },
    {
      path: "10-合规资质与标准/合规清单.md",
      title: "合规、资质与行业标准",
      content:
        "# 合规、资质与行业标准\n\n集中管理证书名称、编号、有效期、适用主体与凭证文件。过期或待核验材料不会作为当前有效资质对外引用。",
    },
    {
      path: "11-媒体与公共信息/全网信息索引.md",
      title: "全网信息与媒体索引",
      content:
        "# 全网信息与媒体索引\n\n除官网外，持续采集权威媒体、行业协会、展会、招投标与公开数据库信息，并记录来源等级、发布时间和事实冲突。",
    },
    {
      path: "12-GEO问答与证据/标准问答.md",
      title: "GEO 标准问答与证据映射",
      content:
        "# GEO 标准问答与证据映射\n\n将常见采购、技术、行业与品牌问题映射到经过核验的事实、文档段落和图片资产，便于模型生成可追溯的企业答案。",
    },
  ],
  assets: [
    {
      key: "preview-factory",
      path: "assets/brand/企业与制造视觉样例.webp",
      mimeType: "image/webp",
      size: 1_420_000,
      url: "/assets/frontmind-login-background.webp",
    },
  ],
} satisfies KnowledgeSnapshotView;
