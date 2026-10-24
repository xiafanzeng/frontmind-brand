import { featuredArticles } from "../content";

export function ArticleList() {
  return (
    <section className="hc-section hc-section--muted" id="articles">
      <div className="hc-container">
        <div className="hc-section__head">
          <h2 className="hc-section__title">热门文章</h2>
          <p className="hc-section__desc">来自企业知识库的高频问题与解答。</p>
        </div>
        <ul className="hc-article-list">
          {featuredArticles.map((article) => (
            <li key={article.id} id={`article-${article.id}`}>
              <a className="hc-article" href={`#article-${article.id}`}>
                <div className="hc-article__main">
                  <div className="hc-article__meta">
                    <span className="hc-tag">{article.tag}</span>
                    <span className="hc-article__date">{article.updatedAt}</span>
                  </div>
                  <h3 className="hc-article__title">{article.title}</h3>
                  <p className="hc-article__excerpt">{article.excerpt}</p>
                </div>
                <div className="hc-article__side">
                  <span className="hc-article__source">
                    来源：{article.sourceTitle}
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </div>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
