import { Router, type Request } from "express";

export type BrandConversationPurpose = "knowledge" | "enterprise_qa";
export interface BrandConversationSnapshot {
  id: string; purpose?: string; workbenchAgentId?: string; taskId?: string;
  messages: Array<Record<string, unknown>>; [key: string]: unknown;
}
export interface BrandConversationStore {
  list(request: Request): Promise<BrandConversationSnapshot[]>;
  save(request: Request, snapshot: BrandConversationSnapshot): Promise<unknown>;
  delete(request: Request, id: string): Promise<unknown>;
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
export function assertBrandConversationPurpose(purpose: BrandConversationPurpose, snapshot: BrandConversationSnapshot, existing?: BrandConversationSnapshot) {
  if (brandConversationPurpose(snapshot) !== purpose || (existing && brandConversationPurpose(existing) !== purpose))
    throw new BrandConversationAccessError("BRAND_CONVERSATION_PURPOSE_MISMATCH");
  if (existing?.taskId && snapshot.taskId && existing.taskId !== snapshot.taskId)
    throw new BrandConversationAccessError("BRAND_CONVERSATION_TASK_MISMATCH");
  for (const message of snapshot.messages) {
    const dispatch = message.generalChatDispatch as Record<string, unknown> | undefined;
    if (dispatch && (purpose !== "enterprise_qa" || dispatch.purpose !== "enterprise_qa"))
      throw new BrandConversationAccessError("BRAND_CONVERSATION_DISPATCH_MISMATCH");
  }
}
const isPurpose = (value: unknown): value is BrandConversationPurpose => value === "knowledge" || value === "enterprise_qa";
export function createBrandConversationRouter(store: BrandConversationStore): Router {
  const router = Router();
  router.get("/conversations", async (req, res) => {
    if (!isPurpose(req.query.purpose)) return void res.status(400).json({error: "BRAND_PURPOSE_REQUIRED"});
    try { res.json({conversations: (await store.list(req)).filter(item => brandConversationPurpose(item) === req.query.purpose)}); }
    catch { res.status(503).json({error: "BRAND_CONVERSATIONS_UNAVAILABLE"}); }
  });
  router.post("/conversations/sync", async (req, res) => {
    const {purpose, conversations, deletedIds = []} = req.body ?? {};
    if (!isPurpose(purpose) || !Array.isArray(conversations) || conversations.length > 200 || !Array.isArray(deletedIds) || deletedIds.length > 200 || deletedIds.some(id => typeof id !== "string" || !id || id.length > 128))
      return void res.status(400).json({error: "BRAND_SNAPSHOT_INVALID"});
    try {
      const saved = new Map((await store.list(req)).map(item => [item.id, item]));
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
  return router;
}
