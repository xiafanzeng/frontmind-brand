import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnterpriseRagPreview } from "./EnterpriseRagPreview";
import { SimplifiedWebsiteBuilderPreview } from "./SimplifiedWebsiteBuilderPreview";

const draftStorageKey = "frontmind.website-builder.draft";

beforeEach(() => window.localStorage.clear());

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

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
    expect(screen.getByText(/权重：网站内容与体验 30 分/)).toBeTruthy();
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

  it("only marks steps complete after the user confirms them", () => {
    render(<SimplifiedWebsiteBuilderPreview />);

    expect(document.querySelectorAll('[data-complete="true"]')).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /建设评估/ }));
    expect(screen.getByRole("button", { name: "确认当前建设草稿" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/配置门槛仅确认 0\/4 项/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /选择模板$/ }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    const confirmButton = screen.getByRole("button", { name: "确认当前建设草稿" });
    expect(confirmButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton);
    expect(screen.getAllByText("草稿已确认").length).toBeGreaterThan(0);
    expect(screen.getByRole("status").textContent).toMatch(/不表示质量评估通过或网站已经发布/);
    expect(screen.getByLabelText(/当前加权评估分/).textContent).toMatch(/0.*\/100.*暂定分/);
  });

  it("calculates a transparent 100-point score without rewarding missing evidence", () => {
    render(<SimplifiedWebsiteBuilderPreview initialStep="evaluation" />);

    expect(screen.queryByRole("heading", { name: "配置门槛（不计分）" })).toBeNull();
    expect(screen.getByLabelText(/当前加权评估分/).textContent).toMatch(/0.*\/100.*暂定分/);
    expect(screen.getByText("当前建议：暂不建议发布")).toBeTruthy();
    expect(screen.getByText("无法计算")).toBeTruthy();
    expect(screen.getByText(/0 \+ 0 \+ 0 \+ 0 = 0 → 0 分/)).toBeTruthy();
    expect(screen.getByText("权重：网站内容与体验 30 分 · 企业事实与公开边界 30 分 · RAG 回答质量 25 分 · 流程与发布边界 15 分")).toBeTruthy();
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
    expect(screen.getByText("受阻")).toBeTruthy();
    expect(screen.queryByText(/0 分只表示尚未获得正式评估分/)).toBeNull();
  });

  it("invalidates a confirmed step when its configuration changes", () => {
    render(<SimplifiedWebsiteBuilderPreview />);

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "确认当前建设草稿" }));
    expect(document.querySelectorAll('[data-complete="true"]')).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /确认结构$/ }));
    fireEvent.change(screen.getByLabelText("网站名称"), { target: { value: "更新后的帮助中心" } });
    expect(document.querySelectorAll('[data-complete="true"]')).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /建设评估/ }));
    expect(screen.getByRole("button", { name: "确认当前建设草稿" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/配置门槛仅确认 2\/4 项/)).toBeTruthy();
  });

  it("reports internal step changes so the URL can stay aligned with the screen", () => {
    const onStepChange = vi.fn();
    render(<SimplifiedWebsiteBuilderPreview initialStep="assistant" onStepChange={onStepChange} />);

    fireEvent.click(screen.getByRole("button", { name: /确认结构/ }));

    expect(onStepChange).toHaveBeenCalledWith("structure");
    expect(screen.getByRole("heading", { name: "确认网站结构与品牌" })).toBeTruthy();
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

    const evaluation = screen.getByRole("region", { name: "回答质量评估" });
    expect(within(evaluation).getByRole("heading", { name: "回答质量评估" })).toBeTruthy();
    expect(within(evaluation).getByLabelText("综合评分").textContent).toContain("84");
    expect(within(evaluation).getByText("合成样例 · 预设评审")).toBeTruthy();
    expect(within(evaluation).getByText("可用，仍有优化空间")).toBeTruthy();
    expect(within(evaluation).getByText("用户真正想确认")).toBeTruthy();
    expect(within(evaluation).getByText("优先优化")).toBeTruthy();
    const improvedAnswerButton = within(evaluation).getByRole("button", { name: "查看优化方案" });
    fireEvent.click(improvedAnswerButton);
    expect(screen.getByRole("dialog", { name: "优化方案" })).toBeTruthy();
    expect(screen.getByText("建议改写 · 待复评")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭评估面板" }));

    const input = screen.getByLabelText("输入企业 RAG 示例问题");
    fireEvent.change(input, { target: { value: "我想咨询新的具体业务问题" } });
    fireEvent.click(screen.getByRole("button", { name: "试用问题" }));

    expect(screen.getByText("我想咨询新的具体业务问题")).toBeTruthy();
    expect(screen.getByText(/此问题不在示例库/)).toBeTruthy();
    expect(within(evaluation).getAllByText("待完成评审")).toHaveLength(2);
    expect(within(evaluation).getByLabelText("综合评分").textContent).toContain("—");
    expect(within(evaluation).getByText("可能分数 0–100")).toBeTruthy();
    expect(screen.queryByText("实时预览")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "开始网站建设" }));
    expect(onOpenWebsite).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "进入网站建设的 AI 助手" }));
    expect(onOpenWebsiteAssistant).toHaveBeenCalledOnce();
    expect(onOpenWebsite).toHaveBeenCalledOnce();

    ragView.unmount();
  });
});
