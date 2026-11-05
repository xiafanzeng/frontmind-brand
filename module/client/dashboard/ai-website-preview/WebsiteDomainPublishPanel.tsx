import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ExternalLink, Globe2, Loader2, RefreshCw } from "lucide-react";
import type { SiteOpsConversationPanelProps } from "../siteops/SiteOpsConversationPanel";
import type { SiteOpsObservationV1 } from "../../../contracts/siteops-contract";
import "./website-domain-publish.css";

export type WebsitePublishTarget = "global_excluding_cn" | "mainland_cn";

export type WebsiteDomainPublishPanelProps = {
  siteOps: SiteOpsConversationPanelProps;
  onRequestPublish: (target: WebsitePublishTarget) => void;
  disabled?: boolean;
  publishBlockedReason?: string;
};

const TARGET_LABELS: Record<WebsitePublishTarget, string> = {
  global_excluding_cn: "海外",
  mainland_cn: "中国大陆",
};

/** Shared technical gates for the panel and the frozen publish confirmation. */
export function getWebsitePublishState(observation: SiteOpsObservationV1 | null, target: WebsitePublishTarget) {
  type Build = SiteOpsObservationV1["builds"][number];
  // Observation builds are newest-first. Publishing must use this current
  // build; a retained preview from an earlier build is not a publish candidate.
  const latestAttempt = observation?.builds[0] ?? null;
  const latestBuild = latestAttempt;
  const displayedBuild = latestBuild?.previewUrl ? latestBuild : observation?.builds.filter((build) => Boolean(build.previewUrl) && ["approved", "preview_ready"].includes(build.status))
    .reduce<Build | null>((latest, build) => !latest || build.ordinal > latest.ordinal ? build : latest, null) ?? latestBuild;
  const newest = [...(observation?.deployments ?? [])].filter((deployment) => deployment.target === target)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const projectedHead = target === "mainland_cn" ? observation?.project.mainlandLiveDeploymentId : observation?.project.globalLiveDeploymentId;
  // Hidden historical rows after reset do not clear the authoritative head.
  // The fallback only supports older observations that omit the projection.
  const active = newest.find((deployment) => deployment.status === "active"
    && (projectedHead === undefined || deployment.id === projectedHead)) ?? null;
  const headDeploymentId = projectedHead === undefined ? active?.id ?? null : projectedHead;
  const pending = newest.find((deployment) => ["reserved", "deploying", "verifying"].includes(deployment.status)) ?? null;
  const failed = newest[0] && ["failed", "attention_required"].includes(newest[0].status) ? newest[0] : null;
  const domain = observation?.domainState;
  const dnsReady = domain?.ownershipStatus === "verified" && domain?.dnsStatus === "active";
  const icpReady = domain?.icpStatus === "approved" && domain.icpDomainRevision === domain.revision;
  const alreadyLive = Boolean(latestBuild && active?.buildId === latestBuild.id);
  const resetPending = Boolean(observation?.rebuildRequest.resetPending);
  const eligible = !resetPending && latestBuild?.status === "approved" && dnsReady
    && (target !== "mainland_cn" || icpReady) && !pending && !alreadyLive;
  const reason = resetPending ? "正在重置建站任务，请稍候。"
    : !latestBuild || latestBuild.status !== "approved" ? "网站构建完成并通过检查后，即可发布。"
      : !dnsReady ? "请先完成域名所有权验证与解析配置。"
        : target === "mainland_cn" && !icpReady ? "中国大陆发布需当前域名版本的 ICP 审核通过。"
          : pending ? "正在发布，完成后会自动更新状态。" : alreadyLive ? "当前构建版本已在此区域上线。" : "发布后将使用当前构建更新此区域的网站。";
  return { eligible, reason, headDeploymentId, latestBuild, latestAttempt, displayedBuild, active, pending, failed, dnsReady, icpReady, alreadyLive };
}

function domainStatus(value: string | null | undefined) {
  const labels: Record<string, string> = {
    verified: "已验证", approved: "已通过", active: "已生效",
    pending: "处理中", preparing: "准备中", submitted: "审核中",
    not_submitted: "未提交", not_verified: "待验证", not_required: "无需备案",
    failed: "需要处理", conflict: "存在冲突", rejected: "审核未通过",
    attention_required: "需要处理",
  };
  return value ? labels[value] ?? "处理中" : "待同步";
}

function readableError(value: unknown, fallback: string) {
  if (!(value instanceof Error)) return fallback;
  // Provider details and credentials are not useful as customer-facing errors.
  const message = value.message.trim();
  return /[\u3400-\u9fff]/u.test(message)
    && !/(?:https?:|\b(?:token|secret|authorization|ARN|UID|RecordId)\b|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)/iu.test(message)
    ? message.slice(0, 500) : fallback;
}

function renderOAuthWindow(popup: Window, title: string, description: string) {
  try {
    const document = popup.document;
    document.title = title;
    document.documentElement.lang = "zh-CN";
    const main = document.createElement("main");
    main.setAttribute("role", "status");
    main.style.cssText = "font:16px/1.65 system-ui;max-width:32rem;margin:12vh auto;padding:2rem;color:#25222d";
    const heading = document.createElement("h1");
    heading.style.fontSize = "1.35rem";
    heading.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.textContent = description;
    main.append(heading, paragraph);
    document.body.replaceChildren(main);
  } catch {
    // A closed or cross-origin popup is never the authoritative error surface.
  }
}

function trustedOAuthUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && ["signin.aliyun.com", "oauth.aliyun.com"].includes(url.hostname);
  } catch { return false; }
}

/** Uses the existing SiteOps transport; opening this section never writes DNS. */
export function WebsiteDomainPublishPanel({
  siteOps,
  onRequestPublish,
  disabled = false,
  publishBlockedReason,
}: WebsiteDomainPublishPanelProps) {
  const {
    observation, onAction, onBeginAliyun, onRefresh, onRefreshAliyunDomains,
    onDisconnectAliyun, aliyunDomains = [], aliyunDomainsLoading,
    aliyunDomainsError, interactionPending,
  } = siteOps;
  const id = useId();
  const [selectedDomain, setSelectedDomain] = useState("");
  const [target, setTarget] = useState<WebsitePublishTarget>("global_excluding_cn");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const busyRef = useRef(false);
  const popupRef = useRef<Window | null>(null);
  const generationRef = useRef(0);
  const oauthExpiryRef = useRef<number | null>(null);
  const callbacks = useRef({ onRefresh, onRefreshAliyunDomains });
  callbacks.current = { onRefresh, onRefreshAliyunDomains };

  useEffect(() => {
    // Selecting the sole domain is a draft choice, never an authorization to
    // alter DNS. Keep a still-valid selection when a domain list is refreshed.
    setSelectedDomain((current) => aliyunDomains.some((item) => item.domain === current)
      ? current : aliyunDomains.length === 1 ? aliyunDomains[0].domain : "");
  }, [aliyunDomains]);

  useEffect(() => {
    let mounted = true;
    const finish = (message: string, failed: boolean) => {
      busyRef.current = false;
      if (!mounted) return;
      setBusy(null);
      if (failed) setError(message); else setNotice(message);
    };
    const cancel = (message: string) => {
      generationRef.current += 1;
      const popup = popupRef.current;
      popupRef.current = null;
      oauthExpiryRef.current = null;
      if (popup && !popup.closed) popup.close();
      finish(message, true);
    };
    const onMessage = (event: MessageEvent) => {
      const popup = popupRef.current;
      if (event.origin !== window.location.origin || !popup || event.source !== popup
        || !event.data || typeof event.data !== "object"
        || event.data.type !== "frontmind:siteops:aliyun-oauth"
        || !["success", "cancelled", "failed"].includes(event.data.status)) return;
      if (event.data.status !== "success") {
        cancel(event.data.status === "cancelled" ? "已取消阿里云授权，可以随时重新连接。" : "阿里云授权没有完成，请重试或联系管理员。");
        return;
      }
      const generation = generationRef.current;
      // Consume the callback once before refreshing to avoid duplicate work.
      popupRef.current = null;
      oauthExpiryRef.current = null;
      renderOAuthWindow(popup, "正在完成阿里云连接", "正在读取连接状态与域名，请稍候。");
      setBusy("oauth_complete");
      void (async () => {
        try {
          await callbacks.current.onRefresh?.();
          await callbacks.current.onRefreshAliyunDomains?.();
          if (mounted && generation === generationRef.current) finish("阿里云已连接，请选择域名并确认配置解析。", false);
        } catch {
          if (mounted && generation === generationRef.current) finish("授权已返回，连接状态暂时无法刷新，请点击刷新状态重试。", true);
        } finally {
          if (!popup.closed) popup.close();
        }
      })();
    };
    const checkPopup = () => {
      const popup = popupRef.current;
      if (!popup) return;
      if (popup.closed) cancel("阿里云授权窗口已关闭，请重新连接。");
      else if (oauthExpiryRef.current && Date.now() >= oauthExpiryRef.current) cancel("阿里云授权已超时，请重新连接。");
    };
    const interval = window.setInterval(checkPopup, 750);
    window.addEventListener("message", onMessage);
    window.addEventListener("focus", checkPopup);
    return () => {
      mounted = false;
      generationRef.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("focus", checkPopup);
      const popup = popupRef.current;
      popupRef.current = null;
      if (popup && !popup.closed) popup.close();
    };
  }, []);

  async function run(key: string, action: (() => Promise<void> | void) | undefined) {
    if (!action || busyRef.current || disabled || interactionPending) return;
    busyRef.current = true;
    setBusy(key); setError(null); setNotice(null);
    try { await action(); }
    catch (failure) { setError(readableError(failure, "操作没有完成，请刷新状态后重试。")); }
    finally { busyRef.current = false; setBusy(null); }
  }

  async function connectAliyun() {
    if (!onBeginAliyun || busyRef.current || disabled || interactionPending) return;
    const popup = window.open("", "frontmind-aliyun-authorization");
    setError(null); setNotice(null);
    if (!popup) { setError("授权窗口被浏览器阻止，请允许此站点打开弹窗后重试。"); return; }
    const generation = ++generationRef.current;
    popupRef.current = popup;
    busyRef.current = true;
    setBusy("oauth");
    renderOAuthWindow(popup, "正在检查阿里云授权配置", "正在确认安全的授权入口，请稍候。");
    popup.focus();
    try {
      const result = await onBeginAliyun();
      if (generation !== generationRef.current || popupRef.current !== popup) return;
      if (!trustedOAuthUrl(result.authorizationUrl)) throw new Error("暂时无法打开安全的阿里云授权页面，请稍后重试。");
      if (popup.closed) throw new Error("阿里云授权窗口已关闭，请重新连接。");
      const expiry = Date.parse(result.expiresAt);
      oauthExpiryRef.current = Number.isFinite(expiry) ? expiry : Date.now() + 10 * 60_000;
      popup.location.href = result.authorizationUrl;
      popup.focus();
    } catch (failure) {
      if (generation !== generationRef.current) return;
      popupRef.current = null;
      if (!popup.closed) popup.close();
      busyRef.current = false; setBusy(null);
      setError(readableError(failure, "暂时无法打开阿里云授权页面，请稍后重试。"));
    }
  }

  const domain = observation?.domainState;
  const connected = observation?.aliyunConnection.status === "active";
  const locked = disabled || Boolean(interactionPending) || Boolean(busy);
  const resetPending = Boolean(observation?.rebuildRequest.resetPending);
  const { eligible, latestBuild, latestAttempt, displayedBuild, active, pending, failed, icpReady, alreadyLive, reason } = getWebsitePublishState(observation, target);
  const publishEnabled = !locked && !publishBlockedReason && Boolean(siteOps.onAction) && eligible;
  const releaseReason = publishBlockedReason || reason;

  function configureDomain(value: string) {
    if (!value || !onAction || !observation) return;
    const message = [...observation.messages].reverse().find((item) => item.metadata?.siteOps?.kind === "domain_status"
      && item.metadata.siteOps.status === "active" && item.metadata.siteOps.revision === observation.project.revision);
    void run("domain_sync", async () => {
      await onAction({ action: "domain_sync", input: { domain: value }, ...(message ? { messageId: message.id, cardKind: "domain_status" as const } : {}) });
      setNotice("域名解析配置已提交，状态会自动同步。");
    });
  }

  return (
    <details className="sfp-domain-publish" data-design-section="domain" data-testid="website-domain-publish" tabIndex={-1} open>
      <summary><span><Globe2 size={17} aria-hidden="true" />域名与发布</span><span className="sfp-domain-summary-status">{domain?.displayDomain || domain?.domain || "可提前配置"}<ChevronDown size={16} aria-hidden="true" /></span></summary>
      <div className="sfp-domain-body">
        <p className="sfp-domain-note">可在生成网站前准备域名。暂不配置也能生成和查看预览。</p>
        {!observation ? <p role="status">{siteOps.loading ? "正在读取域名与发布状态…" : "域名与发布状态暂不可用，请刷新重试。"}</p> : <>
          <div className="sfp-domain-row"><strong>阿里云连接</strong><span>{connected ? "已连接" : observation.aliyunConnection.status === "attention_required" ? "授权需要更新" : "尚未连接"}</span></div>
          <div className="sfp-domain-actions">
            {!connected && <button type="button" className="sfp-button sfp-button-secondary" disabled={locked || !onBeginAliyun} onClick={() => void connectAliyun()}>{busy?.startsWith("oauth") ? <Loader2 size={14} className="sfp-domain-spin" /> : null}{observation.aliyunConnection.status === "not_connected" ? "连接阿里云" : "重新授权阿里云"}</button>}
            <button type="button" className="sfp-button sfp-button-secondary" disabled={locked || (!onRefresh && !onRefreshAliyunDomains)} onClick={() => void run("refresh", async () => { await onRefresh?.(); if (connected) await onRefreshAliyunDomains?.(); })}><RefreshCw size={14} aria-hidden="true" />刷新状态</button>
            {connected && <button type="button" className="sfp-domain-text-button" disabled={locked || !onDisconnectAliyun || !observation.aliyunConnection.canDisconnect} onClick={() => setDisconnectConfirm(true)}>解除阿里云连接</button>}
          </div>
          {connected && !observation.aliyunConnection.canDisconnect && <p className="sfp-domain-note">域名解析操作正在进行，请等待完成后再修改连接。</p>}
          {disconnectConfirm && <div className="sfp-domain-confirm" role="group" aria-label="解除阿里云连接确认"><p>解除连接后，后续解析管理需要重新授权。确认解除？</p><div className="sfp-domain-actions"><button type="button" className="sfp-button sfp-button-secondary" disabled={locked} onClick={() => setDisconnectConfirm(false)}>取消</button><button type="button" className="sfp-button sfp-button-secondary" disabled={locked || !observation.aliyunConnection.canDisconnect} onClick={() => void run("disconnect", async () => { await onDisconnectAliyun?.(); setDisconnectConfirm(false); })}>确认解除连接</button></div></div>}
          <p className="sfp-domain-note">授权用于读取域名和管理解析，不会购买、续费或从阿里云账号扣款。</p>
          {connected && !domain?.domain && <div className="sfp-domain-configuration">
            <label htmlFor={`${id}-domain`}>选择网站域名</label>
            <select id={`${id}-domain`} value={selectedDomain} disabled={locked || Boolean(aliyunDomainsLoading)} onChange={(event) => setSelectedDomain(event.target.value)}><option value="">{aliyunDomainsLoading ? "正在读取域名…" : "请选择域名"}</option>{aliyunDomains.map((item) => <option key={item.domain} value={item.domain}>{item.displayDomain}</option>)}</select>
            {aliyunDomainsError && <p className="sfp-domain-error" role="alert">{readableError(new Error(aliyunDomainsError), "域名列表读取失败，请刷新状态重试。")}</p>}
            {!aliyunDomainsLoading && !aliyunDomainsError && aliyunDomains.length === 0 && <p className="sfp-domain-note">未找到可接入的域名。可在阿里云购买后刷新列表。</p>}
            <div className="sfp-domain-actions"><button type="button" className="sfp-button sfp-button-primary" disabled={locked || resetPending || !selectedDomain || !onAction || !observation.aliyunConnection.canDisconnect} onClick={() => configureDomain(selectedDomain)}>{busy === "domain_sync" ? "正在提交…" : "确认并配置解析"}</button>{aliyunDomains.length === 0 && <a href="https://wanwang.aliyun.com/domain/" target="_blank" rel="noopener noreferrer">前往阿里云<ExternalLink size={13} /></a>}</div>
            <p className="sfp-domain-note">确认后会为所选域名配置网站解析，请先核对域名。</p>
          </div>}
          {domain?.domain && <div className="sfp-domain-state"><strong>{domain.displayDomain || domain.domain}</strong><dl><div><dt>所有权</dt><dd>{domainStatus(domain.ownershipStatus)}</dd></div><div><dt>解析</dt><dd>{domainStatus(domain.dnsStatus)}</dd></div><div><dt>ICP 备案</dt><dd>{domainStatus(domain.icpStatus)}{domain.icpStatus === "approved" && !icpReady ? "（域名版本待核验）" : ""}</dd></div></dl>{connected && ["attention_required", "failed", "conflict"].includes(domain.dnsStatus ?? "") && <button type="button" className="sfp-button sfp-button-secondary" disabled={locked || resetPending || !onAction || !observation.aliyunConnection.canDisconnect} onClick={() => configureDomain(domain.domain!)}>重试配置解析</button>}{!icpReady && <a href="https://beian.aliyun.com/" target="_blank" rel="noopener noreferrer">前往阿里云 ICP 备案<ExternalLink size={13} /></a>}</div>}
          <div className="sfp-domain-release">
            <label htmlFor={`${id}-target`}>发布区域</label>
            <select id={`${id}-target`} value={target} onChange={(event) => setTarget(event.target.value as WebsitePublishTarget)}>
              <option value="global_excluding_cn">海外</option>
              <option value="mainland_cn">中国大陆</option>
            </select>
            <div className="sfp-domain-row">
              <span>待发布版本</span>
              <strong>{latestBuild ? `构建 #${latestBuild.ordinal}${latestBuild.status === "approved" ? " · 检查通过" : " · 尚未通过检查"}` : "等待首次构建"}</strong>
            </div>
            {latestAttempt && displayedBuild && latestAttempt.id !== displayedBuild.id && (
              <p className="sfp-domain-note">新构建 #{latestAttempt.ordinal} 尚未完成，当前预览与已上线网站继续保留。</p>
            )}
            {active && (
              <div className="sfp-domain-current">
                <span>{TARGET_LABELS[target]}已上线 · 构建 #{observation.builds.find((build) => build.id === active.buildId)?.ordinal ?? "—"}</span>
                {active.publicUrl && <a href={active.publicUrl} target="_blank" rel="noopener noreferrer">打开已上线网站<ExternalLink size={13} /></a>}
              </div>
            )}
            {failed && <p className="sfp-domain-error" role="status">上次发布未完成。{active ? "已上线版本仍然保留。" : "请核对域名状态后重试。"}</p>}
            <p id={`${id}-release-help`} className="sfp-domain-note">{releaseReason}</p>
            <button type="button" data-testid="website-publish-request" className="sfp-button sfp-button-primary" disabled={!publishEnabled} aria-describedby={`${id}-release-help`} onClick={() => onRequestPublish(target)}>
              {pending ? "正在发布…" : alreadyLive ? "当前版本已上线" : active ? `更新${TARGET_LABELS[target]}网站` : `发布到${TARGET_LABELS[target]}`}
            </button>
          </div>
        </>}
        {busy?.startsWith("oauth") && <p role="status" className="sfp-domain-note">请在授权窗口完成阿里云连接，返回后会刷新域名。</p>}
        {notice && <p className="sfp-domain-notice" role="status">{notice}</p>}
        {error && <p className="sfp-domain-error" role="alert">{error}</p>}
      </div>
    </details>
  );
}
