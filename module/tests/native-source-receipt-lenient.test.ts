// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  lenientSourceReceiptWireSchema,
  siteSourceReceiptV2Schema,
  NATIVE_SOURCE_PREFLIGHT_V2_SHA256,
} from "../server/siteops/native-react-source.js";

const RECEIPT_BASE = {
  operationToken: "siteops-native-source:op:0",
  baseSourceSha256: "a".repeat(64),
  archiveSha256: "b".repeat(64),
  fileCount: 15,
  preflightVersion: "frontmind-native-preflight-v2",
  preflightStatus: "passed",
  preflightSha256: NATIVE_SOURCE_PREFLIGHT_V2_SHA256,
  runtimeContractVersion: "frontmind-native-runtime-contract-v1",
  runtimeContractSha256: "c".repeat(64),
  executionShellSha256: "d".repeat(64),
  executionBaselineSha256: "e".repeat(64),
  contentPlanSha256: "f".repeat(64),
} as const;

describe("lenient source receipt wire schema", () => {
  it("accepts a hand-typoed pinned literal the strict schema rejects", () => {
    const typoed = { ...RECEIPT_BASE, preflightSha256: "0".repeat(64) };
    expect(siteSourceReceiptV2Schema.safeParse(typoed).success).toBe(false);
    expect(lenientSourceReceiptWireSchema.safeParse(typoed).success).toBe(true);
  });

  it("drops unknown provider fields instead of rejecting", () => {
    const extended = { ...RECEIPT_BASE, extraNote: "模型随手加的字段" };
    expect(siteSourceReceiptV2Schema.safeParse(extended).success).toBe(false);
    const parsed = lenientSourceReceiptWireSchema.safeParse(extended);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).not.toHaveProperty("extraNote");
  });

  it("still requires identity, baseline, archive hash format and preflight status", () => {
    for (const broken of [
      { ...RECEIPT_BASE, operationToken: "" },
      { ...RECEIPT_BASE, baseSourceSha256: "not-a-sha" },
      { ...RECEIPT_BASE, archiveSha256: 42 },
      { ...RECEIPT_BASE, preflightStatus: "failed" },
    ]) {
      expect(lenientSourceReceiptWireSchema.safeParse(broken).success).toBe(false);
    }
  });
});
