// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { JudgeCore } from "../server/response-logic-judge-api.js";
import {
  parseStructuredEnvelopePayload,
  parseJudgePayload,
} from "../server/response-logic-judge-api.js";
import {
  judgeOutputSchema,
  type JudgeOutput,
} from "../contracts/response-logic-judge";

/**
 * Regression tests for JUDGE_STRUCTURED_OUTPUT_MISSING (2026-10-28, task
 * 347d1365): the deployed runner finishes judge tasks without ever emitting a
 * structured_output_result event — the model writes the
 * {"payload":"<JSON>"} envelope into the final assistant_message, prefixed by
 * prose. The generation chain already falls back to assistant_message; the
 * judge/optimizer parser must do the same instead of reporting every completed
 * task as missing output.
 */

const core = {
  classifyManusV2StructuredResultEnvelope: ((value: unknown) => {
    const record = value as { success?: boolean; value?: { payload?: unknown }; error?: unknown };
    if (record && record.success === true && record.value && typeof (record.value as { payload?: unknown }).payload === "string") {
      return { kind: "accepted", value: record.value };
    }
    return { kind: "rejected" as const };
  }),
} as unknown as JudgeCore;

const VALID: JudgeOutput = judgeOutputSchema.parse({
  kind: "judge-evaluation",
  dimensions: {
    relevance: {
      score: 91,
      band: "direct",
      findings: [{
        severity: "improve",
        evidence: "用户关注机构资质与真实性",
        evidenceSource: "draft",
        evidenceConfidence: "supported",
        reason: "首句明确回应了判断标准",
        suggestion: "补充资质核验清单",
      }],
    },
    completeness: {
      score: 100,
      coverage: [
        { field: "concern", status: "covered", findings: [] },
        { field: "conclusion", status: "covered", findings: [] },
        { field: "facts", status: "covered", findings: [] },
        { field: "boundaries", status: "covered", findings: [] },
      ],
      findings: [],
    },
    actionability: {
      score: 83,
      subMetrics: [
        { key: "content_specificity", score: 92, band: "mostly_actionable", findings: [] },
        { key: "evidence_guidance", score: 80, band: "moderately_actionable", findings: [] },
        { key: "structure_guidance", score: 78, band: "moderately_actionable", findings: [] },
      ],
      findings: [],
    },
    boundaryRisk: {
      score: 90,
      risks: [
        { key: "unverified_ranking", status: "controlled", findings: [] },
        { key: "absolute_claim", status: "controlled", findings: [] },
        { key: "effect_promise", status: "controlled", findings: [] },
        { key: "unverified_comparison", status: "controlled", findings: [] },
        { key: "unsupported_fact", status: "controlled", findings: [] },
        { key: "missing_precondition", status: "partial", findings: [] },
      ],
      findings: [],
    },
  },
  overallAssessment: "方向准确、边界稳健的草稿。",
});

/** Shape captured from the real failed task 347d1365: prose + JSON envelope. */
const realShapedAssistant = {
  id: "message:agent-1",
  type: "assistant_message",
  timestamp: 1793178397183,
  assistant_message: {
    content:
      "评估完成。工作流程已按技能要求执行：附件均已读取，分数已按契约公式重算。\n\n" +
      JSON.stringify({ payload: JSON.stringify(VALID) }),
  },
};

describe("parseStructuredEnvelopePayload assistant_message fallback", () => {
  it("recovers the payload JSON from a prose-prefixed assistant message (real incident shape)", () => {
    const result = parseStructuredEnvelopePayload(core, [realShapedAssistant], "JUDGE_PAYLOAD_INVALID_JSON", "bad");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.parsed as { kind?: string }).kind).toBe("judge-evaluation");
    }
  });

  it("still prefers a real structured_output_result event when present", () => {
    const event = {
      id: "so-1",
      type: "structured_output_result",
      timestamp: 2,
      structured_output_result: { success: true, value: { payload: JSON.stringify(VALID) } },
    };
    const result = parseStructuredEnvelopePayload(
      core,
      [realShapedAssistant, event],
      "JUDGE_PAYLOAD_INVALID_JSON",
      "bad",
    );
    expect(result.ok).toBe(true);
  });

  it("reports MISSING for plain prose without any JSON", () => {
    const result = parseStructuredEnvelopePayload(
      core,
      [{ ...realShapedAssistant, assistant_message: { content: "评估完成，但没有输出 JSON。" } }],
      "JUDGE_PAYLOAD_INVALID_JSON",
      "bad",
    );
    expect(result).toMatchObject({ ok: false, code: "JUDGE_STRUCTURED_OUTPUT_MISSING" });
  });

  it("reports MISSING when the JSON object is not a payload envelope", () => {
    const result = parseStructuredEnvelopePayload(
      core,
      [{ ...realShapedAssistant, assistant_message: { content: `说明文字 ${JSON.stringify({ hello: 1 })}` } }],
      "JUDGE_PAYLOAD_INVALID_JSON",
      "bad",
    );
    expect(result).toMatchObject({ ok: false, code: "JUDGE_STRUCTURED_OUTPUT_MISSING" });
  });

  it("reports the caller's invalid-JSON code when the payload string is not JSON", () => {
    const result = parseStructuredEnvelopePayload(
      core,
      [{ ...realShapedAssistant, assistant_message: { content: "说明 " + JSON.stringify({ payload: "not-json{" }) } }],
      "JUDGE_PAYLOAD_INVALID_JSON",
      "bad",
    );
    expect(result).toMatchObject({ ok: false, code: "JUDGE_PAYLOAD_INVALID_JSON" });
  });

  it("reports MISSING with no events at all", () => {
    const result = parseStructuredEnvelopePayload(core, [], "JUDGE_PAYLOAD_INVALID_JSON", "bad");
    expect(result).toMatchObject({ ok: false, code: "JUDGE_STRUCTURED_OUTPUT_MISSING" });
  });
});

describe("parseJudgePayload end-to-end with fallback", () => {
  it("parses the real incident shape into a schema-valid JudgeOutput", () => {
    const result = parseJudgePayload(core, [realShapedAssistant]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.judge.dimensions.relevance.score).toBe(91);
    }
  });

  it("rejects a fallback payload that fails the strict judge schema", () => {
    const bogus = { ...realShapedAssistant, assistant_message: { content: "x " + JSON.stringify({ payload: JSON.stringify({ kind: "judge-evaluation" }) }) } };
    const result = parseJudgePayload(core, [bogus]);
    expect(result).toMatchObject({ ok: false, code: "JUDGE_OUTPUT_SCHEMA_MISMATCH" });
  });
});
