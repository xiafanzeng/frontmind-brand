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
          <input
            className="hc-search__input"
            type="search"
            placeholder="请输入"
            aria-label="搜索帮助文档"
          />
          <button className="hc-search__button" type="submit">
            <span className="hc-sr-only">搜索</span>
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="10.8" cy="10.8" r="6.8" />
              <path d="m20 20-4.25-4.25" />
            </svg>
          </button>
        </form>
      </div>
    </section>
  );
}
