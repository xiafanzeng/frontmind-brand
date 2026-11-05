import ConnectedSiteOpsConversationPanel from "../siteops/ConnectedSiteOpsConversationPanel";
import { useLocation } from "wouter";
import { useRuntimeContext } from "../../host";
import {
  SimplifiedWebsiteBuilderPreview,
  normalizeWebsiteBuildStep,
  type BuildStep,
  type LegacyBuildStep,
  type WebsiteDesignSection,
} from "./SimplifiedWebsiteBuilderPreview";

export type ConnectedSimplifiedWebsiteBuilderPreviewProps = {
  initialStep?: BuildStep | LegacyBuildStep;
  initialSection?: WebsiteDesignSection | null;
  onOpenRag?: () => void;
  onStepChange?: (step: BuildStep) => void;
  storageScope?: string;
};

/**
 * Production transport for the redesigned website builder. The established
 * SiteOps controller still owns idempotency, polling, uploads and retries.
 * Design, domain configuration and release share this one transport.
 */
export default function ConnectedSimplifiedWebsiteBuilderPreview({
  initialStep,
  initialSection,
  onOpenRag,
  onStepChange,
  storageScope: explicitStorageScope,
}: ConnectedSimplifiedWebsiteBuilderPreviewProps) {
  const [, navigate] = useLocation();
  const runtime = useRuntimeContext();
  const storageScope = explicitStorageScope
    ?? `live:${runtime.accountId}:${runtime.workspaceId}`;
  const openRag = onOpenRag ?? (() => {
    const returnStep = normalizeWebsiteBuildStep(initialStep) ?? "template";
    navigate(`/?view=enterprise-qa&returnStep=${returnStep}`);
  });
  const changeStep = onStepChange ?? ((step: BuildStep) => {
    navigate(step === "template" ? "/?view=website" : `/?view=website&step=${step}`, {
      replace: true,
    });
  });

  return (
      <ConnectedSiteOpsConversationPanel
        render={(siteOps) => (
              <SimplifiedWebsiteBuilderPreview
                key={storageScope}
                initialStep={initialStep}
                initialSection={initialSection}
                onOpenRag={openRag}
                onStepChange={changeStep}
                siteOps={siteOps}
                storageScope={storageScope}
              />
            )}
      />
  );
}
