import { Router, type Request } from "express";
import { isConversationDeleteResult, type ConversationDeleteResult } from "../contracts/conversation-delete.js";

export type BrandConversationPurpose = "knowledge" | "enterprise_qa";
export interface BrandConversationSnapshot {
  id: string; purpose?: string; workbenchAgentId?: string; taskId?: string;
  messages: Array<Record<string, unknown>>; [key: string]: unknown;
}
export interface BrandConversationStore {
  list(request: Request): Promise<BrandConversationSnapshot[]>;
  save(request: Request, snapshot: BrandConversationSnapshot): Promise<unknown>;
  delete(request: Request, id: string): Promise<unknown>;
  deleteConfirmed(request: Request, id: string, purpose: BrandConversationPurpose): Promise<ConversationDeleteResult>;
}
export class BrandConversationAccessError extends Error { readonly status = 403; }
/** Saved workflow/task metadata owns the purpose; a browser title does not. */
export function brandConversationPurpose(snapshot: BrandConversationSnapshot): BrandConversationPurpose | null {
  if (snapshot.purpose === "enterprise_qa") return "enterprise_qa";
  if (snapshot.purpose) return null;
  if (snapshot.workbenchAgentId === "knowledge" || snapshot.messages.some(message => {
    const metadata = message.knowledgeBase as Record<string, unknown> | undefined;
    return metadata?.serverOwned === true;
  })) return "knowledge";
  return null;
}
/** Only Core's saved workbench marker may supply an unstarted draft purpose. */
function normalizeSavedBrandConversation(snapshot: BrandConversationSnapshot): BrandConversationSnapshot {
  if (snapshot.purpose || snapshot.workbenchAgentId !== "enterprise-qa" ||
      snapshot.taskId || snapshot.previousResponseId || snapshot.execution || snapshot.executionKind ||
      snapshot.messages.some(message => message.generalChat || message.generalChatDispatch || message.knowledgeBase)) return snapshot;
  return {...snapshot, purpose: "enterprise_qa"};
}
export function assertBrandConversationPurpose(purpose: BrandConversationPurpose, snapshot: BrandConversationSnapshot, existing?: BrandConversationSnapshot) {
  if (brandConversationPurpose(snapshot) !== purpose || (existing && brandConversationPurpose(existing) !== purpose))
    throw new BrandConversationAccessError("BRAND_CONVERSATION_PURPOSE_MISMATCH");
  if (existing?.taskId && snapshot.taskId && existing.taskId !== snapshot.taskId)
    throw new BrandConversationAccessError("BRAND_CONVERSATION_TASK_MISMATCH");
  for (const message of snapshot.messages) {
    const dispatch = message.generalChatDispatch as Record<string, unknown> | undefined;
    if (!dispatch) continue;
    const localTaskId = dispatch.localTaskId;
    const isNewTask = localTaskId === null;
    const boundTaskId = existing?.taskId ?? existing?.previousResponseId;
    if (purpose !== "enterprise_qa" ||
        (isNewTask ? dispatch.purpose !== "enterprise_qa" : dispatch.purpose !== undefined) ||
        (!isNewTask && (typeof localTaskId !== "string" || !localTaskId || localTaskId !== boundTaskId)))
      throw new BrandConversationAccessError("BRAND_CONVERSATION_DISPATCH_MISMATCH");
  }
}
const isPurpose = (value: unknown): value is BrandConversationPurpose => value === "knowledge" || value === "enterprise_qa";
export function createBrandConversationRouter(store: BrandConversationStore): Router {
  const router = Router();
  router.get("/conversations", async (req, res) => {
    if (!isPurpose(req.query.purpose)) return void res.status(400).json({error: "BRAND_PURPOSE_REQUIRED"});
    try { res.json({conversations: (await store.list(req)).map(normalizeSavedBrandConversation).filter(item => brandConversationPurpose(item) === req.query.purpose)}); }
    catch { res.status(503).json({error: "BRAND_CONVERSATIONS_UNAVAILABLE"}); }
  });
  router.post("/conversations/sync", async (req, res) => {
    const {purpose, conversations, deletedIds = []} = req.body ?? {};
    if (!isPurpose(purpose) || !Array.isArray(conversations) || conversations.length > 200 || !Array.isArray(deletedIds) || deletedIds.length > 200 || deletedIds.some(id => typeof id !== "string" || !id || id.length > 128))
      return void res.status(400).json({error: "BRAND_SNAPSHOT_INVALID"});
    try {
      const saved = new Map((await store.list(req)).map(normalizeSavedBrandConversation).map(item => [item.id, item]));
      const seen = new Set<string>();
      // Reject the whole incoming batch before writing any record.
      for (const snapshot of conversations) {
        if (!snapshot || typeof snapshot.id !== "string" || !snapshot.id || snapshot.id.length > 128 || !Array.isArray(snapshot.messages) || seen.has(snapshot.id) || deletedIds.includes(snapshot.id))
          return void res.status(400).json({error: "BRAND_SNAPSHOT_INVALID"});
        seen.add(snapshot.id);
        assertBrandConversationPurpose(purpose, snapshot, saved.get(snapshot.id));
      }
      for (const id of deletedIds) {
        const existing = saved.get(id);
        if (existing && brandConversationPurpose(existing) !== purpose) throw new BrandConversationAccessError("BRAND_CONVERSATION_PURPOSE_MISMATCH");
      }
      for (const snapshot of conversations) await store.save(req, snapshot);
      for (const id of deletedIds) if (saved.has(id)) await store.delete(req, id);
      res.json({success: true});
    } catch (error) {
      res.status(error instanceof BrandConversationAccessError ? 403 : 400).json({error: error instanceof BrandConversationAccessError ? error.message : "BRAND_SNAPSHOT_REJECTED"});
    }
  });
  router.post("/conversations/delete-confirmed", async (req, res) => {
    const { purpose, id } = req.body ?? {};
    if (!isPurpose(purpose) || typeof id !== "string" || !id || id.length > 128)
      return void res.status(400).json({ error: "BRAND_CONVERSATION_DELETE_INVALID" });
    try {
      const existing = (await store.list(req)).map(normalizeSavedBrandConversation).find(item => item.id === id);
      if (!existing) return void res.json({ ok: true } satisfies ConversationDeleteResult);
      if (brandConversationPurpose(existing) !== purpose) throw new BrandConversationAccessError("BRAND_CONVERSATION_PURPOSE_MISMATCH");
      const result = await store.deleteConfirmed(req, id, purpose);
      if (!isConversationDeleteResult(result)) return void res.status(503).json({ error: "BRAND_CONVERSATION_DELETE_RESPONSE_INVALID" });
      res.json(result);
    } catch (error) {
      if (error instanceof BrandConversationAccessError) return void res.status(403).json({ error: error.message });
      res.status(503).json({ error: "BRAND_CONVERSATION_DELETE_UNAVAILABLE" });
    }
  });
  return router;
}
