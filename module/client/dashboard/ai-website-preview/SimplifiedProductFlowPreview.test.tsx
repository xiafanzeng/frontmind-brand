import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnterpriseRagPreview } from "./EnterpriseRagPreview";
import {
  loadWebsiteDraft,
  SimplifiedWebsiteBuilderPreview,
} from "./SimplifiedWebsiteBuilderPreview";
import { previewRagAnswer } from "./preview-copy";
import {
  listEvaluationReports,
  listPublishDecisions,
  saveEvaluationReport,
} from "./evaluation-report-store";

const draftStorageKey = "frontmind.website-builder.draft";

beforeEach(() => window.localStorage.clear());

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function trialAssistantOnce(question = "FrontMind 可以帮企业做什么？") {
  fireEvent.change(screen.getByLabelText("在网站助手中提问"), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
  await waitFor(() => {
    expect(screen.getByText(previewRagAnswer)).toBeTruthy();
    expect(screen.getByText("助手试用已完成")).toBeTruthy();
  });
}

describe("simplified AI website preview", () => {
  it("shows exactly three global steps and enters the merged website design step", () => {
    render(<SimplifiedWebsiteBuilderPreview />);

    const journey = screen.getByRole("list", { name: "网站建设流程" });
    expect(within(journey).getAllByRole("listitem")).toHaveLength(3);
    expect(within(journey).getByRole("button", { name: /选择模板$/ })).toBeTruthy();
    expect(within(journey).getByRole("button", { name: /网站设计$/ })).toBeTruthy();
    expect(within(journey).getByRole("button", { name: /建设评估$/ })).toBeTruthy();
    expect(within(journey).queryByRole("button", { name: /确认结构/ })).toBeNull();
    expect(within(journey).queryByRole("button", { name: /AI 助手/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();
  });

  it("renders four design sections with one knowledge projection and one preview device picker", () => {
    render(<SimplifiedWebsiteBuilderPreview initialStep="design" />);

    for (const sectionName of ["网站基础", "页面与栏目", "主题颜色", "助手设置"]) {
      expect(screen.getByRole("heading", { name: sectionName, level: 3 })).toBeTruthy();
    }

    expect(screen.getAllByTestId("website-design-knowledge-summary")).toHaveLength(1);
    expect(screen.getAllByTestId("website-design-preview")).toHaveLength(1);
    expect(screen.getAllByLabelText("预览设备")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /预览$/ })).toHaveLength(2);

    expect(screen.queryByLabelText(/站点语言/)).toBeNull();
    expect(screen.queryByLabelText(/企业官网 URL/)).toBeNull();
    expect(screen.queryByLabelText(/Logo \/ 品牌标识/)).toBeNull();
    expect(screen.queryByText(/从企业官网生成品牌建议|官网品牌建议|更多品牌设置/)).toBeNull();
    expect(screen.queryByLabelText(/展示回答来源/)).toBeNull();
  });

  it("migrates a V1 structure and assistant draft into one V2 design without deleted fields", async () => {
    window.localStorage.setItem(draftStorageKey, JSON.stringify({
      version: 1,
      updatedAt: 123,
      confirmed: true,
      completedStepIds: ["template", "structure", "assistant"],
      selectedTemplateId: "help-center",
      templateSourceUrl: "https://template.example/layout",
      disabledPageIds: ["services", "guides", "contact"],
      brand: {
        siteName: "远山产品中心",
        siteGoal: "让客户快速了解远山的产品与服务",
        siteLanguage: "en-US",
        brandMark: "YS",
        officialUrl: "https://example.com",
        recognized: true,
        siteAccent: "#a44f25",
      },
      assistant: {
        name: "远山助手",
        welcome: "您好，我会根据远山知识库回答问题。",
        accent: "#315b8a",
        followSiteAccent: false,
        showSources: false,
        tested: true,
      },
    }));

    render(<SimplifiedWebsiteBuilderPreview initialStep="assistant" />);

    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();
    expect((screen.getByLabelText("网站名称") as HTMLInputElement).value).toBe("远山产品中心");
    expect((screen.getByLabelText("站点简介 / 建站目标") as HTMLTextAreaElement).value).toBe("让客户快速了解远山的产品与服务");
    expect((screen.getByLabelText("助手名称") as HTMLInputElement).value).toBe("远山助手");
    expect((screen.getByLabelText("欢迎语") as HTMLTextAreaElement).value).toBe("您好，我会根据远山知识库回答问题。");
    expect(screen.getByRole("button", { name: "选择网站主题色 #a44f25" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "选择助手主题色 #315b8a" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("在网站中显示快速开始") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("在网站中显示产品与服务") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("在网站中显示常见问题") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("助手试用未完成")).toBeTruthy();

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(draftStorageKey) ?? "{}");
      expect(saved.version).toBe(2);
      expect(saved.design).toEqual(expect.objectContaining({
        siteName: "远山产品中心",
        siteGoal: "让客户快速了解远山的产品与服务",
        featuredPageIds: ["start", "faq"],
        siteAccent: "#a44f25",
        assistant: expect.objectContaining({
          name: "远山助手",
          welcome: "您好，我会根据远山知识库回答问题。",
          accent: "#315b8a",
          followSiteAccent: false,
          tested: false,
        }),
      }));
      // Legacy name and goal were user-confirmed in the retired structure
      // step, so the migrated draft shields them from new recommendations.
      expect(saved.design.recommendationEditedFields).toEqual(["siteName", "siteGoal"]);
      expect(saved.completedStepIds).toEqual(["template"]);
      expect(saved).not.toHaveProperty("brand");
      expect(saved).not.toHaveProperty("assistant");
      expect(saved).not.toHaveProperty("disabledPageIds");
      expect(saved.design).not.toHaveProperty("siteLanguage");
      expect(saved.design).not.toHaveProperty("brandMark");
      expect(saved.design).not.toHaveProperty("officialUrl");
      expect(saved.design.assistant).not.toHaveProperty("showSources");
    });
  });

  it("persists every editable design field through the single V2 design draft", async () => {
    const firstMount = render(<SimplifiedWebsiteBuilderPreview initialStep="design" />);

    fireEvent.change(screen.getByLabelText("网站名称"), { target: { value: "远山知识站" } });
    fireEvent.change(screen.getByLabelText("站点简介 / 建站目标"), { target: { value: "提供可信的产品答案" } });
    fireEvent.click(screen.getByLabelText("在网站中显示使用指南"));
    fireEvent.click(screen.getByLabelText("在网站中显示常见问题"));
    fireEvent.click(screen.getByRole("button", { name: "选择网站主题色 #315b8a" }));
    fireEvent.change(screen.getByLabelText("助手名称"), { target: { value: "远山助手" } });
    fireEvent.change(screen.getByLabelText("欢迎语"), { target: { value: "您好，请问想了解哪项产品？" } });
    fireEvent.click(screen.getByRole("button", { name: "选择助手主题色 #3e6b57" }));

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(draftStorageKey) ?? "{}");
      expect(Object.keys(saved).sort()).toEqual([
        "completedStepIds",
        "confirmed",
        "design",
        "selectedTemplateId",
        "templateSourceUrl",
        "updatedAt",
        "version",
      ]);
      expect(Object.keys(saved.design).sort()).toEqual([
        "assistant",
        "featuredPageIds",
        "recommendationEditedFields",
        "siteAccent",
        "siteGoal",
        "siteName",
      ]);
      expect(saved.design).toEqual({
        siteName: "远山知识站",
        siteGoal: "提供可信的产品答案",
        featuredPageIds: ["start", "services", "faq"],
        siteAccent: "#315b8a",
        assistant: {
          name: "远山助手",
          welcome: "您好，请问想了解哪项产品？",
          accent: "#3e6b57",
          followSiteAccent: false,
          tested: false,
        },
        recommendationEditedFields: ["siteName", "siteGoal", "featuredRoutes"],
      });
    });

    firstMount.unmount();
    render(<SimplifiedWebsiteBuilderPreview initialStep="design" />);

    expect((screen.getByLabelText("网站名称") as HTMLInputElement).value).toBe("远山知识站");
    expect((screen.getByLabelText("助手名称") as HTMLInputElement).value).toBe("远山助手");
    expect((screen.getByLabelText("在网站中显示使用指南") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("在网站中显示常见问题") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "选择助手主题色 #3e6b57" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("falls back safely when a saved draft is damaged", () => {
    window.localStorage.setItem(draftStorageKey, "{not-json");

    render(<SimplifiedWebsiteBuilderPreview initialStep="structure" />);

    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();
    expect((screen.getByLabelText("助手名称") as HTMLInputElement).value).toBe("FrontMind 企业助手");
  });

  it("retains contract-valid live template and route IDs without trusting them in the static preview", () => {
    window.localStorage.setItem(draftStorageKey, JSON.stringify({
      version: 2,
      updatedAt: 123,
      confirmed: true,
      completedStepIds: ["template", "design"],
      selectedTemplateId: "33333333-3333-4333-8333-333333333333",
      templateSourceUrl: "",
      design: {
        siteName: "远山知识站",
        siteGoal: "让客户找到可信答案",
        featuredPageIds: ["home", "products:cloud", "INVALID /", "company:faq"],
        siteAccent: "#6f35a5",
        assistant: {
          name: "远山助手",
          welcome: "您好，我会依据知识库回答。",
          accent: "#6f35a5",
          followSiteAccent: true,
          tested: true,
        },
      },
    }));

    const loaded = loadWebsiteDraft();
    expect(loaded.selectedTemplateId).toBe("33333333-3333-4333-8333-333333333333");
    expect(loaded.design.featuredPageIds).toEqual(["home", "products:cloud", "company:faq"]);
    expect(loaded.completedStepIds).toEqual(["template", "design"]);

    render(<SimplifiedWebsiteBuilderPreview />);
    expect((screen.getByRole("radio", { name: /知识帮助中心/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText("products:cloud")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByText("共 5 个栏目，3 个启用")).toBeTruthy();
    expect((screen.getByLabelText("在网站中显示快速开始") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("在网站中显示产品与服务") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("在网站中显示使用指南") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("在网站中显示常见问题") as HTMLInputElement).checked).toBe(false);
  });

  it("focuses the requested design section from legacy step coordinates", () => {
    render(
      <SimplifiedWebsiteBuilderPreview initialStep="structure" initialSection="site" />,
    );

    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();
    const siteSection = document.querySelector('[data-design-section="site"]');
    expect(siteSection?.classList.contains("is-section-focus")).toBe(true);
    const assistantSection = document.querySelector('[data-design-section="assistant"]');
    expect(assistantSection?.classList.contains("is-section-focus")).toBe(false);
  });

  it("shows four non-scoring configuration checks and routes repairs to their area", () => {
    render(<SimplifiedWebsiteBuilderPreview initialStep="evaluation" />);

    const panel = screen.getByTestId("website-config-checks");
    expect(panel.textContent).toContain("配置检查项");
    expect(panel.textContent).toContain("非计分检查");
    expect(panel.textContent).toContain("不参与 40/40/20 加权评分");
    for (const id of ["C01", "C02", "C03", "C04"]) {
      expect(panel.textContent).toContain(id);
    }
    expect(panel.textContent).toContain("模板选择");
    expect(panel.textContent).toContain("页面结构");
    expect(panel.textContent).toContain("网站信息与主题");
    expect(panel.textContent).toContain("助手配置与真实试聊");
    expect(panel.textContent).toContain("待确认");

    // The assistant repair entry jumps straight into the assistant area.
    fireEvent.click(
      within(panel).getByRole("button", { name: "查看助手设置" }),
    );
    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();
    const assistantSection = document.querySelector('[data-design-section="assistant"]');
    expect(assistantSection?.classList.contains("is-section-focus")).toBe(true);
  });

  it("keeps contract-valid custom accents that sit outside the demo palette", () => {
    window.localStorage.setItem(draftStorageKey, JSON.stringify({
      version: 2,
      updatedAt: 123,
      confirmed: false,
      completedStepIds: ["template"],
      selectedTemplateId: "help-center",
      templateSourceUrl: "",
      design: {
        siteName: "远山知识站",
        siteGoal: "让客户找到可信答案",
        featuredPageIds: ["start"],
        siteAccent: "#2457a7",
        assistant: {
          name: "远山助手",
          welcome: "您好，我会依据知识库回答。",
          accent: "#8a2be2",
          followSiteAccent: false,
          tested: false,
        },
      },
    }));

    const loaded = loadWebsiteDraft();
    // A server-saved accent can be any contract hex; reloading the local
    // draft must not clamp it back to a demo palette default.
    expect(loaded.design.siteAccent).toBe("#2457a7");
    expect(loaded.design.assistant.accent).toBe("#8a2be2");
  });

  it("preserves an explicitly empty V2 featured-route selection across refresh", () => {
    window.localStorage.setItem(draftStorageKey, JSON.stringify({
      version: 2,
      updatedAt: 123,
      confirmed: false,
      completedStepIds: ["template"],
      selectedTemplateId: "help-center",
      templateSourceUrl: "",
      design: {
        siteName: "远山知识站",
        siteGoal: "让客户找到可信答案",
        featuredPageIds: [],
        siteAccent: "#6f35a5",
        assistant: {
          name: "远山助手",
          welcome: "您好，我会依据知识库回答。",
          accent: "#6f35a5",
          followSiteAccent: true,
          tested: true,
        },
      },
    }));

    const firstMount = render(<SimplifiedWebsiteBuilderPreview initialStep="design" />);
    expect(screen.getByText("共 5 个栏目，0 个启用")).toBeTruthy();
    expect(screen.getAllByRole("checkbox", { name: /在网站中显示/ }).every(
      (checkbox) => !(checkbox as HTMLInputElement).checked,
    )).toBe(true);

    firstMount.unmount();
    render(<SimplifiedWebsiteBuilderPreview initialStep="design" />);
    expect(screen.getByText("共 5 个栏目，0 个启用")).toBeTruthy();
    expect(loadWebsiteDraft().design.featuredPageIds).toEqual([]);
  });

  it("binds assistant trial completion to an answered exchange and the current design", async () => {
    vi.useFakeTimers();
    render(<SimplifiedWebsiteBuilderPreview initialStep="design" />);

    fireEvent.change(screen.getByLabelText("在网站助手中提问"), {
      target: { value: "zzzzzz-no-known-answer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByText("助手试用未完成")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("在网站助手中提问"), {
      target: { value: "FrontMind 可以帮企业做什么？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    fireEvent.change(screen.getByLabelText("助手名称"), {
      target: { value: "计时期间更新的助手" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByText("助手试用未完成")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("在网站助手中提问"), {
      target: { value: "FrontMind 可以帮企业做什么？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByText("助手试用已完成")).toBeTruthy();
  });

  it("requires one real trial and then goes directly from website design to evaluation", async () => {
    const onStepChange = vi.fn();
    render(<SimplifiedWebsiteBuilderPreview initialStep="design" onStepChange={onStepChange} />);

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByRole("status").textContent).toMatch(/右侧统一预览中提问一次/);
    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();

    await trialAssistantOnce();
    expect(screen.getAllByRole("button", { name: /来源：合成资料/ }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(screen.getByRole("heading", { name: "建设检查与评估" })).toBeTruthy();
    expect(onStepChange).toHaveBeenLastCalledWith("evaluation");
    expect(screen.queryByRole("heading", { name: "配置 AI 助手" })).toBeNull();
  });

  it("preserves the custom assistant color while following site color and restores it afterward", async () => {
    const firstMount = render(<SimplifiedWebsiteBuilderPreview initialStep="design" />);
    const followToggle = screen.getByLabelText(/跟随网站主题色/) as HTMLInputElement;

    expect(followToggle.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "选择助手主题色 #315b8a" }));
    expect(followToggle.checked).toBe(false);
    fireEvent.click(followToggle);
    expect(followToggle.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "选择网站主题色 #3e6b57" }));

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(draftStorageKey) ?? "{}");
      expect(saved.design.siteAccent).toBe("#3e6b57");
      expect(saved.design.assistant.accent).toBe("#315b8a");
      expect(saved.design.assistant.followSiteAccent).toBe(true);
    });

    firstMount.unmount();
    render(<SimplifiedWebsiteBuilderPreview initialStep="design" />);

    const restoredFollowToggle = screen.getByLabelText(/跟随网站主题色/) as HTMLInputElement;
    expect(restoredFollowToggle.checked).toBe(true);
    fireEvent.click(restoredFollowToggle);
    expect(screen.getByRole("button", { name: "选择助手主题色 #315b8a" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("invalidates the one combined design step when any design field changes", async () => {
    render(<SimplifiedWebsiteBuilderPreview />);

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await trialAssistantOnce();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(document.querySelectorAll('[data-complete="true"]')).toHaveLength(2);

    const journey = screen.getByRole("list", { name: "网站建设流程" });
    fireEvent.click(within(journey).getByRole("button", { name: /网站设计$/ }));
    fireEvent.change(screen.getByLabelText("网站名称"), { target: { value: "更新后的帮助中心" } });
    expect(document.querySelectorAll('[data-complete="true"]')).toHaveLength(1);

    fireEvent.click(within(journey).getByRole("button", { name: /建设评估$/ }));
    expect(screen.getByRole("button", { name: "确认当前建设草稿" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows an unassessed website-only 40/40/20 score without a RAG scoring group", () => {
    render(<SimplifiedWebsiteBuilderPreview initialStep="evaluation" />);

    expect(screen.queryByRole("heading", { name: "配置门槛（不计分）" })).toBeNull();
    expect(screen.getByLabelText(/当前加权评估分/).textContent).toMatch(/—.*\/100.*暂定结果/);
    expect(screen.getByText("当前建议：暂不建议发布")).toBeTruthy();
    expect(screen.getByText("无法计算")).toBeTruthy();
    expect(screen.getByText(/0 \+ 0 \+ 0 = 0 → — 分/)).toBeTruthy();
    expect(screen.getByText("权重：网站内容与体验 40 分 · 企业事实与公开边界 40 分 · 流程与发布说明 20 分")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "RAG 回答质量" })).toBeNull();
    expect(within(screen.getByLabelText("关联的企业 RAG 评估")).getByText(/未关联评估快照；不影响网站得分或发布选择/)).toBeTruthy();
  });

  it("keeps publish confirmation available at low coverage and stores a separate risk decision", () => {
    render(<SimplifiedWebsiteBuilderPreview initialStep="evaluation" />);

    const releaseButton = screen.getByRole("button", { name: "进入发布确认" });
    expect(releaseButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(releaseButton);

    const dialog = within(screen.getByRole("dialog", { name: "发布确认" }));
    expect(dialog.getByText(/这些结果只提供质量建议，不会替你决定/)).toBeTruthy();
    expect(dialog.getByText(/当前原型不会执行真实部署/)).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "我已了解风险，继续发布" }));

    expect(screen.queryByRole("dialog", { name: "发布确认" })).toBeNull();
    expect(listPublishDecisions()).toEqual([
      expect.objectContaining({
        action: "publish",
        mode: "accepted_risk",
        riskAcknowledged: true,
        evaluationReportIds: [expect.stringMatching(/^website-report-/)],
      }),
    ]);
    expect(listEvaluationReports().map((report) => report.reportId)).toEqual(
      listPublishDecisions()[0].evaluationReportIds,
    );
  });

  it("explicitly links a RAG snapshot without changing the website score", () => {
    expect(saveEvaluationReport({
      reportId: "rag-report-linked",
      createdAt: "2026-10-23T08:00:00.000Z",
      subject: { kind: "rag-answer", id: "answer-linked", version: "rag-eval-1.2" },
      result: {
        skillId: "enterprise-rag-evaluation",
        version: "1.0.0",
        status: "completed",
        score: 12,
        coverage: 100,
        recommendation: "not_recommended",
        summary: "回答质量较低，但结果只提供建议。",
        dimensions: [],
        risks: [{
          id: "risk-rag-linked",
          severity: "critical" as const,
          title: "回答关键风险",
          summary: "该风险不会改变网站建设得分。",
          evidenceIds: [],
        }],
        relatedReportIds: [],
      },
    })).toBe(true);

    render(<SimplifiedWebsiteBuilderPreview initialStep="evaluation" />);
    const scoreBefore = screen.getByLabelText(/当前加权评估分/).textContent;
    fireEvent.click(screen.getByRole("button", { name: "关联最新 RAG 评估" }));

    expect(within(screen.getByLabelText("关联的企业 RAG 评估")).getByText(/已关联 12\/100 · 1.0.0/)).toBeTruthy();
    expect(screen.getByLabelText(/当前加权评估分/).textContent).toBe(scoreBefore);
  });

  it("uses the merged website design entry from the enterprise RAG page", () => {
    const onOpenWebsite = vi.fn();
    const onOpenWebsiteAssistant = vi.fn();
    render(
      <EnterpriseRagPreview
        onOpenWebsite={onOpenWebsite}
        onOpenWebsiteAssistant={onOpenWebsiteAssistant}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "开始网站建设" }));
    expect(onOpenWebsite).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "进入网站设计" }));
    expect(onOpenWebsiteAssistant).toHaveBeenCalledOnce();
    expect(onOpenWebsite).toHaveBeenCalledOnce();
  });
});
