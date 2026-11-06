import type { EnterpriseRagEvaluationCoordinate } from "../enterprise-rag-evaluation-api";

export type RagReportSection = "rules" | "records";
export type RagReportUrlBuilder = (section: RagReportSection, coordinate?: EnterpriseRagEvaluationCoordinate, exampleId?: string) => string;
