import { createElement } from "react";
import type { IntentWorkspaceHost } from "./response-logic-host.js";

let current: IntentWorkspaceHost | undefined;
/** Each application installs its trusted host once, before rendering module UI. */
export function configureIntentWorkspaceHost(host: IntentWorkspaceHost) { current = host; }
function host() { if (!current) throw new Error("INTENT_WORKSPACE_HOST_REQUIRED"); return current; }
export const captureWorkspaceRestOperation: IntentWorkspaceHost["captureRestOperation"] = (...args) => host().captureRestOperation(...args);
export const useSearch = () => host().useSearch();
export const activeEnterpriseProjectId = () => host().activeEnterpriseProjectId();
export const createResponseLogicTask: IntentWorkspaceHost["createResponseLogicTask"] = (...args) => host().createResponseLogicTask(...args);
export const uploadChatLocalAsset: IntentWorkspaceHost["uploadChatLocalAsset"] = (...args) => host().uploadChatLocalAsset(...args);
export const toast = { success: (message: string) => host().toast.success(message), error: (message: string) => host().toast.error(message) };
export const trpc = new Proxy({} as IntentWorkspaceHost["trpc"], { get: (_, key) => Reflect.get(host().trpc, key) });
/**
 * Optional visual components (FilePreview, ImagePreview, BusinessExecutionActivity)
 * may be omitted by some hosts. React error #130 ("Element type is invalid … got:
 * undefined") occurs when createElement receives an undefined component — observed
 * live 2026-11-04 when the workspace rendered through a host that didn't supply
 * optional visuals. Fall back to a no-op instead of crashing the tree.
 */
const NullVisual = () => null;
export const BusinessExecutionActivity: IntentWorkspaceHost["BusinessExecutionActivity"] = props => createElement((host().BusinessExecutionActivity ?? NullVisual) as IntentWorkspaceHost["BusinessExecutionActivity"], props);
export const FilePreview: IntentWorkspaceHost["FilePreview"] = props => createElement((host().FilePreview ?? NullVisual) as IntentWorkspaceHost["FilePreview"], props);
export const ImagePreview: IntentWorkspaceHost["ImagePreview"] = props => createElement((host().ImagePreview ?? NullVisual) as IntentWorkspaceHost["ImagePreview"], props);
export const Button: IntentWorkspaceHost["Button"] = props => createElement(host().Button, props);

export const loadPreviewAdapter = () => host().loadPreviewAdapter?.() ?? Promise.reject(new Error("LOCAL_PREVIEW_ADAPTER_UNAVAILABLE"));
