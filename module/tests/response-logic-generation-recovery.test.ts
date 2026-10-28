// @vitest-environment node
import { describe, expect, it } from "vitest";

/**
 * Regression tests for the "page stuck on 生成中 after the task finished"
 * incident (2026-10-28, task 548a349a): the generation state lives in an
 * in-memory store, so a workspace unmount (navigation/refresh) or a start
 * issued from another surface leaves the record's bound task without any
 * observer — no status request is ever sent, the page keeps showing the
 * loading card, and a retried start fails with 409. The recovery helper maps
 * the authoritative record back onto a polling-ready generation state.
 */

import {
  recoverResponseLogicGenerationFromRecord,
  type ResponseLogicGenerationState,
} from "../client/ResponseLogicWorkspace.js";

const base = {
  scope: "account",
  questionId: "q-1",
  generation: null as ResponseLogicGenerationState | null,
};

const boundRecord = {
  questionId: "q-1",
  lastTaskId: "task-1",
  conversationId: "conv-1",
  revision: 2,
  appliedModelResult: null,
};

describe("recoverResponseLogicGenerationFromRecord", () => {
  it("re-arms a running state from a record with a bound, unadopted task", () => {
    const recovered = recoverResponseLogicGenerationFromRecord({
      ...base,
      record: boundRecord,
    });
    expect(recovered).not.toBeNull();
    expect(recovered!.phase).toBe("running");
    expect(recovered!.taskId).toBe("task-1");
    expect(recovered!.conversationId).toBe("conv-1");
    expect(recovered!.operationRevision).toBe(2);
    expect(recovered!.questionId).toBe("q-1");
    expect(recovered!.scope).toBe("account");
  });

  it("never overrides live in-memory generation state", () => {
    const recovered = recoverResponseLogicGenerationFromRecord({
      ...base,
      generation: { ...boundRecord, phase: "running", scope: "account" },
      record: boundRecord,
    });
    expect(recovered).toBeNull();
  });

  it("does not recover once a result has been adopted", () => {
    const recovered = recoverResponseLogicGenerationFromRecord({
      ...base,
      record: { ...boundRecord, appliedModelResult: { resultId: "r" } },
    });
    expect(recovered).toBeNull();
  });

  it("does not recover for a missing record, another question, or no bound task", () => {
    expect(
      recoverResponseLogicGenerationFromRecord({ ...base, record: null }),
    ).toBeNull();
    expect(
      recoverResponseLogicGenerationFromRecord({
        ...base,
        record: { ...boundRecord, questionId: "other" },
      }),
    ).toBeNull();
    expect(
      recoverResponseLogicGenerationFromRecord({
        ...base,
        record: { ...boundRecord, lastTaskId: null },
      }),
    ).toBeNull();
    expect(
      recoverResponseLogicGenerationFromRecord({
        ...base,
        record: { ...boundRecord, conversationId: null },
      }),
    ).toBeNull();
  });
});
