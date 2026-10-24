import { categories, faqs, siteMeta, support } from "../content";

export function Main() {
  return (
    <main className="dc-main" id="top">
      <header className="dc-page-head">
        <p className="dc-breadcrumb">帮助中心 / {siteMeta.pageTitle}</p>
        <h1 className="dc-page-title">{siteMeta.pageTitle}</h1>
        <p className="dc-page-summary">{siteMeta.pageSummary}</p>
        <p className="dc-page-meta">最近更新：{siteMeta.lastUpdated}</p>
      </header>

      {categories.map((category) => (
        <section
          key={category.id}
          id={category.id}
          className="dc-group"
        >
          <header className="dc-group__head">
            <h2>{category.title}</h2>
            <p>{category.description}</p>
          </header>
          <ul className="dc-articles">
            {category.articles.map((article) => (
              <li key={article.id} id={article.id} className="dc-article">
                <a href={`#${article.id}`} className="dc-article__link">
                  <span className="dc-article__title">{article.title}</span>
                  <span className="dc-article__excerpt">{article.excerpt}</span>
                  <span className="dc-article__meta">
                    更新 {article.updatedAt} · 来源 {article.sourceTitle}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section id="faq" className="dc-group">
        <header className="dc-group__head">
          <h2>常见问题</h2>
          <p>高频问题的快速回答。</p>
        </header>
        <dl className="dc-faq">
          {faqs.map((faq) => (
            <div key={faq.id} className="dc-faq__item">
              <dt>{faq.question}</dt>
              <dd>{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="support" className="dc-support">
        <div>
          <h2>{support.title}</h2>
          <p>{support.summary}</p>
        </div>
        <a className="dc-support__button" href="#top">
          {support.action}
        </a>
      </section>
    </main>
  );
}
