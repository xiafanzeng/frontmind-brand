import type { ReactNode } from "react";
import { categories } from "../content";

const iconPaths: Record<string, ReactNode> = {
  book: (
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5h-5A1.5 1.5 0 0 1 4 16V5.5Zm16 0A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 0 20 16V5.5Z" />
  ),
  credit: (
    <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1H3V7Zm0 4h18v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm3 4h4v-1.5H6V15Z" />
  ),
  truck: (
    <path d="M2 6.5A1.5 1.5 0 0 1 3.5 5H14a1 1 0 0 1 1 1v1h2.6a1 1 0 0 1 .8.4l2.4 3.1a1 1 0 0 1 .2.6V16a1 1 0 0 1-1 1h-1.1a2.5 2.5 0 0 1-4.8 0H9.9a2.5 2.5 0 0 1-4.8 0H3.5A1.5 1.5 0 0 1 2 15.5v-9Zm14 4h3.3l-1.8-2.4H16v2.4Z" />
  ),
  shield: (
    <path d="M12 3l7 2.5V11c0 4.4-2.9 7.6-7 9-4.1-1.4-7-4.6-7-9V5.5L12 3Zm-1.2 10.6 4.7-4.7-1.1-1.1-3.6 3.6-1.9-1.9L7.8 10.6l3 3Z" />
  ),
  account: (
    <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.9 0-7 2.2-7 4.8V21h14v-2.2c0-2.6-3.1-4.8-7-4.8Z" />
  ),
  chat: (
    <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9.4L5.7 19.7A1 1 0 0 1 4 19v-3.6A2 2 0 0 1 4 14V5Zm4 3.5v1.5h8V8.5H8Zm0 4V14h5v-1.5H8Z" />
  ),
};

export function CategoryGrid() {
  return (
    <section className="hc-section" id="categories">
      <div className="hc-container">
        <div className="hc-section__head">
          <h2 className="hc-section__title">按分类浏览</h2>
          <p className="hc-section__desc">选择一个分类，查看对应的帮助文章。</p>
        </div>
        <div className="hc-category-grid">
          {categories.map((category) => (
            <a
              key={category.id}
              className="hc-category"
              href={`#article-${category.id}`}
            >
              <span className="hc-category__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  {iconPaths[category.icon]}
                </svg>
              </span>
              <span className="hc-category__body">
                <span className="hc-category__title">{category.title}</span>
                <span className="hc-category__desc">{category.description}</span>
                <span className="hc-category__count">
                  {category.articleCount} 篇文章
                </span>
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
