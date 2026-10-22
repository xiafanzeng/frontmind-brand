import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Eye,
  FileText,
  Grid2X2,
  MessageSquareText,
  Plus,
  Save,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { websitePreviewFixture } from "./fixtures";
import {
  DeviceSwitch,
  LocalActionNotice,
  PreviewButton,
  PreviewPill,
  WebsiteCanvas,
} from "./preview-components";
import type {
  AiWebsitePreviewPage,
  WebsiteDraft,
  WebsiteEditorTab,
  WebsitePreviewDevice,
  WebsitePreviewFixture,
} from "./types";

export type WebsiteEditorPreviewProps = {
  fixture?: WebsitePreviewFixture;
  draft?: WebsiteDraft;
  hasUnsavedChanges?: boolean;
  evaluationStale?: boolean;
  onDraftChange?: (draft: WebsiteDraft) => void;
  onSave?: () => void;
  onNavigate?: (page: AiWebsitePreviewPage) => void;
};

export function WebsiteEditorPreview({
  fixture = websitePreviewFixture,
  draft: externalDraft,
  hasUnsavedChanges: externalHasUnsavedChanges,
  evaluationStale = false,
  onDraftChange,
  onSave,
  onNavigate = () => undefined,
}: WebsiteEditorPreviewProps) {
  const [localDraft, setLocalDraft] = useState<WebsiteDraft>(fixture.site.defaultDraft);
  const [localHasUnsavedChanges, setLocalHasUnsavedChanges] = useState(false);
  const [selectedPage, setSelectedPage] = useState("home");
  const [selectedSection, setSelectedSection] = useState("hero");
  const [device, setDevice] = useState<WebsitePreviewDevice>("desktop");
  const [tab, setTab] = useState<WebsiteEditorTab>("content");
  const [notice, setNotice] = useState<string | null>(null);

  const draft = externalDraft ?? localDraft;
  const hasUnsavedChanges =
    externalHasUnsavedChanges ?? localHasUnsavedChanges;
  const currentPage = useMemo(
    () => fixture.pages.find((page) => page.id === selectedPage),
    [fixture.pages, selectedPage],
  );
  const currentSection =
    currentPage?.sections.find((section) => section.id === selectedSection)?.label ??
    currentPage?.label ??
    "页面";

  const updateDraft = (patch: Partial<WebsiteDraft>) => {
    const nextDraft = { ...draft, ...patch };
    if (onDraftChange) {
      onDraftChange(nextDraft);
    } else {
      setLocalDraft(nextDraft);
      setLocalHasUnsavedChanges(true);
    }
    setNotice(null);
  };

  const saveDraft = () => {
    if (onSave) {
      onSave();
    } else {
      setLocalHasUnsavedChanges(false);
    }
    setNotice("草稿已保存在本地预览状态，未向线上提交。")
  };

  const selectPage = (pageId: string) => {
    setSelectedPage(pageId);
    setSelectedSection(pageId === "home" ? "hero" : "");
  };

  return (
    <div className="awp-editor">
      <div className="awp-page-main awp-editor__main">
        <button
          className="awp-back-button"
          onClick={() => onNavigate("workbench")}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={15} />
          返回网站工作台
        </button>

        <header className="awp-page-heading awp-editor__heading">
          <div>
            <h1>编辑网站</h1>
            <p>
              草稿 {fixture.versions.draft}　｜　当前编辑：{currentPage?.label}　｜　知识库{" "}
              {fixture.versions.knowledge}
            </p>
          </div>
          <div className="awp-heading-actions">
            <PreviewButton
              onClick={() =>
                setNotice(
                  `${device === "desktop" ? "桌面" : "手机"}效果正在中间画布本地预览，未打开外部地址。`,
                )
              }
            >
              <Eye aria-hidden="true" size={16} />
              预览
            </PreviewButton>
            <PreviewButton variant="primary" onClick={saveDraft}>
              {hasUnsavedChanges ? (
                <Save aria-hidden="true" size={16} />
              ) : (
                <Check aria-hidden="true" size={16} />
              )}
              保存草稿
            </PreviewButton>
          </div>
        </header>

        {notice && <LocalActionNotice>{notice}</LocalActionNotice>}

        <section className="awp-editor-workspace">
          <aside className="awp-page-tree" aria-label="页面与区块">
            <h2>页面与区块</h2>
            {fixture.pages.map((page) => {
              const activePage = selectedPage === page.id;
              return (
                <div className="awp-page-tree__page" key={page.id}>
                  <button
                    aria-expanded={page.sections.length ? activePage : undefined}
                    className={activePage ? "is-active" : ""}
                    onClick={() => selectPage(page.id)}
                    type="button"
                  >
                    {page.id === "faq" ? (
                      <MessageSquareText aria-hidden="true" size={15} />
                    ) : (
                      <FileText aria-hidden="true" size={15} />
                    )}
                    {page.label}
                    {page.sections.length > 0 && (
                      <ChevronDown aria-hidden="true" size={13} />
                    )}
                  </button>
                  {activePage && page.sections.length > 0 && (
                    <div className="awp-page-tree__sections">
                      {page.sections.map((section) => (
                        <button
                          className={selectedSection === section.id ? "is-active" : ""}
                          key={section.id}
                          onClick={() => setSelectedSection(section.id)}
                          type="button"
                        >
                          {section.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <button
              className="awp-page-tree__add"
              onClick={() => setNotice("添加页面仅作交互示意，本地数据没有改变。")}
              type="button"
            >
              <Plus aria-hidden="true" size={15} />
              添加页面
            </button>
            <div className="awp-page-tree__global">
              <h3>全站设置</h3>
              <button
                onClick={() => setNotice("品牌与主题设置将在后续预览开放。")}
                type="button"
              >
                <Grid2X2 aria-hidden="true" size={15} /> 品牌与主题
              </button>
              <button
                onClick={() => setNotice("站点设置将在后续预览开放。")}
                type="button"
              >
                <Settings2 aria-hidden="true" size={15} /> 站点设置
              </button>
            </div>
          </aside>

          <div className="awp-editor-canvas">
            <header>
              <span>
                {currentPage?.label} / {currentSection}
              </span>
              <DeviceSwitch onChange={setDevice} value={device} />
            </header>
            <div className="awp-editor-canvas__paper">
              <WebsiteCanvas
                device={device}
                draft={draft}
                fixture={fixture}
                selectedPage={selectedPage}
                selectedSection={selectedSection}
              />
            </div>
            <footer>选择页面区块，在右侧修改内容与样式。</footer>
          </div>
        </section>

        <footer className="awp-editor-savebar">
          <span>
            <Clock3 aria-hidden="true" size={15} />
            {hasUnsavedChanges
              ? "有未保存修改 · Evaluation 待重评"
              : `本地草稿 ${fixture.versions.draft} 已保存`}
          </span>
          <span>
            线上 {fixture.versions.online} 仅作示例 · 本预览不会发布
          </span>
        </footer>
      </div>

      <aside className="awp-inspector awp-editor__inspector">
        <section className="awp-editor-score">
          <div>
            <span>
              <strong>{fixture.evaluation.score}</strong>/100
            </span>
            <span>
              <b>Evaluation · 官网质量</b>
              <small>
                {evaluationStale ? "旧评估快照" : "已保存快照"} {fixture.versions.draft} · 覆盖 {fixture.evaluation.coverage}%
              </small>
            </span>
            <PreviewPill tone="violet">示例</PreviewPill>
          </div>
          {hasUnsavedChanges ? (
            <p>有未保存修改，当前示例得分尚未包含本次编辑。</p>
          ) : evaluationStale ? (
            <p>草稿已保存，但示例得分仍对应初始快照，需要重新评估。</p>
          ) : null}
        </section>

        <header className="awp-inspector-heading">
          <div>
            <h2>{currentSection}</h2>
            <p>{currentPage?.label} / 当前选中区块</p>
          </div>
          <SlidersHorizontal aria-hidden="true" size={18} />
        </header>

        <div className="awp-editor-tabs" aria-label="编辑选项">
          <button
            aria-pressed={tab === "content"}
            onClick={() => setTab("content")}
            type="button"
          >
            内容
          </button>
          <button
            aria-pressed={tab === "style"}
            onClick={() => setTab("style")}
            type="button"
          >
            样式
          </button>
        </div>

        {selectedPage === "home" && selectedSection === "hero" ? (
          tab === "content" ? (
            <div className="awp-editor-fields">
              <label>
                <span>
                  主标题 <small>建议 30 字以内</small>
                </span>
                <textarea
                  aria-label="主标题"
                  onChange={(event) => updateDraft({ heroTitle: event.target.value })}
                  rows={3}
                  value={draft.heroTitle}
                />
              </label>
              <label>
                <span>辅助说明</span>
                <textarea
                  aria-label="辅助说明"
                  onChange={(event) =>
                    updateDraft({ heroDescription: event.target.value })
                  }
                  rows={4}
                  value={draft.heroDescription}
                />
              </label>
              <button
                className="awp-source-chip"
                onClick={() => setNotice("引用仅指向本地 fixture，不会请求知识库。")}
                type="button"
              >
                <BookOpen aria-hidden="true" size={14} />
                引用：企业身份与服务概况 ↗
              </button>
              <label>
                <span>行动按钮文字</span>
                <input
                  aria-label="行动按钮文字"
                  onChange={(event) =>
                    updateDraft({ callToAction: event.target.value })
                  }
                  value={draft.callToAction}
                />
              </label>
              <label>
                <span>跳转页面</span>
                <select
                  aria-label="跳转页面"
                  onChange={(event) =>
                    updateDraft({ callToActionTarget: event.target.value })
                  }
                  value={draft.callToActionTarget}
                >
                  <option>服务介绍</option>
                  <option>常见问题</option>
                  <option>联系我们</option>
                </select>
              </label>
            </div>
          ) : (
            <div className="awp-editor-fields">
              <fieldset>
                <legend>主题色</legend>
                <div className="awp-color-options">
                  {["#4b6657", "#7d4c9b", "#bb995b", "#465c86"].map((color) => (
                    <button
                      aria-label={`选择主题色 ${color}`}
                      aria-pressed={draft.accent === color}
                      key={color}
                      onClick={() => updateDraft({ accent: color })}
                      style={{ backgroundColor: color }}
                      type="button"
                    />
                  ))}
                </div>
                <small>{draft.accent.toUpperCase()}</small>
              </fieldset>
              <div className="awp-field-callout">
                第一版只开放主题色调整；字体、间距与布局将在后续迭代补充。
              </div>
            </div>
          )
        ) : (
          <div className="awp-empty-editor">
            <Settings2 aria-hidden="true" size={22} />
            <h3>{currentSection}已选中</h3>
            <p>第一版保留完整页面结构；该区块的详细编辑字段将在下一轮接入。</p>
          </div>
        )}

        <section className="awp-local-evaluation">
          <header>
            <h3>本区块 Evaluation</h3>
            <span>{evaluationStale ? "示例 · 旧快照待复评" : "示例 · 已保存快照"}</span>
          </header>
          <div>
            <span>
              <strong>100%</strong>
              <small>事实支持</small>
            </span>
            <span>
              <strong>80%</strong>
              <small>问题覆盖</small>
            </span>
            <span>
              <strong>90%</strong>
              <small>结构检查</small>
            </span>
          </div>
          <p>建议补充：服务适用条件的明确入口。</p>
        </section>
      </aside>
    </div>
  );
}

