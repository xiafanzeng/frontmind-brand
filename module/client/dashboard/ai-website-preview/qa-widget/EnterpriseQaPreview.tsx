import { useState, type CSSProperties, type FormEvent } from "react";
import {
  Check,
  Clipboard,
  Clock3,
  ExternalLink,
  Heart,
  MessageSquareText,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  qaWidgetFixture,
  type KnowledgeSource,
  type PreviewModuleTarget,
} from "./fixtures";
import { usePreviewDialog } from "./usePreviewDialog";

type EnterpriseQaPreviewProps = {
  onNavigate: (target: PreviewModuleTarget) => void;
  onNotice: (message: string) => void;
};

type Overlay =
  | { kind: "source"; source: KnowledgeSource }
  | { kind: "evaluation" }
  | null;

export function EnterpriseQaSubnavigation() {
  return (
    <nav className="aqwp-qa-nav" aria-label="企业问答页面">
      <button type="button" className="is-active" aria-current="page">
        <MessageSquareText />当前会话
      </button>
      <button type="button" disabled title="会话记录将在后续迭代接入">
        <Clock3 />会话记录
      </button>
      <button type="button" disabled title="完整评估页将在后续迭代接入">
        <ShieldCheck />问答评估
      </button>
      <span>回答 → 证据 → Evaluation → 改进</span>
    </nav>
  );
}

function CitationButton({
  source,
  onOpen,
}: {
  source: KnowledgeSource;
  onOpen: (source: KnowledgeSource) => void;
}) {
  return (
    <button
      type="button"
      className="aqwp-citation"
      aria-label={`查看引用 ${source.marker}：${source.title}`}
      onClick={() => onOpen(source)}
    >
      {source.marker}
    </button>
  );
}

export function EnterpriseQaPreview({
  onNavigate,
  onNotice,
}: EnterpriseQaPreviewProps) {
  const { customer, qa, versions } = qaWidgetFixture;
  const [isNewSession, setIsNewSession] = useState(false);
  const [question, setQuestion] = useState("");
  const [helpful, setHelpful] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const dialogRef = usePreviewDialog(Boolean(overlay), () => setOverlay(null));
  const identitySource = qa.sources[0];
  const servicesSource = qa.sources[1];

  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!question.trim()) return;
    onNotice(
      `已保留本地问题“${question.trim()}”。第一版预览不会调用真实模型。`,
    );
  };

  const copyAnswer = async () => {
    if (!navigator.clipboard?.writeText) {
      onNotice("当前浏览器未提供剪贴板能力，请手动选择回答文字。");
      return;
    }
    try {
      await navigator.clipboard.writeText(
        `${qa.title}\n${customer.organization}\n${qa.missingKnowledge}`,
      );
      onNotice("已复制示例回答。此操作仅发生在本地浏览器中。");
    } catch {
      onNotice("浏览器未开放剪贴板权限，请手动选择回答文字。");
    }
  };

  return (
    <>
      <div className="aqwp-workspace aqwp-workspace--qa">
        <section className="aqwp-primary">
          <div className="aqwp-page-heading">
            <div>
              <h1>企业问答</h1>
              <p>
                {isNewSession
                  ? `新会话 · 企业公开知识库 ${versions.latestKnowledge}`
                  : "机构介绍与服务范围 · 让每个回答都有依据"}
              </p>
            </div>
            <button
              className="aqwp-button aqwp-button--gold"
              type="button"
              onClick={() => setIsNewSession(true)}
            >
              <Plus />新建会话
            </button>
          </div>

          <div className="aqwp-meta-strip">
            {isNewSession ? (
              <span>
                新会话使用 <strong>知识库 {versions.latestKnowledge}</strong>
              </span>
            ) : (
              <span>
                本会话 <strong>知识库 {versions.sessionKnowledge}</strong>
                <i />项目最新 <strong>{versions.latestKnowledge}</strong>
                <em>历史回答保留原版本</em>
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                isNewSession
                  ? onNotice("公开知识范围为集中 fixture，本预览未连接真实知识库。")
                  : setIsNewSession(true)
              }
            >
              {isNewSession ? "查看知识范围" : `使用 ${versions.latestKnowledge} 新建会话`} ↗
            </button>
          </div>

          {isNewSession ? (
            <section className="aqwp-empty-answer">
              <span><Sparkles /></span>
              <h2>基于企业知识，开始新的提问</h2>
              <p>
                新会话将使用当前知识库 {versions.latestKnowledge}。
                <br />旧会话仍保留原知识版本与回答记录。
              </p>
              <button
                type="button"
                className="aqwp-button"
                onClick={() => setIsNewSession(false)}
              >
                <MessageSquareText />查看示例问答
              </button>
            </section>
          ) : (
            <>
              <section className="aqwp-question-card">
                <span className="aqwp-user-mark">我</span>
                <div>
                  <strong>{qa.question}</strong>
                  <p>{qa.updatedAt} · 会话 {qa.sessionId}</p>
                </div>
                <span className="aqwp-pill aqwp-pill--success">已回答</span>
              </section>

              <article className="aqwp-answer-card">
                <header>
                  <div>
                    <span className="aqwp-bot-mark"><Sparkles /></span>
                    <strong>{qaWidgetFixture.product.name}</strong>
                    <small>基于企业资料回答</small>
                  </div>
                  <span>回答 {qa.answerId}</span>
                </header>
                <div className="aqwp-answer-body">
                  <h2>{qa.title}</h2>
                  <p>
                    根据本会话绑定的企业资料，{customer.organization}
                    <CitationButton source={identitySource} onOpen={(source) => setOverlay({ kind: "source", source })} />
                  </p>
                  <h3>主要服务方向</h3>
                  <div className="aqwp-service-grid">
                    {qa.services.map((service) => (
                      <div key={service}><Check />{service}</div>
                    ))}
                  </div>
                  <p>
                    以上方向来自企业服务介绍；具体项目与适用条件，需结合个人实际情况进一步咨询。
                    <CitationButton source={servicesSource} onOpen={(source) => setOverlay({ kind: "source", source })} />
                  </p>
                  <h3>预约与咨询</h3>
                  <p>
                    具体服务方案由专业人员面诊评估后确定。
                    <CitationButton source={servicesSource} onOpen={(source) => setOverlay({ kind: "source", source })} />
                  </p>
                  <div className="aqwp-missing-note">{qa.missingKnowledge}</div>
                </div>
                <div className="aqwp-answer-sources">
                  {qa.sources.map((source) => (
                    <button
                      type="button"
                      key={source.id}
                      onClick={() => setOverlay({ kind: "source", source })}
                    >
                      [{source.marker}] {source.title} ↗
                    </button>
                  ))}
                </div>
                <footer className="aqwp-answer-actions">
                  <button type="button" onClick={() => void copyAnswer()}>
                    <Clipboard />复制回答
                  </button>
                  <button
                    type="button"
                    aria-pressed={helpful}
                    onClick={() => {
                      setHelpful(true);
                      onNotice("已记录本地示例反馈，不改变 Evaluation 分数。");
                    }}
                  >
                    {helpful ? <Check /> : <Heart />}{helpful ? "已标记有帮助" : "有帮助"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onNotice("示例执行：读取问题 → 检索知识 v1 → 生成回答 → 本地示例评估。未调用真实模型。")}
                  >
                    <Clock3 />执行详情
                  </button>
                  <span>示例回答与引用</span>
                </footer>
              </article>
            </>
          )}

          <form className="aqwp-composer" onSubmit={submitQuestion}>
            <div className="aqwp-suggestions">
              <button type="button" onClick={() => setQuestion("机构有哪些服务？")}>机构有哪些服务？</button>
              <button type="button" onClick={() => setQuestion("如何预约咨询？")}>如何预约咨询？</button>
            </div>
            <textarea
              aria-label="企业问题"
              placeholder="继续提问，了解更多企业与服务信息…"
              value={question}
              onChange={(event) => setQuestion(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div>
              <span>Enter 发送 · Shift + Enter 换行 · 仅作本地交互预览</span>
              <button type="submit" aria-label="发送问题"><Send /></button>
            </div>
          </form>
          <div className="aqwp-page-footer">
            <span>回答与引用均来自 typed fixtures；不会向线上提交。</span>
            <span>FRONTMIND / LOCAL PREVIEW</span>
          </div>
        </section>

        <aside className="aqwp-rail aqwp-evaluation-rail">
          <div className="aqwp-rail-heading">
            <div><h2>Evaluation</h2><span className="aqwp-pill aqwp-pill--purple">单次回答</span></div>
            <button type="button" onClick={() => setOverlay({ kind: "evaluation" })}>评分口径 ↗</button>
          </div>
          <p className="aqwp-rail-scope">
            回答 {qa.answerId} · 知识库 {versions.sessionKnowledge} · {versions.qaRule} 建议稿
          </p>
          <div className="aqwp-score-summary">
            <div
              className="aqwp-score-ring"
              style={{ "--aqwp-score": `${qa.evaluation.score * 3.6}deg` } as CSSProperties}
            >
              <strong>{qa.evaluation.score}<small>/100</small></strong>
            </div>
            <div>
              <h3>{qa.evaluation.summary}</h3>
              <p>还有 {qa.evaluation.pendingItems} 个回答要点待补充<br />评分只对应当前回答</p>
              <span className="aqwp-pill aqwp-pill--success">已评估</span>
            </div>
          </div>
          <div className="aqwp-coverage">
            <span>判定覆盖 <strong>{qa.evaluation.coverage}%</strong></span>
            <span>{qa.evaluation.checkedUnits} 检查单元已判定</span>
          </div>
          <div className="aqwp-dimensions">
            {qa.evaluation.dimensions.map((dimension) => (
              <div key={dimension.id}>
                <p><span>{dimension.label}</span><strong>{dimension.earned} / {dimension.total}</strong></p>
                <div><i style={{ width: `${(dimension.earned / dimension.total) * 100}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="aqwp-evaluation-meta">
            <span>评估时间 {qa.evaluation.evaluatedAt}</span>
            <strong>{qa.evaluation.label}</strong>
          </div>
          <div className="aqwp-improve-card">
            <h3>改进建议 · 补全预约入口</h3>
            <p>已识别资料不足，未编造联系方式。完善知识依据后，可补全第 5 个回答要点。</p>
            <button type="button" onClick={() => setOverlay({ kind: "evaluation" })}>
              <ShieldCheck />查看评估与改进
            </button>
          </div>
          <div className="aqwp-source-list">
            <header><h3>回答依据</h3><span>{qa.sources.length} 份资料 · 3 处引用</span></header>
            {qa.sources.map((source) => (
              <button type="button" key={source.id} onClick={() => setOverlay({ kind: "source", source })}>
                <strong><span>{source.marker}</span>{source.title}<ExternalLink /></strong>
                <p>{source.description}</p>
                <small>知识库 {versions.sessionKnowledge} · {source.location}</small>
              </button>
            ))}
          </div>
          <div className="aqwp-rail-note">
            {qa.evaluation.disclaimer} 评分绑定回答 {qa.answerId} 与知识库 {versions.sessionKnowledge}。
          </div>
        </aside>
      </div>

      {overlay && (
        <div className="aqwp-overlay" role="presentation" onMouseDown={() => setOverlay(null)}>
          <section
            ref={dialogRef}
            className="aqwp-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={overlay.kind === "source" ? overlay.source.title : "问答评分口径"}
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="aqwp-dialog__close" type="button" aria-label="关闭" onClick={() => setOverlay(null)}><X /></button>
            {overlay.kind === "source" ? (
              <>
                <span className="aqwp-dialog__eyebrow">引用 {overlay.source.marker} · 历史知识快照</span>
                <h2>{overlay.source.title}</h2>
                <dl>
                  <div><dt>知识版本</dt><dd>{versions.sessionKnowledge} · 会话 {qa.sessionId}</dd></div>
                  <div><dt>定位</dt><dd>{overlay.source.location}</dd></div>
                </dl>
                <h3>资料摘录 · 示例</h3>
                <blockquote>{overlay.source.excerpt}</blockquote>
                <p>引用保留原知识版本，项目当前 {versions.latestKnowledge} 不替换这份历史快照。</p>
              </>
            ) : (
              <>
                <span className="aqwp-dialog__eyebrow">{versions.qaRule} · 建议稿</span>
                <h2>问答评分口径</h2>
                <p>示例得分由事实有据、问题覆盖、引用可追溯和回答边界四项相加得到。</p>
                <div className="aqwp-formula">
                  {qa.evaluation.dimensions.map((item) => item.earned).join(" + ")} = <strong>{qa.evaluation.score} / 100</strong>
                </div>
                <p>{qa.evaluation.disclaimer}</p>
                <button className="aqwp-button" type="button" onClick={() => onNavigate("widget-config")}>查看 AI 部件配置</button>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

