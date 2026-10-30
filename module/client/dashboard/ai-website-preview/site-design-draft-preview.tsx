import type { CSSProperties } from "react";
import { FileText, PanelTop } from "lucide-react";
import type { SiteDesignPreviewBlock } from "../../../contracts/site-design-preferences";
import { PreviewAssistantWidget } from "./preview-assistant-widget";

export type PreviewDevice = "desktop" | "mobile";

const BLOCK_KIND_LABELS: Record<SiteDesignPreviewBlock["kind"], string> = {
  hero: "首页 Hero",
  offerings: "产品与服务",
  facts: "事实与证明",
  faq: "常见问题",
  contact: "联系方式",
  summary: "内容摘要",
};

export type DraftPreviewPage = { id: string; name: string };

/**
 * First-level preview of the two-stage preview design: a server-projected
 * skeleton from the frozen knowledge snapshot. Every block is rendered from
 * SiteDesignRecommendationOutput.previewBlocks (real document projections with
 * source coordinates) — never from local fixtures — and is explicitly labeled
 * as a draft so it can never impersonate the final build.
 */
export function SiteDesignDraftPreview({
  assistantAccent,
  assistantName,
  blocksByRoute,
  brandMark,
  device,
  error,
  knowledgeVersion,
  loading,
  pages,
  siteAccent,
  siteDomain,
  siteName,
  stale,
  templateName,
  welcome,
}: {
  assistantAccent: string;
  assistantName: string;
  blocksByRoute: ReadonlyMap<string, SiteDesignPreviewBlock>;
  brandMark: string;
  device: PreviewDevice;
  error: string | null;
  knowledgeVersion: number | null;
  loading: boolean;
  pages: DraftPreviewPage[];
  siteAccent: string;
  siteDomain: string;
  siteName: string;
  stale: boolean;
  templateName: string;
  welcome: string;
}) {
  return (
    <div className={`sfp-site-stage sfp-site-stage--${device}`}>
      <div className="sfp-browser-bar">
        <span><i /><i /><i /></span>
        <p>{siteDomain}</p>
      </div>
      <div
        className="sfp-site-canvas sfp-draft-canvas"
        style={{ "--sfp-site-accent": siteAccent, "--sfp-widget-accent": assistantAccent } as CSSProperties}
      >
        <div className="sfp-draft-banner" data-testid="website-draft-preview-banner">
          <strong>真实数据草稿</strong>
          <small>
            {knowledgeVersion !== null ? `知识库 v${knowledgeVersion}` : "等待知识坐标"}
            {" · "}
            {templateName}
            {" · 构建完成后以真实构建预览为准"}
          </small>
          {stale && <em>知识或模板已更新，此草稿基于旧版本；刷新推荐后同步。</em>}
        </div>

        {loading && (
          <div className="sfp-draft-state" role="status" data-testid="website-draft-preview-state">
            <PanelTop size={18} />
            <p>正在按当前发布知识生成真实数据草稿…</p>
            <small>草稿生成前不显示任何模拟网站页面。</small>
          </div>
        )}

        {!loading && error && (
          <div className="sfp-draft-state" role="status" data-testid="website-draft-preview-state">
            <PanelTop size={18} />
            <p>真实数据草稿暂时不可用。</p>
            <small>左侧可重试推荐；恢复前不会回退到模拟页面。</small>
          </div>
        )}

        {!loading && !error && blocksByRoute.size === 0 && (
          <div className="sfp-draft-state" role="status" data-testid="website-draft-preview-state">
            <PanelTop size={18} />
            <p>尚未生成真实数据草稿。</p>
            <small>选择模板并启用主栏目后，将按当前发布知识生成草稿。</small>
          </div>
        )}

        {!loading && !error && blocksByRoute.size > 0 && (
          <>
            <header className="sfp-site-header">
              <strong><i>{brandMark || "AI"}</i>{siteName || "企业网站"}</strong>
              <nav aria-label="草稿主导航">
                {pages.map((page) => <span key={page.id}>{page.name}</span>)}
              </nav>
            </header>
            <main className="sfp-draft-main">
              {pages.length === 0 && (
                <p className="sfp-draft-empty">尚未启用主栏目；启用后将按知识投影渲染草稿。</p>
              )}
              {pages.map((page) => {
                const block = blocksByRoute.get(page.id) ?? null;
                if (!block) {
                  return (
                    <section className="sfp-draft-block is-empty" key={page.id}>
                      <header><span className="sfp-draft-kind">待生成</span><h3>{page.name}</h3></header>
                      <p>该栏目暂无知识投影；真实构建时会按 content plan 生成内容。</p>
                    </section>
                  );
                }
                return (
                  <section className="sfp-draft-block" key={block.id} data-testid="website-draft-block">
                    <header>
                      <span className="sfp-draft-kind">{BLOCK_KIND_LABELS[block.kind]}</span>
                      <h3>{block.title}</h3>
                    </header>
                    {block.body && <p className="sfp-draft-lead">{block.body}</p>}
                    {block.items.length > 0 && (
                      <ul className="sfp-draft-items">
                        {block.items.map((item, index) => (
                          <li key={`${block.id}:${index}`}>
                            {item.title && <strong>{item.title}</strong>}
                            <span>{item.body}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <footer>
                      <FileText size={14} />
                      <small>{block.sourceDocumentIds.length} 个知识来源 · 可追溯到当前知识快照</small>
                    </footer>
                  </section>
                );
              })}
            </main>
          </>
        )}

        <PreviewAssistantWidget
          assistantName={assistantName}
          initiallyOpen
          interactive={false}
          showSources
          trialNote="真实问答与助手试用在下方真实构建预览中进行；本地草稿不会模拟回答。"
          welcome={welcome}
        />
      </div>
    </div>
  );
}
