import {type ComponentType, type ReactNode } from "react";
import { configureIntentWorkspaceHost } from "./response-logic-runtime-host.js";
import type { IntentWorkspaceHost, IntentToast, StartResponseLogicTask, UploadIntentAsset, IntentRestOperation, IntentVisualComponents } from "./response-logic-host.js";

export type BrandRestOperation = {
  signal: AbortSignal;
  assertActive(): void;
  headers(extra?: Record<string, string>): Record<string, string>;
  fetch(input: RequestInfo | URL, init?: RequestInit, implementation?: typeof fetch): Promise<Response>;
};

/**
 * Brand-side adapter that implements the IntentWorkspaceHost contract for the
 * response-logic workspace, using Brand's existing host infrastructure.
 *
 * Deps that are not yet wired (StartResponseLogicTask, uploadChatLocalAsset,
 * trpc workspace queries) are provided as explicit not-yet-wired stubs that
 * throw clear errors instead of silently failing — S6 Core wiring will replace
 * them with real implementations.
 */

const NOT_WIRED = (name: string) => () => {
  throw new Error(
    `${name} is not yet wired in the Brand host. This capability requires S6 Core wiring to provide the upstream task/asset infrastructure. See response-logic-core-ports.ts for the full port contract.`,
  );
};

export interface BrandResponseLogicAdapterInput {
  /** Brand's existing REST capture (from BrandHost.captureWorkspaceRestOperation). */
  captureRestOperation: (signal?: AbortSignal | null) => BrandRestOperation;
  /** Visual components from Brand's vendor module-ui or local equivalents. */
  visual: IntentVisualComponents;
  /** Toast notifications from Brand's host. */
  toast: IntentToast;
  /** Optional: real task creation (S6 will provide this). */
  startTask?: StartResponseLogicTask;
  /** Optional: real asset upload (S6 will provide this). */
  uploadAsset?: UploadIntentAsset;
}

export function createBrandResponseLogicHost(input: BrandResponseLogicAdapterInput): IntentWorkspaceHost {
  const captureRest = (signal?: AbortSignal | null): IntentRestOperation => {
    const brandRest = input.captureRestOperation(signal ?? undefined);
    return {
      signal: brandRest.signal,
      assertActive: brandRest.assertActive,
      fetch: (req, init) => brandRest.fetch(req, init),
    } satisfies IntentRestOperation;
  };

  const host: IntentWorkspaceHost = {
    captureRestOperation: captureRest,
    createResponseLogicTask: input.startTask ?? NOT_WIRED("createResponseLogicTask"),
    uploadChatLocalAsset: input.uploadAsset ?? NOT_WIRED("uploadChatLocalAsset"),
    useSearch: () => typeof window !== "undefined" ? window.location.search : "",
    activeEnterpriseProjectId: () => undefined,
    trpc: {
      workspace: {
        responseLogic: {
          useQuery: () => ({ data: undefined, isLoading: false, isFetching: false, isSuccess: false, isError: false, refetch: async () => ({}) }),
        },
        saveResponseLogic: {
          useMutation: () => ({ mutateAsync: async () => { throw new Error("SAVE_RESPONSE_LOGIC_NOT_YET_WIRED — S6 Core wiring required"); }, isPending: false }),
        },
      },
    } as never,
    FilePreview: input.visual.FilePreview,
    ImagePreview: input.visual.ImagePreview,
    Button: input.visual.Button,
    toast: input.toast,
    BusinessExecutionActivity: input.visual.BusinessExecutionActivity,
    categoryKey: (value: string) => value || null,
    categoryTone: () => null,
  };

  configureIntentWorkspaceHost(host);
  return host;
}
