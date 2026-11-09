// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  nativeRuntimeDiagnosticsAttachment,
  nativeSourceRepairSystemPromptForWorkflow,
} from "../server/siteops/manus-provider.js";

const REPAIR_INPUT = {
  attempt: 1,
  kind: "hard_safety" as const,
  diagnostics: [
    {
      code: "CANONICAL_PATHNAME_REQUIRED",
      file: "src/frontmind-routes.tsx",
      line: null,
      column: null,
      detail:
        "workflow 2.9 multi-page routing must reference the host bridge, e.g. window.canonicalSitePathname?.() ?? window.location.pathname",
    },
    {
      // Older persisted repairs carry no detail; the attachment must keep
      // accepting them byte-for-byte.
      code: "DEPENDENCY_FORBIDDEN",
      file: "package.json",
      line: null,
      column: null,
    },
  ],
};

describe("native repair diagnostics detail", () => {
  it("serializes audit issue detail into the diagnostics attachment", () => {
    const attachment = nativeRuntimeDiagnosticsAttachment(REPAIR_INPUT);
    const decoded = JSON.parse(
      Buffer.from(
        attachment.file_data.replace(/^data:application\/json;base64,/, ""),
        "base64",
      ).toString("utf8"),
    );
    expect(attachment.filename).toBe(
      "frontmind-native-runtime-diagnostics-v1.json",
    );
    expect(decoded.diagnostics).toHaveLength(2);
    expect(decoded.diagnostics[0]).toEqual(REPAIR_INPUT.diagnostics[0]);
    expect(decoded.diagnostics[1]).not.toHaveProperty("detail");
  });

  it("repair prompt names the compliant canonical pathname forms", () => {
    const repairPrompt = nativeSourceRepairSystemPromptForWorkflow("2.9.0");
    expect(repairPrompt).toContain("window.canonicalSitePathname?.()");
    expect(repairPrompt).toContain("先读取该属性存入局部再判断调用同样合规");
  });
});
