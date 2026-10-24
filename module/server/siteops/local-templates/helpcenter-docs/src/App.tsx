import { Sidebar } from "./components/Sidebar";
import { Main } from "./components/Main";
import { Toc } from "./components/Toc";
import { siteMeta } from "./content";

export default function App() {
  return (
    <div className="dc-page" data-palette={siteMeta.palette}>
      <Sidebar />
      <Main />
      <Toc />
    </div>
  );
}
