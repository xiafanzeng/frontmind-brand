import { categories } from "../content";

export function CategoryGrid() {
  return (
    <section className="hc-section" id="categories">
      <div className="hc-container">
        <div className="hc-section__head">
          <h2 className="hc-section__title">浏览所有分类</h2>
          <p className="hc-sr-only">选择一个分类，查看对应的帮助文章。</p>
        </div>
        <div className="hc-category-grid">
          {categories.map((category) => (
            <article key={category.id} className="hc-category">
              <h3 className="hc-category__title">{category.title}</h3>
              <ul className="hc-category__items">
                <li>{category.description}</li>
                <li>共 {category.articleCount} 篇帮助文章</li>
              </ul>
              <a className="hc-category__more" href="#articles">
                <span>查看更多</span>
                <svg
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h13M14 7l5 5-5 5" />
                </svg>
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
