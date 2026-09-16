import { createHash } from "node:crypto";
import path from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import sharp from "sharp";
import { KNOWLEDGE_BASE_WORKING_SET_POLICY } from "./knowledge-base-working-set-policy.js";
import {
  canonicalWorkingSetArchive,
  validateKnowledgeBaseWorkingSetArchive,
  type KnowledgeBaseWorkingSetAsset,
  type ValidatedKnowledgeBaseWorkingSet,
} from "../contracts/knowledge-base-materialized-contract.js";
import { KNOWLEDGE_NODE_IMAGE_MIMES } from "../contracts/knowledge-node-edit-contract.js";

const sha256 = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
type MarkdownNode = {
  type: string;
  url?: string;
  identifier?: string;
  value?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
type MarkdownEdit = { start: number; end: number; text: string };

function applyMarkdownEdits(source: string, edits: MarkdownEdit[], offset = 0) {
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result =
      result.slice(0, edit.start - offset) +
      edit.text +
      result.slice(edit.end - offset);
  }
  return result;
}

function decodeHtmlUrl(value: string) {
  return value.replace(
    /&(?:#(x[\da-f]+|\d+)|(amp|quot|apos|lt|gt));/giu,
    (entity, numeric: string | undefined, named: string | undefined) => {
      if (numeric) {
        const point =
          numeric[0].toLowerCase() === "x"
            ? Number.parseInt(numeric.slice(1), 16)
            : Number.parseInt(numeric, 10);
        return point > 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : entity;
      }
      return (
        (
          { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" } as Record<
            string,
            string
          >
        )[named!.toLowerCase()] ?? entity
      );
    },
  );
}

/** Remove only references to removed files; leave prose and code examples intact. */
export function removeKnowledgeImageReferences(input: {
  markdown: string;
  contentPath: string;
  assets: readonly KnowledgeBaseWorkingSetAsset[];
  resourceUrls?: readonly string[];
}) {
  if (!input.assets.length && !input.resourceUrls?.length)
    return input.markdown;
  const removedPaths = new Set(input.assets.map((asset) => `/${asset.path}`));
  const removedUrls = new Set(
    (input.resourceUrls ?? []).map((url) =>
      decodeURIComponent(new URL(url, "https://knowledge.invalid").pathname),
    ),
  );
  const matches = (value: string) => {
    try {
      const url = new URL(
        value,
        `https://knowledge.invalid/${input.contentPath}`,
      );
      const pathname = decodeURIComponent(url.pathname);
      if (removedUrls.has(pathname)) return true;
      if (
        input.assets.some((asset) =>
          pathname.endsWith(
            `/working-set/assets/${asset.assetId}/${asset.sha256}`,
          ),
        )
      )
        return true;
      if (url.origin !== "https://knowledge.invalid") return false;
      const rootPath = `/${decodeURIComponent(value.split(/[?#]/)[0]!).replace(/^(?:\.\.?\/)+/, "")}`;
      return removedPaths.has(pathname) || removedPaths.has(rootPath);
    } catch {
      return false;
    }
  };
  const root = fromMarkdown(input.markdown) as MarkdownNode;
  const definitions = new Set<string>();
  const walk = (node: MarkdownNode, visit: (node: MarkdownNode) => void) => {
    visit(node);
    for (const child of node.children ?? []) walk(child, visit);
  };
  walk(root, (node) => {
    if (
      node.type === "definition" &&
      node.url &&
      matches(node.url) &&
      node.identifier
    )
      definitions.add(node.identifier);
  });
  // HTML inline tags can span several Markdown nodes. Track code/raw-text tags
  // across nodes so image-looking examples inside them remain byte-for-byte intact.
  const protectedTags: string[] = [];
  const codeTags = new Set([
    "pre",
    "code",
    "script",
    "style",
    "textarea",
    "xmp",
  ]);
  const rawTextTags = new Set(["script", "style", "textarea", "xmp"]);
  const editHtml = (html: string) =>
    html.replace(
      /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<(?:"[^"]*"|'[^']*'|[^'">])*>/gu,
      (tag) => {
        const element = tag.match(/^<(\/?)\s*([a-z][\w:-]*)\b/iu);
        if (!element) return tag;
        const closing = element[1] === "/";
        const name = element[2].toLowerCase();
        const protectedParent = protectedTags.at(-1);
        if (protectedParent && rawTextTags.has(protectedParent)) {
          if (closing && name === protectedParent) protectedTags.pop();
          return tag;
        }
        if (codeTags.has(name)) {
          if (closing) {
            const index = protectedTags.lastIndexOf(name);
            if (index >= 0) protectedTags.splice(index);
          } else if (!/\/\s*>$/.test(tag)) protectedTags.push(name);
          return tag;
        }
        if (protectedTags.length || closing || !["img", "a"].includes(name))
          return tag;
        let removeImage = false;
        const edited = tag.replace(
          /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu,
          (
            attribute,
            key: string,
            double: string | undefined,
            single: string | undefined,
            bare: string | undefined,
          ) => {
            const value = double ?? single ?? bare;
            if (!value || !matches(decodeHtmlUrl(value))) return attribute;
            if (name === "img" && key.toLowerCase() === "src")
              removeImage = true;
            return name === "a" && key.toLowerCase() === "href"
              ? ""
              : attribute;
          },
        );
        return removeImage ? "" : edited;
      },
    );
  const collectEdits = (node: MarkdownNode, edits: MarkdownEdit[]) => {
    const start = node.position?.start.offset,
      end = node.position?.end.offset;
    const referencesRemoved =
      !protectedTags.length &&
      (node.url
        ? matches(node.url)
        : Boolean(node.identifier && definitions.has(node.identifier)));
    if (
      start !== undefined &&
      end !== undefined &&
      ["image", "imageReference", "definition"].includes(node.type) &&
      referencesRemoved
    ) {
      edits.push({ start, end, text: "" });
      return;
    }
    if (
      start !== undefined &&
      end !== undefined &&
      ["link", "linkReference"].includes(node.type) &&
      referencesRemoved
    ) {
      const first = node.children?.[0]?.position?.start.offset;
      const last = node.children?.at(-1)?.position?.end.offset;
      const childEdits: MarkdownEdit[] = [];
      for (const child of node.children ?? []) collectEdits(child, childEdits);
      edits.push({
        start,
        end,
        text:
          first !== undefined && last !== undefined
            ? applyMarkdownEdits(
                input.markdown.slice(first, last),
                childEdits,
                first,
              )
            : "",
      });
      return;
    }
    if (
      start !== undefined &&
      end !== undefined &&
      node.type === "html" &&
      node.value
    ) {
      const text = editHtml(node.value);
      if (text !== node.value) edits.push({ start, end, text });
      return;
    }
    for (const child of node.children ?? []) collectEdits(child, edits);
  };
  const edits: MarkdownEdit[] = [];
  collectEdits(root, edits);
  return applyMarkdownEdits(input.markdown, edits);
}

/** One complete, deterministic revision. This never mutates the published/base archive. */
export async function composeKnowledgeImageLibrary(input: {
  base: ValidatedKnowledgeBaseWorkingSet;
  operationId: string;
  images: Array<{
    bytes: Buffer;
    mimeType: string;
    sha256: string;
    caption?: string;
  }>;
  removeAssetIds: string[];
  removedResourceUrls?: string[];
  forceRevision?: boolean;
  /** A node save changes only its associations; the library keeps the files. */
  leafId?: string;
}): Promise<ValidatedKnowledgeBaseWorkingSet> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/.test(input.operationId))
    throw new Error("图片修改标识无效");
  if (input.images.length > 20) throw new Error("每次最多增加20张图片");
  const targetLeaf = input.leafId
    ? input.base.manifest.leaves.find((leaf) => leaf.leafId === input.leafId)
    : undefined;
  if (input.leafId && !targetLeaf) throw new Error("知识节点不存在");
  const removed = new Set(input.removeAssetIds);
  if (
    targetLeaf &&
    [...removed].some((id) => !targetLeaf.assetIds.includes(id))
  )
    throw new Error("节点图片已变化，请重新读取");
  const removedAssets = input.base.manifest.assets.filter((asset) =>
    removed.has(asset.assetId),
  );
  if (removedAssets.length !== removed.size)
    throw new Error("部分图片已变化，请重新读取图片库");
  const manifest = structuredClone(input.base.manifest);
  const files = new Map(input.base.files);
  if (!targetLeaf) {
    manifest.assets = manifest.assets.filter(
      (asset) => !removed.has(asset.assetId),
    );
    for (const asset of removedAssets) files.delete(asset.path);
  }
  let added = 0;
  const attached = new Set<string>();
  for (const image of input.images) {
    if (
      !KNOWLEDGE_NODE_IMAGE_MIMES.includes(
        image.mimeType as (typeof KNOWLEDGE_NODE_IMAGE_MIMES)[number],
      ) ||
      image.bytes.length >
        KNOWLEDGE_BASE_WORKING_SET_POLICY.archive.maxAssetBytes ||
      sha256(image.bytes) !== image.sha256
    )
      throw new Error("图片格式、大小或内容校验失败，请重新上传");
    const decoder = sharp(image.bytes, {
      limitInputPixels: 40_000_000,
      failOn: "warning",
    });
    const dimensions = await decoder.metadata();
    await decoder.stats();
    if (!dimensions.width || !dimensions.height)
      throw new Error("图片内容无法读取");
    const actualMimeType =
      dimensions.format === "heif" && dimensions.compression === "av1"
        ? "image/avif"
        : `image/${dimensions.format}`;
    if (actualMimeType !== image.mimeType)
      throw new Error("图片实际格式与上传格式不一致，请重新上传");
    const existing = manifest.assets.find(
      (asset) => asset.sha256 === image.sha256,
    );
    if (existing) {
      if (
        targetLeaf &&
        (!targetLeaf.assetIds.includes(existing.assetId) ||
          removed.has(existing.assetId))
      )
        attached.add(existing.assetId);
      continue;
    }
    const mimeType = image.mimeType as KnowledgeBaseWorkingSetAsset["mimeType"];
    const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice(6);
    const asset: KnowledgeBaseWorkingSetAsset = {
      assetId: `library-${image.sha256.slice(0, 32)}`,
      path: `assets/library/${image.sha256}.${extension}`,
      sha256: image.sha256,
      mimeType,
      bytes: image.bytes.length,
      width: dimensions.width,
      height: dimensions.height,
      provenance: {
        ownership: "first_party",
        sourceKind: "user_upload",
        originalUploadSha256: image.sha256,
      },
      documentIds: [],
      assetType: "customer_supplied",
      displayRole: "inline",
      caption: path.basename(image.caption || "上传图片").slice(0, 255),
    };
    if (
      manifest.assets.some(
        (item) => item.assetId === asset.assetId || item.path === asset.path,
      )
    )
      throw new Error("图片标识冲突，请重新读取图片库");
    manifest.assets.push(asset);
    if (targetLeaf) attached.add(asset.assetId);
    files.set(asset.path, image.bytes);
    added += 1;
  }
  if (!added && !attached.size && !removed.size && !input.forceRevision)
    return input.base;
  manifest.leaves = manifest.leaves.map((leaf) => {
    if (targetLeaf && leaf.leafId !== targetLeaf.leafId) return leaf;
    const original = files.get(leaf.contentPath)!;
    let body = removeKnowledgeImageReferences({
      markdown: original.toString("utf8"),
      contentPath: leaf.contentPath,
      assets: removedAssets,
      resourceUrls: input.removedResourceUrls,
    });
    if (targetLeaf) {
      for (const id of attached) {
        const asset = manifest.assets.find((item) => item.assetId === id)!;
        const relative = path.posix.relative(
          path.posix.dirname(leaf.contentPath),
          asset.path,
        );
        const caption = (asset.caption || "知识库配图")
          .replace(/[\[\]\\]/g, "\\$&")
          .replace(/[\r\n]/g, " ");
        body += `\n\n![${caption}](${relative})`;
      }
    }
    files.set(leaf.contentPath, Buffer.from(body, "utf8"));
    return {
      ...leaf,
      assetIds: [
        ...leaf.assetIds.filter((id) => !removed.has(id)),
        ...(targetLeaf ? attached : []),
      ],
    };
  });
  for (const asset of manifest.assets)
    asset.documentIds = manifest.leaves
      .filter((leaf) => leaf.assetIds.includes(asset.assetId))
      .map((leaf) => leaf.leafId)
      .sort();
  if (
    !targetLeaf &&
    manifest.logo.assetId &&
    removed.has(manifest.logo.assetId)
  )
    manifest.logo = { status: "missing", assetId: null };
  manifest.operationId = input.operationId;
  manifest.contentVersion += 1;
  const archive = await canonicalWorkingSetArchive({ manifest, files });
  const validated = await validateKnowledgeBaseWorkingSetArchive(
    archive.archiveBytes,
    {
      buildId: manifest.buildId,
      generation: manifest.generation,
      contentVersion: manifest.contentVersion,
      skillContentHash: manifest.skill.contentHash,
      companyName: manifest.company.name,
      companyWebsite: manifest.company.website,
    },
  );
  if (
    validated.droppedOptionalCount ||
    validated.manifest.assets.length !== manifest.assets.length
  )
    throw new Error("图片校验失败，原知识库保持不变");
  return validated;
}
