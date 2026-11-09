// @vitest-environment node
import { describe, expect, it } from "vitest";
import { auditNativeRuntimeContractV1 } from "../server/siteops/native-react-source.js";

// Verbatim routes module rejected by build c4ff8324 (2026-11-08): the bridge
// is read into a local and invoked after a typeof guard, which is functionally
// the host-canonical lookup the contract wants.
const INDIRECT_BRIDGE_ROUTES = `import React from "react";
import "./frontmind-tailwind.css";
import "./index.css";
import App from "./App";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

export const FRONTMIND_ROUTE_PATHS = ["/", "/hospital/", "/departments/", "/centers/", "/services/", "/technology/", "/audiences/", "/visit/", "/contact/"] as const;

function getCanonicalSitePathname() {
  const hostPath = (window as Window & { canonicalSitePathname?: () => string }).canonicalSitePathname;
  return typeof hostPath === "function" ? hostPath() : window.location.pathname;
}

export default function FrontMindRoutes() {
  const initialPath = getCanonicalSitePathname();
  return <App initialPath={initialPath} />;
}
`;

const DIRECT_BRIDGE_ROUTES = `import App from "./App";
export const FRONTMIND_ROUTE_PATHS = ["/", "/about/"] as const;
export default function FrontMindRoutes() {
  const initialPath = window.canonicalSitePathname?.() ?? window.location.pathname;
  return <App initialPath={initialPath} />;
}
`;

const NO_BRIDGE_ROUTES = `import App from "./App";
export const FRONTMIND_ROUTE_PATHS = ["/", "/about/"] as const;
export default function FrontMindRoutes() {
  return <App initialPath={window.location.pathname} />;
}
`;

const TYPE_ONLY_ROUTES = `import App from "./App";
declare global {
  interface Window { canonicalSitePathname?: () => string }
}
export const FRONTMIND_ROUTE_PATHS = ["/", "/about/"] as const;
export default function FrontMindRoutes() {
  return <App initialPath={window.location.pathname} />;
}
`;

function auditRoutes(source: string) {
  return auditNativeRuntimeContractV1({
    files: new Map([["src/frontmind-routes.tsx", Buffer.from(source, "utf8")]]),
    requireCanonicalSitePathname: true,
  });
}

describe("auditNativeRuntimeContractV1 canonical pathname bridge", () => {
  it("accepts reading the bridge into a local before calling it (build c4ff8324 regression)", () => {
    const audit = auditRoutes(INDIRECT_BRIDGE_ROUTES);
    expect(
      audit.issues.filter((issue) => issue.code === "CANONICAL_PATHNAME_REQUIRED"),
    ).toEqual([]);
  });

  it("accepts the direct optional-chain call", () => {
    const audit = auditRoutes(DIRECT_BRIDGE_ROUTES);
    expect(
      audit.issues.filter((issue) => issue.code === "CANONICAL_PATHNAME_REQUIRED"),
    ).toEqual([]);
  });

  it("still rejects a routes module that never references the bridge", () => {
    const audit = auditRoutes(NO_BRIDGE_ROUTES);
    expect(
      audit.issues.some(
        (issue) => issue.code === "CANONICAL_PATHNAME_REQUIRED",
      ),
    ).toBe(true);
  });

  it("still rejects a type-only mention without property access", () => {
    const audit = auditRoutes(TYPE_ONLY_ROUTES);
    expect(
      audit.issues.some(
        (issue) => issue.code === "CANONICAL_PATHNAME_REQUIRED",
      ),
    ).toBe(true);
  });
});
