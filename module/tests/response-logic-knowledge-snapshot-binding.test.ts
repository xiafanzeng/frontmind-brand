// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the toISOString TypeError that blocked every
 * /response-logic/start AFTER the earlier date-safety fixes: the runtime bound
 * Core's getLatestAuthenticatedKnowledgeSnapshot — whose signature is
 * ({ userId, notBefore }) — with a bare userId argument. notBefore then read
 * as undefined and drizzle's gte(knowledgeBaseSnapshots.createdAt, undefined)
 * crashed in MySqlTimestamp.mapToDriverValue before the first
 * [RL-Start] stage instrumentation could run. The runtime must bind the
 * module's own (userId)-arity getLatestKnowledgeSnapshot instead.
 */

vi.mock("../server/knowledge-snapshot-service.js", () => ({
  getLatestKnowledgeSnapshot: vi.fn(async () => null),
}));

import { getLatestKnowledgeSnapshot as moduleSnapshotLookup } from "../server/knowledge-snapshot-service.js";
import { assembleResponseLogicCore } from "../server/response-logic-runtime.js";
import { registerIntentSkillPorts } from "../server/intent-skill-runtime.js";

function registerSpyPorts() {
  const authenticatedVariant = vi.fn(async () => ({ id: "authenticated" }));
  registerIntentSkillPorts({
    getLatestAuthenticatedKnowledgeSnapshot: authenticatedVariant,
  } as never);
  return { authenticatedVariant };
}

describe("response-logic runtime knowledge snapshot binding", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("routes to the module (userId)-arity lookup, never the Core {userId,notBefore} variant", async () => {
    const { authenticatedVariant } = registerSpyPorts();
    const core = assembleResponseLogicCore({ getDb: async () => null });

    const snapshot = await core.getLatestKnowledgeSnapshot(7);

    expect(snapshot).toBeNull();
    expect(moduleSnapshotLookup).toHaveBeenCalledTimes(1);
    expect(moduleSnapshotLookup).toHaveBeenCalledWith(7);
    expect(authenticatedVariant).not.toHaveBeenCalled();
  });

  it("passes the bare numeric userId only — an object argument would hide signature drift", async () => {
    registerSpyPorts();
    const core = assembleResponseLogicCore({ getDb: async () => null });

    await core.getLatestKnowledgeSnapshot(42);

    const calls = vi.mocked(moduleSnapshotLookup).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([42]);
  });
});
