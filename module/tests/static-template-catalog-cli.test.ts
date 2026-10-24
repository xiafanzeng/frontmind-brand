// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { runStaticTemplateCatalogCli } from "../server/siteops/static-template-catalog-cli.js";

afterEach(() => vi.restoreAllMocks());

it("advertises initializer capabilities without loading catalog assets", async () => {
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await runStaticTemplateCatalogCli(["--help"]);
  expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
    cliVersion: 2,
    capabilities: ["ensure-ready-v1", "v2-to-v3-cache-reuse"],
    assetRootEnvironment: "FRONTMIND_DASHBOARD_ASSET_DIR",
  });
});

it.each([
  [["--root", "relative-assets"], "--root requires an absolute asset directory"],
  [["--root"], "--root requires an absolute asset directory"],
  [["--concurrency", "0"], "--concurrency must be 1, 2 or 3"],
  [["--concurrency", "4"], "--concurrency must be 1, 2 or 3"],
  [["--ensure-ready", "--check-active"], "Choose one catalog command"],
  [["--unknown"], "Unknown catalog option; use --help"],
])("rejects invalid CLI parameters %j before initialization", async (args, message) => {
  await expect(runStaticTemplateCatalogCli(args as string[])).rejects.toThrow(message as string);
});
