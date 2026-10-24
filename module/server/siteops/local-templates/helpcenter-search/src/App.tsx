import { Header } from "./components/Header";
import { HeroSearch } from "./components/HeroSearch";
import { CategoryGrid } from "./components/CategoryGrid";
import { ArticleList } from "./components/ArticleList";
import { FaqSection } from "./components/FaqSection";
import { ContactBand } from "./components/ContactBand";
import { Footer } from "./components/Footer";
import { siteMeta } from "./content";

export default function App() {
  return (
    <div className="hc-page" data-palette={siteMeta.palette}>
      <Header />
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
