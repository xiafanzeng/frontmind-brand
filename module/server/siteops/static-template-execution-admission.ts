import JSZip from "jszip";
import { STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS } from "./static-template-catalog-manifest.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  materializeNativeReactSource,
  type NativeReactQaReportV1,
} from "./native-react-build-runtime.js";
import {
  NATIVE_RUNTIME_CONTRACT_V1,
  NATIVE_RUNTIME_CONTRACT_V1_SHA256,
  NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256,
  NATIVE_RUNTIME_CONTRACT_VERSION,
  NATIVE_SOURCE_PREFLIGHT_V2_SHA256,
  NATIVE_SOURCE_PREFLIGHT_V2_VERSION,
  auditNativeRuntimeContractV1,
  validateNativeReactSourceArchive,
} from "./native-react-source.js";
import {
  NativeVisualSourceError,
  prepareStaticTemplateExecutionSource,
} from "./native-visual-source.js";
import {
  STATIC_TEMPLATE_PREVIEW_FALLBACK_REASON_CODES,
  type StaticTemplateExecutionAdmissionBuilder,
} from "./static-template-catalog.js";

import { staticTemplateRuntimeMedia } from "./static-template-admission-policy.js";
export {
  REQUIRED_STATIC_TEMPLATE_EXECUTION_CANDIDATE_ID,
  REQUIRED_STATIC_TEMPLATE_RUNTIME_MEDIA,
} from "./static-template-admission-policy.js";

const ADMISSION_BUILD = {
  id: "22222222-2222-4222-8222-222222222222",
  projectId: "22222222-2222-4222-8222-222222222223",
  knowledgeSnapshotId: null,
  workflowVersion: "2.8.0",
} as const;

const ADMISSION_BRIEF = {
  companyName: "FrontMind execution admission",
  primaryLanguage: "zh-CN",
  contacts: [],
  offerings: ["受控静态官网执行验证"],
  audience: ["FrontMind catalog admission"],
  conversionGoal: "验证模板执行能力",
  contentInventory: {
    schemaVersion: 1,
    source: "frozen_knowledge_snapshot",
    entries: [],
  },
  routes: [
    {
      id: "home",
      slug: "/",
      title: "首页",
      sourceDocumentIds: ["catalog-admission-source"],
    },
  ],
  verifiedFacts: [
    {
      statement: "该内容仅用于模板执行准入，不进入客户网站。",
      sourceDocumentIds: ["catalog-admission-source"],
    },
  ],
  publicAssetIds: [],
  unknowns: [],
} as const;

function sha256(bytes: Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBuffer(value: unknown) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

type AdmissionInput = Parameters<StaticTemplateExecutionAdmissionBuilder>[0];
type PreparedAdmissionSource = Pick<
  Awaited<ReturnType<typeof prepareStaticTemplateExecutionSource>>,
  | "framework"
  | "sourceArchive"
  | "sourceArchiveSha256"
  | "sourceTreeSha256"
>;

const PREVIEW_REFERENCE_FALLBACK_CODES: ReadonlySet<string> = new Set(
  STATIC_TEMPLATE_PREVIEW_FALLBACK_REASON_CODES,
);

/** Preview fallback is intentionally limited to deterministic provider-source
 * incompatibilities observed in the frozen catalog. Network, abort, ordinary
 * errors and all compiler/browser failures remain fatal. */
export function staticTemplatePreviewFallbackReasonCode(
  error: unknown,
  signal?: Pick<AbortSignal, "aborted">,
): (typeof STATIC_TEMPLATE_PREVIEW_FALLBACK_REASON_CODES)[number] | null {
  return !signal?.aborted &&
    error instanceof NativeVisualSourceError &&
    PREVIEW_REFERENCE_FALLBACK_CODES.has(error.code)
    ? (error.code as (typeof STATIC_TEMPLATE_PREVIEW_FALLBACK_REASON_CODES)[number])
    : null;
}

const PREVIEW_REFERENCE_PALETTES = Object.freeze([
  ["#08111f", "#38bdf8", "#e0f2fe"],
  ["#190b2d", "#c084fc", "#f3e8ff"],
  ["#102117", "#34d399", "#d1fae5"],
  ["#28130b", "#fb923c", "#ffedd5"],
  ["#251019", "#fb7185", "#ffe4e6"],
  ["#101827", "#818cf8", "#e0e7ff"],
] as const);

function previewReferenceExtension(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
}

/** Some frozen provider projects include server routes or dependencies that
 * are deliberately outside the browser runtime allowlist. Keep those entries
 * useful without executing that code by compiling a deterministic, local-only
 * design-reference shell around the exact mirrored preview. */
async function preparePreviewReferenceSource(
  input: AdmissionInput,
): Promise<PreparedAdmissionSource> {
  const preview = await readFile(input.previewPath);
  if (
    preview.byteLength !== input.previewBytes ||
    sha256(preview) !== input.previewSha256
  ) {
    throw new Error("STATIC_TEMPLATE_PREVIEW_HASH_MISMATCH");
  }
  const extension = previewReferenceExtension(input.previewMimeType);
  const previewFilename = `template-preview.${extension}`;
  const palette =
    PREVIEW_REFERENCE_PALETTES[
      (input.definition.order - 1) % PREVIEW_REFERENCE_PALETTES.length
    ]!;
  const title = JSON.stringify(input.definition.providerName);
  const description = JSON.stringify(input.definition.providerDescription);
  const tags = JSON.stringify(input.definition.tags.join(" · "));
  const app = [
    'import React from "react";',
    'import "./styles.css";',
    `const title=${title};`,
    `const description=${description};`,
    `const tags=${tags};`,
    "export default function App(){return <main className=\"page\"><nav><strong>{title}</strong><span>Overview&nbsp;&nbsp; Work&nbsp;&nbsp; Contact</span></nav><section className=\"hero\"><div className=\"copy\"><p className=\"eyebrow\">FRONTMIND CURATED TEMPLATE</p><h1>{title}</h1><p className=\"description\">{description}</p><p className=\"tags\">{tags}</p><div className=\"actions\"><a href=\"#reference\">Explore design</a><a className=\"secondary\" href=\"#contact\">Start a project</a></div></div><figure id=\"reference\"><img src=\"/" + previewFilename + "\" alt={title+\" template preview\"}/><figcaption>Verified visual reference</figcaption></figure></section><section id=\"contact\" className=\"footer\"><span>Built for a clear, focused customer journey.</span><strong>{title}</strong></section></main>}",
    "",
  ].join("\n");
  const css = [
    `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:${palette[2]};background:${palette[0]};font-synthesis:none}`,
    "*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-width:320px;background:radial-gradient(circle at 82% 5%,color-mix(in srgb,var(--accent) 24%,transparent),transparent 34%),var(--background)}",
    `:root{--background:${palette[0]};--accent:${palette[1]};--foreground:${palette[2]}}`,
    ".page{min-height:100vh;padding:0 clamp(22px,5vw,76px)}nav{height:88px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid color-mix(in srgb,var(--foreground) 18%,transparent);letter-spacing:.02em}nav span{font-size:13px;opacity:.7}.hero{min-height:calc(100vh - 88px);display:grid;grid-template-columns:minmax(0,.86fr) minmax(340px,1.14fr);gap:clamp(34px,6vw,90px);align-items:center;padding:64px 0}.copy{max-width:650px}.eyebrow{color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.22em}h1{font-size:clamp(48px,7vw,104px);line-height:.92;letter-spacing:-.055em;margin:22px 0}.description{font-size:clamp(17px,2vw,22px);line-height:1.65;opacity:.78}.tags{margin-top:26px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.64}.actions{display:flex;gap:12px;margin-top:36px}.actions a{display:inline-flex;padding:14px 20px;border-radius:999px;background:var(--accent);color:var(--background);font-weight:800;text-decoration:none}.actions .secondary{background:transparent;color:var(--foreground);border:1px solid color-mix(in srgb,var(--foreground) 30%,transparent)}figure{margin:0;position:relative;border:1px solid color-mix(in srgb,var(--foreground) 18%,transparent);border-radius:28px;padding:10px;background:color-mix(in srgb,var(--foreground) 7%,transparent);box-shadow:0 34px 100px rgba(0,0,0,.38);transform:rotate(1.2deg)}figure img{display:block;width:100%;max-height:72vh;object-fit:cover;object-position:top;border-radius:19px;background:#fff}figcaption{position:absolute;right:18px;bottom:18px;padding:8px 12px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font-size:11px;letter-spacing:.08em;text-transform:uppercase}.footer{display:flex;justify-content:space-between;gap:24px;padding:28px 0 46px;border-top:1px solid color-mix(in srgb,var(--foreground) 18%,transparent);opacity:.72}@media(max-width:850px){nav span{display:none}.hero{grid-template-columns:1fr;padding-top:42px}figure{transform:none}figure img{max-height:none}.footer{flex-direction:column}}",
    "",
  ].join("\n");
  const zip = new JSZip();
  zip.file(
    "frontmind-template/package.json",
    `${JSON.stringify({
      name: `frontmind-catalog-${input.definition.order}`,
      private: true,
      version: "1.0.0",
      scripts: { build: "vite build" },
      dependencies: { react: "19.2.1", "react-dom": "19.2.1" },
    })}\n`,
  );
  zip.file(
    "frontmind-template/index.html",
    '<!doctype html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>FrontMind template</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
  );
  zip.file("frontmind-template/src/App.tsx", app);
  zip.file(
    "frontmind-template/src/main.tsx",
    'import React from "react";import{createRoot}from"react-dom/client";import App from"./App";createRoot(document.getElementById("root")!).render(<App/>);\n',
  );
  zip.file("frontmind-template/src/styles.css", css);
  zip.file(`frontmind-template/public/${previewFilename}`, preview);
  const archive = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
  });
  return await prepareStaticTemplateExecutionSource({
    templateId: input.definition.providerTemplateId,
    slug: input.definition.providerSlug,
    version: input.definition.sourceCommitSha,
    archive,
    expectedArchiveSha256: sha256(archive),
    sourceSubdirectory: null,
    signal: input.signal,
    frozenRuntimeMedia: [],
  });
}

async function materializePreparedAdmission(input: {
  request: AdmissionInput;
  prepared: PreparedAdmissionSource;
  runtimeMedia: ReturnType<typeof staticTemplateRuntimeMedia>;
  admissionMode:
    | "provider_source"
    | "verified_normalized_cache"
    | "preview_reference_fallback";
  referencePreviewSha256: string | null;
  fallbackReasonCode:
    | (typeof STATIC_TEMPLATE_PREVIEW_FALLBACK_REASON_CODES)[number]
    | null;
}) {
  const {
    request,
    prepared,
    runtimeMedia,
    admissionMode,
    referencePreviewSha256,
    fallbackReasonCode,
  } = input;
  const sourceArchive = await JSZip.loadAsync(prepared.sourceArchive);
  const sourceFileCount = Object.values(sourceArchive.files).filter(
    (file) => !file.dir,
  ).length;
  const operationToken = `catalog-admission:${request.catalogVersion}:${request.definition.candidateId}`;
  const validated = await validateNativeReactSourceArchive({
    archive: prepared.sourceArchive,
    receipt: {
      operationToken,
      baseSourceSha256: prepared.sourceArchiveSha256,
      archiveSha256: prepared.sourceArchiveSha256,
      fileCount: sourceFileCount,
      preflightVersion: NATIVE_SOURCE_PREFLIGHT_V2_VERSION,
      preflightStatus: "passed",
      preflightSha256: NATIVE_SOURCE_PREFLIGHT_V2_SHA256,
      runtimeContractVersion: NATIVE_RUNTIME_CONTRACT_VERSION,
      runtimeContractSha256: NATIVE_RUNTIME_CONTRACT_V1_SHA256,
      executionShellSha256: NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256,
      executionBaselineSha256: prepared.sourceArchiveSha256,
    },
    expectedOperationToken: operationToken,
    expectedBaseSourceSha256: prepared.sourceArchiveSha256,
    requiredReceiptVersion: 2,
    expectedExecutionBaselineSha256: prepared.sourceArchiveSha256,
    runtimeContract: NATIVE_RUNTIME_CONTRACT_V1,
  });
  const selectionHash = sha256(
    JSON.stringify({
      catalogVersion: request.catalogVersion,
      candidateId: request.definition.candidateId,
      rawSourceSha256: request.rawSourceSha256,
    }),
  );
  const materialized = await materializeNativeReactSource({
    sourceZip: prepared.sourceArchive,
    validatedSource: validated,
    build: { ...ADMISSION_BUILD, selectionHash },
    brief: ADMISSION_BRIEF,
    mode: "preview",
    timeoutMs: 120_000,
    abortSignal: request.signal,
    browserQa: true,
    lighthouseQa: false,
    runtimeAudit: (auditInput) =>
      auditNativeRuntimeContractV1({
        ...auditInput,
        contract: NATIVE_RUNTIME_CONTRACT_V1,
      }),
  });
  const qa = JSON.parse(
    materialized.qaJson.toString("utf8"),
  ) as NativeReactQaReportV1;
  if (!qa.passed || !qa.browser.available) {
    throw new Error("STATIC_TEMPLATE_BROWSER_QA_UNAVAILABLE");
  }
  const browserReceipt = jsonBuffer({
    schemaVersion: 1,
    receiptKind: "frontmind_static_template_browser_admission",
    binding: {
      catalogVersion: request.catalogVersion,
      candidateId: request.definition.candidateId,
      rawSourceSha256: request.rawSourceSha256,
      runtimeMedia,
      admissionMode,
      referencePreviewSha256,
      fallbackReasonCode,
    },
    normalizedSourceSha256: prepared.sourceArchiveSha256,
    sourceTreeSha256: prepared.sourceTreeSha256,
    runtimeContractSha256: NATIVE_RUNTIME_CONTRACT_V1_SHA256,
    executionShellSha256: NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256,
    deliveryContractSha256: materialized.contractSha256,
    distSha256: materialized.distSha256,
    qaSha256: materialized.qaSha256,
    browser: qa.browser,
    buildDelivery: materialized.buildDelivery,
  });
  return {
    status: "admitted" as const,
    framework: prepared.framework,
    normalizedSource: prepared.sourceArchive,
    sourceTreeSha256: prepared.sourceTreeSha256,
    runtimeContractSha256: NATIVE_RUNTIME_CONTRACT_V1_SHA256,
    executionShellSha256: NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256,
    contract: materialized.contractJson,
    dist: materialized.distZip,
    qa: materialized.qaJson,
    browserReceipt,
    qaStatus: materialized.buildDelivery.qaStatus,
    admissionMode,
    referencePreviewSha256,
    fallbackReasonCode,
  };
}

/** Every v5 catalog entry must pass the same controlled compiler and browser
 * QA before the catalog may become active. The guard remains explicit so a
 * future catalog can stage entries without accidentally making them usable. */
export const buildStaticTemplateExecutionAdmission: StaticTemplateExecutionAdmissionBuilder =
  async (input) => {
    if (
      !STATIC_TEMPLATE_REQUIRED_ADMISSION_IDS.includes(input.definition.candidateId)
    ) {
      return {
        status: "unavailable",
        code: "STATIC_TEMPLATE_EXECUTION_ADMISSION_PENDING",
        reason:
          "该模板尚未完成 FrontMind 受控 Vite 构建与浏览器验收，当前不可选择。",
      };
    }
    const rawSource = await readFile(input.rawSourcePath);
    if (
      rawSource.byteLength !== input.rawSourceBytes ||
      sha256(rawSource) !== input.rawSourceSha256
    ) {
      throw new Error("STATIC_TEMPLATE_RAW_SOURCE_HASH_MISMATCH");
    }
    const runtimeMedia = staticTemplateRuntimeMedia(input.definition.candidateId);
    const cached = input.cachedNormalizedSource;
    const cachedBytes = cached ? await readFile(cached.path) : null;
    if (cached && (!cachedBytes || cachedBytes.length !== cached.bytes || sha256(cachedBytes) !== cached.sha256 || cached.rawSourceSha256 !== input.rawSourceSha256)) throw new Error("STATIC_TEMPLATE_NORMALIZED_SOURCE_HASH_MISMATCH");
    if (cached && cachedBytes) {
      return await materializePreparedAdmission({
        request: input,
        prepared: {
          framework: "vite_react" as const,
          sourceArchive: cachedBytes,
          sourceArchiveSha256: cached.sha256,
          sourceTreeSha256: cached.sourceTreeSha256,
        },
        runtimeMedia,
        admissionMode: "verified_normalized_cache",
        referencePreviewSha256: null,
        fallbackReasonCode: null,
      });
    }
    let prepared: PreparedAdmissionSource;
    try {
      prepared = await prepareStaticTemplateExecutionSource({
        templateId: input.definition.providerTemplateId,
        slug: input.definition.providerSlug,
        version: input.definition.sourceCommitSha,
        archive: rawSource,
        expectedArchiveSha256: input.rawSourceSha256,
        sourceSubdirectory: input.definition.sourceSubdirectory,
        signal: input.signal,
        frozenRuntimeMedia: runtimeMedia,
      });
    } catch (error) {
      const fallbackReasonCode = staticTemplatePreviewFallbackReasonCode(
        error,
        input.signal,
      );
      if (!fallbackReasonCode) throw error;
      const fallback = await preparePreviewReferenceSource(input);
      return await materializePreparedAdmission({
        request: input,
        prepared: fallback,
        runtimeMedia,
        admissionMode: "preview_reference_fallback",
        referencePreviewSha256: input.previewSha256,
        fallbackReasonCode,
      });
    }
    return await materializePreparedAdmission({
      request: input,
      prepared,
      runtimeMedia,
      admissionMode: "provider_source",
      referencePreviewSha256: null,
      fallbackReasonCode: null,
    });
  };
