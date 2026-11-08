import { describe, expect, it } from "vitest";

import { websiteEvaluationVerdictLabel } from "./website-evaluation-copy";

describe("website evaluation verdict copy", () => {
  it("uses short, parallel publishing recommendations", () => {
    expect(websiteEvaluationVerdictLabel("recommended")).toBe("推荐发布");
    expect(websiteEvaluationVerdictLabel("repair_or_continue")).toBe("修复后发布");
    expect(websiteEvaluationVerdictLabel("not_recommended")).toBe("暂缓发布");
  });
});
