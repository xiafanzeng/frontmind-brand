import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";

type EmbedRoute = { id: string; slug: string; title: string };

export type EmbeddableBuild = {
  id: string;
  ordinal: number;
  status: string;
  previewUrl: string | null;
  knowledgeSnapshotVersion: number | null;
};

type EmbedTokenState = {
  state: "loading" | "ready" | "failed";
  base: string;
  token: string;
  expiresAt: number;
};

function embedPathForSlug(slug: string) {
  const normalized = slug.startsWith("/") ? slug.slice(1) : slug;
  if (!normalized || normalized === "/") return "";
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

/**
 * Second level of the two-stage preview: the real build dist embedded through
 * the owner-only same-origin embed endpoint. The short-lived embed token is
 * refreshed in place — a failing or expired iframe never triggers a rebuild.
 */
export function SiteOpsBuildEmbedPreview({
  build,
  device,
  routes,
}: {
  build: EmbeddableBuild;
  device: "desktop" | "mobile";
  routes: EmbedRoute[];
}) {
  const [tokenState, setTokenState] = useState<EmbedTokenState>({
    state: "loading",
    base: "",
    token: "",
    expiresAt: 0,
  });
  const [routeSlug, setRouteSlug] = useState("/");
  const [reloadSequence, setReloadSequence] = useState(0);
  const [frameFailed, setFrameFailed] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);

  const refreshTimerMs = useMemo(() => {
    if (tokenState.state !== "ready") return null;
    const remaining = tokenState.expiresAt - Date.now() - 30_000;
    return remaining > 2_000 ? remaining : 2_000;
  }, [tokenState]);

  const loadToken = useCallback(
    async (attemptReload: boolean) => {
      setTokenState((current) => ({
        ...current,
        state: current.state === "ready" ? "ready" : "loading",
      }));
      setFrameFailed(false);
      try {
        const response = await fetch(
          `/api/site-ops/builds/${encodeURIComponent(build.id)}/embed-preview-token`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error("SITEOPS_EMBED_TOKEN_REQUEST_FAILED");
        const body = (await response.json()) as {
          url?: unknown;
          expiresAt?: unknown;
        };
        if (typeof body.url !== "string" || typeof body.expiresAt !== "number") {
          throw new Error("SITEOPS_EMBED_TOKEN_RESPONSE_INVALID");
        }
        const separator = body.url.indexOf("?token=");
        if (separator <= 0) throw new Error("SITEOPS_EMBED_TOKEN_URL_INVALID");
        setTokenState({
          state: "ready",
          base: body.url.slice(0, separator),
          token: body.url.slice(separator + "?token=".length),
          expiresAt: body.expiresAt,
        });
        if (attemptReload) setReloadSequence((current) => current + 1);
      } catch {
        setTokenState((current) => ({ ...current, state: "failed" }));
        setFrameFailed(true);
      }
    },
    [build.id],
  );

  useEffect(() => {
    void loadToken(false);
  }, [loadToken]);

  useEffect(() => {
    if (refreshTimerMs === null) return;
    const timer = window.setTimeout(() => {
      void loadToken(false);
    }, refreshTimerMs);
    refreshTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      refreshTimerRef.current = null;
    };
  }, [loadToken, refreshTimerMs]);

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
  }, []);

  const frameSrc = tokenState.state === "ready"
    ? `${tokenState.base}${embedPathForSlug(routeSlug)}?token=${encodeURIComponent(tokenState.token)}`
    : "";
  const openInNewWindow = () => {
    if (!build.previewUrl) return;
    const base = build.previewUrl.endsWith("/")
      ? build.previewUrl
      : `${build.previewUrl}/`;
    window.open(`${base}${embedPathForSlug(routeSlug)}`, "_blank", "noopener");
  };

  return (
    <div className="sfp-embed-preview">
      <div className="sfp-embed-toolbar" data-testid="website-embed-preview-toolbar">
        <span className="sfp-embed-meta">
          <strong>真实构建 v{build.ordinal}</strong>
          <small>
            {build.knowledgeSnapshotVersion !== null
              ? `知识快照 v${build.knowledgeSnapshotVersion}`
              : "知识快照版本待确认"}
            {" · "}
            {build.status}
          </small>
        </span>
        <label className="sfp-embed-page">
          <span>页面</span>
          <select
            aria-label="选择预览页面"
            value={routeSlug}
            onChange={(event) => setRouteSlug(event.currentTarget.value)}
          >
            {routes.map((route) => (
              <option key={route.id} value={route.slug}>
                {route.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            if (frameFailed || tokenState.state === "failed") {
              void loadToken(true);
              return;
            }
            setReloadSequence((current) => current + 1);
          }}
        >
          <RefreshCw size={14} /> 重新载入
        </button>
        <button type="button" onClick={openInNewWindow} disabled={!build.previewUrl}>
          <ExternalLink size={14} /> 新窗口打开
        </button>
      </div>
      <div className={`sfp-embed-stage sfp-embed-stage--${device}`}>
        {tokenState.state === "loading" && (
          <p className="sfp-embed-state" role="status">正在载入真实构建预览…</p>
        )}
        {tokenState.state === "failed" && (
          <div className="sfp-embed-state" role="alert">
            <p>真实构建预览暂时无法嵌入。</p>
            <small>令牌刷新失败不会触发重新构建；可重试载入或在新窗口打开。</small>
          </div>
        )}
        {frameFailed && tokenState.state === "ready" && (
          <div className="sfp-embed-state" role="alert" data-testid="website-embed-preview-failed">
            <p>真实构建预览加载失败，预览签名可能已过期。</p>
            <small>重新载入会刷新访问签名，不会重新构建网站。</small>
          </div>
        )}
        {tokenState.state === "ready" && (
          <iframe
            key={`${reloadSequence}:${tokenState.token}`}
            src={frameSrc}
            title="真实构建预览"
            className="sfp-embed-frame"
            sandbox="allow-scripts allow-forms"
            onError={() => setFrameFailed(true)}
          />
        )}
      </div>
    </div>
  );
}
