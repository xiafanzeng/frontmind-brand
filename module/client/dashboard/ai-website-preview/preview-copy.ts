export const previewRagQuestion = "FrontMind 可以帮企业做什么？";

export const previewRagAnswer =
  "FrontMind 可以把企业资料整理为可追溯的知识库，用于生成帮助中心内容，并为网站 AI 助手提供问答能力。网站中的回答和这里的示例使用同一套知识来源。";

export const previewKnowledgeCollectionCount = 3;
export const previewKnowledgeFragmentCount = 41;

/** 网站助手预览中的建议提问，均来自 RAG 示例库，可直接命中合成回答。 */
export const previewAssistantSuggestions: readonly string[] = [
  previewRagQuestion,
  "如何配置网站 AI 助手？",
  "能保证两周内上线吗？",
];

/** 示例知识库无法支持的问题使用统一拒答文案，不编造回答。 */
export const previewAssistantUnknownAnswer =
  "抱歉，当前示例知识库中没有支持这个问题的资料，我不能编造回答。您可以点击示例问题重试，或先补充可公开的企业资料。";
