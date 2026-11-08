import type {
  WebsiteBuildEvaluationVerdict,
} from "../../../contracts/website-build-evaluation-run";

export const WEBSITE_EVALUATION_VERDICT_LABELS: Readonly<
  Record<WebsiteBuildEvaluationVerdict, string>
> = {
  recommended: "推荐发布",
  repair_or_continue: "修复后发布",
  not_recommended: "暂缓发布",
};

export function websiteEvaluationVerdictLabel(
  verdict: WebsiteBuildEvaluationVerdict,
) {
  return WEBSITE_EVALUATION_VERDICT_LABELS[verdict];
}
