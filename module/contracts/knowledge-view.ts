export type KnowledgeDocument = {
  id?: string;
  path: string;
  title: string;
  content: string;
  kind?: "overview" | "leaf" | "evidence" | "report" | "index" | "other";
  branchId?: string;
  branchTitle?: string;
  order?: number;
  evidenceStatus?:
    | "verified_first_party"
    | "verified_authoritative"
    | "supported_third_party"
    | "inferred"
    | "needs_verification"
    | "not_applicable";
  sourceIds?: string[];
  evidenceDocumentIds?: string[];
  assetIds?: string[];
  customerVisible?: boolean;
  evidenceCharacters?: number;
  requiredFormalCharacters?: number;
  contentStatus?: "complete" | "limited_evidence" | "needs_verification";
  productFamilyId?: string;
};

export type KnowledgeAsset = {
  id?: string;
  key: string;
  path: string;
  mimeType: string;
  size: number;
  url?: string;
  sha256?: string;
  width?: number;
  height?: number;
  caption?: string;
  alt?: string;
  branchId?: string;
  documentIds?: string[];
  sourcePageUrl?: string;
  sourceAssetUrl?: string;
  sourceDocumentPath?: string;
  sourceKind?:
    | "official_web"
    | "official_document"
    | "official_logo_upload"
    | "user_upload";
  sourceUploadIndex?: number;
  sourceUploadFileId?: string;
  sourceUploadSha256?: string;
  sourceUploadFilename?: string;
  sourceUploadMimeType?: string;
  sourceUploadSizeBytes?: number;
  ownership?: "first_party" | "third_party" | "unknown";
  assetType?:
    | "brand_identity"
    | "product_ui"
    | "product_diagram"
    | "case_photo"
    | "team_photo"
    | "environment_photo"
    | "certificate_badge"
    | "document_figure"
    | "customer_supplied"
    | "other";
  displayRole?: "hero" | "inline" | "badge";
};
