// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";
import { controlledViteBuilderSource } from "../server/siteops/native-react-build-runtime.js";

const require = createRequire(import.meta.url);

function generatedBoundary(root: string, platform: typeof path) {
  const program = controlledViteBuilderSource({
    viteModuleUrl: "file:///host/vite.js",
    tailwindModuleUrl: null,
    tailwindV3ModuleUrl: null,
    tailwindAnimateModuleUrl: null,
    autoprefixerModuleUrl: null,
    tailwindV3Config: null,
    useTailwind: false,
    allowedDependencies: ["react", "react-dom"],
    sourceAliasRoot: "src",
  });
  // Evaluate the actual generated plugin; do not duplicate its path decisions.
  const start = program.indexOf("const allowedDependencies = ");
  const end = program.indexOf("const dependencyCompatibility = ");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return runInNewContext(
    `${program.slice(start, end)}; sourceBoundary;`,
    { root, path: platform },
  ) as { resolveId(source: string, importer: string): null };
}

describe.each([
  { name: "Windows", platform: path.win32, root: "C:\\sandbox\\site" },
  { name: "POSIX", platform: path.posix, root: "/sandbox/site" },
])("generated native build boundary on $name", ({ platform, root }) => {
  const importer = platform.join(root, "src", "main.tsx");

  it.each(["outside source root", "inside node_modules"])(
    "allows React DOM's real scheduler dependency from a host package %s",
    location => {
      const reactDomRoot = path.dirname(require.resolve("react-dom/client"));
      const reactDomClient = readFileSync(path.join(reactDomRoot, "cjs/react-dom-client.production.js"), "utf8");
      expect(reactDomClient).toMatch(/require\(["']scheduler["']\)/u);
      const hostRoot = location === "outside source root"
        ? platform.resolve(root, "..", "..", "host") : root;
      const hostImporter = platform.join(hostRoot, "node_modules", "react-dom", "cjs", "react-dom-client.production.js");
      expect(generatedBoundary(root, platform).resolveId("scheduler", hostImporter)).toBeNull();
    },
  );

  it("rejects an undeclared scheduler import from customer source", () => {
    expect(() => generatedBoundary(root, platform).resolveId("scheduler", importer))
      .toThrow("NATIVE_BUILD_DEPENDENCY_BOUNDARY");
  });

  it("rejects a relative import that resolves outside the source root", () => {
    expect(() => generatedBoundary(root, platform).resolveId("../../outside.ts", importer))
      .toThrow("NATIVE_BUILD_SOURCE_BOUNDARY");
  });

  it("rejects a relative import that resolves exactly to the parent directory", () => {
    expect(() => generatedBoundary(root, platform).resolveId("..", platform.join(root, "main.tsx")))
      .toThrow("NATIVE_BUILD_SOURCE_BOUNDARY");
  });

  it("allows relative imports within the source root", () => {
    expect(generatedBoundary(root, platform).resolveId("../shared.ts", importer)).toBeNull();
  });

  it("allows declared dependency subpaths", () => {
    expect(generatedBoundary(root, platform).resolveId("react/jsx-runtime", importer)).toBeNull();
  });

  it("keeps file URL imports forbidden", () => {
    expect(() => generatedBoundary(root, platform).resolveId("file:///outside.ts", importer))
      .toThrow("NATIVE_BUILD_SOURCE_BOUNDARY");
  });
});
