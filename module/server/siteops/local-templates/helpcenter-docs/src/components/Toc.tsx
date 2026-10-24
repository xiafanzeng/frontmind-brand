import { categories } from "../content";

export function Toc() {
  return (
    <nav className="dc-toc" aria-label="本页目录">
      <p className="dc-toc__title">本页目录</p>
      {categories.map((category) => (
        <a key={category.id} href={`#${category.id}`}>
          {category.title}
        </a>
      ))}
      <a href="#faq">常见问题</a>
    </nav>
  );
}
