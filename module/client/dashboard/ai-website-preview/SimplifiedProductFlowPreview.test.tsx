import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnterpriseRagPreview } from "./EnterpriseRagPreview";
import { SimplifiedWebsiteBuilderPreview } from "./SimplifiedWebsiteBuilderPreview";
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
  vi.restoreAllMocks();
});

/** 在 AI 助手步骤的网站预览中完成一次真实问答试用。 */
async function trialAssistantOnce(question = "FrontMind 可以帮企业做什么？") {
  fireEvent.change(screen.getByLabelText("在网站助手中提问"), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
  await waitFor(() => {
    expect(screen.getByText(previewRagAnswer)).toBeTruthy();
    expect(screen.getByText("助手试用已完成")).toBeTruthy();
  });
}

describe("simplified AI website preview", () => {
  it("keeps the website journey to four directly accessible steps", () => {
    render(<SimplifiedWebsiteBuilderPreview />);

    expect(screen.getByRole("list", { name: "网站建设流程" })).toBeTruthy();
    expect(screen.getAllByText("选择模板").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByRole("heading", { name: "确认网站结构与品牌" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByRole("heading", { name: "配置 AI 助手" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /建设评估/ }));
    expect(screen.getByRole("heading", { name: "建设检查与评估" })).toBeTruthy();
    expect(screen.queryByText("上线设置（后续再处理）")).toBeNull();
    expect(screen.getByText(/权重：网站内容与体验 40 分/)).toBeTruthy();
  });

  it("keeps the template URL and enterprise website URL as separate inputs", () => {
    render(<SimplifiedWebsiteBuilderPreview />);

    expect(screen.getByLabelText("外部模板链接（导入版式）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    const officialUrl = screen.getByLabelText("企业官网 URL（生成品牌建议，可选）");
    fireEvent.change(officialUrl, { target: { value: "https://frontmind.cn" } });
    fireEvent.click(screen.getByRole("button", { name: "生成建议" }));

    expect(screen.getByRole("status").textContent).toMatch(/已根据官网 URL 生成一组品牌建议/);
    expect((screen.getByLabelText("网站名称") as HTMLInputElement).value).toBe("FrontMind 帮助中心");
    expect((screen.getByLabelText("Logo / 品牌标识") as HTMLInputElement).value).toBe("FM");
    expect(screen.getByText("FrontMind 帮助中心")).toBeTruthy();
  });

  it("persists website and assistant settings across remounts", async () => {
    const firstMount = render(<SimplifiedWebsiteBuilderPreview />);
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    fireEvent.change(screen.getByLabelText("网站名称"), { target: { value: "远山产品中心" } });
    fireEvent.change(screen.getByLabelText("Logo / 品牌标识"), { target: { value: "YS" } });
    fireEvent.click(screen.getByRole("button", { name: "选择网站主题色 #315b8a" }));
    fireEvent.click(screen.getByLabelText("在网站中显示常见问题"));

    fireEvent.click(within(screen.getByRole("list", { name: "网站建设流程" })).getByRole("button", { name: /AI 助手$/ }));
    fireEvent.change(screen.getByLabelText("助手名称"), { target: { value: "远山助手" } });
    fireEvent.click(screen.getByRole("button", { name: "选择助手主题色 #3e6b57" }));
    fireEvent.click(screen.getByLabelText(/展示回答来源/));
    expect(screen.getByText(/网站端来源已隐藏/)).toBeTruthy();

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(draftStorageKey) ?? "{}");
      expect(saved.brand.siteName).toBe("远山产品中心");
      expect(saved.assistant.name).toBe("远山助手");
      expect(saved.assistant.accent).toBe("#3e6b57");
      expect(saved.assistant.followSiteAccent).toBe(false);
    });

    firstMount.unmount();
    render(<SimplifiedWebsiteBuilderPreview initialStep="assistant" />);

    expect((screen.getByLabelText("助手名称") as HTMLInputElement).value).toBe("远山助手");
    expect(screen.getByRole("button", { name: "选择助手主题色 #3e6b57" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText(/展示回答来源/) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /确认结构/ }));
    expect((screen.getByLabelText("网站名称") as HTMLInputElement).value).toBe("远山产品中心");
    expect((screen.getByLabelText("在网站中显示常见问题") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "选择网站主题色 #315b8a" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("falls back safely when the saved draft is damaged", () => {
    window.localStorage.setItem(draftStorageKey, "{not-json");

    render(<SimplifiedWebsiteBuilderPreview initialStep="assistant" />);

    expect((screen.getByLabelText("助手名称") as HTMLInputElement).value).toBe("FrontMind 企业助手");
    expect(screen.getByRole("heading", { name: "配置 AI 助手" })).toBeTruthy();
  });

  it("does not restore a confirmed state when saved required fields are invalid", () => {
    window.localStorage.setItem(draftStorageKey, JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      confirmed: true,
      completedStepIds: ["template", "structure", "assistant"],
      selectedTemplateId: "help-center",
      templateSourceUrl: "",
      disabledPageIds: ["start", "services", "guides", "faq", "contact"],
      brand: {
        siteName: "",
        siteLanguage: "zh-CN",
        brandMark: "",
        officialUrl: "",
        recognized: false,
        siteAccent: "#6f35a5",
      },
      assistant: {
        name: "",
        welcome: "",
        accent: "#6f35a5",
        showSources: true,
      },
    }));

    render(<SimplifiedWebsiteBuilderPreview initialStep="evaluation" />);

    expect(screen.queryByText("草稿已确认")).toBeNull();
    expect(document.querySelectorAll('[data-complete="true"]')).toHaveLength(1);
    expect(screen.getByRole("button", { name: "确认当前建设草稿" }).hasAttribute("disabled")).toBe(true);
  });

  it("returns from an evaluation check to the exact editing step", () => {
    render(<SimplifiedWebsiteBuilderPreview />);
    fireEvent.click(screen.getByRole("button", { name: /建设评估/ }));

    fireEvent.click(screen.getByRole("button", { name: "查看结构：版本、目标问题覆盖与信息结构" }));

    expect(screen.getByRole("heading", { name: "确认网站结构与品牌" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /确认结构/ }).getAttribute("aria-current")).toBe("step");
  });

  it("can enter the website builder directly at the AI assistant step", () => {
    render(<SimplifiedWebsiteBuilderPreview initialStep="assistant" />);

    expect(screen.getByRole("heading", { name: "配置 AI 助手" })).toBeTruthy();
    expect(
      within(screen.getByRole("list", { name: "网站建设流程" })).getByRole("button", { name: /AI 助手$/ }).getAttribute("aria-current"),
    ).toBe("step");
  });

  it("only marks steps complete after the user confirms them", async () => {
    render(<SimplifiedWebsiteBuilderPreview />);

    expect(document.querySelectorAll('[data-complete="true"]')).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /建设评估/ }));
    expect(screen.getByRole("button", { name: "确认当前建设草稿" }).hasAttribute("disabled")).toBe(true);
    expect(within(screen.getByLabelText("评估摘要")).getByText("0/4")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /选择模板$/ }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await trialAssistantOnce();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    const confirmButton = screen.getByRole("button", { name: "确认当前建设草稿" });
    expect(confirmButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton);
    expect(screen.getAllByText("草稿已确认").length).toBeGreaterThan(0);
    expect(screen.getByRole("status").textContent).toMatch(/不表示质量评估通过或网站已经发布/);
    expect(screen.getByLabelText(/当前加权评估分/).textContent).toMatch(/—.*\/100.*暂定结果/);
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
    expect(screen.queryByText("只检查是否确认，不计分")).toBeNull();
    expect(screen.queryByText(/个维度已有正式判定/)).toBeNull();
    expect(screen.queryByText("分母仅包含通过与不通过")).toBeNull();
    expect(screen.queryByText("关键项优先于总分")).toBeNull();
    expect(screen.queryByText(/总分 = 100 ×/)).toBeNull();
    expect(screen.queryByText(/状态系数：/)).toBeNull();
    expect(screen.queryByText(/分档与门禁：/)).toBeNull();
    expect(screen.queryByText("C01")).toBeNull();
    expect(screen.queryByText("权重 15 分")).toBeNull();
    expect(screen.queryByText(/正式验收需逐项留存/)).toBeNull();
    expect(screen.getAllByText("待核实")).toHaveLength(3);
    expect(screen.getAllByText("未执行")).toHaveLength(4);
    expect(screen.getByText("仅作建议，不限制发布")).toBeTruthy();
    expect(screen.queryByText(/0 分只表示尚未获得正式评估分/)).toBeNull();
  });

  it("keeps publish confirmation available at low coverage and stores a separate risk decision", () => {
    render(<SimplifiedWebsiteBuilderPreview initialStep="evaluation" />);

    expect(screen.getByLabelText(/当前加权评估分/).textContent).toMatch(/—.*\/100/);
    expect(screen.getByRole("button", { name: "确认当前建设草稿" }).hasAttribute("disabled")).toBe(true);
    const releaseButton = screen.getByRole("button", { name: "进入发布确认" });
    expect(releaseButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(releaseButton);
    const dialog = within(screen.getByRole("dialog", { name: "发布确认" }));
    expect(dialog.getByText(/这些结果只提供质量建议，不会替你决定/)).toBeTruthy();
    expect(dialog.getByText(/当前原型不会执行真实部署/)).toBeTruthy();
    expect(listEvaluationReports()).toEqual([]);
    fireEvent.click(dialog.getByRole("button", { name: "我已了解风险，继续发布" }));

    expect(screen.queryByRole("dialog", { name: "发布确认" })).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/已记录发布决定；当前原型未执行真实部署/);
    const decisions = listPublishDecisions();
    expect(decisions).toEqual([
      expect.objectContaining({
        action: "publish",
        mode: "accepted_risk",
        riskAcknowledged: true,
        evaluationReportIds: [expect.stringMatching(/^website-report-/)],
      }),
    ]);
    expect(decisions[0].acknowledgedRiskIds.length).toBeGreaterThan(0);
    expect(listEvaluationReports().map((report) => report.reportId)).toEqual(
      decisions[0].evaluationReportIds,
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
        risks: Array.from({ length: 7 }, (_, index) => ({
          id: `risk-rag-linked-${index + 1}`,
          severity: "critical" as const,
          title: `回答关键风险 ${index + 1}`,
          summary: "该风险不会改变网站建设得分。",
          evidenceIds: [],
        })),
        relatedReportIds: [],
      },
    })).toBe(true);

    render(<SimplifiedWebsiteBuilderPreview initialStep="evaluation" />);
    const scoreBefore = screen.getByLabelText(/当前加权评估分/).textContent;
    const formulaBefore = screen.getByLabelText("加权评估分计算结果").textContent;
    fireEvent.click(screen.getByRole("button", { name: "关联最新 RAG 评估" }));

    expect(within(screen.getByLabelText("关联的企业 RAG 评估")).getByText(/已关联 12\/100 · 1.0.0/)).toBeTruthy();
    expect(within(screen.getByLabelText("关联的企业 RAG 评估")).getByText(/报告 ID：rag-report-linked/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/只作参考，不参与网站建设得分/);
    expect(screen.getByLabelText(/当前加权评估分/).textContent).toBe(scoreBefore);
    expect(screen.getByLabelText("加权评估分计算结果").textContent).toBe(formulaBefore);

    fireEvent.click(screen.getByRole("button", { name: "进入发布确认" }));
    const dialog = within(screen.getByRole("dialog", { name: "发布确认" }));
    expect(dialog.getByText(/rag-report-linked/)).toBeTruthy();
    for (let index = 1; index <= 7; index += 1) {
      expect(dialog.getByText(`回答关键风险 ${index}`)).toBeTruthy();
    }
    fireEvent.click(dialog.getByRole("button", { name: "我已了解风险，继续发布" }));
    expect(listPublishDecisions()[0].acknowledgedRiskIds).toEqual(expect.arrayContaining(
      Array.from({ length: 7 }, (_, index) => `risk-rag-linked-${index + 1}`),
    ));
  });

  it("invalidates a confirmed step when its configuration changes", async () => {
    render(<SimplifiedWebsiteBuilderPreview />);

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await trialAssistantOnce();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "确认当前建设草稿" }));
    expect(document.querySelectorAll('[data-complete="true"]')).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /确认结构$/ }));
    fireEvent.change(screen.getByLabelText("网站名称"), { target: { value: "更新后的帮助中心" } });
    expect(document.querySelectorAll('[data-complete="true"]')).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /建设评估/ }));
    expect(screen.getByRole("button", { name: "确认当前建设草稿" }).hasAttribute("disabled")).toBe(true);
    expect(within(screen.getByLabelText("评估摘要")).getByText("2/4")).toBeTruthy();
  });

  it("reports internal step changes so the URL can stay aligned with the screen", () => {
    const onStepChange = vi.fn();
    render(<SimplifiedWebsiteBuilderPreview initialStep="assistant" onStepChange={onStepChange} />);

    fireEvent.click(screen.getByRole("button", { name: /确认结构/ }));

    expect(onStepChange).toHaveBeenCalledWith("structure");
    expect(screen.getByRole("heading", { name: "确认网站结构与品牌" })).toBeTruthy();
  });

  it("requires a real assistant trial before the AI assistant step can complete", async () => {
    render(<SimplifiedWebsiteBuilderPreview initialStep="assistant" />);
    const stepList = screen.getByRole("list", { name: "网站建设流程" });

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByRole("status").textContent).toMatch(/完成助手试用/);
    expect(document.querySelectorAll('[data-complete="true"]')).toHaveLength(0);

    await trialAssistantOnce();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByRole("heading", { name: "建设检查与评估" })).toBeTruthy();

    fireEvent.click(within(stepList).getByRole("button", { name: /AI 助手$/ }));
    fireEvent.change(screen.getByLabelText("助手名称"), { target: { value: "远山助手" } });
    expect(screen.getByText("助手试用未完成")).toBeTruthy();
    fireEvent.click(within(stepList).getByRole("button", { name: /建设评估/ }));
    expect(screen.getByRole("button", { name: "确认当前建设草稿" }).hasAttribute("disabled")).toBe(true);
    expect(within(screen.getByLabelText("评估摘要")).getByText("0/4")).toBeTruthy();
  });

  it("answers from the shared RAG samples and refuses unsupported questions", async () => {
    render(<SimplifiedWebsiteBuilderPreview initialStep="assistant" />);

    fireEvent.change(screen.getByLabelText("在网站助手中提问"), { target: { value: "你们的公司地址在哪里？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    await waitFor(() => expect(screen.getByText(/不能编造回答/)).toBeTruthy());
    expect(screen.queryAllByRole("button", { name: /来源：/ })).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("在网站助手中提问"), { target: { value: "FrontMind 可以帮企业做什么？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    await waitFor(() => expect(screen.getByText(previewRagAnswer)).toBeTruthy());
    expect(screen.getAllByRole("button", { name: /来源：合成资料/ }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText(/展示回答来源/));
    expect(screen.queryAllByRole("button", { name: /来源：合成资料/ })).toHaveLength(0);
  });

  it("keeps the assistant accent in sync with the site accent until customized", () => {
    render(<SimplifiedWebsiteBuilderPreview initialStep="structure" />);
    const stepList = screen.getByRole("list", { name: "网站建设流程" });

    fireEvent.click(screen.getByRole("button", { name: "选择网站主题色 #a44f25" }));
    fireEvent.click(within(stepList).getByRole("button", { name: /AI 助手$/ }));
    expect(screen.getByRole("button", { name: "选择助手主题色 #a44f25" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "选择助手主题色 #315b8a" }));
    expect(screen.getByRole("button", { name: "选择助手主题色 #315b8a" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(stepList).getByRole("button", { name: /确认结构$/ }));
    fireEvent.click(screen.getByRole("button", { name: "选择网站主题色 #3e6b57" }));
    fireEvent.click(within(stepList).getByRole("button", { name: /AI 助手$/ }));
    expect(screen.getByRole("button", { name: "选择助手主题色 #315b8a" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByLabelText(/跟随网站主题色/));
    expect(screen.getByRole("button", { name: "选择助手主题色 #3e6b57" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("previews the layout of the selected template", () => {
    render(<SimplifiedWebsiteBuilderPreview initialStep="structure" />);
    const stepList = screen.getByRole("list", { name: "网站建设流程" });

    expect(screen.getByText("企业知识帮助中心")).toBeTruthy();

    fireEvent.click(within(stepList).getByRole("button", { name: /选择模板$/ }));
    fireEvent.click(screen.getByRole("radio", { name: /简洁文档站/ }));
    fireEvent.click(within(stepList).getByRole("button", { name: /确认结构$/ }));
    expect(screen.getByText("目录")).toBeTruthy();

    fireEvent.click(within(stepList).getByRole("button", { name: /选择模板$/ }));
    fireEvent.click(screen.getByRole("radio", { name: /企业服务门户/ }));
    fireEvent.click(within(stepList).getByRole("button", { name: /确认结构$/ }));
    expect(screen.getByText("联系我们获取服务建议")).toBeTruthy();
    expect(screen.queryByText("目录")).toBeNull();
  });

  it("uses one enterprise RAG page for source inspection, answer trial, and evaluation", () => {
    const onOpenWebsite = vi.fn();
    const onOpenWebsiteAssistant = vi.fn();
    const ragView = render(
      <EnterpriseRagPreview
        onOpenWebsite={onOpenWebsite}
        onOpenWebsiteAssistant={onOpenWebsiteAssistant}
      />,
    );

    const evaluation = screen.getByRole("region", { name: "本轮回答质量" });
    expect(within(evaluation).getByRole("heading", { name: "本轮回答质量" })).toBeTruthy();
    expect(within(evaluation).getByLabelText("六维诊断评分").textContent).toContain("84");
    expect(within(evaluation).queryByText("合成样例 · 预设评审")).toBeNull();
    expect(within(evaluation).getByText("待改进")).toBeTruthy();
    expect(within(evaluation).queryByText("用户真正想确认")).toBeNull();
    expect(within(evaluation).queryByText("优先优化")).toBeNull();
    const judgmentDisclosure = within(evaluation).getByRole("button", { name: "理解本次判断" });
    const optimizationDisclosure = within(evaluation).getByRole("button", { name: "查看优化方案" });
    fireEvent.click(judgmentDisclosure);
    expect(within(evaluation).queryByRole("heading", { name: "用户要解决的问题" })).toBeNull();
    expect(within(evaluation).getByText(/快速理解产品能解决哪些问题，以及自己下一步可以从哪里开始。/).textContent).toContain("“人工评审与计算”用于查看评分如何形成");
    expect(within(evaluation).getByRole("button", { name: "人工评审与计算" })).toBeTruthy();
    expect(within(evaluation).getByRole("button", { name: "查看回答依据" })).toBeTruthy();
    fireEvent.click(optimizationDisclosure);
    expect(within(evaluation).getByText("优先处理")).toBeTruthy();
    expect(within(evaluation).queryByText("优先优化")).toBeNull();
    const improvedAnswerButton = within(evaluation).getByRole("button", { name: "查看完整方案" });
    fireEvent.click(improvedAnswerButton);
    expect(screen.getByRole("dialog", { name: "优化方案" })).toBeTruthy();
    expect(screen.getByText("建议改写 · 待复评")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭评估面板" }));

    const input = screen.getByLabelText("输入企业 RAG 示例问题");
    fireEvent.change(input, { target: { value: "我想咨询新的具体业务问题" } });
    fireEvent.click(screen.getByRole("button", { name: "试用问题" }));

    expect(screen.getByText("我想咨询新的具体业务问题")).toBeTruthy();
    expect(screen.getByText(/此问题不在示例库/)).toBeTruthy();
    expect(within(evaluation).getByRole("heading", { name: "待核验" })).toBeTruthy();
    expect(within(evaluation).queryByText("人工评审 · 本地计算")).toBeNull();
    expect(within(evaluation).getByLabelText("六维诊断评分").textContent).toContain("—");
    expect(within(evaluation).getByText("可能分数 0–100")).toBeTruthy();
    expect(screen.queryByText("实时预览")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "开始网站建设" }));
    expect(onOpenWebsite).toHaveBeenCalledOnce();

    expect(screen.queryByRole("button", { name: "进入网站建设的 AI 助手" })).toBeNull();
    expect(onOpenWebsiteAssistant).not.toHaveBeenCalled();
    expect(onOpenWebsite).toHaveBeenCalledOnce();

    ragView.unmount();
  });
});
