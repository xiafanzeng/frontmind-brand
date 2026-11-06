// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  SiteContentPlanValidationError,
  siteContentPlanV2FromWire,
  siteContentPlanWireV2Schema,
} from "../contracts/siteops-content-plan.js";
import {
  siteContentPlanRepairIssues,
  siteContentPlanSchemaRepairIssues,
} from "../server/siteops/manus-provider.js";

const TOKEN = "siteops-content-plan:test-op:1";
const SHA =
  "a".repeat(64);

function route(routeId: string, path: string, title: string) {
  return {
    routeId,
    path,
    title,
    navigation: "primary" as const,
    parentPath: null,
    detailOfPath: null,
    purpose: "页面用途",
    userQuestions: ["这个页面讲什么？"],
    h1: title,
    summary: "页面摘要",
    ctaLabel: null,
    ctaTargetPath: null,
  };
}

function section(routeId: string, sectionId: string) {
  return {
    routeId,
    sectionId,
    blockKind: "prose",
    heading: `${sectionId} 标题`,
    purpose: "区块用途",
    body: "区块正文",
    sourceDocumentIds: ["doc-1"],
    evidenceExcerpts: ["证据摘录"],
    mediaIds: [],
    entityIds: [],
    faqIds: [],
  };
}

function baseWire() {
  return {
    wireSchemaVersion: 2,
    operationToken: TOKEN,
    inventorySha256: SHA,
    routes: [route("home", "/", "首页"), route("about", "/about/", "关于")],
    sections: [section("home", "home-hero")],
    navigation: [{ label: "首页", targetPath: "/" }],
    coverage: [
      {
        sourceDocumentId: "doc-1",
        status: "used",
        routeIds: ["home"],
        omissionReason: null,
      },
    ],
  };
}

function completeWire() {
  return {
    ...baseWire(),
    routes: [route("home", "/", "首页"), route("visit", "/visit/", "就诊指引")],
    sections: [section("home", "home-hero"), section("visit", "visit-appointments")],
    navigation: [
      { label: "首页", targetPath: "/" },
      { label: "就诊信息", targetPath: "/visit/" },
    ],
    coverage: [
      {
        sourceDocumentId: "doc-1",
        status: "used",
        routeIds: ["home", "visit"],
        omissionReason: null,
      },
    ],
  };
}

describe("content plan repair issue identity", () => {
  it("names the orphan route in the section-ownership message", () => {
    const parsed = siteContentPlanWireV2Schema.safeParse(baseWire());
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issue = parsed.error.issues.find((item) =>
      item.message.includes("Every route must own at least one section"),
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("route about (/about/");
    expect(issue!.message).toContain("关于");
  });

  it("forwards custom messages through the repair issue formatter", () => {
    const parsed = siteContentPlanWireV2Schema.safeParse(baseWire());
    if (parsed.success) throw new Error("expected schema failure");
    const formatted = siteContentPlanSchemaRepairIssues(parsed.error);
    const ownership = formatted.find((token) =>
      token.includes("@routes.1.routeId"),
    );
    expect(ownership).toContain(
      "CONTENT_PLAN_SCHEMA_CUSTOM@routes.1.routeId: Every route must own at least one section; route about (/about/",
    );
  });

  it("names the section that targets an absent route", () => {
    const wire = baseWire();
    wire.sections.push(section("ghost", "ghost-block"));
    const parsed = siteContentPlanWireV2Schema.safeParse(wire);
    if (parsed.success) throw new Error("expected schema failure");
    const formatted = siteContentPlanSchemaRepairIssues(parsed.error);
    expect(
      formatted.some(
        (token) =>
          token.includes("@sections.1.routeId") &&
          token.includes("section ghost-block") &&
          token.includes("unknown routeId ghost"),
      ),
    ).toBe(true);
  });

  it("names the route and both CTA fields on a CTA mismatch", () => {
    const wire = baseWire();
    wire.routes[1]!.ctaLabel = "了解更多";
    const parsed = siteContentPlanWireV2Schema.safeParse(wire);
    if (parsed.success) throw new Error("expected schema failure");
    const formatted = siteContentPlanSchemaRepairIssues(parsed.error);
    expect(
      formatted.some(
        (token) =>
          token.includes("@routes.1.ctaLabel") &&
          token.includes("route about (/about/)") &&
          token.includes('"了解更多"'),
      ),
    ).toBe(true);
  });

  it("keeps non-custom zod issues as bare tokens", () => {
    const error = new z.ZodError([
      {
        code: "invalid_type",
        expected: "string",
        received: "number",
        path: ["operationToken"],
        message: "Expected string, received number",
      },
    ]);
    expect(siteContentPlanSchemaRepairIssues(error)).toEqual([
      "CONTENT_PLAN_SCHEMA_INVALID_TYPE@operationToken",
    ]);
  });

  it("preserves the materialized navigation failure when a valid wire repeats an appointment target", () => {
    const wire = completeWire();
    wire.navigation.push({ label: "预约指引", targetPath: "/visit/" });
    const parsed = siteContentPlanWireV2Schema.safeParse(wire);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;

    let materializedError: unknown;
    try {
      siteContentPlanV2FromWire(parsed.data, {
        operationToken: TOKEN,
        inventorySha256: SHA,
      });
    } catch (error) {
      materializedError = error;
    }
    expect(materializedError).toBeInstanceOf(z.ZodError);
    if (!(materializedError instanceof z.ZodError)) {
      throw new Error("expected materialized content-plan validation to fail");
    }
    expect(materializedError.issues).toEqual([
      expect.objectContaining({
        path: ["navigation"],
        message: "Navigation route coordinates must be unique",
      }),
    ]);
    expect(siteContentPlanRepairIssues(materializedError)).toEqual([
      "CONTENT_PLAN_SCHEMA_CUSTOM@navigation: Navigation route coordinates must be unique",
    ]);
  });

  it("materializes the same complete plan once its navigation targets are unique", () => {
    const wire = completeWire();
    const parsed = siteContentPlanWireV2Schema.safeParse(wire);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;

    const plan = siteContentPlanV2FromWire(parsed.data, {
      operationToken: TOKEN,
      inventorySha256: SHA,
    });
    expect(plan.navigation).toEqual(wire.navigation);
    expect(plan.routes.map((item) => ({
      id: item.id,
      path: item.path,
      sections: item.sections.map((block) => block.id),
    }))).toEqual([
      { id: "home", path: "/", sections: ["home-hero"] },
      { id: "visit", path: "/visit/", sections: ["visit-appointments"] },
    ]);
  });

  it("preserves precise semantic repair issues without replacing them with a schema token", () => {
    const issues = [
      "CONTENT_PLAN_REQUIRED_MEDIA_UNBOUND",
      "CONTENT_PLAN_REQUIRED_DOCUMENT_NOT_RENDER_BOUND",
    ];
    expect(siteContentPlanRepairIssues(
      new SiteContentPlanValidationError(issues),
    )).toEqual(issues);
  });

  it.each([
    new Error("untrusted provider response details"),
    { issues: ["untrusted issue text"], message: "untrusted response details" },
    null,
  ])("uses a safe fallback for an unknown error (%#)", (error) => {
    expect(siteContentPlanRepairIssues(error)).toEqual([
      "CONTENT_PLAN_SCHEMA_INVALID",
    ]);
  });
});
