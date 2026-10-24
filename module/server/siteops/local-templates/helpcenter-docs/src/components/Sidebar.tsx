import { categories, siteMeta } from "../content";

export function Sidebar() {
  return (
    <aside className="dc-sidebar" aria-label="文档导航">
      <a className="dc-brand" href="#top">
        <span className="dc-brand__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <path
              d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5h-5A1.5 1.5 0 0 1 4 16V5.5Z"
              fill="currentColor"
              opacity="0.9"
            />
            <path
              d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 0 20 16V5.5Z"
              fill="currentColor"
              opacity="0.55"
            />
          </svg>
        </span>
        <span className="dc-brand__name">{siteMeta.brand}</span>
      </a>
      <form
        className="dc-side-search"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <input type="search" placeholder="搜索文档" aria-label="搜索文档" />
      </form>
      <nav className="dc-side-nav">
        {categories.map((category) => (
          <div key={category.id} className="dc-side-group">
            <a className="dc-side-group__title" href={`#${category.id}`}>
              {category.title}
            </a>
            {category.articles.map((article) => (
              <a
                key={article.id}
                className="dc-side-link"
                href={`#${article.id}`}
              >
                {article.title}
              </a>
            ))}
          </div>
        ))}
      </nav>
      <div className="dc-side-foot">
        <a className="dc-side-support" href="#support">
          联系支持
        </a>
      </div>
    </aside>
  );
}
