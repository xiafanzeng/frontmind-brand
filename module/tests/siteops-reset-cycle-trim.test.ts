// @vitest-environment node
import { describe, expect, it } from "vitest";
import { projectSiteOpsCurrentResetCycle } from "../server/siteops/service.js";

const boundary = new Date("2026-10-26T03:11:23.000Z");
const artifact = (createdAt: Date, status = "succeeded") => ({
  id: `${createdAt.toISOString()}-${status}`,
  status,
  createdAt,
});

describe("siteops reset cycle artifact trimming", () => {
  it("keeps artifacts created inside the reset epoch second", () => {
    // The restart truncates its epoch to whole seconds; a scripted
    // rebuild+snapshot+search burst can create the visual search operation
    // within that same second, and it must stay in the fresh cycle.
    const projected = projectSiteOpsCurrentResetCycle({
      successfulResetApplied: true,
      currentTaskStartedAt: boundary,
      messageRows: [],
      timelineMessageRows: [],
      buildRows: [],
      deploymentRows: [],
      packageRows: [],
      batchRows: [artifact(boundary), artifact(new Date(boundary.getTime() + 4000))],
      timelineOperationRows: [artifact(boundary), artifact(new Date(boundary.getTime() - 1000))],
    });
    expect(projected.batchRows).toHaveLength(2);
    expect(projected.timelineOperationRows).toHaveLength(1);
    expect(projected.timelineOperationRows[0]!.id).toBe(artifact(boundary).id);
  });
  it("still drops superseded and cancelled artifacts", () => {
    const projected = projectSiteOpsCurrentResetCycle({
      successfulResetApplied: true,
      currentTaskStartedAt: boundary,
      messageRows: [],
      timelineMessageRows: [],
      buildRows: [],
      deploymentRows: [],
      packageRows: [],
      batchRows: [
        artifact(boundary, "superseded"),
        artifact(new Date(boundary.getTime() + 1000), "cancelled"),
        artifact(new Date(boundary.getTime() + 2000), "published"),
      ],
      timelineOperationRows: [],
    });
    expect(projected.batchRows).toHaveLength(1);
    expect(projected.batchRows[0]!.status).toBe("published");
  });
});
