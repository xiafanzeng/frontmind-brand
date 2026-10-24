import { articles, faqs, footer, siteMeta } from "./content";

export default function App() {
  return (
    <div className="mn-page" data-palette={siteMeta.palette}>
      <header className="mn-header">
        <span className="mn-brand">{siteMeta.brand}</span>
      </header>

      <main className="mn-main">
        <section className="mn-intro">
          <h1 className="mn-title">{siteMeta.title}</h1>
          <p className="mn-summary">{siteMeta.summary}</p>
        </section>

        <section className="mn-articles" aria-label="帮助文章">
          {articles.map((article) => (
            <article key={article.id} id={article.id} className="mn-article">
              <p className="mn-article__kicker">
                <span className="mn-article__category">{article.category}</span>
                <span className="mn-article__date">{article.updatedAt}</span>
              </p>
              <h2 className="mn-article__title">
                <a href={`#${article.id}`}>{article.title}</a>
              </h2>
              <p className="mn-article__excerpt">{article.excerpt}</p>
              <p className="mn-article__source">出处 {article.sourceTitle}</p>
            </article>
          ))}
        </section>

        <section className="mn-faq" aria-label="常见问题">
          <h2 className="mn-section-title">常见问题</h2>
          {faqs.map((faq) => (
            <div key={faq.id} className="mn-faq__item">
              <h3 className="mn-faq__q">{faq.question}</h3>
              <p className="mn-faq__a">{faq.answer}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="mn-footer">
        <span>{footer.contact}</span>
        <span>{footer.note}</span>
      </footer>
    </div>
  );
}
