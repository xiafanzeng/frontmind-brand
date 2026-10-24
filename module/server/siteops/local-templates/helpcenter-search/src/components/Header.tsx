import { siteMeta } from "../content";

export function Header() {
  return (
    <header className="hc-header">
      <div className="hc-container hc-header__inner">
        <a className="hc-brand" href="#top">
          <span className="hc-brand__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
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
          <span className="hc-brand__name">{siteMeta.brand}</span>
        </a>
        <nav className="hc-nav" aria-label="主导航">
          <a className="hc-nav__link hc-nav__link--active" href="#top">
            帮助中心
          </a>
          <a className="hc-nav__link" href="#categories">
            分类浏览
          </a>
          <a className="hc-nav__link" href="#faq">
            常见问题
          </a>
        </nav>
      </div>
    </header>
  );
}
