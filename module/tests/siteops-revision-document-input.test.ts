// @vitest-environment node
import { createHash } from "node:crypto";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  SITEOPS_REVISION_DOCUMENT_MAX_BYTES,
  siteOpsRevisionInputCoordinate,
  siteOpsRevisionInputDescriptor,
} from "../contracts/siteops-revision-input.js";
import {
  nativeSourceReceiptV2SchemaForRuntime,
  overlaySiteOpsRevisionMedia,
  siteOpsContentPlanMediaSelection,
} from "../server/siteops/manus-provider.js";
import { siteOpsProductionRevisionAssetRequirement } from "../server/siteops/esa-provider.js";
import { matchedNativeUserDocumentPaths } from "../server/siteops/native-react-build-runtime.js";
import {
  NATIVE_RUNTIME_CONTRACT_V1_SHA256,
  NATIVE_RUNTIME_CONTRACT_VERSION,
  NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256,
  NATIVE_RUNTIME_EXECUTION_SHELL_VERSION,
  NATIVE_RUNTIME_HTML_SHELL_V1_TEXT,
  NATIVE_SOURCE_PREFLIGHT_V2_LEGACY_SHA256,
  NATIVE_SOURCE_PREFLIGHT_V2_SCRIPT,
  NATIVE_SOURCE_PREFLIGHT_V2_SHA256,
  NATIVE_SOURCE_PREFLIGHT_V2_VERSION,
  siteSourceReceiptV2Schema,
  validateNativeReactSourceArchive,
} from "../server/siteops/native-react-source.js";
import { assertSiteOpsRevisionDocumentBytes } from "../server/siteops/service.js";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function nativeSourceArchiveWithDocument(input: {
  publicPath: string;
  bytes: Buffer;
}) {
  const archive = new JSZip();
  archive.file("package.json", "{}");
  archive.file("index.html", NATIVE_RUNTIME_HTML_SHELL_V1_TEXT);
  archive.file("src/main.tsx", "export default 1;\n");
  archive.file(`public${input.publicPath}`, input.bytes);
  return archive.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

describe("SiteOps revision document inputs", () => {
  it("normalizes empty and Windows Markdown MIME without trusting a mismatched type", () => {
    expect(siteOpsRevisionInputDescriptor("说明.md", "")?.mimeType).toBe(
      "text/markdown",
    );
    expect(
      siteOpsRevisionInputDescriptor("说明.md", "text/plain")?.mimeType,
    ).toBe("text/markdown");
    expect(siteOpsRevisionInputDescriptor("说明.pdf", "image/png")).toBeNull();
  });

  it("accepts a hash-addressed 8–10 MiB document coordinate but not an oversized image", () => {
    const digest = "a".repeat(64);
    expect(
      siteOpsRevisionInputCoordinate({
        filename: "手册.pdf",
        mimeType: "application/pdf",
        sizeBytes: 9 * 1024 * 1024,
        contentSha256: digest,
        width: 0,
        height: 0,
        publicPath: `/frontmind-user-media/${digest}.pdf`,
      })?.maxBytes,
    ).toBe(SITEOPS_REVISION_DOCUMENT_MAX_BYTES);
    expect(
      siteOpsRevisionInputCoordinate({
        filename: "hero.png",
        mimeType: "image/png",
        sizeBytes: 9 * 1024 * 1024,
        contentSha256: digest,
        width: 100,
        height: 100,
        publicPath: `/frontmind-user-media/${digest}.png`,
      }),
    ).toBeNull();
  });

  it("never admits documents as content-plan media", () => {
    const image = {
      mimeType: "image/png",
      publicPath: `/frontmind-user-media/${"b".repeat(64)}.png`,
    };
    const document = {
      mimeType: "application/pdf",
      publicPath: `/frontmind-user-media/${"c".repeat(64)}.pdf`,
    };
    const mediaId = `customer-media:${sha(Buffer.from(image.publicPath)).slice(0, 32)}`;
    const selection = siteOpsContentPlanMediaSelection(
      {
        routes: [
          {
            path: "/",
            sections: [{ mediaIds: [mediaId] }],
          },
        ],
      } as never,
      [image, document],
    );
    expect(selection.selectedCustomerMedia).toEqual([image]);
  });

  it("overlays a document byte-for-byte into the frozen public path", async () => {
    const parent = new JSZip();
    parent.file("package.json", "{}");
    const source = await parent.generateAsync({ type: "nodebuffer" });
    const bytes = Buffer.from("reference document", "utf8");
    const digest = sha(bytes);
    const output = await overlaySiteOpsRevisionMedia(source, [
      {
        localAssetId: "00000000-0000-4000-8000-000000000000",
        filename: "reference.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        contentSha256: digest,
        width: 0,
        height: 0,
        publicPath: `/frontmind-user-media/${digest}.txt`,
        siteOpsKnowledgeInputEpochId: null,
        bytes,
      },
    ] as never);
    const archive = await JSZip.loadAsync(output);
    await expect(
      archive.file(`public/frontmind-user-media/${digest}.txt`)!.async("nodebuffer"),
    ).resolves.toEqual(bytes);
  });

  it("keeps the legacy preflight coordinate while current admission adds bounded documents", () => {
    expect(NATIVE_SOURCE_PREFLIGHT_V2_SHA256).not.toBe(
      NATIVE_SOURCE_PREFLIGHT_V2_LEGACY_SHA256,
    );
    const source = NATIVE_SOURCE_PREFLIGHT_V2_SCRIPT.toString("utf8");
    expect(source).toContain("frozenUserDocumentPattern");
    expect(source).toContain("USER_DOCUMENT_HASH_MISMATCH");
    expect(source).toContain(String(10 * 1024 * 1024));
  });

  it("admits a trusted 8–10 MiB document and rejects untrusted or changed bytes", async () => {
    const operationToken = "revision-document-host-admission";
    const baseSourceSha256 = "d".repeat(64);
    const bytes = Buffer.alloc(8 * 1024 * 1024 + 1, 0x61);
    const digest = sha(bytes);
    const publicPath = `/frontmind-user-media/${digest}.txt`;
    const archive = await nativeSourceArchiveWithDocument({
      publicPath,
      bytes,
    });
    const receipt = {
      operationToken,
      baseSourceSha256,
      archiveSha256: sha(archive),
      fileCount: 4,
    };
    await expect(
      validateNativeReactSourceArchive({
        archive,
        receipt,
        expectedOperationToken: operationToken,
        expectedBaseSourceSha256: baseSourceSha256,
        requiredReceiptVersion: 1,
        trustedUserDocuments: [{ publicPath, contentSha256: digest }],
      }),
    ).resolves.toMatchObject({ fileCount: 4 });
    await expect(
      validateNativeReactSourceArchive({
        archive,
        receipt,
        expectedOperationToken: operationToken,
        expectedBaseSourceSha256: baseSourceSha256,
        requiredReceiptVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "NATIVE_SOURCE_LIMIT_EXCEEDED" });

    const changedArchive = await nativeSourceArchiveWithDocument({
      publicPath,
      bytes: Buffer.alloc(bytes.length, 0x62),
    });
    await expect(
      validateNativeReactSourceArchive({
        archive: changedArchive,
        receipt: { ...receipt, archiveSha256: sha(changedArchive) },
        expectedOperationToken: operationToken,
        expectedBaseSourceSha256: baseSourceSha256,
        requiredReceiptVersion: 1,
        trustedUserDocuments: [{ publicPath, contentSha256: digest }],
      }),
    ).rejects.toMatchObject({
      code: "NATIVE_SOURCE_ARCHIVE_HASH_MISMATCH",
    });
  }, 30_000);

  it("requires document anchors to use the QA page origin", () => {
    const publicPath = `/frontmind-user-media/${"e".repeat(64)}.pdf`;
    expect(
      matchedNativeUserDocumentPaths(
        [{ publicPath }],
        [
          { origin: "https://evil.example", pathname: publicPath },
          { origin: "http://127.0.0.1:4173", pathname: publicPath },
        ],
        "http://127.0.0.1:4173",
      ),
    ).toEqual([publicPath]);
    expect(
      matchedNativeUserDocumentPaths(
        [{ publicPath }],
        [{ origin: "https://evil.example", pathname: publicPath }],
        "http://127.0.0.1:4173",
      ),
    ).toEqual([]);
  });

  it("separates ESA image media from independently required documents", () => {
    const imageSha = "f".repeat(64);
    const documentSha = "1".repeat(64);
    expect(
      siteOpsProductionRevisionAssetRequirement({
        filename: "hero.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        contentSha256: imageSha,
        width: 100,
        height: 50,
        publicPath: `/frontmind-user-media/${imageSha}.png`,
      }),
    ).toMatchObject({
      kind: "image",
      customerMediaId: expect.stringMatching(/^customer-media:[a-f0-9]{32}$/u),
    });
    expect(
      siteOpsProductionRevisionAssetRequirement({
        filename: "manual.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        contentSha256: documentSha,
        width: 0,
        height: 0,
        publicPath: `/frontmind-user-media/${documentSha}.pdf`,
      }),
    ).toEqual({
      kind: "document",
      requiredUserDocument: {
        publicPath: `/frontmind-user-media/${documentSha}.pdf`,
        contentSha256: documentSha,
      },
    });
  });

  it("pins default/current and replay/legacy receipt schemas independently", () => {
    const receipt = {
      operationToken: "schema-coordinate-test",
      baseSourceSha256: "2".repeat(64),
      archiveSha256: "3".repeat(64),
      fileCount: 4,
      preflightVersion: NATIVE_SOURCE_PREFLIGHT_V2_VERSION,
      preflightStatus: "passed" as const,
      preflightSha256: NATIVE_SOURCE_PREFLIGHT_V2_SHA256,
      runtimeContractVersion: NATIVE_RUNTIME_CONTRACT_VERSION,
      runtimeContractSha256: NATIVE_RUNTIME_CONTRACT_V1_SHA256,
      executionShellSha256: NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256,
      executionBaselineSha256: "4".repeat(64),
    };
    expect(siteSourceReceiptV2Schema.safeParse(receipt).success).toBe(true);
    const legacySchema = nativeSourceReceiptV2SchemaForRuntime({
      contractVersion: NATIVE_RUNTIME_CONTRACT_VERSION,
      contractSha256: NATIVE_RUNTIME_CONTRACT_V1_SHA256,
      executionShellVersion: NATIVE_RUNTIME_EXECUTION_SHELL_VERSION,
      executionShellSha256: NATIVE_RUNTIME_EXECUTION_SHELL_V1_SHA256,
      preflightVersion: NATIVE_SOURCE_PREFLIGHT_V2_VERSION,
      preflightSha256: NATIVE_SOURCE_PREFLIGHT_V2_LEGACY_SHA256,
    });
    expect(
      legacySchema.safeParse({
        ...receipt,
        preflightSha256: NATIVE_SOURCE_PREFLIGHT_V2_LEGACY_SHA256,
      }).success,
    ).toBe(true);
    expect(
      legacySchema.safeParse(receipt).success,
    ).toBe(false);
  });

  it("bounds DOCX expansion before reading the required XML entries", async () => {
    const valid = new JSZip();
    valid.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    );
    valid.file(
      "word/document.xml",
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    );
    await expect(
      assertSiteOpsRevisionDocumentBytes(
        ".docx",
        await valid.generateAsync({
          type: "nodebuffer",
          compression: "DEFLATE",
        }),
      ),
    ).resolves.toBe(true);

    const oversized = new JSZip();
    oversized.file("[Content_Types].xml", "<Types/>");
    oversized.file(
      "word/document.xml",
      `<w:document>${"a".repeat(8 * 1024 * 1024)}</w:document>`,
    );
    await expect(
      assertSiteOpsRevisionDocumentBytes(
        ".docx",
        await oversized.generateAsync({
          type: "nodebuffer",
          compression: "DEFLATE",
        }),
      ),
    ).resolves.toBe(false);
  }, 30_000);
});
