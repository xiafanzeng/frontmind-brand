import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnterpriseRagPreview } from "./EnterpriseRagPreview";
import { RAG_SAMPLE_CASES } from "./rag-evaluation-cases";
import { installRagPreviewFixtures } from "./rag-preview-fixture-loader";
import { ragPreviewFixtures } from "./rag-preview-fixtures-data";
import {
  loadWebsiteDraft,
  SimplifiedWebsiteBuilderPreview,
} from "./SimplifiedWebsiteBuilderPreview";
import type { WebsiteEvaluationAuthorityView } from "./WebsiteEvaluationWorkspace";
import { previewRagAnswer } from "./preview-copy";
import {
  listEvaluationReports,
  listPublishDecisions,
  saveEvaluationReport,
} from "./evaluation-report-store";

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  message: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMock }));

const draftStorageKey = "frontmind.website-builder.draft";
const simplifiedProductPreviewStyles = readFileSync(
  "client/dashboard/ai-website-preview/simplified-product-preview.css",
  "utf8",
);
installRagPreviewFixtures(ragPreviewFixtures);

beforeEach(() => {
  window.localStorage.clear();
  toastMock.error.mockClear();
  toastMock.message.mockClear();
  toastMock.success.mockClear();
});
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

function completedWebsiteEvaluation(reportId = "report-first-assessment"): WebsiteEvaluationAuthorityView {
  return {
    buildId: "build-first-assessment",
    status: "completed",
    runId: "run-first-assessment",
    reportId,
    reportHash: `hash-${reportId}`,
    reportUrl: `/website-evaluations/reports/${reportId}`,
    score: 86,
    recommendation: "recommended",
    verdict: "推荐发布",
    summary: "当前网站版本已完成建设评估。",
    judgmentCoverage: 100,
    brandReferenceCoverage: 100,
    dimensions: [],
    risks: [],
    evidenceUpdatedLabel: "2026-11-08T14:35:12+08:00",
  };
}

describe("simplified AI website preview", () => {
  it("suppresses the Safari pointer focus rectangle without hiding keyboard focus", () => {
    expect(simplifiedProductPreviewStyles).toMatch(
      /\.sfp-root\[data-step\][^{]+\.sfp-steps[^{}]+button\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent;/s,
    );
    expect(simplifiedProductPreviewStyles).toMatch(
      /\.sfp-root\[data-step\][^{]+\.sfp-steps[^{}]+button:focus:not\(:focus-visible\)\s*\{[^}]*outline:\s*0;/s,
    );
    expect(simplifiedProductPreviewStyles).toMatch(
      /\.sfp-root\[data-step\][^{]+\.sfp-steps[^{}]+button:focus-visible\s*\{[^}]*box-shadow:[^}]+outline:\s*0;/s,
    );
  });

  it("shows exactly three global steps and enters the merged website design step", () => {
    render(<SimplifiedWebsiteBuilderPreview />);

    const journey = screen.getByRole("list", { name: "网站建设流程" });
    const leadingActions = screen.getByRole("group", { name: "草稿与返回" });
    const workspaceActions = screen.getByRole("group", { name: "网站流程操作" });
    expect(screen.queryByText("从知识库快速搭建帮助中心")).toBeNull();
    expect(screen.queryByText("先完成网站建设与整体评估，再考虑域名和正式上线。")).toBeNull();
    expect(journey.parentElement?.previousElementSibling).toBe(leadingActions);
    expect(journey.parentElement?.nextElementSibling).toBe(workspaceActions);
    expect(within(leadingActions).getByRole("button", { name: "保存" })).toBeTruthy();
    expect((within(leadingActions).getByRole("button", { name: "返回" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(workspaceActions).getByRole("button", { name: "进入设计" })).toBeTruthy();
    expect(document.querySelector(".sfp-draft-state")).toBeNull();
    expect(within(journey).getAllByRole("listitem")).toHaveLength(3);
    expect(within(journey).getByRole("button", { name: /选择模板$/ })).toBeTruthy();
    const designStep = within(journey).getByRole("button", { name: /网站设计$/ }) as HTMLButtonElement;
    const evaluationStep = within(journey).getByRole("button", { name: /建设评估$/ }) as HTMLButtonElement;
    expect(designStep.disabled).toBe(true);
    expect(evaluationStep.disabled).toBe(true);
    expect(within(journey).queryByRole("button", { name: /确认结构/ })).toBeNull();
    expect(within(journey).queryByRole("button", { name: /AI 助手/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "进入设计" }));
    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();
    expect(designStep.disabled).toBe(false);
    expect(evaluationStep.disabled).toBe(true);
  });

  it("shows the shared shimmer state until the draft save feedback completes", async () => {
    vi.useFakeTimers();
    render(<SimplifiedWebsiteBuilderPreview />);

    const save = screen.getByRole("button", { name: "保存" });
    fireEvent.click(save);

    const saving = screen.getByRole("button", { name: "正在保存" }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    expect(saving.getAttribute("aria-busy")).toBe("true");
    expect(saving.classList.contains("is-running")).toBe(true);
    expect(toastMock.success).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(800));

    const restored = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    expect(restored.disabled).toBe(false);
    expect(restored.hasAttribute("aria-busy")).toBe(false);
    expect(restored.classList.contains("is-running")).toBe(false);
    expect(toastMock.success).toHaveBeenCalledWith("草稿已保存");
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

    // Columns start fully selected, so a single opt-out is enough to shape
    // the persisted navigation.
    expect(
      ["快速开始", "产品与服务", "使用指南", "常见问题", "联系我们"].every(
        (name) =>
          (screen.getByLabelText(`在网站中显示${name}`) as HTMLInputElement)
            .checked,
      ),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("网站名称"), { target: { value: "远山知识站" } });
    fireEvent.change(screen.getByLabelText("站点简介 / 建站目标"), { target: { value: "提供可信的产品答案" } });
    fireEvent.click(screen.getByLabelText("在网站中显示使用指南"));
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
        featuredPageIds: ["start", "services", "faq", "contact"],
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
    fireEvent.click(screen.getByRole("button", { name: "进入设计" }));
    expect(screen.getByText("共 5 个栏目，5 个启用")).toBeTruthy();
    expect((screen.getByLabelText("在网站中显示快速开始") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("在网站中显示产品与服务") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("在网站中显示使用指南") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("在网站中显示常见问题") as HTMLInputElement).checked).toBe(true);
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
    expect(panel.textContent).toContain("发布检查");
    expect(panel.textContent).not.toContain("配置检查项");
    expect(panel.textContent).not.toContain("不计入评分");
    for (const id of ["C01", "C02", "C03", "C04"]) {
      expect(panel.textContent).not.toContain(id);
    }
    expect(panel.textContent).toContain("模板选择");
    expect(panel.textContent).toContain("页面结构");
    expect(panel.textContent).toContain("网站设置");
    expect(panel.textContent).toContain("助手试聊");
    expect(panel.querySelectorAll("li.is-pending")).toHaveLength(4);

    // The assistant repair entry jumps straight into the assistant area.
    fireEvent.click(
      within(panel).getByRole("button", { name: "查看助手" }),
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

  it("starts assessment after one real trial and opens evaluation when the new report completes", async () => {
    const onStepChange = vi.fn();
    const onReevaluateWebsiteEvaluation = vi.fn(async () => undefined);
    const view = render(<SimplifiedWebsiteBuilderPreview
      initialStep="design"
      onStepChange={onStepChange}
      onReevaluateWebsiteEvaluation={onReevaluateWebsiteEvaluation}
    />);
    const journey = screen.getByRole("list", { name: "网站建设流程" });
    const evaluationStep = within(journey).getByRole("button", { name: /建设评估$/ }) as HTMLButtonElement;
    expect(evaluationStep.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "开始评估" }));
    expect(toastMock.message).toHaveBeenCalledWith(expect.stringMatching(/右侧统一预览中提问一次/));
    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();

    await trialAssistantOnce();
    expect(screen.getAllByRole("button", { name: /来源：合成资料/ }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "开始评估" }));

    await waitFor(() => expect(onReevaluateWebsiteEvaluation).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "建设评估" })).toBeNull();
    expect(evaluationStep.disabled).toBe(true);

    view.rerender(<SimplifiedWebsiteBuilderPreview
      initialStep="design"
      onStepChange={onStepChange}
      onReevaluateWebsiteEvaluation={onReevaluateWebsiteEvaluation}
      websiteEvaluation={completedWebsiteEvaluation()}
    />);
    await waitFor(() => expect(screen.getByRole("region", { name: "建设评估" })).toBeTruthy());
    expect(evaluationStep.disabled).toBe(false);
    expect(screen.queryByRole("heading", { name: "网站设计" })).toBeNull();
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
    const onReevaluateWebsiteEvaluation = vi.fn(async () => undefined);
    const view = render(<SimplifiedWebsiteBuilderPreview
      initialStep="design"
      onReevaluateWebsiteEvaluation={onReevaluateWebsiteEvaluation}
    />);

    await trialAssistantOnce();
    fireEvent.click(screen.getByRole("button", { name: "开始评估" }));
    await waitFor(() => expect(onReevaluateWebsiteEvaluation).toHaveBeenCalledTimes(1));
    view.rerender(<SimplifiedWebsiteBuilderPreview
      initialStep="design"
      onReevaluateWebsiteEvaluation={onReevaluateWebsiteEvaluation}
      websiteEvaluation={completedWebsiteEvaluation("report-before-edit")}
    />);
    const journey = screen.getByRole("list", { name: "网站建设流程" });
    const evaluationStep = within(journey).getByRole("button", { name: /建设评估$/ }) as HTMLButtonElement;
    await waitFor(() => expect(screen.getByRole("region", { name: "建设评估" })).toBeTruthy());
    expect(evaluationStep.disabled).toBe(false);
    expect(document.querySelectorAll('[data-complete="true"]')).toHaveLength(3);

    fireEvent.click(within(journey).getByRole("button", { name: /网站设计$/ }));
    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("网站名称"), { target: { value: "更新后的帮助中心" } });
    expect(document.querySelectorAll('[data-complete="true"]')).toHaveLength(1);
    expect(evaluationStep.disabled).toBe(true);

    fireEvent.click(evaluationStep);
    expect(screen.queryByRole("region", { name: "建设评估" })).toBeNull();
    expect(screen.getByRole("heading", { name: "网站设计" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
    expect(document.querySelector(".sfp-actions")).toBeNull();
  });

  it("shows an unassessed website without a fake score, empty radar, or RAG scoring group", () => {
    render(<SimplifiedWebsiteBuilderPreview initialStep="evaluation" />);

    expect(screen.getByRole("status").textContent).toContain("尚无权威评估");
    expect(screen.queryByTestId("website-evaluation-score")).toBeNull();
    expect(screen.queryByLabelText("网站建设六维评分雷达图")).toBeNull();
    expect(screen.queryByText(/\/100/)).toBeNull();
    expect(screen.queryByText("网站质量")).toBeNull();
    expect(screen.queryByRole("heading", { name: "RAG 回答质量" })).toBeNull();
    expect(screen.queryByLabelText("RAG 参考")).toBeNull();
  });

  it("does not create a browser score, report, or publish decision in standalone mode", () => {
    render(<SimplifiedWebsiteBuilderPreview initialStep="evaluation" />);

    const releaseButton = screen.getByRole("button", { name: "完成发布" });
    expect(releaseButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(releaseButton);
    expect(screen.queryByRole("dialog", { name: "发布确认" })).toBeNull();
    expect(toastMock.message).toHaveBeenCalledWith(expect.stringMatching(/本地候选不生成浏览器评分或发布决定/));
    expect(listPublishDecisions()).toEqual([]);
    expect(listEvaluationReports()).toEqual([]);
  });

  it("keeps legacy RAG snapshots out of the redesigned website assessment", () => {
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
    expect(screen.queryByTestId("website-evaluation-score")).toBeNull();
    expect(screen.queryByLabelText("RAG 参考")).toBeNull();
    expect(screen.queryByRole("button", { name: /查找 RAG 评估/ })).toBeNull();
    expect(screen.queryByTestId("website-evaluation-score")).toBeNull();
  });

  it("keeps direct answer details in the RAG workspace without restoring removed website shortcuts", async () => {
    // jsdom 26 cannot evaluate Floating UI top-layer pseudo-classes.
    const nativeMatches = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function(this: Element, selector) {
      if (selector === ":modal" || selector === ":fullscreen") return false;
      return nativeMatches.call(this, selector);
    });
    const onOpenWebsite = vi.fn();
    const onOpenWebsiteAssistant = vi.fn();
    render(
      <EnterpriseRagPreview
        onOpenWebsite={onOpenWebsite}
        onOpenWebsiteAssistant={onOpenWebsiteAssistant}
      />,
    );

    expect(screen.getByRole("heading", { name: "待评估" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "历史问答" }));
    const history = await screen.findByRole("dialog", { name: "历史问答" });
    fireEvent.click(within(history).getByRole("button", { name: /^企业能力介绍/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "历史问答" })).toBeNull());
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const evaluation = screen.getByRole("region", { name: "本轮回答质量" });
    expect(within(evaluation).getByRole("heading", { name: "本轮回答质量" })).toBeTruthy();
    expect(within(evaluation).getByLabelText("六维诊断评分").textContent).toContain("84");
    expect(within(evaluation).getByText("待改进")).toBeTruthy();
    const actions = within(evaluation).getByRole("group", { name: "回答评估详情" });
    expect(within(actions).getAllByRole("button").map(button => button.textContent)).toEqual(["回答依据", "优化方案", "人工评审"]);
    for (const [entry, title] of [["回答依据", "回答依据与陈述核验"], ["优化方案", "优化方案"], ["人工评审", "人工评审与计算"]]) {
      fireEvent.click(within(actions).getByRole("button", { name: entry }));
      const dialog = screen.getByRole("dialog", { name: title });
      if (entry === "优化方案") expect(within(dialog).getByRole("heading", { name: "改写示例" })).toBeTruthy();
      fireEvent.click(within(dialog).getByRole("button", { name: "关闭评估面板" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).toBeNull());
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    expect(within(evaluation).queryByRole("button", { name: "理解本次判断" })).toBeNull();
    expect(screen.queryByRole("button", { name: "开始网站建设" })).toBeNull();
    expect(screen.queryByRole("button", { name: "进入网站设计" })).toBeNull();
    expect(onOpenWebsite).not.toHaveBeenCalled();
    expect(onOpenWebsiteAssistant).not.toHaveBeenCalled();

    const input = screen.getByLabelText("输入企业 RAG 预览问题");
    fireEvent.change(input, { target: { value: "我想咨询新的具体业务问题" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "试用问题" })); });
    expect(screen.getByText("我想咨询新的具体业务问题")).toBeTruthy();
    expect(screen.getByText(/此问题不在示例库/)).toBeTruthy();
    expect(within(evaluation).getByRole("heading", { name: "待评估" })).toBeTruthy();
    expect(within(evaluation).getByLabelText("六维诊断评分")).toBeTruthy();
    expect(within(evaluation).queryByText(/可能分数/)).toBeNull();
  });
});
