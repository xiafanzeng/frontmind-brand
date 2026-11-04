// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assertUpstreamPromptBudget,
  upstreamPromptCharacterCount,
} from "@frontmind/module-contracts/upstream-prompt-budget";

import {
  configureManusProviderCore,
  type ManusProviderCore,
  NATIVE_TEMPLATE_COORDINATE_PROMPT_INSTRUCTIONS,
  nativeSourcePrompt,
  nativeSourceRepairSystemPromptForWorkflow,
  nativeSourceSystemPromptForWorkflow,
  safePublicDocuments,
} from "../server/siteops/manus-provider.js";

configureManusProviderCore({
  tables: {},
  assertUpstreamPromptBudget,
} as unknown as ManusProviderCore);

describe("native source system prompt (full-branch doc view)", () => {
  const prompt = nativeSourceSystemPromptForWorkflow("2.9.0");

  it("requires a complete-document view grouped by knowledge branch", () => {
    expect(prompt).toContain("完整文档模态弹层");
    expect(prompt).toContain("branchIds");
    expect(prompt).toContain("branch.title");
    expect(prompt).toContain("按合同顺序");
    expect(prompt).toContain("文档大标题");
  });

  it("forbids partial node display and keeps verbatim rules", () => {
    expect(prompt).toContain("不得只展示被引用的节点");
    expect(prompt).toContain("不得摘要化、改写或省略任何节点");
    expect(prompt).toContain("去掉 http(s):// 前缀");
    expect(prompt).toContain("禁止新增 route manifest 路由");
  });

  it("wires every existing clickable element and bans aggregation modules", () => {
    expect(prompt).toContain("每一个可点击的内容元素");
    expect(prompt).toContain("不得以页面跳转代替文档打开");
    expect(prompt).toContain("严禁为了承载文档入口而新增");
    expect(prompt).toContain("聚合模块或聚合区块");
    expect(prompt).toContain("route manifest、路由路径与页面结构必须与冻结内容计划完全一致");
    expect(prompt).toContain("不得为对齐知识分支而增删或改名路由");
  });

  it("requires the deterministic DOM contract used by browser QA", () => {
    expect(prompt).toContain("frontmind-site-document-view-plan-v1.json");
    expect(prompt).toContain("data-frontmind-document-branches");
    expect(prompt).toContain("data-frontmind-section");
    expect(prompt).toContain('role="dialog"');
    expect(prompt).toContain("data-frontmind-document-dialog");
    expect(prompt).toContain("data-frontmind-document-branch");
    expect(prompt).toContain("data-frontmind-document-node");
    expect(prompt).toContain("data-frontmind-document-close");
    expect(prompt).toContain("document-level 委托点击处理");
    expect(prompt).toContain("branchIds=[] 时不得设置空");
    expect(prompt).toContain("plan.branches[].nodes[].id");
    expect(prompt).toContain("nodeContentSource/splitDossierRule");
    expect(prompt).toContain("dossier 是弹层正文的唯一来源");
  });

  it("keeps real href semantics while intercepting an unmodified primary click", () => {
    expect(prompt).toContain("普通无修饰键的鼠标主键点击");
    expect(prompt).toContain("preventDefault");
    expect(prompt).toContain("Ctrl/Meta/Shift/Alt 修饰键");
    expect(prompt).toContain("中键或新窗口语义仍保留 href");
  });

  it("repeats the document-view contract during a repair attempt", () => {
    const repairPrompt = nativeSourceRepairSystemPromptForWorkflow("2.9.0");

    expect(repairPrompt).toContain("frontmind-site-document-view-plan-v1.json");
    expect(repairPrompt).toContain("data-frontmind-document-branches");
    expect(repairPrompt).toContain("data-frontmind-document-dialog");
    expect(repairPrompt).toContain("data-frontmind-document-node");
    expect(repairPrompt).toContain("无修饰键主键点击时 preventDefault");
    expect(repairPrompt).toContain("branchIds=[] 时不得设置空");
    expect(repairPrompt).toContain("nodeContentSource/splitDossierRule");
  });
});

describe("safePublicDocuments branch metadata", () => {
  const snapshot = {
    documents: [
      {
        id: "1.01",
        path: "frontmind_knowledge_base/nodes/0001.md",
        title: "医院概况",
        content: "# 医院概况\n\n一段逐字事实。",
        kind: "leaf",
        branchId: "identity",
        branchTitle: "企业身份",
        order: 0,
        customerVisible: true,
      },
      {
        id: "1.02",
        path: "frontmind_knowledge_base/nodes/0002.md",
        title: "医院性质",
        content: "# 医院性质\n\n另一段逐字事实。",
        kind: "leaf",
        branchId: "identity",
        branchTitle: "企业身份",
        order: 1,
        evidenceStatus: "inferred",
      },
      {
        id: "2.01",
        path: "frontmind_knowledge_base/nodes/0003.md",
        title: "无分支节点",
        content: "# 无分支节点\n\n内容。",
        kind: "leaf",
      },
    ],
  } as unknown as Parameters<typeof safePublicDocuments>[0];

  it("keeps branchId, branchTitle and order for doc-view assembly", () => {
    const documents = safePublicDocuments(snapshot);
    expect(documents).toHaveLength(2);
    expect(documents[0]).toMatchObject({
      id: "1.01",
      branchId: "identity",
      branchTitle: "企业身份",
      order: 0,
    });
  });

  it("omits branch fields gracefully when the snapshot lacks them", () => {
    const documents = safePublicDocuments(snapshot);
    expect(documents[1]!.branchId).toBeUndefined();
    expect(documents[1]!.branchTitle).toBeUndefined();
    expect(documents[1]!.order).toBeUndefined();
  });
});

describe("native source prompt budget", () => {
  it.each(Object.entries(NATIVE_TEMPLATE_COORDINATE_PROMPT_INSTRUCTIONS))(
    "keeps the reachable fresh-build %s prompt below a 100-character safety margin",
    (_name, templateCoordinateInstruction) => {
      const prompt = nativeSourcePrompt({
        operationToken:
          "siteops-native-source:00000000-0000-4000-8000-000000000000:1",
        baseSourceSha256: "a".repeat(64),
        contractVersion: 2,
        runtimeCoordinates: {} as never,
        workflowVersion: "2.9.0",
        hasCustomerFeedback: true,
        hasKnowledgeMedia: true,
        templateCoordinateInstruction,
        contentPlanSha256: "b".repeat(64),
      });

      expect(upstreamPromptCharacterCount(prompt)).toBeLessThanOrEqual(2_900);
    },
  );

  it("keeps the reachable continuous-revision prompt below the same margin", () => {
    const prompt = nativeSourcePrompt({
      operationToken:
        "siteops-native-source:00000000-0000-4000-8000-000000000000:1",
      baseSourceSha256: "a".repeat(64),
      contractVersion: 2,
      runtimeCoordinates: {} as never,
      workflowVersion: "2.9.0",
      hasCustomerFeedback: true,
      hasRevisionMedia: true,
      hasRevisionBaseline: true,
      hasKnowledgeMedia: true,
      // Continuous revisions use the frozen parent source, so the provider
      // deliberately omits the mutually exclusive fresh-template coordinate.
      contentPlanSha256: "b".repeat(64),
    });

    expect(upstreamPromptCharacterCount(prompt)).toBeLessThanOrEqual(2_900);
  });
});
