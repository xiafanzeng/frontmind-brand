import { categories, siteMeta } from "../content";

export function Footer() {
  return (
    <footer className="hc-footer">
      <div className="hc-container hc-footer__inner">
        <div className="hc-footer__brand">
          <span className="hc-footer__name">{siteMeta.brand}</span>
          <p className="hc-footer__note">
            帮助内容来自已发布的企业知识库，并标注引用来源。
          </p>
        </div>
        <nav className="hc-footer__nav" aria-label="分类导航">
          {categories.slice(0, 4).map((category) => (
            <a
              key={category.id}
              className="hc-footer__link"
              href="#categories"
            >
              {category.title}
            </a>
          ))}
        </nav>
      </div>
      <div className="hc-container hc-footer__bar">
        <span>© 2026 {siteMeta.brand}</span>
        <span>内容依据企业知识库生成，保持可追溯引用。</span>
      </div>
    </footer>
  );
}
