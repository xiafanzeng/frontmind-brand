/** Module-owned maintenance command. Never runs in the browser/API process. */
export async function runStaticTemplateCatalogCli(args: string[]) {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(`${JSON.stringify({ cliVersion: 2, capabilities: ["ensure-ready-v1", "v2-to-v4-cache-reuse", "v3-to-v4-cache-reuse", "required-admission-binding-v1"], options: ["--ensure-ready", "--check-active", "--root ABS_DIR", "--concurrency N"], assetRootEnvironment: "FRONTMIND_DASHBOARD_ASSET_DIR" })}\n`);
    return;
  }
  let command: "seed" | "ensure" | "check" = "seed";
  let rootDir: string | undefined;
  let concurrency = 1;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--ensure-ready" || argument === "--check-active") {
      if (command !== "seed") throw new Error("Choose one catalog command");
      command = argument === "--ensure-ready" ? "ensure" : "check";
    } else if (argument === "--root") {
      rootDir = args[++index];
      const path = await import("node:path");
      if (!rootDir || !path.isAbsolute(rootDir)) throw new Error("--root requires an absolute asset directory");
    } else if (argument === "--concurrency") {
      concurrency = Number(args[++index]);
      if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error("--concurrency must be 1, 2 or 3");
    } else throw new Error("Unknown catalog option; use --help");
  }
  const { getStaticTemplateCatalogReadiness, readStaticTemplateCatalogActiveVersion, seedStaticTemplateCatalog } = await import("./static-template-catalog.js");
  if (command === "check" || command === "ensure") {
    const readiness = await getStaticTemplateCatalogReadiness({ rootDir, verifyAssetHashes: command === "check" });
    const actualActiveVersion = readiness.activeCatalogVersion ?? await readStaticTemplateCatalogActiveVersion({ rootDir });
    if (command === "check" || (readiness.ready && readiness.requiredAdmissionReady)) {
      process.stdout.write(`${JSON.stringify({ ...readiness, activeCatalogVersion: actualActiveVersion, reused: command === "ensure", ok: readiness.ready && readiness.requiredAdmissionReady })}\n`);
      if (!readiness.ready || !readiness.requiredAdmissionReady) process.exitCode = 1;
      return;
    }
  }
  const { buildStaticTemplateExecutionAdmission } = await import("./static-template-execution-admission.js");
  const seeded = await seedStaticTemplateCatalog({ rootDir, concurrency, executionAdmissionBuilder: buildStaticTemplateExecutionAdmission });
  const readiness = await getStaticTemplateCatalogReadiness({ rootDir });
  process.stdout.write(`${JSON.stringify({ ...readiness, ok: readiness.ready && readiness.requiredAdmissionReady, reused: seeded.reused })}\n`);
  if (!readiness.ready || !readiness.requiredAdmissionReady) process.exitCode = 1;
}

export function reportCatalogCliFailure(error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : "STATIC_TEMPLATE_CATALOG_SEED_FAILED"}\n`);
  process.exitCode = 1;
}
