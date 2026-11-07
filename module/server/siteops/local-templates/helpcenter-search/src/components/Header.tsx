import { siteMeta } from "../content";

type HeaderProps = {
  darkMode: boolean;
  onToggleTheme: () => void;
};

export function Header({ darkMode, onToggleTheme }: HeaderProps) {
  return (
    <header className="hc-header">
      <div className="hc-container hc-header__inner">
        <a className="hc-brand" href="#top">
          <span className="hc-brand__mark" aria-hidden="true">
            <svg viewBox="0 0 36 48" fill="none">
              <path
                d="M3 8.1c0-2.3 2.2-3.9 4.3-3.1l9.2 3.4v33.9L5.2 38.1A3.3 3.3 0 0 1 3 35V8.1Z"
                fill="currentColor"
                opacity="0.42"
              />
              <path
                d="M16.5 3.9c0-2.4 2.4-4 4.6-3l9.8 3.8A3.3 3.3 0 0 1 33 7.8v31.7c0 2.5-2.6 4.1-4.8 2.9l-11.7-6.2V3.9Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="hc-sr-only">{siteMeta.brand}</span>
        </a>
        <button
          className="hc-theme-toggle"
          type="button"
          aria-label={darkMode ? "切换到浅色模式" : "切换到深色模式"}
          aria-pressed={darkMode}
          onClick={onToggleTheme}
        >
          <span className="hc-theme-toggle__sun" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <circle cx="12" cy="12" r="3.25" />
              <path d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
            </svg>
          </span>
          <span className="hc-theme-toggle__thumb" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
