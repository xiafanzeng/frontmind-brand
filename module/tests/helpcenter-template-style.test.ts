import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../server/siteops/local-templates/helpcenter-search/src/App.js";

const templateSource = path.resolve(
  process.cwd(),
  "server/siteops/local-templates/helpcenter-search/src",
);

describe("HelpLook-style help center template", () => {
  it("keeps the existing content surfaces and interactive controls", () => {
    const html = renderToStaticMarkup(createElement(App));

    expect(html.match(/class="hc-category"/g)).toHaveLength(6);
    expect(html).toContain("热门文章");
    expect(html).toContain("常见问题");
    expect(html).toContain("没有找到想要的答案");
    expect(html).toContain("aria-label=\"搜索帮助文档\"");
    expect(html).toContain("aria-label=\"切换到深色模式\"");
    expect(html).toContain("付款方式");
    expect(html).not.toContain("aria-label=\"主导航\"");
  });

  it("routes every visible accent through the runtime site color", async () => {
    const css = await readFile(path.join(templateSource, "index.css"), "utf8");

    expect(css).toMatch(
      /--accent:\s*var\(--frontmind-site-accent,\s*#0868f7\)/,
    );
    for (const selector of [
      ".hc-brand",
      ".hc-hero",
      ".hc-search__button",
      ".hc-category__more",
    ]) {
      const start = css.indexOf(`${selector} {`);
      expect(start).toBeGreaterThan(-1);
      expect(css.slice(start, css.indexOf("}", start))).toMatch(
        /(?:color|background):\s*var\(--hc-accent\)/,
      );
    }
  });
});
