import {
  EnterpriseRagPreviewSurface,
  type EnterpriseRagPreviewProps,
} from "./EnterpriseRagPreview";
import { installRagPreviewFixtures } from "./rag-preview-fixture-loader";
import { ragPreviewFixtures } from "./rag-preview-fixtures-data";

const fixtures = installRagPreviewFixtures(ragPreviewFixtures);

/** Local-preview-only entry. Formal live rendering never imports this chunk. */
export default function EnterpriseRagPreviewFixtures(
  props: EnterpriseRagPreviewProps,
) {
  return <EnterpriseRagPreviewSurface {...props} previewFixtures={fixtures} />;
}
