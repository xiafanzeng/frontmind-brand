import type { SiteOpsDatabase, SiteOpsInfrastructureTables, SiteOpsCoreErrorConstructor, SiteOpsOwnershipPredicate, PresalesApiCredential, EncryptedCredential } from "./infrastructure-ports.js";
export interface ArtifactApiCore {
 tables: SiteOpsInfrastructureTables;
 enterpriseOwnerPredicate: SiteOpsOwnershipPredicate;
 enterpriseProjectUrl: (path: string) => string;
 getEnterpriseProjectScope: () => unknown;
 enterpriseWorkspaceUserId: (userId: number) => number;
 getDb: () => Promise<SiteOpsDatabase | null>;
 requestActor: (request: import("express").Request) => {id: number} | undefined;
 runWithSiteOpsOAuthProjectScope: <T>(actor: any, identity: import("./infrastructure-ports.js").SiteOpsOAuthProjectIdentity, action: () => T | Promise<T>) => Promise<T>;
 readSiteOpsArtifact: typeof import("./artifact-store.js").readSiteOpsArtifact;
 exchangeAliyunOAuthCode: typeof import("./aliyun-platform-service.js").exchangeAliyunOAuthCode;
 completeSiteOpsAliyunOAuth: typeof import("./service.js").completeSiteOpsAliyunOAuth;
 /** Host-injected HMAC over the domain-separated payload; the module
  * re-derives and compares with timingSafeEqual when verifying. */
 signEmbedPreviewToken: (payload: string) => string;
}
let siteBuilds: SiteOpsInfrastructureTables["siteBuilds"];
let siteProjects: SiteOpsInfrastructureTables["siteProjects"];
let socialPackages: SiteOpsInfrastructureTables["socialPackages"];
let websiteStyleSampleBatches: SiteOpsInfrastructureTables["websiteStyleSampleBatches"];
let websiteStyleSamples: SiteOpsInfrastructureTables["websiteStyleSamples"];
let enterpriseOwnerPredicate: ArtifactApiCore["enterpriseOwnerPredicate"];
let enterpriseProjectUrl: ArtifactApiCore["enterpriseProjectUrl"];
let getEnterpriseProjectScope: ArtifactApiCore["getEnterpriseProjectScope"];
let enterpriseWorkspaceUserId: ArtifactApiCore["enterpriseWorkspaceUserId"];
let getDb: ArtifactApiCore["getDb"];
let requestActor: ArtifactApiCore["requestActor"];
let runWithSiteOpsOAuthProjectScope: ArtifactApiCore["runWithSiteOpsOAuthProjectScope"];
let readSiteOpsArtifact: ArtifactApiCore["readSiteOpsArtifact"];
let exchangeAliyunOAuthCode: ArtifactApiCore["exchangeAliyunOAuthCode"];
let completeSiteOpsAliyunOAuth: ArtifactApiCore["completeSiteOpsAliyunOAuth"];
let signEmbedPreviewToken: ArtifactApiCore["signEmbedPreviewToken"];
export function configureArtifactApiCore(core: ArtifactApiCore) {
 ({siteBuilds,siteProjects,socialPackages,websiteStyleSampleBatches,websiteStyleSamples}=core.tables);
 ({enterpriseOwnerPredicate,enterpriseProjectUrl,getEnterpriseProjectScope,enterpriseWorkspaceUserId,getDb,requestActor,runWithSiteOpsOAuthProjectScope,readSiteOpsArtifact,exchangeAliyunOAuthCode,completeSiteOpsAliyunOAuth,signEmbedPreviewToken}=core);
}

import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import express from "express";
import JSZip from "jszip";
import { and, eq, sql, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";

import { siteContentPlanV2Schema } from "../../contracts/siteops-content-plan.js";
import {
  readSiteDesignPreferencesFromBrief,
  staticTemplateExecutionAdmissionEvidenceSchema,
} from "../../contracts/siteops.js";
import { openStaticTemplateCatalogVersionDist } from "./static-template-catalog.js";
import { previewNavigationBridgeSource } from "./preview-routing.js";
import { siteAssistantApiOrigin } from "./site-assistant-widget.js";
import { customerVisibleStyleBatchStatusCondition } from "./visual-batch-visibility.js";

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_CONTENT_PLAN_BYTES = 4 * 1024 * 1024;

type AliyunOAuthCompletionStatus = "success" | "cancelled" | "failed";
type AliyunOAuthCallbackStage =
  | "session"
  | "provider_authorization"
  | "oauth_exchange"
  | "account_bind";

const SAFE_ALIYUN_OAUTH_ERROR_CODES = new Set([
  "CREDENTIAL_ROTATED",
  "DATABASE_UNAVAILABLE",
  "FORBIDDEN",
  "INVALID_CALLBACK",
  "INVALID_CREDENTIAL",
  "NOT_FOUND",
  "PROVIDER_AUTHORIZATION_FAILED",
  "PROVIDER_NOT_CONFIGURED",
  "RATE_LIMITED",
  "STATE_CONFLICT",
  "UNAUTHENTICATED",
  "UPSTREAM_UNAVAILABLE",
]);

function safeAliyunOAuthErrorCode(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : null;
  return typeof code === "string" && SAFE_ALIYUN_OAUTH_ERROR_CODES.has(code)
    ? code
    : "UNEXPECTED_ERROR";
}

function logAliyunOAuthCallbackFailure(input: {
  correlationId: string;
  stage: AliyunOAuthCallbackStage;
  userId: number | null;
  errorCode: string;
  startedAt: number;
}) {
  const buildSha = process.env.FRONTMIND_BUILD_SHA?.trim() ?? "";
  console.error("[SiteOps Aliyun OAuth] callback_stage_failed", {
    event: "siteops_aliyun_oauth_callback_stage_failed",
    correlationId: input.correlationId,
    stage: input.stage,
    userId: input.userId,
    errorCode: SAFE_ALIYUN_OAUTH_ERROR_CODES.has(input.errorCode)
      ? input.errorCode
      : "UNEXPECTED_ERROR",
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    releaseSha: /^[a-f0-9]{40}$/u.test(buildSha) ? buildSha : null,
  });
}

const ALIYUN_OAUTH_COMPLETION_COPY: Record<
  AliyunOAuthCompletionStatus,
  { title: string; description: string }
> = {
  success: {
    title: "阿里云授权已完成",
    description: "账号已经连接，可以返回 AI友好官网管理选择并配置域名。",
  },
  cancelled: {
    title: "已取消阿里云授权",
    description: "未保存新的客户账号连接，可以返回后重新发起授权。",
  },
  failed: {
    title: "阿里云授权暂时无法完成",
    description: "请返回 AI友好官网管理后重试，或联系 FrontMind 协助处理。",
  },
};

function sendAliyunOAuthCompletionPage(
  res: express.Response,
  status: AliyunOAuthCompletionStatus,
) {
  const nonce = randomBytes(18).toString("base64url");
  const copy = ALIYUN_OAUTH_COMPLETION_COPY[status];
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${copy.title}</title>
    <style nonce="${nonce}">
      :root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #f7f5fb; color: #25222d; }
      main { width: min(32rem, calc(100vw - 3rem)); padding: 2rem; border: 1px solid #e4deed; border-radius: 1.25rem; background: #fff; box-shadow: 0 1rem 3rem rgba(43, 34, 59, .08); }
      h1 { margin: 0 0 .75rem; font-size: 1.35rem; }
      p { margin: 0 0 1.25rem; color: #625b6d; line-height: 1.65; }
      a { display: inline-flex; padding: .7rem 1rem; border-radius: .75rem; background: #493b64; color: #fff; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>${copy.title}</h1>
      <p>${copy.description}</p>
      <a href="/">返回 AI友好官网管理</a>
    </main>
    <script nonce="${nonce}">
      (() => {
        const message = Object.freeze({
          type: "frontmind:siteops:aliyun-oauth",
          status: "${status}"
        });
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(message, window.location.origin);
          if (message.status === "cancelled") {
            window.close();
          }
        }
      })();
    </script>
  </body>
</html>`;

  res.status(200);
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`,
  );
  res.send(html);
}

function notFound(res: express.Response) {
  res.status(404).json({ error: "NOT_FOUND" });
}

export function publicSiteOpsArtifactError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return code === "NOT_FOUND"
    ? { status: 404, body: { error: "NOT_FOUND" } }
    : {
        status: 409,
        body: { error: "文件暂时无法打开，请稍后重试。" },
      };
}

function sendError(res: express.Response, error: unknown) {
  const projected = publicSiteOpsArtifactError(error);
  res.status(projected.status).json(projected.body);
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db;
}

async function streamToBuffer(stream: Readable, maxBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of stream) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    size += chunk.length;
    if (size > maxBytes) {
      stream.destroy();
      throw new Error("SITEOPS_ARTIFACT_TOO_LARGE");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function safePreviewPath(raw: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw || "");
  } catch {
    throw new Error("SITEOPS_PREVIEW_PATH_INVALID");
  }
  if (
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.startsWith("/") ||
    decoded.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("SITEOPS_PREVIEW_PATH_INVALID");
  }
  const normalized = decoded.normalize("NFKC").replace(/^\/+|\/+$/gu, "");
  if (normalized.length > 1_024) {
    throw new Error("SITEOPS_PREVIEW_PATH_INVALID");
  }
  return normalized || "index.html";
}

function previewMimeType(filename: string) {
  const extension = path.posix.extname(filename).toLowerCase();
  return (
    (
      {
        ".avif": "image/avif",
        ".css": "text/css; charset=utf-8",
        ".gif": "image/gif",
        ".html": "text/html; charset=utf-8",
        ".ico": "image/x-icon",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".webp": "image/webp",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".xml": "application/xml; charset=utf-8",
      } as Record<string, string>
    )[extension] ?? "application/octet-stream"
  );
}

function prefixPreviewRootUrl(value: string, prefix: string) {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith(prefix)
  ) {
    return value;
  }
  return `${prefix}${value.slice(1)}`;
}

function rewriteCssRootUrls(value: string, prefix: string) {
  return value
    .replace(
      /url\(\s*(?:(["'])(\/(?!\/)[^"')]+)\1|(\/(?!\/)[^)\s]+))\s*\)/giu,
      (
        match,
        quote: string | undefined,
        quoted: string | undefined,
        bare: string | undefined,
      ) => {
        const url = quoted ?? bare;
        if (!url) return match;
        const rewritten = prefixPreviewRootUrl(url, prefix);
        return quote
          ? `url(${quote}${rewritten}${quote})`
          : `url(${rewritten})`;
      },
    )
    .replace(
      /(@import\s+)(["'])(\/(?!\/)[^"']+)\2/giu,
      (_match, keyword: string, quote: string, url: string) =>
        `${keyword}${quote}${prefixPreviewRootUrl(url, prefix)}${quote}`,
    );
}

function localPreviewAssetPath(raw: string, from: string) {
  const decoded = raw.trim();
  if (
    !decoded ||
    decoded.startsWith("#") ||
    /^(?:data:|blob:|mailto:|tel:|https?:|\/\/)/iu.test(decoded)
  ) {
    return null;
  }
  const withoutSuffix = decoded.split(/[?#]/u, 1)[0]!;
  const resolved = withoutSuffix.startsWith("/")
    ? withoutSuffix.slice(1)
    : path.posix.normalize(
        path.posix.join(path.posix.dirname(from), withoutSuffix),
      );
  if (
    !resolved ||
    resolved.startsWith("../") ||
    resolved.includes("\\") ||
    resolved.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("SITEOPS_PREVIEW_PATH_INVALID");
  }
  return resolved;
}

async function replaceAsync(
  value: string,
  expression: RegExp,
  replacer: (...groups: string[]) => Promise<string>,
) {
  const matches = [...value.matchAll(expression)];
  if (matches.length === 0) return value;
  const replacements = await Promise.all(
    matches.map((match) =>
      replacer(match[0], ...match.slice(1).map((part) => part ?? "")),
    ),
  );
  let cursor = 0;
  let result = "";
  matches.forEach((match, index) => {
    result += value.slice(cursor, match.index) + replacements[index];
    cursor = (match.index ?? 0) + match[0].length;
  });
  return result + value.slice(cursor);
}

function addPreviewExecutableNonces(html: string, nonce: string) {
  const openingTag = /<(script|style)\b[^>]*>/giu;
  let cursor = 0;
  let result = "";
  while (cursor < html.length) {
    openingTag.lastIndex = cursor;
    const match = openingTag.exec(html);
    if (!match || match.index === undefined) {
      result += html.slice(cursor);
      break;
    }
    const tagName = match[1]!.toLowerCase();
    const opening = match[0];
    result += html.slice(cursor, match.index);
    result += /\bnonce\s*=/iu.test(opening)
      ? opening
      : opening.replace(/>$/u, ` nonce="${nonce}">`);

    const contentStart = match.index + opening.length;
    const closingTag = new RegExp(`</${tagName}\\s*>`, "iu");
    const closing = closingTag.exec(html.slice(contentStart));
    if (!closing || closing.index === undefined) {
      result += html.slice(contentStart);
      break;
    }
    const contentEnd = contentStart + closing.index;
    const closingEnd = contentEnd + closing[0].length;
    result += html.slice(contentStart, closingEnd);
    cursor = closingEnd;
  }
  return result;
}

export type SiteOpsPreviewRoutingMode =
  | "legacy_static_literals"
  | "canonical_pathname";

function previewNavigationBridge(input: {
  nonce: string;
  previewPrefix: string;
}) {
  return `<script nonce="${input.nonce}">${previewNavigationBridgeSource(input.previewPrefix)}</script>`;
}

function injectPreviewNavigationBridge(input: {
  html: string;
  nonce: string;
  previewPrefix: string;
}) {
  const bridge = previewNavigationBridge(input);
  if (/<head\b[^>]*>/iu.test(input.html)) {
    return input.html.replace(/<head\b[^>]*>/iu, (head) => `${head}${bridge}`);
  }
  if (/<body\b[^>]*>/iu.test(input.html)) {
    return input.html.replace(/<body\b[^>]*>/iu, (body) => `${bridge}${body}`);
  }
  return `${bridge}${input.html}`;
}

export async function createSandboxedPreviewDocument(input: {
  zip: JSZip;
  entryName: string;
  previewPrefix: string;
  previewRoutingMode?: SiteOpsPreviewRoutingMode;
}) {
  const files = new Map(
    Object.values(input.zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => [entry.name, entry] as const),
  );
  const bytesCache = new Map<string, Buffer>();
  let expandedBytes = 0;
  const fileBytes = async (filename: string) => {
    const cached = bytesCache.get(filename);
    if (cached) return cached;
    const entry = files.get(filename);
    if (!entry || entry.name.includes("\\") || entry.name.includes("..")) {
      throw new Error("SITEOPS_PREVIEW_ASSET_MISSING");
    }
    const mode = Number(entry.unixPermissions ?? 0);
    if (mode && (mode & 0o170000) === 0o120000) {
      throw new Error("SITEOPS_DIST_SYMLINK_REJECTED");
    }
    const bytes = await entry.async("nodebuffer");
    expandedBytes += bytes.length;
    if (bytes.length > 20 * 1024 * 1024 || expandedBytes > MAX_ARCHIVE_BYTES) {
      throw new Error("SITEOPS_PREVIEW_FILE_TOO_LARGE");
    }
    bytesCache.set(filename, bytes);
    return bytes;
  };
  const dataUrl = async (filename: string) => {
    const mimeType = previewMimeType(filename).split(";", 1)[0];
    return `data:${mimeType};base64,${(await fileBytes(filename)).toString("base64")}`;
  };
  const embedCssUrls = async (css: string, filename: string) =>
    await replaceAsync(
      css,
      /url\(\s*(?:(["'])([^"']+)\1|([^)'"\s]+))\s*\)/giu,
      async (match, quote, quoted, bare) => {
        const raw = quoted || bare;
        const local = localPreviewAssetPath(raw, filename);
        if (!local) return match;
        const embedded = await dataUrl(local);
        return `url(${quote || '"'}${embedded}${quote || '"'})`;
      },
    );
  const inlineCss = async (filename: string, visiting = new Set<string>()) => {
    if (visiting.has(filename)) {
      throw new Error("SITEOPS_PREVIEW_STYLE_CYCLE");
    }
    const nextVisiting = new Set(visiting).add(filename);
    let css = (await fileBytes(filename)).toString("utf8");
    css = await replaceAsync(
      css,
      /@import\s+(?:url\(\s*)?(["'])([^"']+)\1\s*\)?\s*;/giu,
      async (_match, _quote, raw) => {
        const local = localPreviewAssetPath(raw, filename);
        if (!local) throw new Error("SITEOPS_PREVIEW_STYLE_INVALID");
        return await inlineCss(local, nextVisiting);
      },
    );
    return await embedCssUrls(css, filename);
  };
  const embedAssetReferences = async (text: string, from: string) => {
    const assetPaths = [...files.keys()]
      .filter((filename) => filename !== input.entryName)
      .sort((left, right) => right.length - left.length);
    let result = text;
    for (const filename of assetPaths) {
      const embedded = await dataUrl(filename);
      for (const reference of [
        `/${filename}`,
        path.posix.relative(path.posix.dirname(from), filename),
      ]) {
        if (reference && reference !== ".") {
          result = result.split(reference).join(embedded);
        }
      }
    }
    return result;
  };

  const nonce = randomBytes(18).toString("base64url");
  let html = (await fileBytes(input.entryName)).toString("utf8");
  // The immutable dist carries its production document policy and a root base
  // URL. The private preview is a self-contained, nonce-authorized sandbox at
  // a build-scoped path, so neither directive may be allowed to compose with
  // the response policy or change how relative navigation resolves.
  html = html
    .replace(
      /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*["']Content-Security-Policy["'])[^>]*>/giu,
      "",
    )
    .replace(/<base\b[^>]*>/giu, "");
  html = injectPreviewNavigationBridge({
    html,
    nonce,
    previewPrefix: input.previewPrefix,
  });
  html = await replaceAsync(
    html,
    /<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/giu,
    async (_match, raw) => {
      const local = localPreviewAssetPath(raw, input.entryName);
      if (!local) throw new Error("SITEOPS_PREVIEW_STYLE_INVALID");
      return `<style nonce="${nonce}">${await inlineCss(local)}</style>`;
    },
  );
  html = html.replace(
    /<link\b(?=[^>]*\brel=["'](?:modulepreload|preload)["'])[^>]*>/giu,
    "",
  );
  html = await replaceAsync(
    html,
    /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/giu,
    async (_match, before, raw, after) => {
      const local = localPreviewAssetPath(raw, input.entryName);
      if (!local) throw new Error("SITEOPS_PREVIEW_SCRIPT_INVALID");
      const embeddedSource = await embedAssetReferences(
        (await fileBytes(local)).toString("utf8"),
        local,
      );
      const source = rewriteSiteOpsPreviewDocument({
        bytes: Buffer.from(embeddedSource, "utf8"),
        mimeType: "text/javascript; charset=utf-8",
        previewPrefix: input.previewPrefix,
        previewRoutingMode:
          input.previewRoutingMode ?? "legacy_static_literals",
      }).toString("utf8");
      const attributes = `${before} ${after}`
        .replace(/\s(?:crossorigin|integrity)(?:=["'][^"']*["'])?/giu, "")
        .trim();
      return `<script nonce="${nonce}"${attributes ? ` ${attributes}` : ""}>${source.replace(/<\/script/giu, "<\\/script")}</script>`;
    },
  );
  html = await replaceAsync(
    html,
    /\b(src|poster)(\s*=\s*)(["'])([^"']+)\3/giu,
    async (match, name, equals, quote, raw) => {
      const local = localPreviewAssetPath(raw, input.entryName);
      if (!local) return match;
      return `${name}${equals}${quote}${await dataUrl(local)}${quote}`;
    },
  );
  html = await replaceAsync(
    html,
    /\bsrcset(\s*=\s*)(["'])([^"']*)\2/giu,
    async (_match, equals, quote, value) => {
      const candidates = await Promise.all(
        value.split(",").map(async (candidate) => {
          const [raw, ...descriptor] = candidate.trim().split(/\s+/u);
          const local = raw
            ? localPreviewAssetPath(raw, input.entryName)
            : null;
          return [local ? await dataUrl(local) : raw, ...descriptor]
            .filter(Boolean)
            .join(" ");
        }),
      );
      return `srcset${equals}${quote}${candidates.join(", ")}${quote}`;
    },
  );
  html = await replaceAsync(
    html,
    /<link\b(?=[^>]*\brel=["']icon["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/giu,
    async (match, raw) => {
      const local = localPreviewAssetPath(raw, input.entryName);
      if (!local) return match;
      return match.replace(raw, await dataUrl(local));
    },
  );
  html = await replaceAsync(
    html,
    /<style\b([^>]*)>([\s\S]*?)<\/style>/giu,
    async (_match, attributes, css) =>
      `<style${attributes}>${await embedCssUrls(css, input.entryName)}</style>`,
  );
  html = addPreviewExecutableNonces(html, nonce).replace(
    /\bhref(\s*=\s*)(["'])([^"']*)\2/giu,
    (_match, equals: string, quote: string, url: string) => {
      const prefixed = prefixPreviewRootUrl(url, input.previewPrefix);
      if (!getEnterpriseProjectScope()) return `href${equals}${quote}${prefixed}${quote}`;
      let resolved: URL;
      try { resolved = new URL(prefixed, `https://frontmind.invalid${input.previewPrefix}${input.entryName}`); }
      catch { return `href${equals}${quote}${prefixed}${quote}`; }
      const scoped = resolved.origin === "https://frontmind.invalid" && resolved.pathname.startsWith(input.previewPrefix)
        ? enterpriseProjectUrl(`${resolved.pathname}${resolved.search}${resolved.hash}`)
        : prefixed;
      return `href${equals}${quote}${scoped}${quote}`;
    },
  );
  return { bytes: Buffer.from(html, "utf8"), nonce };
}

export function sandboxedPreviewContentSecurityPolicy(
  nonce: string,
  options: { frameAncestors?: string } = {},
) {
  if (!/^[A-Za-z0-9_-]{16,64}$/u.test(nonce)) {
    throw new Error("SITEOPS_PREVIEW_NONCE_INVALID");
  }
  const frameAncestors = options.frameAncestors ?? "'none'";
  if (!/^'(?:none|self)'$/u.test(frameAncestors)) {
    throw new Error("SITEOPS_PREVIEW_FRAME_ANCESTORS_INVALID");
  }
  return `sandbox allow-scripts; default-src 'none'; img-src data: blob:; font-src data:; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${siteAssistantApiOrigin()}; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; media-src data: blob:; manifest-src 'none'; base-uri 'none'; frame-ancestors ${frameAncestors}; form-action 'none'`;
}

export function rewriteSiteOpsPreviewDocument(input: {
  bytes: Buffer;
  mimeType: string;
  previewPrefix: string;
  previewRoutingMode?: SiteOpsPreviewRoutingMode;
}) {
  const mediaType = input.mimeType.split(";", 1)[0]?.trim().toLowerCase();
  if (
    mediaType !== "text/html" &&
    mediaType !== "text/css" &&
    mediaType !== "text/javascript" &&
    mediaType !== "application/javascript"
  ) {
    return input.bytes;
  }
  let text = input.bytes.toString("utf8");
  if (mediaType === "text/html") {
    text = text
      .replace(
        /\b(href|src|action|poster|data|xlink:href)(\s*=\s*)(["'])(\/(?!\/)[^"'<>]*)\3/giu,
        (_match, name: string, equals: string, quote: string, url: string) =>
          `${name}${equals}${quote}${prefixPreviewRootUrl(url, input.previewPrefix)}${quote}`,
      )
      .replace(
        /\b(srcset)(\s*=\s*)(["'])([^"']*)\3/giu,
        (
          _match,
          name: string,
          equals: string,
          quote: string,
          value: string,
        ) => {
          const rewritten = value.replace(
            /(^|,\s*)(\/(?!\/)[^\s,]+)/gu,
            (_candidate, separator: string, url: string) =>
              `${separator}${prefixPreviewRootUrl(url, input.previewPrefix)}`,
          );
          return `${name}${equals}${quote}${rewritten}${quote}`;
        },
      );
  }
  if (
    (mediaType === "text/javascript" ||
      mediaType === "application/javascript") &&
    (input.previewRoutingMode ?? "legacy_static_literals") ===
      "legacy_static_literals"
  ) {
    // Historical 2.8 bundles commonly use literal route tables. Keep those
    // keys aligned with the build-scoped preview URL, but deliberately leave
    // dynamic template literals alone: prefixing `/${segment}/` here can
    // compose with an already-prefixed pathname and produce a double prefix.
    // The navigation bridge above scopes dynamic anchors and History API
    // calls at execution time instead.
    text = text.replace(
      /(["'])(\/(?!\/)[A-Za-z0-9._~!$&()*+,;=:@%/?#-]*)\1/gu,
      (_match, quote: string, url: string) =>
        `${quote}${prefixPreviewRootUrl(url, input.previewPrefix)}${quote}`,
    );
  }
  return Buffer.from(rewriteCssRootUrls(text, input.previewPrefix), "utf8");
}

function ownedSiteProjectCondition(projectId: SQLWrapper, userId: number) {
  return sql`EXISTS (SELECT 1 FROM ${siteProjects} WHERE ${siteProjects.id} = ${projectId} AND ${enterpriseOwnerPredicate(siteProjects, userId)})`;
}

async function ownedBuild(userId: number, buildId: string) {
  const db = await requireDb();
  const rows = await db
    .select({ build: siteBuilds, project: siteProjects })
    .from(siteBuilds)
    .innerJoin(siteProjects, eq(siteProjects.id, siteBuilds.projectId))
    .where(
      and(
        eq(siteBuilds.id, buildId),
        eq(siteBuilds.userId, userId),
        enterpriseOwnerPredicate(siteProjects, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Short-lived capability token for the same-origin embed preview. A valid
 * dashboard session is still required on every request; the token only bounds
 * how long a minted embed URL stays usable, and refreshing it never triggers a
 * rebuild.
 */
export const SITEOPS_EMBED_PREVIEW_TOKEN_TTL_MS = 10 * 60_000;

const SITEOPS_EMBED_PREVIEW_TOKEN_DOMAIN = "frontmind.siteops-embed-preview.v1";
const SITEOPS_EMBED_PREVIEW_TOKEN_MAX_CHARS = 4_096;

const embedPreviewTokenPayloadSchema = z
  .object({
    v: z.literal(1),
    buildId: z.string().uuid(),
    userId: z.number().int().positive(),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u),
    expiresAt: z.number().int().positive(),
  })
  .strict();

type EmbedPreviewSigner = (payload: string) => string;

function embedPreviewTokenSignature(payload: string, sign: EmbedPreviewSigner) {
  return sign(`${SITEOPS_EMBED_PREVIEW_TOKEN_DOMAIN}\u0000${payload}`);
}

function timingSafeEqualText(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes);
}

export function buildSiteOpsEmbedPreviewToken(input: {
  buildId: string;
  userId: number;
  now: number;
  ttlMs?: number;
  sign: EmbedPreviewSigner;
}) {
  const payload = JSON.stringify({
    v: 1,
    buildId: input.buildId,
    userId: input.userId,
    nonce: randomBytes(18).toString("base64url"),
    expiresAt: input.now + (input.ttlMs ?? SITEOPS_EMBED_PREVIEW_TOKEN_TTL_MS),
  });
  return `${payload}.${embedPreviewTokenSignature(payload, input.sign)}`;
}

export function verifySiteOpsEmbedPreviewToken(
  token: unknown,
  input: { buildId: string; userId: number; now: number; sign: EmbedPreviewSigner },
): "valid" | "expired" | "invalid" {
  if (typeof token !== "string" || token.length > SITEOPS_EMBED_PREVIEW_TOKEN_MAX_CHARS) {
    return "invalid";
  }
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return "invalid";
  const payloadText = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return "invalid";
  }
  const parsed = embedPreviewTokenPayloadSchema.safeParse(payload);
  if (!parsed.success) return "invalid";
  if (
    !timingSafeEqualText(
      signature,
      embedPreviewTokenSignature(payloadText, input.sign),
    )
  ) {
    return "invalid";
  }
  if (parsed.data.buildId !== input.buildId || parsed.data.userId !== input.userId) {
    return "invalid";
  }
  return parsed.data.expiresAt < input.now ? "expired" : "valid";
}

export type SiteOpsPreviewBridgeConfig = {
  token: string;
  buildId: string;
  knowledgeSnapshotId: string;
  knowledgeArchiveHash: string;
  designRevision: number | null;
  draftHash: string | null;
};

/**
 * Communication capability for the trusted preview bridge: derived
 * deterministically from the embed capability so the mint endpoint and the
 * serving route agree without server-side state. Rotates whenever the embed
 * token is refreshed.
 */
export function siteOpsPreviewBridgeToken(
  embedToken: string,
  sign: EmbedPreviewSigner,
) {
  return sign(`frontmind.siteops-preview-bridge.v1\u0000${embedToken}`);
}

function bridgeConfigJson(input: SiteOpsPreviewBridgeConfig) {
  return JSON.stringify(input)
    .replaceAll("<", "\\u003c")
    .replaceAll(String.fromCharCode(0x2028), "\\u2028")
    .replaceAll(String.fromCharCode(0x2029), "\\u2029");
}

/** Nonce-scoped bootstrap the real assistant widget reads to report rendered
 * answers back to the embedding dashboard. */
export function siteOpsPreviewBridgeScript(
  nonce: string,
  config: SiteOpsPreviewBridgeConfig,
) {
  if (!/^[A-Za-z0-9_-]{16,64}$/u.test(nonce)) {
    throw new Error("SITEOPS_PREVIEW_NONCE_INVALID");
  }
  return `<script nonce="${nonce}">window.__FRONTMIND_SITEOPS_PREVIEW_BRIDGE__=${bridgeConfigJson(config)};</script>`;
}

async function frozenPreviewRouteEntries(input: {
  userId: number;
  build: typeof siteBuilds.$inferSelect;
}) {
  if (input.build.workflowVersion !== "2.9.0") return null;
  if (!input.build.contentPlanLocalAssetId || !input.build.contentPlanSha256) {
    return undefined;
  }
  const asset = await readSiteOpsArtifact({
    userId: input.userId,
    localAssetId: input.build.contentPlanLocalAssetId,
    expectedSha256: input.build.contentPlanSha256,
    expectedMimeTypes: ["application/json"],
  });
  if (!asset) return undefined;
  const bytes = await streamToBuffer(
    asset.stored.createReadStream(),
    MAX_CONTENT_PLAN_BYTES,
  );
  let candidate: unknown;
  try {
    candidate = JSON.parse(bytes.toString("utf8"));
  } catch {
    return undefined;
  }
  const plan = siteContentPlanV2Schema.safeParse(candidate);
  if (!plan.success) return undefined;
  return new Set(
    plan.data.routes.map((route) =>
      route.path === "/"
        ? "index.html"
        : `${route.path.replace(/^\/+|\/+$/gu, "")}/index.html`,
    ),
  );
}

async function sendOwnedAsset(input: {
  res: express.Response;
  userId: number;
  localAssetId: string;
  expectedSha256?: string | null;
  expectedMimeTypes?: string[];
  disposition?: "inline" | "attachment";
}) {
  const asset = await readSiteOpsArtifact({
    userId: input.userId,
    localAssetId: input.localAssetId,
    expectedSha256: input.expectedSha256,
    ...(input.expectedMimeTypes
      ? { expectedMimeTypes: input.expectedMimeTypes }
      : {}),
  });
  if (
    !asset ||
    (input.expectedMimeTypes &&
      !input.expectedMimeTypes.includes(asset.row.mimeType))
  ) {
    return notFound(input.res);
  }
  input.res.setHeader("Cache-Control", "private, no-store, max-age=0");
  input.res.setHeader("Content-Type", asset.row.mimeType);
  input.res.setHeader("Content-Length", String(asset.row.sizeBytes));
  input.res.setHeader("ETag", `"sha256:${asset.row.contentSha256}"`);
  input.res.setHeader(
    "Content-Disposition",
    `${input.disposition ?? "attachment"}; filename*=UTF-8''${encodeURIComponent(asset.row.filename)}`,
  );
  asset.stored.createReadStream().pipe(input.res);
}

const FAIL_CLOSED_ARTIFACT_ERRORS = new Set([
  "SITEOPS_ARTIFACT_BODY_MISMATCH",
  "SITEOPS_ARTIFACT_HASH_MISMATCH",
  "SITEOPS_ARTIFACT_MIME_MISMATCH",
]);

async function sendOwnedStylePreview(input: {
  res: express.Response;
  userId: number;
  localAssetId: string;
  expectedSha256?: string | null;
  expectedMimeTypes: string[];
}) {
  try {
    await sendOwnedAsset({
      ...input,
      disposition: "inline",
    });
  } catch (error) {
    if (
      error instanceof Error &&
      FAIL_CLOSED_ARTIFACT_ERRORS.has(error.message)
    ) {
      return notFound(input.res);
    }
    throw error;
  }
}

export const siteOpsArtifactApi: express.Router = express.Router();

const STYLE_PREVIEW_MIME_TYPES = [
  "image/avif",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

function normalizedSha256(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/iu.test(value.trim())) {
    return null;
  }
  return value.trim().toLowerCase();
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

const staticTemplatePreviewMetadataSchema = z
  .object({
    schemaVersion: z.literal(7),
    renderer: z.literal("frontmind_static_template_catalog_v1"),
    workflowVersion: z.enum(["2.8.0", "2.9.0"]),
    catalogVersion: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{0,190}$/u),
    catalogPosition: z.number().int().min(1).max(35),
    catalogCandidateId: z
      .string()
      .regex(/^static-template-[0-9]{2,3}-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u),
    providerTemplateId: z.string().trim().min(1).max(191),
    providerSlug: z.string().trim().min(1).max(191),
    providerVersion: z.string().regex(/^[a-f0-9]{40}$/u),
    sourceOwner: z.string().trim().min(1).max(191),
    sourceRepo: z.string().trim().min(1).max(191),
    sourceCommitSha: z.string().regex(/^[a-f0-9]{40}$/u),
    sourceSubdirectory: z.string().trim().min(1).max(1_024).nullable(),
    sourceLicense: z.enum(["MIT", "Apache-2.0"]),
    sourceAssetId: z.string().trim().min(1).max(512),
    sourceArchiveSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceArchiveBytes: z.number().int().positive().max(MAX_ARCHIVE_BYTES * 2),
    previewAssetId: z.string().trim().min(1).max(512),
    previewSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    executionAdmission: staticTemplateExecutionAdmissionEvidenceSchema,
  })
  .passthrough();

/** Resolve a saved selection against its frozen catalog, never current active. */
export async function openFrozenStaticTemplatePreviewDist(
  metadata: unknown,
  options: { rootDir?: string } = {},
) {
  const parsed = staticTemplatePreviewMetadataSchema.safeParse(metadata);
  if (!parsed.success) {
    throw new Error("NOT_FOUND");
  }
  const frozen = parsed.data;
  const evidence = frozen.executionAdmission;
  if (evidence.status !== "admitted") {
    throw new Error("NOT_FOUND");
  }
  const opened = await openStaticTemplateCatalogVersionDist(
    frozen.catalogVersion,
    frozen.catalogCandidateId,
    options,
  );
  const entry = opened.entry;
  const admission = entry.executionAdmission;
  const valid =
    entry.order === frozen.catalogPosition &&
    entry.providerTemplateId === frozen.providerTemplateId &&
    entry.providerSlug === frozen.providerSlug &&
    entry.providerVersion === frozen.providerVersion &&
    entry.sourceOwner === frozen.sourceOwner &&
    entry.sourceRepo === frozen.sourceRepo &&
    entry.sourceCommitSha === frozen.sourceCommitSha &&
    entry.sourceSubdirectory === frozen.sourceSubdirectory &&
    entry.sourceLicense === frozen.sourceLicense &&
    entry.sourceAssetId === frozen.sourceAssetId &&
    entry.sourceSha256 === frozen.sourceArchiveSha256 &&
    entry.sourceBytes === frozen.sourceArchiveBytes &&
    entry.previewAssetId === frozen.previewAssetId &&
    entry.previewSha256 === frozen.previewSha256 &&
    admission.binding.catalogVersion === frozen.catalogVersion &&
    admission.binding.candidateId === frozen.catalogCandidateId &&
    admission.binding.rawSourceSha256 === evidence.rawSourceSha256 &&
    admission.normalizedSourceSha256 === evidence.normalizedSourceSha256 &&
    admission.sourceTreeSha256 === evidence.sourceTreeSha256 &&
    admission.runtimeContractSha256 === evidence.runtimeContractSha256 &&
    admission.executionShellSha256 === evidence.executionShellSha256 &&
    admission.deliveryContractSha256 === evidence.deliveryContractSha256 &&
    admission.distSha256 === evidence.distSha256 &&
    admission.qaSha256 === evidence.qaSha256 &&
    admission.browserReceiptSha256 === evidence.browserReceiptSha256 &&
    admission.qaStatus === evidence.qaStatus &&
    admission.admissionEvidenceSha256 === evidence.admissionEvidenceSha256 &&
    admission.admissionMode === evidence.admissionMode &&
    admission.referencePreviewSha256 === evidence.referencePreviewSha256 &&
    admission.fallbackReasonCode === evidence.fallbackReasonCode;
  if (!valid) {
    opened.stream.destroy();
    throw new Error("NOT_FOUND");
  }
  return opened;
}

/**
 * A V4 style sample freezes two independent images: the provider reference
 * shown on the selection board and FrontMind's realization of that reference.
 * The sample row decides which of those images is being served. Never choose a
 * digest merely because one hash field happens to be present in metadata.
 */
function frozenStylePreviewSha256(
  localAssetId: string,
  sourceMetadata: unknown,
) {
  if (
    !sourceMetadata ||
    typeof sourceMetadata !== "object" ||
    Array.isArray(sourceMetadata)
  ) {
    return { valid: true as const, value: undefined };
  }
  const metadata = sourceMetadata as Record<string, unknown>;
  const rawBlueprint = metadata.referenceBlueprint;
  const blueprint =
    rawBlueprint &&
    typeof rawBlueprint === "object" &&
    !Array.isArray(rawBlueprint)
      ? (rawBlueprint as Record<string, unknown>)
      : null;
  const v4Coordinates =
    metadata.schemaVersion === 4 || blueprint?.schemaVersion === 4;

  if (v4Coordinates) {
    if (!blueprint || blueprint.schemaVersion !== 4) {
      return { valid: false as const, value: undefined };
    }
    const referenceAssetId = nonEmptyString(
      blueprint.referencePreviewLocalAssetId,
    );
    const referenceHash = normalizedSha256(blueprint.referencePreviewSha256);
    const blueprintRealizationAssetId = nonEmptyString(
      blueprint.previewLocalAssetId,
    );
    const blueprintRealizationHash = normalizedSha256(blueprint.previewSha256);
    const metadataRealizationAssetId = nonEmptyString(
      metadata.realizationPreviewLocalAssetId,
    );
    const metadataRealizationHash = normalizedSha256(
      metadata.realizationPreviewSha256,
    );

    if (
      !referenceAssetId ||
      !referenceHash ||
      !blueprintRealizationAssetId ||
      !blueprintRealizationHash ||
      !metadataRealizationAssetId ||
      !metadataRealizationHash ||
      metadataRealizationAssetId !== blueprintRealizationAssetId ||
      metadataRealizationHash !== blueprintRealizationHash ||
      (referenceAssetId === blueprintRealizationAssetId &&
        referenceHash !== blueprintRealizationHash)
    ) {
      return { valid: false as const, value: undefined };
    }

    const topLevelReferenceAssetId =
      metadata.referencePreviewLocalAssetId === undefined
        ? null
        : nonEmptyString(metadata.referencePreviewLocalAssetId);
    const topLevelReferenceHash =
      metadata.referencePreviewSha256 === undefined
        ? null
        : normalizedSha256(metadata.referencePreviewSha256);
    if (
      (metadata.referencePreviewLocalAssetId !== undefined ||
        metadata.referencePreviewSha256 !== undefined) &&
      (topLevelReferenceAssetId !== referenceAssetId ||
        topLevelReferenceHash !== referenceHash)
    ) {
      return { valid: false as const, value: undefined };
    }

    if (
      localAssetId === referenceAssetId &&
      localAssetId === metadataRealizationAssetId
    ) {
      return referenceHash === metadataRealizationHash
        ? { valid: true as const, value: referenceHash }
        : { valid: false as const, value: undefined };
    }
    if (localAssetId === referenceAssetId) {
      return { valid: true as const, value: referenceHash };
    }
    if (localAssetId === metadataRealizationAssetId) {
      return { valid: true as const, value: metadataRealizationHash };
    }
    return { valid: false as const, value: undefined };
  }

  const strictSourceBackedPreview =
    metadata.schemaVersion === 5 ||
    metadata.schemaVersion === 6 ||
    metadata.renderer === "twenty_first_native_react_v1" ||
    metadata.renderer === "twenty_first_native_template_v1";
  const raw = metadata.previewSha256 ?? metadata.realizationPreviewSha256;
  if (raw === undefined || raw === null) {
    return strictSourceBackedPreview
      ? { valid: false as const, value: undefined }
      : { valid: true as const, value: undefined };
  }
  const normalized = normalizedSha256(raw);
  if (!normalized) {
    return { valid: false as const, value: undefined };
  }
  return { valid: true as const, value: normalized };
}

siteOpsArtifactApi.get("/aliyun/oauth/callback", async (req, res) => {
  const startedAt = Date.now();
  const correlationId = randomBytes(12).toString("hex");
  const actor = requestActor(req);
  const providerError =
    typeof req.query.error === "string" ? req.query.error : null;
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;

  if (!actor) {
    logAliyunOAuthCallbackFailure({
      correlationId,
      stage: "session",
      userId: null,
      errorCode: "UNAUTHENTICATED",
      startedAt,
    });
    sendAliyunOAuthCompletionPage(res, "failed");
    return;
  }
  if (providerError) {
    if (providerError === "access_denied") {
      sendAliyunOAuthCompletionPage(res, "cancelled");
      return;
    }
    logAliyunOAuthCallbackFailure({
      correlationId,
      stage: "provider_authorization",
      userId: actor.id,
      errorCode: "PROVIDER_AUTHORIZATION_FAILED",
      startedAt,
    });
    sendAliyunOAuthCompletionPage(res, "failed");
    return;
  }
  if (!code || !state) {
    logAliyunOAuthCallbackFailure({
      correlationId,
      stage: "provider_authorization",
      userId: actor.id,
      errorCode: "INVALID_CALLBACK",
      startedAt,
    });
    sendAliyunOAuthCompletionPage(res, "failed");
    return;
  }
  let stage: AliyunOAuthCallbackStage = "oauth_exchange";
  try {
    const identity = await exchangeAliyunOAuthCode({
      code,
      state,
      userId: actor.id,
      authorizeProject: async (verifiedIdentity) => {
        await runWithSiteOpsOAuthProjectScope(actor, verifiedIdentity, async () => undefined);
      },
    });
    stage = "account_bind";
    await completeSiteOpsAliyunOAuth({
      actor,
      credentialId: identity.credentialId,
      projectId: identity.projectId,
      userId: identity.userId,
      actorUserId: identity.actorUserId,
      enterpriseProjectId: identity.enterpriseProjectId,
      accountUid: identity.accountUid,
      refreshToken: identity.refreshToken,
    });
    sendAliyunOAuthCompletionPage(res, "success");
  } catch (error) {
    logAliyunOAuthCallbackFailure({
      correlationId,
      stage,
      userId: actor.id,
      errorCode: safeAliyunOAuthErrorCode(error),
      startedAt,
    });
    sendAliyunOAuthCompletionPage(res, "failed");
  }
});

siteOpsArtifactApi.get("/style-previews/:sampleId", async (req, res) => {
  try {
    const userId = requestActor(req) ? enterpriseWorkspaceUserId(requestActor(req)!.id) : undefined;
    if (!userId) return notFound(res);
    const db = await requireDb();
    const rows = await db
      .select({
        localAssetId: websiteStyleSamples.previewLocalAssetId,
        sourceMetadata: websiteStyleSamples.sourceMetadata,
      })
      .from(websiteStyleSamples)
      .innerJoin(
        websiteStyleSampleBatches,
        eq(websiteStyleSampleBatches.id, websiteStyleSamples.batchId),
      )
      .where(
        and(
          eq(websiteStyleSamples.id, req.params.sampleId),
          eq(websiteStyleSampleBatches.userId, userId),
          ownedSiteProjectCondition(websiteStyleSampleBatches.siteProjectId, userId),
          eq(websiteStyleSampleBatches.sourceKind, "siteops_21st"),
          customerVisibleStyleBatchStatusCondition(),
        ),
      )
      .limit(1);
    const row = rows[0];
    const metadata =
      row?.sourceMetadata &&
      typeof row.sourceMetadata === "object" &&
      !Array.isArray(row.sourceMetadata)
        ? (row.sourceMetadata as Record<string, unknown>)
        : null;
    if (
      metadata?.schemaVersion === 7 &&
      metadata.renderer === "frontmind_static_template_catalog_v1"
    ) {
      const catalogVersion = nonEmptyString(metadata.catalogVersion);
      const candidateId = nonEmptyString(metadata.catalogCandidateId);
      const previewAssetId = nonEmptyString(metadata.previewAssetId);
      const previewLocalAssetId = nonEmptyString(metadata.previewLocalAssetId);
      const previewSha256 = normalizedSha256(metadata.previewSha256);
      const previewMimeType = nonEmptyString(metadata.previewMimeType);
      const providerTemplateId = nonEmptyString(metadata.providerTemplateId);
      const providerSlug = nonEmptyString(metadata.providerSlug);
      const sourceAssetId = nonEmptyString(metadata.sourceAssetId);
      const sourceArchiveSha256 = normalizedSha256(
        metadata.sourceArchiveSha256,
      );
      const catalogPosition = Number(metadata.catalogPosition);
      const previewWidth = Number(metadata.previewWidth);
      const previewHeight = Number(metadata.previewHeight);
      const rowLocalAssetId = nonEmptyString(row?.localAssetId);
      if (
        !["2.8.0", "2.9.0"].includes(String(metadata.workflowVersion)) ||
        !catalogVersion ||
        !candidateId ||
        !previewAssetId ||
        !previewLocalAssetId ||
        !rowLocalAssetId ||
        rowLocalAssetId !== previewLocalAssetId ||
        !previewSha256 ||
        !previewMimeType ||
        !STYLE_PREVIEW_MIME_TYPES.includes(
          previewMimeType as (typeof STYLE_PREVIEW_MIME_TYPES)[number],
        ) ||
        !providerTemplateId ||
        !providerSlug ||
        !sourceAssetId ||
        !sourceArchiveSha256 ||
        !Number.isInteger(catalogPosition) ||
        !Number.isInteger(previewWidth) ||
        !Number.isInteger(previewHeight)
      ) {
        return notFound(res);
      }
      // The immutable catalog coordinates were independently verified before
      // this managed-user mirror was bound. Serving must now depend only on
      // the frozen row/metadata coordinate and the mirrored bytes, otherwise
      // a later catalog mount change would break an already published board.
      await sendOwnedStylePreview({
        res,
        userId,
        localAssetId: rowLocalAssetId,
        expectedSha256: previewSha256,
        expectedMimeTypes: [previewMimeType],
      });
      return;
    }
    const localAssetId = row?.localAssetId;
    const expectedHash = localAssetId
      ? frozenStylePreviewSha256(localAssetId, row?.sourceMetadata)
      : { valid: false as const, value: undefined };
    if (!localAssetId || !expectedHash.valid) return notFound(res);
    await sendOwnedStylePreview({
      res,
      userId,
      localAssetId,
      expectedSha256: expectedHash.value,
      expectedMimeTypes: [...STYLE_PREVIEW_MIME_TYPES],
    });
  } catch (error) {
    sendError(res, error);
  }
});

siteOpsArtifactApi.get("/builds/:buildId/source", async (req, res) => {
  try {
    const userId = requestActor(req) ? enterpriseWorkspaceUserId(requestActor(req)!.id) : undefined;
    if (!userId) return notFound(res);
    const owned = await ownedBuild(userId, req.params.buildId);
    if (!owned?.build.sourceLocalAssetId) return notFound(res);
    await sendOwnedAsset({
      res,
      userId,
      localAssetId: owned.build.sourceLocalAssetId,
      expectedSha256: owned.build.sourceHash,
    });
  } catch (error) {
    sendError(res, error);
  }
});

siteOpsArtifactApi.get("/template-previews/:sampleId", async (req, res) => {
  try {
    const userId = requestActor(req) ? enterpriseWorkspaceUserId(requestActor(req)!.id) : undefined;
    if (!userId) return notFound(res);
    const db = await requireDb();
    const rows = await db
      .select({
        sourceMetadata: websiteStyleSamples.sourceMetadata,
      })
      .from(websiteStyleSamples)
      .innerJoin(
        websiteStyleSampleBatches,
        eq(websiteStyleSampleBatches.id, websiteStyleSamples.batchId),
      )
      .where(
        and(
          eq(websiteStyleSamples.id, req.params.sampleId),
          eq(websiteStyleSampleBatches.userId, userId),
          ownedSiteProjectCondition(websiteStyleSampleBatches.siteProjectId, userId),
          eq(websiteStyleSampleBatches.sourceKind, "siteops_21st"),
          customerVisibleStyleBatchStatusCondition(),
        ),
      )
      .limit(1);
    const metadata =
      rows[0]?.sourceMetadata &&
      typeof rows[0].sourceMetadata === "object" &&
      !Array.isArray(rows[0].sourceMetadata)
        ? (rows[0].sourceMetadata as Record<string, unknown>)
        : null;
    if (!metadata) return notFound(res);
    const opened = await openFrozenStaticTemplatePreviewDist(metadata);
    const archive = await streamToBuffer(opened.stream, MAX_ARCHIVE_BYTES);
    const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (entries.length < 1 || entries.length > MAX_ARCHIVE_ENTRIES) {
      throw new Error("SITEOPS_DIST_STRUCTURE_INVALID");
    }
    const entry = zip.file("index.html");
    if (!entry || entry.name.includes("\\") || entry.name.includes("..")) {
      return notFound(res);
    }
    const mode = Number(entry.unixPermissions ?? 0);
    if (mode && (mode & 0o170000) === 0o120000) {
      throw new Error("SITEOPS_DIST_SYMLINK_REJECTED");
    }
    const document = await createSandboxedPreviewDocument({
      zip,
      entryName: entry.name,
      previewPrefix: `/api/site-ops/template-previews/${encodeURIComponent(req.params.sampleId)}/`,
      previewRoutingMode: "canonical_pathname",
    });
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), geolocation=(), microphone=()",
    );
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    // The builder embeds this document in a same-origin iframe; build previews
    // stay top-level-only.
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader(
      "Content-Security-Policy",
      sandboxedPreviewContentSecurityPolicy(document.nonce, {
        frameAncestors: "'self'",
      }),
    );
    res.setHeader("Content-Length", String(document.bytes.length));
    res.send(document.bytes);
  } catch (error) {
    sendError(res, error);
  }
});

siteOpsArtifactApi.get("/builds/:buildId/qa", async (req, res) => {
  try {
    const userId = requestActor(req) ? enterpriseWorkspaceUserId(requestActor(req)!.id) : undefined;
    if (!userId) return notFound(res);
    const owned = await ownedBuild(userId, req.params.buildId);
    if (!owned?.build.qaLocalAssetId) return notFound(res);
    await sendOwnedAsset({
      res,
      userId,
      localAssetId: owned.build.qaLocalAssetId,
    });
  } catch (error) {
    sendError(res, error);
  }
});

/** Shared dist pipeline for the top-level preview and the embed preview. */
async function sendOwnedBuildPreviewDocument(input: {
  req: express.Request;
  res: express.Response;
  userId: number;
  buildId: string;
  previewPrefix: string;
  frame: "top-level" | "embed";
  /** Raw embed capability token; required for the preview bridge injection. */
  embedToken?: string;
}) {
  const owned = await ownedBuild(input.userId, input.buildId);
  if (!owned?.build.distLocalAssetId || !owned.build.distHash) {
    return notFound(input.res);
  }
  const allowedRouteEntries = await frozenPreviewRouteEntries({
    userId: input.userId,
    build: owned.build,
  });
  if (owned.build.workflowVersion === "2.9.0" && !allowedRouteEntries) {
    return notFound(input.res);
  }
  const asset = await readSiteOpsArtifact({
    userId: input.userId,
    localAssetId: owned.build.distLocalAssetId,
    expectedSha256: owned.build.distHash,
    expectedMimeTypes: ["application/zip"],
  });
  if (!asset) return notFound(input.res);
  const archive = await streamToBuffer(
    asset.stored.createReadStream(),
    MAX_ARCHIVE_BYTES,
  );
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length < 1 || entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error("SITEOPS_DIST_STRUCTURE_INVALID");
  }
  const wildcard = (input.req.params as Record<string, string | undefined>)["0"];
  const requestPath = safePreviewPath(wildcard ?? "");
  const candidates = requestPath.endsWith("/")
    ? [`${requestPath}index.html`]
    : [requestPath, `${requestPath}/index.html`];
  const entry = candidates
    .filter(
      (candidate) =>
        allowedRouteEntries == null || allowedRouteEntries.has(candidate),
    )
    .map((candidate) => zip.file(candidate))
    .find(Boolean);
  if (
    !entry ||
    !entry.name.endsWith(".html") ||
    entry.name.includes("\\") ||
    entry.name.includes("..")
  ) {
    return notFound(input.res);
  }
  const mode = Number(entry.unixPermissions ?? 0);
  if (mode && (mode & 0o170000) === 0o120000) {
    throw new Error("SITEOPS_DIST_SYMLINK_REJECTED");
  }
  const document = await createSandboxedPreviewDocument({
    zip,
    entryName: entry.name,
    previewPrefix: input.previewPrefix,
    previewRoutingMode:
      owned.build.workflowVersion === "2.9.0"
        ? "canonical_pathname"
        : "legacy_static_literals",
  });
  // Embed documents carry the trusted preview bridge so the real assistant
  // widget can report rendered answers (and their frozen build coordinates)
  // back to the embedding dashboard. Top-level previews never get it.
  let documentBytes = document.bytes;
  if (input.frame === "embed" && input.embedToken && typeof signEmbedPreviewToken === "function") {
    const preferences = readSiteDesignPreferencesFromBrief(owned.build.brief);
    const bridgeScript = siteOpsPreviewBridgeScript(document.nonce, {
      token: siteOpsPreviewBridgeToken(input.embedToken, signEmbedPreviewToken),
      buildId: owned.build.id,
      knowledgeSnapshotId: owned.build.knowledgeSnapshotId,
      knowledgeArchiveHash: owned.build.knowledgeArchiveHash,
      designRevision: preferences?.designRevision ?? null,
      draftHash: preferences?.draftHash ?? null,
    });
    const html = document.bytes.toString("utf8");
    const headClose = html.search(/<\/head>/iu);
    documentBytes = Buffer.from(
      headClose >= 0
        ? html.slice(0, headClose) + bridgeScript + html.slice(headClose)
        : bridgeScript + html,
      "utf8",
    );
  }
  input.res.setHeader("Cache-Control", "private, no-store, max-age=0");
  input.res.setHeader("Content-Type", "text/html; charset=utf-8");
  input.res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  input.res.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=()",
  );
  input.res.setHeader("Referrer-Policy", "no-referrer");
  input.res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (input.frame === "embed") {
    // The builder embeds this document in a same-origin iframe; the top-level
    // preview keeps its stricter DENY policy untouched.
    input.res.setHeader("X-Frame-Options", "SAMEORIGIN");
    input.res.setHeader(
      "Content-Security-Policy",
      sandboxedPreviewContentSecurityPolicy(document.nonce, {
        frameAncestors: "'self'",
      }),
    );
  } else {
    input.res.setHeader("X-Frame-Options", "DENY");
    input.res.setHeader(
      "Content-Security-Policy",
      sandboxedPreviewContentSecurityPolicy(document.nonce),
    );
  }
  input.res.setHeader("Content-Length", String(documentBytes.length));
  input.res.send(documentBytes);
}

siteOpsArtifactApi.get("/builds/:buildId/preview/*", async (req, res) => {
  try {
    const userId = requestActor(req) ? enterpriseWorkspaceUserId(requestActor(req)!.id) : undefined;
    if (!userId) return notFound(res);
    await sendOwnedBuildPreviewDocument({
      req,
      res,
      userId,
      buildId: req.params.buildId,
      previewPrefix: `/api/site-ops/builds/${encodeURIComponent(req.params.buildId)}/preview/`,
      frame: "top-level",
    });
  } catch (error) {
    sendError(res, error);
  }
});

/** Mints a fresh embed URL for an owned build; refreshing never rebuilds. */
siteOpsArtifactApi.get(
  "/builds/:buildId/embed-preview-token",
  async (req, res) => {
    try {
      const userId = requestActor(req)
        ? enterpriseWorkspaceUserId(requestActor(req)!.id)
        : undefined;
      if (!userId) return notFound(res);
      const owned = await ownedBuild(userId, req.params.buildId);
      if (!owned?.build.distLocalAssetId || !owned.build.distHash) {
        return notFound(res);
      }
      if (typeof signEmbedPreviewToken !== "function") {
        throw new Error("SITEOPS_EMBED_SIGNER_UNCONFIGURED");
      }
      const now = Date.now();
      const token = buildSiteOpsEmbedPreviewToken({
        buildId: req.params.buildId,
        userId,
        now,
        sign: signEmbedPreviewToken,
      });
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.json({
        schemaVersion: 1,
        url: enterpriseProjectUrl(
          `/api/site-ops/builds/${encodeURIComponent(req.params.buildId)}/embed-preview/?token=${encodeURIComponent(token)}`,
        ),
        // Shared secret for the trusted preview bridge: the served document
        // receives the same value, so the parent can authenticate the real
        // assistant's trial reports.
        bridgeToken: siteOpsPreviewBridgeToken(token, signEmbedPreviewToken),
        expiresAt: now + SITEOPS_EMBED_PREVIEW_TOKEN_TTL_MS,
      });
    } catch (error) {
      sendError(res, error);
    }
  },
);

/**
 * Owner-only same-origin embeddable variant of the build preview. Requires a
 * valid dashboard session AND a fresh embed token; expiry is reported so the
 * client can refresh the signature without rebuilding.
 */
siteOpsArtifactApi.get("/builds/:buildId/embed-preview/*", async (req, res) => {
  try {
    const userId = requestActor(req)
      ? enterpriseWorkspaceUserId(requestActor(req)!.id)
      : undefined;
    if (!userId) return notFound(res);
    if (typeof signEmbedPreviewToken !== "function") {
      throw new Error("SITEOPS_EMBED_SIGNER_UNCONFIGURED");
    }
    const tokenState = verifySiteOpsEmbedPreviewToken(req.query.token, {
      buildId: req.params.buildId,
      userId,
      now: Date.now(),
      sign: signEmbedPreviewToken,
    });
    if (tokenState === "expired") {
      res
        .status(401)
        .json({ error: "SITEOPS_EMBED_TOKEN_EXPIRED" });
      return;
    }
    if (tokenState !== "valid") return notFound(res);
    const embedToken =
      typeof req.query.token === "string" ? req.query.token : "";
    await sendOwnedBuildPreviewDocument({
      req,
      res,
      userId,
      buildId: req.params.buildId,
      previewPrefix: `/api/site-ops/builds/${encodeURIComponent(req.params.buildId)}/embed-preview/`,
      frame: "embed",
      embedToken,
    });
  } catch (error) {
    sendError(res, error);
  }
});

siteOpsArtifactApi.get(
  "/social-packages/:packageId/archive",
  async (req, res) => {
    try {
      const userId = requestActor(req) ? enterpriseWorkspaceUserId(requestActor(req)!.id) : undefined;
      if (!userId) return notFound(res);
      const db = await requireDb();
      const rows = await db
        .select()
        .from(socialPackages)
        .where(
          and(
            eq(socialPackages.id, req.params.packageId),
            eq(socialPackages.userId, userId),
            ownedSiteProjectCondition(socialPackages.projectId, userId),
            eq(socialPackages.status, "ready"),
          ),
        )
        .limit(1);
      const item = rows[0];
      if (!item?.archiveLocalAssetId || !item.archiveHash) return notFound(res);
      await db
        .update(socialPackages)
        .set({ downloadCount: item.downloadCount + 1 })
        .where(
          and(
            eq(socialPackages.id, item.id),
            eq(socialPackages.downloadCount, item.downloadCount),
          ),
        );
      await sendOwnedAsset({
        res,
        userId,
        localAssetId: item.archiveLocalAssetId,
        expectedSha256: item.archiveHash,
      });
    } catch (error) {
      sendError(res, error);
    }
  },
);

siteOpsArtifactApi.get(
  "/social-packages/:packageId/preview/:index",
  async (req, res) => {
    try {
      const userId = requestActor(req) ? enterpriseWorkspaceUserId(requestActor(req)!.id) : undefined;
      if (!userId) return notFound(res);
      const index = Number(req.params.index);
      if (!Number.isSafeInteger(index) || index < 0 || index > 8) {
        return notFound(res);
      }
      const db = await requireDb();
      const rows = await db
        .select()
        .from(socialPackages)
        .where(
          and(
            eq(socialPackages.id, req.params.packageId),
            eq(socialPackages.userId, userId),
            ownedSiteProjectCondition(socialPackages.projectId, userId),
            eq(socialPackages.status, "ready"),
          ),
        )
        .limit(1);
      const localAssetId = rows[0]?.previewLocalAssetIds[index];
      if (!localAssetId) return notFound(res);
      await sendOwnedAsset({
        res,
        userId,
        localAssetId,
        disposition: "inline",
      });
    } catch (error) {
      sendError(res, error);
    }
  },
);
