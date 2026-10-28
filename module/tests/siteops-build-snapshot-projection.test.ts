// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { siteOpsBuildProjectionSchema } from "../contracts/siteops-contract";
import { projectSiteOpsBuildKnowledgeSnapshotCoordinates } from "../server/siteops/service";

const BUILD_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";

function buildProjection() {
  return {
    id: BUILD_ID,
    ordinal: 1,
    parentBuildId: null,
    knowledgeSnapshotId: SNAPSHOT_ID,
    knowledgeSnapshot: {
      id: SNAPSHOT_ID,
      version: 2,
      archiveHash: "a".repeat(64),
    },
    status: "approved",
    previewUrl: null,
    sourceUrl: null,
    designPreferences: null,
    brief: null,
    buildDelivery: null,
    needsHelp: false,
    createdAt: "2026-10-23T01:00:00.000Z",
    updatedAt: "2026-10-23T01:10:00.000Z",
  };
}

describe("SiteOps build-owned knowledge snapshot projection", () => {
  it("accepts a complete frozen coordinate and rejects an ID mismatch", () => {
    expect(siteOpsBuildProjectionSchema.parse(buildProjection()).knowledgeSnapshot)
      .toEqual(buildProjection().knowledgeSnapshot);
    expect(() => siteOpsBuildProjectionSchema.parse({
      ...buildProjection(),
      knowledgeSnapshot: {
        ...buildProjection().knowledgeSnapshot,
        id: OTHER_SNAPSHOT_ID,
      },
    })).toThrow("must match knowledgeSnapshotId");
  });

  it("projects only valid coordinates referenced by visible builds", () => {
    const coordinates = projectSiteOpsBuildKnowledgeSnapshotCoordinates({
      buildSnapshotIds: [SNAPSHOT_ID],
      ownedSnapshotRows: [
        { id: SNAPSHOT_ID, version: 2, archiveHash: "a".repeat(64) },
        { id: OTHER_SNAPSHOT_ID, version: 9, archiveHash: "b".repeat(64) },
      ],
    });

    expect([...coordinates]).toEqual([[
      SNAPSHOT_ID,
      { id: SNAPSHOT_ID, version: 2, archiveHash: "a".repeat(64) },
    ]]);
  });

  it("owner-scopes archived lookup without widening the selectable list", () => {
    const source = readFileSync(
      new URL("../server/siteops/service.ts", import.meta.url),
      "utf8",
    ).replace(/\r\n/gu, "\n");
    const lookupStart = source.indexOf("const buildSnapshotRows =");
    const lookupEnd = source.indexOf(
      "const buildSnapshotCoordinates =",
      lookupStart,
    );
    const lookup = source.slice(lookupStart, lookupEnd);
    expect(lookupStart).toBeGreaterThan(-1);
    expect(lookupEnd).toBeGreaterThan(lookupStart);
    expect(lookup).toContain(
      "enterpriseOwnerPredicate(knowledgeBaseSnapshots, input.userId)",
    );
    expect(lookup).toContain(
      "inArray(knowledgeBaseSnapshots.id, visibleBuildSnapshotIds)",
    );
    expect(lookup).not.toContain("knowledgeBaseSnapshots.status");

    const selectableProjection = source.slice(
      source.indexOf("knowledgeSnapshots: selectableSnapshotRows.map("),
      source.indexOf("messages: messagesProjected"),
    );
    expect(selectableProjection).toContain(
      "knowledgeSnapshots: selectableSnapshotRows.map(",
    );
    expect(selectableProjection).not.toContain("buildSnapshotRows");
  });
});
