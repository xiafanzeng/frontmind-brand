import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiteOpsObservationV1 } from "../../../contracts/siteops-contract";
import { getWebsitePublishState, WebsiteDomainPublishPanel } from "./WebsiteDomainPublishPanel";

function observation(): SiteOpsObservationV1 {
  return {
    schemaVersion: 1, executionKind: "site_ops",
    serviceReadiness: { visuals: { status: "configured" }, website: { status: "configured" }, publishing: { status: "configured" }, domain: { status: "configured" } },
    aliyunConnection: { configured: true, status: "active", verifiedAt: null, canDisconnect: true }, domainState: null,
    project: { id: "11111111-1111-4111-8111-111111111111", conversationId: "siteops:1", revision: 3, status: "draft", currentKnowledgeSnapshotId: null, primaryLanguage: "zh-CN", canonicalHostname: null, updatedAt: "2026-11-05T00:00:00.000Z" },
    brief: null, knowledgeSnapshots: [], messages: [], visualCandidates: [], visualCandidatePages: [],
    visualGeneration: { status: "idle", targetPage: null, generatedPages: 0, maxPages: 4, canGenerateMore: false, canSelectExisting: false },
    executionSteps: [], builds: [], deployments: [], socialPackages: [],
    rebuildRequest: { allowed: false, resetApplied: false, resetSourceBuildId: null },
    interactionState: "collecting_brief", latestSequence: 1,
  };
}

function publishable(): SiteOpsObservationV1 {
  return {
    ...observation(), interactionState: "approved",
    domainState: { domain: "example.com", displayDomain: "example.com", revision: 2, ownershipStatus: "verified", dnsStatus: "active", icpStatus: "approved", icpDomainRevision: 2, icpVerifiedAt: "2026-11-05T00:00:00.000Z" },
    builds: [{ id: "22222222-2222-4222-8222-222222222222", ordinal: 2, parentBuildId: null, status: "approved", previewUrl: "/preview/2", sourceUrl: null, buildDelivery: null, needsHelp: false, createdAt: "2026-11-05T00:00:00.000Z", updatedAt: "2026-11-05T00:00:00.000Z" }],
  };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("WebsiteDomainPublishPanel", () => {
  it("offers domain setup before a build and requires an explicit DNS action for a sole domain", async () => {
    const onAction = vi.fn(async () => undefined);
    const base = observation();
    const props = { observation: base, onAction, aliyunDomains: [{ domain: "example.com", displayDomain: "example.com" }] };
    const { rerender } = render(<WebsiteDomainPublishPanel siteOps={props} onRequestPublish={vi.fn()} />);
    expect((screen.getByLabelText("选择网站域名") as HTMLSelectElement).value).toBe("example.com");
    expect((screen.getByRole("button", { name: "确认并配置解析" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("website-publish-request") as HTMLButtonElement).disabled).toBe(true);
    rerender(<WebsiteDomainPublishPanel siteOps={{ ...props, observation: { ...base, project: { ...base.project, revision: 4 } } }} onRequestPublish={vi.fn()} />);
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认并配置解析" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
    expect(onAction).toHaveBeenCalledWith({ action: "domain_sync", input: { domain: "example.com" } });
  });

  it("keeps domain configuration available while unsaved design blocks publishing", () => {
    render(<WebsiteDomainPublishPanel siteOps={{ observation: observation(), onAction: vi.fn(), aliyunDomains: [{ domain: "example.com", displayDomain: "example.com" }] }} publishBlockedReason="请先提交设计修改。" onRequestPublish={vi.fn()} />);
    expect((screen.getByRole("button", { name: "确认并配置解析" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("website-publish-request") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("请先提交设计修改。")).toBeTruthy();
  });

  it("clears a selection removed from the refreshed provider list", () => {
    const props = { observation: observation(), onAction: vi.fn(), aliyunDomains: [{ domain: "old.com", displayDomain: "old.com" }] };
    const { rerender } = render(<WebsiteDomainPublishPanel siteOps={props} onRequestPublish={vi.fn()} />);
    rerender(<WebsiteDomainPublishPanel siteOps={{ ...props, aliyunDomains: [] }} onRequestPublish={vi.fn()} />);
    expect((screen.getByLabelText("选择网站域名") as HTMLSelectElement).value).toBe("");
    expect((screen.getByRole("button", { name: "确认并配置解析" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("requests the selected target through the shared confirmation without publishing directly", () => {
    const onAction = vi.fn(); const onRequestPublish = vi.fn();
    render(<WebsiteDomainPublishPanel siteOps={{ observation: publishable(), onAction }} onRequestPublish={onRequestPublish} />);
    fireEvent.change(screen.getByLabelText("发布区域"), { target: { value: "mainland_cn" } });
    fireEvent.click(screen.getByRole("button", { name: "发布到中国大陆" }));
    expect(onRequestPublish).toHaveBeenCalledOnce();
    expect(onRequestPublish).toHaveBeenCalledWith("mainland_cn");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows previous live deployment while a newer build is in progress", () => {
    const state = publishable();
    const oldBuildId = state.builds[0].id;
    state.builds.unshift({ ...state.builds[0], id: "33333333-3333-4333-8333-333333333333", ordinal: 3, status: "building", previewUrl: null });
    state.deployments.push({ id: "44444444-4444-4444-8444-444444444444", buildId: oldBuildId, target: "global_excluding_cn", status: "active", publicUrl: "https://example.com", createdAt: "2026-11-05T00:00:00.000Z" });
    render(<WebsiteDomainPublishPanel siteOps={{ observation: state, onAction: vi.fn() }} onRequestPublish={vi.fn()} />);
    expect(screen.getByText("海外已上线 · 构建 #2")).toBeTruthy();
    expect((screen.getByRole("link", { name: "打开已上线网站" }) as HTMLAnchorElement).href).toBe("https://example.com/");
    expect(screen.getByText(/新构建 #3 尚未完成/)).toBeTruthy();
  });

  it("accepts OAuth completion only from its own same-origin popup and only reads state", async () => {
    const popup = { document: document.implementation.createHTMLDocument(), closed: false, location: { href: "" }, focus: vi.fn(), close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const onRefresh = vi.fn(async () => undefined); const onRefreshAliyunDomains = vi.fn(async () => undefined); const onAction = vi.fn();
    const base = observation(); base.aliyunConnection.status = "not_connected";
    render(<WebsiteDomainPublishPanel siteOps={{ observation: base, onAction, onRefresh, onRefreshAliyunDomains, onBeginAliyun: async () => ({ authorizationUrl: "https://signin.aliyun.com/oauth2/v1/auth?state=test", expiresAt: "2099-01-01T00:00:00.000Z" }) }} onRequestPublish={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "连接阿里云" }));
    await waitFor(() => expect(popup.location.href).toContain("https://signin.aliyun.com/"));
    const data = { type: "frontmind:siteops:aliyun-oauth", status: "success" };
    fireEvent(window, new MessageEvent("message", { origin: "https://attacker.invalid", source: popup as unknown as Window, data }));
    expect(onRefresh).not.toHaveBeenCalled();
    fireEvent(window, new MessageEvent("message", { origin: window.location.origin, source: window, data }));
    expect(onRefresh).not.toHaveBeenCalled();
    fireEvent(window, new MessageEvent("message", { origin: window.location.origin, source: popup as unknown as Window, data }));
    await waitFor(() => expect(onRefreshAliyunDomains).toHaveBeenCalledOnce());
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it("rejects an unexpected OAuth destination", async () => {
    const popup = { document: document.implementation.createHTMLDocument(), closed: false, location: { href: "" }, focus: vi.fn(), close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const base = observation(); base.aliyunConnection.status = "not_connected";
    render(<WebsiteDomainPublishPanel siteOps={{ observation: base, onBeginAliyun: async () => ({ authorizationUrl: "https://signin.aliyun.com.attacker.invalid/auth", expiresAt: "2099-01-01T00:00:00.000Z" }) }} onRequestPublish={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "连接阿里云" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("安全的阿里云授权页面"));
    expect(popup.location.href).toBe(""); expect(popup.close).toHaveBeenCalledOnce();
  });
});

describe("getWebsitePublishState", () => {
  it("enforces verified ownership, approved build, active DNS and current mainland ICP", () => {
    const state = publishable();
    expect(getWebsitePublishState(state, "global_excluding_cn").eligible).toBe(true);
    expect(getWebsitePublishState(state, "mainland_cn").eligible).toBe(true);
    state.domainState!.icpDomainRevision = 1;
    expect(getWebsitePublishState(state, "mainland_cn").eligible).toBe(false);
    expect(getWebsitePublishState(state, "global_excluding_cn").eligible).toBe(true);
    state.domainState!.ownershipStatus = "pending";
    expect(getWebsitePublishState(state, "global_excluding_cn").eligible).toBe(false);
    state.domainState!.ownershipStatus = "verified"; state.domainState!.dnsStatus = "pending";
    expect(getWebsitePublishState(state, "global_excluding_cn").eligible).toBe(false);
    state.domainState!.dnsStatus = "active"; state.builds[0].status = "preview_ready";
    expect(getWebsitePublishState(state, "global_excluding_cn").eligible).toBe(false);
  });

  it("uses the current target head and blocks pending/repeated deployment or reset", () => {
    const state = publishable();
    state.deployments = [{ id: "44444444-4444-4444-8444-444444444444", buildId: state.builds[0].id, target: "mainland_cn", status: "active", publicUrl: "https://example.com", createdAt: "2026-11-05T00:00:00.000Z" }];
    expect(getWebsitePublishState(state, "global_excluding_cn").eligible).toBe(true);
    expect(getWebsitePublishState(state, "global_excluding_cn").headDeploymentId).toBe(null);
    expect(getWebsitePublishState(state, "mainland_cn").headDeploymentId).toBe(state.deployments[0].id);
    expect(getWebsitePublishState(state, "mainland_cn").eligible).toBe(false);
    state.deployments[0].status = "verifying";
    expect(getWebsitePublishState(state, "mainland_cn").eligible).toBe(false);
    state.rebuildRequest.resetPending = true;
    expect(getWebsitePublishState(state, "global_excluding_cn").eligible).toBe(false);
  });

  it("retains an authoritative head when its historical row is hidden and ignores stale active rows", () => {
    const state = publishable();
    state.project.globalLiveDeploymentId = "55555555-5555-4555-8555-555555555555";
    state.deployments = [{ id: "44444444-4444-4444-8444-444444444444", buildId: state.builds[0].id, target: "global_excluding_cn", status: "active", publicUrl: "https://stale.example.com", createdAt: "2026-11-05T00:00:00.000Z" }];
    const result = getWebsitePublishState(state, "global_excluding_cn");
    expect(result.headDeploymentId).toBe(state.project.globalLiveDeploymentId);
    expect(result.active).toBe(null);
    expect(result.alreadyLive).toBe(false);
    expect(result.eligible).toBe(true);
    state.project.globalLiveDeploymentId = null;
    expect(getWebsitePublishState(state, "global_excluding_cn").headDeploymentId).toBe(null);
    expect(getWebsitePublishState(state, "global_excluding_cn").active).toBe(null);
  });

  it("does not publish an older approved preview while the current build is incomplete", () => {
    const state = publishable();
    state.builds.unshift({ ...state.builds[0], id: "33333333-3333-4333-8333-333333333333", ordinal: 3, status: "building", previewUrl: null });
    const result = getWebsitePublishState(state, "global_excluding_cn");
    expect(result.latestBuild?.ordinal).toBe(3);
    expect(result.displayedBuild?.ordinal).toBe(2);
    expect(result.eligible).toBe(false);
  });
});
