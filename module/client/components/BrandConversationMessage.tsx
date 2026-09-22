import type { ReactNode } from "react";
import BusinessMessage, { type BusinessMessageRuntime } from "@frontmind/module-ui/components/BusinessMessage";
import FilePreview from "@frontmind/module-ui/components/FilePreview";
import ImagePreview from "@frontmind/module-ui/components/ImagePreview";
import type { LocalMessage } from "../conversation-types";
import MessageActions from "./MessageActions";
import { sanitizeBrandText } from "../lib/frontmind-api";
import * as brandHost from "../host";

function buildProxyDownloadUrl(fileUrl: string, fileName?: string, asDownload = false) {
  try {
    const parsed = new URL(fileUrl, window.location.origin);
    if (parsed.pathname.endsWith("/api/frontmind/proxy-download")) {
      if (fileName) parsed.searchParams.set("filename", sanitizeBrandText(fileName));
      if (asDownload) parsed.searchParams.set("download", "1");
      return `${parsed.pathname}${parsed.search}`;
    }
    if (/^https?:\/\//i.test(fileUrl)) {
      const params = new URLSearchParams({ url: fileUrl });
      if (fileName) params.set("filename", sanitizeBrandText(fileName));
      if (asDownload) params.set("download", "1");
      return `/api/frontmind/proxy-download?${params.toString()}`;
    }
  } catch { /* malformed URLs are handled by the original source */ }
  return null;
}

async function fetchWithAuth(url: string) {
  const response = await fetch(url, {
    credentials: "include",
    headers: typeof brandHost.deliveryProjectHeaders === "function"
      ? brandHost.deliveryProjectHeaders()
      : undefined,
  });
  if (!response.ok) throw new Error(`文件读取失败（HTTP ${response.status}）`);
  return URL.createObjectURL(await response.blob());
}

function nativeDownload(url: string, name: string) {
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.rel = "noopener"; document.body.appendChild(anchor); anchor.click(); anchor.remove();
}

// Stable component identities keep Markdown, selection and previews mounted
// when an unchanged message is projected by a background observation.
const runtime: BusinessMessageRuntime = {
    MessageActions: ({ message: candidate, allowCopy: canCopy, onDelete, children: content }) => (
      <MessageActions message={candidate as LocalMessage} allowCopy={canCopy} onDelete={onDelete}>{content}</MessageActions>
    ),
    FilePreview: ({ file }) => <FilePreview file={file} />,
    ImagePreview,
    sanitizeText: sanitizeBrandText,
    deliveryHeaders: () => typeof brandHost.deliveryProjectHeaders === "function"
      ? brandHost.deliveryProjectHeaders()
      : {},
    fetchWithAuth,
    buildProxyDownloadUrl,
    nativeDownload,
    filterWaitingText: content => content.replace(/^等待用户输入[。.…]*$/gm, "").replace(/等待用户输入[。.…]*/g, "").trim(),
  };

/** The original Dashboard message presentation, shared by both Brand hosts. */
export default function BrandConversationMessage({ message, allowCopy = false, children }: {
  message: LocalMessage;
  allowCopy?: boolean;
  children?: ReactNode;
}) {
  return <BusinessMessage message={message} isFinalReply={allowCopy} generalChatLinks inlineContent={children} runtime={runtime} />;
}
