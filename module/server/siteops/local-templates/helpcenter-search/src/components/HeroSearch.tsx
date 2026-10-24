import { siteMeta } from "../content";

export function HeroSearch() {
  return (
    <section className="hc-hero" id="top">
      <div className="hc-container hc-hero__inner">
        <p className="hc-hero__eyebrow">{siteMeta.slogan}</p>
        <h1 className="hc-hero__title">{siteMeta.heroTitle}</h1>
        <p className="hc-hero__summary">{siteMeta.heroSummary}</p>
        <form
          className="hc-search"
          role="search"
          onSubmit={(event) => event.preventDefault()}
        >
          <svg
            className="hc-search__icon"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            className="hc-search__input"
            type="search"
            placeholder="搜索问题、文章或关键词"
            aria-label="搜索帮助文档"
          />
          <button className="hc-search__button" type="submit">
            搜索
          </button>
        </form>
        <div className="hc-hero__quick">
          {siteMeta.quickLinks.map((label) => (
            <a key={label} className="hc-chip" href="#categories">
              {label}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
