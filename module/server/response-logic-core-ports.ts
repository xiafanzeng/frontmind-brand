/**
 * Core port contracts for the response-logic feature running inside the
 * brand module. Extracted from the intent module's task-ports.ts (S2 of
 * the intent→brand migration); only the types needed by the response-logic
 * service layer, rule evaluation API, and (future) judge/optimizer are
 * declared here. Brand's Core wiring provides the implementations.
 */

import type { ResponseLogicRecordDto } from "../contracts/response-logic.js";
import type { RuleEvaluationEnvelope } from "../contracts/response-logic-evaluation.js";

export type CoreRequest = {
  frontmindUser?: { id: number; role: string };
  frontmindCredential?: { id: string; apiKey?: string };
  [key: string]: unknown;
};

export type CredentialHandle = {
  id: string;
  userId: number;
  version: number;
  credentialRef: string;
  fingerprint: string;
  status: "active" | "retired";
  verifiedAt: Date | null;
  agentProfile: string;
  provider: string;
  upstreamModel: string;
  upstreamEffort: string | null;
};

export type ManusV2MessageEvent = {
  id: string;
  type: string;
  timestamp: number;
  [key: string]: unknown;
};

export type CoreProviderError = Error & { code: string };

export type ConfiguredIntentQuestion = {
  questionId: string;
  groupId: string;
  groupTitle: string;
  question: string;
  intent: string;
  summary: string;
  writeScope: {
    revision: number;
    contractId: string | null;
    quotaPeriodId: string;
  };
};

export type EvidenceSnapshot = {
  id: string;
  version: number;
  sourceFileName: string;
  documents: Array<{ path: string; title: string; content: string; kind?: string }>;
} | null;

/**
 * The full port surface the response-logic API family needs from the host.
 * Brand's Core adapter assembles this from BrandKeywordPorts (already
 * available) plus the response-logic service instance.
 */
export type ResponseLogicApiPorts = {
  enterpriseWorkspaceUserId(userId: number): number;
  assertServiceCapability(userId: number, capability: string): Promise<void>;
  ServiceEntitlementError: new (code: string, message: string, statusCode?: number) => Error & { code: string; statusCode: number };
  sendAiBillingError(res: unknown, error: unknown): boolean;
  getDashboardQuestion(userId: number, questionId: string): Promise<ConfiguredIntentQuestion | null>;
  getResponseLogicEntry(userId: number, questionId: string): Promise<ResponseLogicRecordDto | null>;
  getLatestKnowledgeSnapshot(userId: number): Promise<EvidenceSnapshot>;
  getResponseLogicEntryRecord(userId: number, questionId: string): Promise<ResponseLogicRecordDto | null>;
  credentialForRequest(request: unknown): CredentialHandle | undefined;
  getFrontMindCredentials(request: unknown): { credentialRef?: string };
  getCredentialForUpstreamResource(userId: number, kind: string, upstreamId: string): Promise<CredentialHandle | null>;
  createCredentialAgentClient(credential: CredentialHandle, options?: { baseUrl?: string; accountUserId?: number; intentId?: string; rateLimitScope?: string }): {
    uploadFile(input: { filename: string; bytes: Buffer; contentType?: string }): Promise<{ fileId: string }>;
    createTask(input: Record<string, unknown>): Promise<{ taskId: string; raw: unknown }>;
    sendMessage(input: Record<string, unknown>): Promise<{ taskId: string; raw: unknown }>;
    listAllMessages(input: { taskId: string; order: string }): Promise<ManusV2MessageEvent[]>;
  };
  getUpstreamBaseUrl(request: unknown): string;
  toUpstreamAgentProfile(profile: string): string;
  recordUpstreamResource(input: { userId: number; apiCredentialId: string; kind: string; upstreamId: string }): Promise<void>;
  classifyManusV2StructuredResultEnvelope(input: unknown): { kind: string; code?: string; value?: unknown };
  latestManusV2TaskState(events: readonly unknown[]): string | null;
  orderManusV2EventsByProviderRank(events: readonly unknown[], direction: string): unknown[];
  ManusV2ApiError: new (operation: string, status: number | null, code: string, retryable: boolean, outcomeUnknown: boolean) => Error & { outcomeUnknown: boolean };
  assertUpstreamPromptBudget(value: string): string;
  buildDeterministicTaskAttachmentArchive(input: { name: string; entrypoint: string; files: Array<{ path: string; content: string }>; metadata?: Record<string, unknown> }): Promise<{ bytes: Buffer; contentHash: string }>;
  buildDirectorySkillArchive(input: { name: string; version: string; directoryCandidates: readonly string[]; files: readonly string[] }): Promise<{ bytes: Buffer; contentHash: string }>;
  getDb(): Promise<unknown>;
  [key: string]: unknown;
};
