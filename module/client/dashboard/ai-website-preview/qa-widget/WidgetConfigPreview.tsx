import { useMemo, useState, type CSSProperties } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  MessageSquareText,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useWorkspaceDraftGuard } from "../../../host";
import { usePreviewDialog } from "./usePreviewDialog";
import {
  cloneWidgetDraft,
  qaWidgetFixture,
  widgetDraftsEqual,
  type PreviewModuleTarget,
  type WidgetDraft,
} from "./fixtures";

type WidgetConfigPreviewProps = {
  onNavigate: (target: PreviewModuleTarget) => void;
  onNotice: (message: string) => void;
};

const storageKey = `${"frontmind.ai-website-preview.widget-draft.v1"}.${encodeURIComponent(qaWidgetFixture.customer.projectName)}.${qaWidgetFixture.versions.widgetDraft}`;

const isWidgetDraft = (value: unknown): value is WidgetDraft => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WidgetDraft>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.welcome === "string" &&
    Array.isArray(candidate.suggestions) &&
    candidate.suggestions.length === 3 &&
    candidate.suggestions.every((item) => typeof item === "string") &&
    ["purple", "moss", "blue"].includes(candidate.themeId ?? "") &&
    typeof candidate.enabled === "boolean" &&
    typeof candidate.showReferences === "boolean"
  );
};

const readStoredDraft = (): WidgetDraft => {
  const fallback = cloneWidgetDraft(qaWidgetFixture.widget.defaultDraft);
  if (typeof window === "undefined") return fallback;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    return isWidgetDraft(parsed) ? cloneWidgetDraft(parsed) : fallback;
  } catch {
    return fallback;
  }
};

const steps: readonly {
  number: string;
  title: string;
  detail: string;
  target: PreviewModuleTarget;
}[] = [
  { number: "01", title: "部件配置", detail: "内容、外观与知识", target: "widget-config" },
  { number: "02", title: "对话测试", detail: "访客预览与用例", target: "widget-test" },
  { number: "03", title: "评估与应用", detail: "检查、确认与生效", target: "widget-evaluation" },
  { number: "04", title: "运行效果", detail: "反馈与持续优化", target: "widget-runtime" },
];

export function WidgetSubnavigation({
  onNavigate,
}: {
  onNavigate: (target: PreviewModuleTarget) => void;
}) {
  return (
    <nav className="aqwp-widget-route" aria-label="AI 部件工作流程">
      <div className="aqwp-widget-route__caption">
        <strong>AI 部件工作流程</strong>
        <span>点击任一步骤切换，无需逐步返回</span>
      </div>
      <ol>
        {steps.map((step) => (
          <li key={step.number} className={step.target === "widget-config" ? "is-current" : ""}>
            <button
              type="button"
              aria-current={step.target === "widget-config" ? "step" : undefined}
              onClick={() => onNavigate(step.target)}
            >
              <span>{step.number}</span>
              <span><strong>{step.title}</strong><small>{step.detail}</small></span>
              {step.target === "widget-config" && <em>当前</em>}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function WidgetConfigPreview({
  onNavigate,
  onNotice,
}: WidgetConfigPreviewProps) {
  const { customer, versions, widget } = qaWidgetFixture;
  const [draft, setDraft] = useState<WidgetDraft>(readStoredDraft);
  const [savedDraft, setSavedDraft] = useState<WidgetDraft>(() => readStoredDraft());
  const [evaluationOpen, setEvaluationOpen] = useState(false);
  const dialogRef = usePreviewDialog(evaluationOpen, () => setEvaluationOpen(false));
  const [previewQuestion, setPreviewQuestion] = useState<string>(widget.sampleExchange.question);
  const theme = widget.themes.find((item) => item.id === draft.themeId) ?? widget.themes[0];
  const isUnsaved = !widgetDraftsEqual(draft, savedDraft);
  const differsFromEvaluation = !widgetDraftsEqual(draft, widget.defaultDraft);
  const completeness = useMemo(() => {
    const fields = [draft.name, draft.welcome, ...draft.suggestions];
    return fields.filter((value) => value.trim().length > 0).length + 4;
  }, [draft]);

  const update = <Key extends keyof WidgetDraft>(key: Key, value: WidgetDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateSuggestion = (index: number, value: string) => {
    setDraft((current) => {
      const suggestions = [...current.suggestions] as WidgetDraft["suggestions"];
      suggestions[index] = value;
      return { ...current, suggestions };
    });
  };

  const saveDraft = () => {
    const snapshot = cloneWidgetDraft(draft);
    setSavedDraft(snapshot);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
      onNotice(`已保存本地演示草稿 ${versions.widgetDraft}；没有提交线上配置。`);
    } catch {
      onNotice("草稿保留在当前页面，但浏览器未允许本地存储。");
    }
    return true;
  };

  const discardDraft = () => {
    setDraft(cloneWidgetDraft(savedDraft));
    return true;
  };

  useWorkspaceDraftGuard({
    dirty: isUnsaved,
    label: "AI 部件本地预览草稿",
    save: async () => saveDraft(),
    discard: async () => discardDraft(),
  });

  return (
    <>
      <div className="aqwp-workspace aqwp-workspace--widget">
        <section className="aqwp-primary">
          <div className="aqwp-page-heading">
            <div>
              <h1>部件配置</h1>
              <p>让访客在官网中获得有依据、可追溯的企业回答。</p>
            </div>
            <div className="aqwp-heading-actions">
              <button className="aqwp-button" type="button" onClick={saveDraft}><Save />保存草稿</button>
              <button className="aqwp-button aqwp-button--gold" type="button" onClick={() => onNavigate("widget-test")}>
                <MessageSquareText />进入对话测试
              </button>
            </div>
          </div>

          <div className="aqwp-meta-strip">
            <span>
              <strong>配置草稿 {versions.widgetDraft}</strong><i />公开知识库 {versions.latestKnowledge}<i />正式使用 {versions.widgetLive}
            </span>
            <em className={isUnsaved ? "is-warning" : ""}>
              {isUnsaved ? "有未保存修改" : "本地草稿已保存 · 尚未应用"}
            </em>
          </div>

          <section className="aqwp-form-panel">
            <header><Bot /><h2>助手内容</h2></header>
            <div className="aqwp-form-columns">
              <label>
                <span>助手名称 <small>最多 20 字</small></span>
                <input
                  value={draft.name}
                  maxLength={20}
                  onChange={(event) => update("name", event.currentTarget.value)}
                />
              </label>
              <label>
                <span>知识来源</span>
                <select value={versions.latestKnowledge} disabled aria-label="知识来源">
                  <option value={versions.latestKnowledge}>企业公开知识库 {versions.latestKnowledge}</option>
                </select>
              </label>
            </div>
            <label>
              <span>欢迎语 <small>说明助手可以回答什么</small></span>
              <textarea
                value={draft.welcome}
                maxLength={150}
                onChange={(event) => update("welcome", event.currentTarget.value)}
              />
            </label>
            <div className="aqwp-field-label">
              <strong>建议提问</strong><small>最多 3 条 · 点击右侧预览可试用</small>
            </div>
            <div className="aqwp-question-fields">
              {draft.suggestions.map((suggestion, index) => (
                <label key={index}>
                  <span>0{index + 1}</span>
                  <input
                    aria-label={`建议提问 ${index + 1}`}
                    value={suggestion}
                    maxLength={40}
                    onChange={(event) => updateSuggestion(index, event.currentTarget.value)}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="aqwp-form-panel aqwp-settings-panel">
            <header><Settings2 /><h2>展示与外观</h2></header>
            <label className="aqwp-setting-row">
              <span><strong>在官网展示助手</strong><small>保存并应用后更新正式网站的入口</small></span>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => update("enabled", event.currentTarget.checked)}
              />
            </label>
            <label className="aqwp-setting-row">
              <span><strong>展示回答来源</strong><small>展示引用入口；资料仍限定在公开范围</small></span>
              <input
                type="checkbox"
                checked={draft.showReferences}
                onChange={(event) => update("showReferences", event.currentTarget.checked)}
              />
            </label>
            <div className="aqwp-setting-row">
              <span><strong>品牌主题色</strong><small>对话标题栏与访客消息使用同一主题</small></span>
              <div className="aqwp-color-options">
                {widget.themes.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-label={option.label}
                    aria-pressed={option.id === draft.themeId}
                    style={{ backgroundColor: option.color }}
                    onClick={() => update("themeId", option.id)}
                  />
                ))}
              </div>
            </div>
          </section>

          <button className="aqwp-eval-brief" type="button" onClick={() => setEvaluationOpen(true)}>
            <span>
              <strong>{differsFromEvaluation ? "配置已修改 · 待复评" : `配置完整性 ${completeness} / 10`}</strong>
              {differsFromEvaluation ? "旧分数只对应上次快照" : "建议精简欢迎语"}
            </span>
            <span>查看量化检查 ↗</span>
          </button>

          <div className="aqwp-page-footer">
            <span>编辑内容只在本地浏览器中临时保留；保存后仍需评估并单独应用。</span>
            <span>FRONTMIND / LOCAL PREVIEW</span>
          </div>
        </section>

        <aside className="aqwp-rail aqwp-widget-rail">
          <button className="aqwp-snapshot-card" type="button" onClick={() => setEvaluationOpen(true)}>
            <strong>{widget.evaluation.score}<small>/100</small></strong>
            <span>
              <b>Evaluation <span>· 上次保存的配置</span></b>
              <small>配置 {versions.widgetDraft} · {versions.widgetRule} · 判定覆盖 {widget.evaluation.coverage}%</small>
              <small>{differsFromEvaluation ? "当前配置已修改，待重新评估" : `${widget.evaluation.passedCases} / ${widget.evaluation.totalCases} 用例通过 · 示例快照`}</small>
            </span>
            <em>查看 ↗</em>
          </button>

          <div className="aqwp-rail-heading">
            <div><h2>实时预览</h2><span className="aqwp-pill aqwp-pill--purple">访客视角</span></div>
          </div>
          <p className="aqwp-rail-scope">左侧配置即时反映在预览中</p>

          <section
            className="aqwp-widget-window"
            style={{ "--aqwp-widget-color": theme.color } as CSSProperties}
            aria-label="AI 部件实时预览"
          >
            <header>
              <span><Sparkles /></span>
              <div><h3>{draft.name || "未命名助手"}</h3><p>基于企业公开资料回答</p></div>
              <X aria-hidden="true" />
            </header>
            <div className="aqwp-widget-conversation">
              <small>实时预览 · 当前配置草稿</small>
              <div className="aqwp-chat-bubble">{draft.welcome || "请填写欢迎语。"}</div>
              <div className="aqwp-preview-suggestions">
                {draft.suggestions.map((suggestion, index) => (
                  <button
                    type="button"
                    key={index}
                    onClick={() => setPreviewQuestion(suggestion || "示例问题")}
                  >
                    {suggestion || `建议提问 ${index + 1}`}<span>↗</span>
                  </button>
                ))}
              </div>
              <div className="aqwp-chat-bubble aqwp-chat-bubble--visitor">{previewQuestion}</div>
              <div className="aqwp-chat-bubble">
                {widget.sampleExchange.answer}
                {draft.showReferences && (
                  <button type="button" onClick={() => onNotice("这是公开知识版本的本地示例引用，不会打开线上资料。") }>
                    {widget.sampleExchange.source} · {versions.latestKnowledge} ↗
                  </button>
                )}
              </div>
            </div>
            <div className="aqwp-widget-input"><span>输入您想了解的问题…</span><Send /></div>
            <footer>Powered by FrontMind</footer>
          </section>
          <p className="aqwp-widget-caption">
            {draft.enabled ? "助手入口已开启 · 待应用后生效" : "助手入口已关闭 · 应用后隐藏；仍可预览草稿"}
          </p>
          <div className="aqwp-rail-spacer" />
          <div className="aqwp-rail-note">
            修改内容、知识或展示设置后，原评估保留为快照，当前草稿标记为待复评。
          </div>
          <button className="aqwp-button aqwp-button--soft aqwp-button--wide" type="button" onClick={() => onNavigate("widget-evaluation")}>
            <ShieldCheck />查看评估与应用<ChevronRight />
          </button>
          <p className="aqwp-local-only">本页面不调用真实模型，也不会向线上应用配置。</p>
        </aside>
      </div>

      {evaluationOpen && (
        <div className="aqwp-overlay" role="presentation" onMouseDown={() => setEvaluationOpen(false)}>
          <section ref={dialogRef} className="aqwp-dialog" role="dialog" aria-modal="true" aria-label="AI 部件示例评分" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
            <button className="aqwp-dialog__close" type="button" aria-label="关闭" onClick={() => setEvaluationOpen(false)}><X /></button>
            <span className="aqwp-dialog__eyebrow">{versions.widgetRule} · {widget.evaluation.label}</span>
            <h2>上次配置快照</h2>
            <div className="aqwp-dialog-score">{widget.evaluation.score}<small>/100</small></div>
            <dl>
              <div><dt>固定用例</dt><dd>{widget.evaluation.passedCases} / {widget.evaluation.totalCases} 通过</dd></div>
              <div><dt>判定覆盖</dt><dd>{widget.evaluation.coverage}%</dd></div>
              <div><dt>配置版本</dt><dd>{versions.widgetDraft} · 知识 {versions.latestKnowledge}</dd></div>
            </dl>
            <p>{widget.evaluation.disclaimer}</p>
            {differsFromEvaluation && <div className="aqwp-dialog-warning">当前草稿已变化，旧分数只用于布局预览，不对应当前配置。</div>}
          </section>
        </div>
      )}
    </>
  );
}

