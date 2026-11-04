import { canonicalJson } from "../../contracts/siteops-workflow.js";
import type { SiteContentPlanV2 } from "../../contracts/siteops-content-plan.js";

export const SITE_DOCUMENT_VIEW_PLAN_V1_FILENAME =
  "frontmind-site-document-view-plan-v1.json" as const;

/** Stable DOM coordinates used by generated sites and the host browser QA. */
export const SITE_DOCUMENT_VIEW_DOM = {
  triggerBranchesAttribute: "data-frontmind-document-branches",
  dialogAttribute: "data-frontmind-document-dialog",
  branchAttribute: "data-frontmind-document-branch",
  nodeAttribute: "data-frontmind-document-node",
  closeAttribute: "data-frontmind-document-close",
} as const;

export type SiteDocumentViewSourceDocument = {
  id: string;
  path: string;
  title: string;
  content: string;
  branchId?: string;
  branchTitle?: string;
  order?: number;
};

export type SiteDocumentViewPlanV1 = {
  schemaVersion: 1;
  branches: Array<{
    id: string;
    title: string;
    nodes: Array<{
      id: string;
      path: string;
      title: string;
      order: number;
      content: string;
    }>;
  }>;
  routes: Array<{
    routeId: string;
    path: string;
    branchIds: string[];
    sections: Array<{
      sectionId: string;
      branchIds: string[];
    }>;
  }>;
};

export type SiteDocumentViewProviderPlanV1 = Omit<
  SiteDocumentViewPlanV1,
  "branches"
> & {
  sourceDossierFilename: "frontmind-siteops-source-dossier-v1.json";
  nodeContentSource: "match_node_id_in_single_dossier_or_manifest_parts";
  splitDossierRule: "read_manifest_parts_and_join_contentPartIndex";
  branches: Array<{
    id: string;
    title: string;
    nodes: Array<{
      id: string;
      path: string;
      title: string;
      order: number;
    }>;
  }>;
};

export type SiteDocumentViewPlanErrorCode =
  | "SITE_DOCUMENT_VIEW_DUPLICATE_DOCUMENT_ID"
  | "SITE_DOCUMENT_VIEW_SOURCE_DOCUMENT_MISSING";

export class SiteDocumentViewPlanError extends Error {
  constructor(
    readonly code: SiteDocumentViewPlanErrorCode,
    readonly documentId: string,
  ) {
    super(`${code}:${documentId}`);
    this.name = "SiteDocumentViewPlanError";
  }
}

function compactCoordinate(value: string, fallback: string) {
  const compacted = value.trim();
  return compacted || fallback;
}

function branchIdFor(document: SiteDocumentViewSourceDocument) {
  return document.branchId?.trim() || `document:${document.id}`;
}

function documentOrder(document: SiteDocumentViewSourceDocument) {
  return typeof document.order === "number" && Number.isFinite(document.order)
    ? document.order
    : 0;
}

function uniqueInOrder(values: readonly string[]) {
  return [...new Set(values)];
}

/**
 * Projects the frozen content plan onto complete knowledge branches. A section
 * only selects a branch; once selected, every eligible node in that branch is
 * carried into the immutable viewer contract.
 */
export function deriveSiteDocumentViewPlanV1(input: {
  contentPlan: SiteContentPlanV2;
  documents: readonly SiteDocumentViewSourceDocument[];
  /** Internal generation-only sources, such as customer revision requests,
   * must never be projected into a public document dialog. */
  ignoredSourceDocumentIds?: readonly string[];
}): SiteDocumentViewPlanV1 {
  const ignoredSourceDocumentIds = new Set(
    input.ignoredSourceDocumentIds ?? [],
  );
  const documentById = new Map<string, SiteDocumentViewSourceDocument>();
  for (const document of input.documents) {
    if (documentById.has(document.id)) {
      throw new SiteDocumentViewPlanError(
        "SITE_DOCUMENT_VIEW_DUPLICATE_DOCUMENT_ID",
        document.id,
      );
    }
    if (!ignoredSourceDocumentIds.has(document.id)) {
      documentById.set(document.id, document);
    }
  }

  const documentsByBranch = new Map<
    string,
    SiteDocumentViewSourceDocument[]
  >();
  for (const document of input.documents) {
    if (ignoredSourceDocumentIds.has(document.id)) continue;
    const branchId = branchIdFor(document);
    const branchDocuments = documentsByBranch.get(branchId) ?? [];
    branchDocuments.push(document);
    documentsByBranch.set(branchId, branchDocuments);
  }

  const referencedBranchIds: string[] = [];
  const routes = input.contentPlan.routes.map((route) => {
    const routeBranchIds: string[] = [];
    const sections = route.sections.map((section) => {
      const sectionBranchIds = uniqueInOrder(
        section.sourceBindings.flatMap((binding) => {
          if (ignoredSourceDocumentIds.has(binding.sourceDocumentId)) {
            return [];
          }
          const document = documentById.get(binding.sourceDocumentId);
          if (!document) {
            throw new SiteDocumentViewPlanError(
              "SITE_DOCUMENT_VIEW_SOURCE_DOCUMENT_MISSING",
              binding.sourceDocumentId,
            );
          }
          return [branchIdFor(document)];
        }),
      );
      routeBranchIds.push(...sectionBranchIds);
      referencedBranchIds.push(...sectionBranchIds);
      return {
        sectionId: section.id,
        branchIds: sectionBranchIds,
      };
    });
    return {
      routeId: route.id,
      path: route.path,
      branchIds: uniqueInOrder(routeBranchIds),
      sections,
    };
  });

  const branches = uniqueInOrder(referencedBranchIds).map((branchId) => {
    const documents = [...(documentsByBranch.get(branchId) ?? [])].sort(
      (left, right) =>
        documentOrder(left) - documentOrder(right) ||
        left.id.localeCompare(right.id, "en"),
    );
    const first = documents[0]!;
    const explicitTitle = documents
      .map((document) => document.branchTitle?.trim() ?? "")
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, "zh-CN"))[0];
    return {
      id: branchId,
      title: compactCoordinate(explicitTitle ?? first.title, first.title),
      nodes: documents.map((document) => ({
        id: document.id,
        path: document.path,
        title: document.title,
        order: documentOrder(document),
        content: document.content,
      })),
    };
  });

  return {
    schemaVersion: 1,
    branches,
    routes,
  };
}

export function siteDocumentViewPlanAttachment(plan: SiteDocumentViewPlanV1) {
  const providerPlan: SiteDocumentViewProviderPlanV1 = {
    schemaVersion: 1,
    sourceDossierFilename: "frontmind-siteops-source-dossier-v1.json",
    nodeContentSource: "match_node_id_in_single_dossier_or_manifest_parts",
    splitDossierRule: "read_manifest_parts_and_join_contentPartIndex",
    branches: plan.branches.map((branch) => ({
      id: branch.id,
      title: branch.title,
      nodes: branch.nodes.map((node) => ({
        id: node.id,
        path: node.path,
        title: node.title,
        order: node.order,
      })),
    })),
    routes: plan.routes,
  };
  const bytes = Buffer.from(`${canonicalJson(providerPlan)}\n`, "utf8");
  return {
    filename: SITE_DOCUMENT_VIEW_PLAN_V1_FILENAME,
    mime_type: "application/json",
    file_data: `data:application/json;base64,${bytes.toString("base64")}`,
  } as const;
}
