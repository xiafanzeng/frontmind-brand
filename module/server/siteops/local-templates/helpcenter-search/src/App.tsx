import { useState } from "react";
import { Header } from "./components/Header";
import { HeroSearch } from "./components/HeroSearch";
import { CategoryGrid } from "./components/CategoryGrid";
import { ArticleList } from "./components/ArticleList";
import { FaqSection } from "./components/FaqSection";
import { ContactBand } from "./components/ContactBand";
import { Footer } from "./components/Footer";
import { siteMeta } from "./content";

const THEME_STORAGE_KEY = "frontmind-help-center-theme";

function initialDarkMode() {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark") return true;
    if (stored === "light") return false;
  } catch {
    // Storage may be unavailable in a hardened or embedded browser.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export default function App() {
  const [darkMode, setDarkMode] = useState(initialDarkMode);

  const toggleTheme = () => {
    setDarkMode((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
      } catch {
        // Keep the in-memory control usable when persistence is unavailable.
      }
      return next;
    });
  };

  return (
    <div
      className="hc-page"
      data-palette={siteMeta.palette}
      data-theme={darkMode ? "dark" : "light"}
    >
      <Header
        darkMode={darkMode}
        onToggleTheme={toggleTheme}
      />
      <main>
        <HeroSearch />
        <CategoryGrid />
        <ArticleList />
        <FaqSection />
        <ContactBand />
      </main>
      <Footer />
    </div>
  );
}
