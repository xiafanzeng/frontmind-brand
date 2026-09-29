/** Frozen evidence needed by the enterprise QA business; the host validates account/project ownership. */
export interface EnterpriseQaContext {
 purpose:string;
 knowledgeBase:{snapshotId:string;contentHash:string}|null;
 knowledgeText:string|null;
 answerContractVersion?:1;
 inputFiles?:{localAssetId:string;filename:string}[];
}
