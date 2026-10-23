import ConnectedSiteOpsConversationPanel from "../siteops/ConnectedSiteOpsConversationPanel";
import { useLocation } from "wouter";
import { useRuntimeContext } from "../../host";
import {
  SimplifiedWebsiteBuilderPreview,
  type BuildStep,
} from "./SimplifiedWebsiteBuilderPreview";

export type ConnectedSimplifiedWebsiteBuilderPreviewProps = {
  initialStep?: BuildStep;
  onOpenRag?: () => void;
  onStepChange?: (step: BuildStep) => void;
  storageScope?: string;
};

/**
 * Production transport for the redesigned website builder. The established
 * SiteOps controller still owns idempotency, polling, uploads and retries;
 * only its view is replaced by the newer four-step product experience.
 */
export default function ConnectedSimplifiedWebsiteBuilderPreview({
  initialStep,
  onOpenRag,
  onStepChange,
  storageScope: explicitStorageScope,
}: ConnectedSimplifiedWebsiteBuilderPreviewProps) {
  const [, navigate] = useLocation();
  const runtime = useRuntimeContext();
  const storageScope = explicitStorageScope
    ?? `live:${runtime.accountId}:${runtime.workspaceId}`;
  const openRag = onOpenRag ?? (() => {
    const returnStep = initialStep ?? "template";
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
          onOpenRag={openRag}
          onStepChange={changeStep}
          siteOps={siteOps}
          storageScope={storageScope}
        />
      )}
    />
  );
}
