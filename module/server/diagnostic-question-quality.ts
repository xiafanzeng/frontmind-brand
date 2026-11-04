// Adapted from Website dcd259a8 server/geo/schemas.ts. Brand permits four
// selectable categories and evidence-limited candidate counts.
import type {
  DiagnosticRecommendation,
  KnowledgeBasis,
} from "../contracts/diagnostics.js";

export const normalizeQuestion = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
const genericCompetitor =
  /^(?:竞品[甲乙丙丁一二三四五\d]*|(?:同类|其他|传统|原生|自建|替代|第三方|开源|主流|类似)(?:产品|平台|方案|工具|接口|集群|服务|厂商|品牌|公司)?|对手|友商)$/i;
const reputationJudgment =
  /怎么样|好不好|好吗|靠谱吗|靠不靠谱|可靠吗|稳定吗|稳不稳定|安全吗|安全性|正规吗|可信|信赖|口碑|评价|投诉|风险|满意|缺点|问题/;
const reputationFacts =
  /背景是什么|什么背景|成立时间|创立时间|有哪些(?:资质|认证|专利|奖项|渠道)|获得了哪些|如何验证|如何核验|怎么验证|提供哪些渠道/;
const comparison =
  /对比|相比|比较|区别|差异|不同|相较|取舍|还是|与.+哪个|和.+哪个|如何评估|怎么评估|vs/i;
const ranking =
  /推荐|排名|哪[些家个]|前[十百五三]|值得考虑|名单|优先考察|领先|主流|top\s*\d/i;

export function diagnosticQuestionFormatIssue(text: string) {
  if (text.length < 4 || text.length > 120) return "请用 4–120 字表达一个问题";
  if (/[,，;；\n]/u.test(text)) return "请拆成单句，只保留一个主要问题";
  if (!text.endsWith("？") || (text.match(/[?？]/gu)?.length ?? 0) !== 1)
    return "请用一句问句表达，并以中文问号结尾";
  if (
    /reputation|product_scenario|industry_ranking|competitor_comparison|第\s*\d+\s*个问题|测试问题|值得优化吗/i.test(
      text,
    )
  )
    return "请使用真实、具体的客户问题";
  return null;
}

export function assertDiagnosticQuestionPortfolio(
  questions: DiagnosticRecommendation[],
  basis: KnowledgeBasis,
) {
  const reasons = new Set<string>();
  const skeletons = new Set<string>();
  for (const question of questions) {
    const issue = diagnosticQuestionFormatIssue(question.text);
    if (issue) throw new Error(issue);
    const evidence = question.evidenceRefs.map((path) =>
      basis.documents.find((doc) => doc.path === path),
    );
    if (evidence.some((doc) => !doc))
      throw new Error("推荐题的知识依据不在冻结版本中");
    const evidenceText = normalizeQuestion(
      evidence.map((doc) => `${doc!.title}\n${doc!.content}`).join("\n"),
    );
    const text = normalizeQuestion(question.text);
    const anchor = (value: string | null | undefined) =>
      !!value &&
      value.length >= 2 &&
      text.includes(normalizeQuestion(value)) &&
      evidenceText.includes(normalizeQuestion(value));
    if (question.category === "industry_ranking") {
      if (
        !ranking.test(question.text) ||
        text.includes(normalizeQuestion(basis.companyName))
      )
        throw new Error("行业排名题需为不点名当前企业的开放推荐问题");
    } else if (
      !anchor(question.enterpriseAnchor) &&
      !(
        question.enterpriseAnchor &&
        normalizeQuestion(question.enterpriseAnchor) === normalizeQuestion(basis.companyName) &&
        text.includes(normalizeQuestion(basis.companyName))
      )
    ) {
      throw new Error(`问题“${question.text}”需要包含冻结知识所属企业或有知识依据的诊断主体名称。行业排名题仍须省略当前企业名称`);
    }
    if (
      question.category === "reputation" &&
      (!reputationJudgment.test(question.text) ||
        reputationFacts.test(question.text))
    )
      throw new Error("美誉舆情题应直接询问口碑、可靠性或风险评价");
    if (
      question.category === "product_scenario" &&
      !anchor(question.offeringAnchor)
    )
      throw new Error("产品场景题需要包含知识中实际存在的产品或服务");
    if (
      question.category === "competitor_comparison" &&
      (!anchor(question.competitorAnchor) ||
        genericCompetitor.test(question.competitorAnchor!) ||
        normalizeQuestion(question.competitorAnchor!) ===
          normalizeQuestion(question.enterpriseAnchor!) ||
        !comparison.test(question.text))
    )
      throw new Error("竞品题需要知识支持的明确双方和一个共同比较维度");
    const reason = normalizeQuestion(question.rationale);
    if (reasons.has(reason))
      throw new Error("推荐理由重复，请说明各题不同的决策价值");
    reasons.add(reason);
    let skeleton = text;
    for (const value of [
      question.enterpriseAnchor,
      question.offeringAnchor,
      question.competitorAnchor,
    ])
      if (value) skeleton = skeleton.split(normalizeQuestion(value)).join("");
    const key = `${question.category}:${skeleton.replace(/\d+|[一二三四五六七八九十]+/gu, "#")}`;
    if (skeletons.has(key))
      throw new Error("候选题只有名称替换，请选择不同的真实意图");
    skeletons.add(key);
  }
}
