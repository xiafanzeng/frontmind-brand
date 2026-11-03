// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  nativeSourceSystemPromptForWorkflow,
  safePublicDocuments,
} from "../server/siteops/manus-provider.js";

describe("native source system prompt (full-branch doc view)", () => {
  const prompt = nativeSourceSystemPromptForWorkflow("2.9.0");

  it("requires a complete-document view grouped by knowledge branch", () => {
    expect(prompt).toContain("完整文档视图");
    expect(prompt).toContain("branchId");
    expect(prompt).toContain("branchTitle");
    expect(prompt).toContain("order 升序");
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
    expect(prompt).toContain("信息架构与模板基线保持不变");
    expect(prompt).toContain("与知识分支一一对应且不得重复");
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
