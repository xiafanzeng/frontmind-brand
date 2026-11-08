export const SITEOPS_REVISION_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const SITEOPS_REVISION_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const SITEOPS_REVISION_INPUT_MAX_BYTES =
  SITEOPS_REVISION_DOCUMENT_MAX_BYTES;

export const SITEOPS_REVISION_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const SITEOPS_REVISION_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
] as const;

export type SiteOpsRevisionInputKind = "image" | "document";
export type SiteOpsRevisionInputMimeType =
  | (typeof SITEOPS_REVISION_IMAGE_MIME_TYPES)[number]
  | (typeof SITEOPS_REVISION_DOCUMENT_MIME_TYPES)[number];

type SiteOpsRevisionInputDescriptor = Readonly<{
  kind: SiteOpsRevisionInputKind;
  extension: string;
  publicExtension: string;
  mimeType: SiteOpsRevisionInputMimeType;
  maxBytes: number;
}>;

const descriptorByExtension = new Map<string, SiteOpsRevisionInputDescriptor>([
  [".png", { kind: "image", extension: ".png", publicExtension: ".png", mimeType: "image/png", maxBytes: SITEOPS_REVISION_IMAGE_MAX_BYTES }],
  [".jpg", { kind: "image", extension: ".jpg", publicExtension: ".jpg", mimeType: "image/jpeg", maxBytes: SITEOPS_REVISION_IMAGE_MAX_BYTES }],
  [".jpeg", { kind: "image", extension: ".jpeg", publicExtension: ".jpg", mimeType: "image/jpeg", maxBytes: SITEOPS_REVISION_IMAGE_MAX_BYTES }],
  [".webp", { kind: "image", extension: ".webp", publicExtension: ".webp", mimeType: "image/webp", maxBytes: SITEOPS_REVISION_IMAGE_MAX_BYTES }],
  [".pdf", { kind: "document", extension: ".pdf", publicExtension: ".pdf", mimeType: "application/pdf", maxBytes: SITEOPS_REVISION_DOCUMENT_MAX_BYTES }],
  [".docx", { kind: "document", extension: ".docx", publicExtension: ".docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", maxBytes: SITEOPS_REVISION_DOCUMENT_MAX_BYTES }],
  [".txt", { kind: "document", extension: ".txt", publicExtension: ".txt", mimeType: "text/plain", maxBytes: SITEOPS_REVISION_DOCUMENT_MAX_BYTES }],
  [".md", { kind: "document", extension: ".md", publicExtension: ".md", mimeType: "text/markdown", maxBytes: SITEOPS_REVISION_DOCUMENT_MAX_BYTES }],
]);

function filenameExtension(filename: string) {
  const normalized = filename.trim().toLowerCase();
  const basename = normalized.split(/[\\/]/u).at(-1) ?? "";
  const index = basename.lastIndexOf(".");
  return index > 0 ? basename.slice(index) : "";
}

/** Browsers frequently report Markdown as text/plain or no MIME at all. The
 * extension selects the narrow allowlisted type; the server still validates
 * the bytes before freezing the canonical MIME. */
export function siteOpsRevisionInputDescriptor(
  filename: string,
  declaredMimeType: string,
): SiteOpsRevisionInputDescriptor | null {
  const descriptor = descriptorByExtension.get(filenameExtension(filename));
  if (!descriptor) return null;
  const declared = declaredMimeType.trim().toLowerCase();
  const inferred = declared === "" || declared === "application/octet-stream";
  const markdownAlias =
    descriptor.extension === ".md" && declared === "text/plain";
  return inferred || markdownAlias || declared === descriptor.mimeType
    ? descriptor
    : null;
}

export function isSiteOpsRevisionImageMimeType(
  mimeType: string,
): mimeType is (typeof SITEOPS_REVISION_IMAGE_MIME_TYPES)[number] {
  return (SITEOPS_REVISION_IMAGE_MIME_TYPES as readonly string[]).includes(
    mimeType,
  );
}

export function siteOpsRevisionInputCoordinate(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  width: number;
  height: number;
  publicPath: string;
}) {
  const descriptor = siteOpsRevisionInputDescriptor(
    input.filename,
    input.mimeType,
  );
  if (
    !descriptor ||
    input.mimeType !== descriptor.mimeType ||
    !/^[a-f0-9]{64}$/u.test(input.contentSha256) ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes < 1 ||
    input.sizeBytes > descriptor.maxBytes ||
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    (descriptor.kind === "image"
      ? input.width < 1 || input.height < 1
      : input.width !== 0 || input.height !== 0) ||
    input.publicPath !==
      `/frontmind-user-media/${input.contentSha256}${descriptor.publicExtension}`
  ) {
    return null;
  }
  return descriptor;
}
