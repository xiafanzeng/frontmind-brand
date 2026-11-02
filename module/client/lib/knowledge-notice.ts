import type { KnowledgeBaseClientNotice } from "../knowledge-conversation-state";

export function knowledgeBaseNoticeRecoveryMode(
  notice: Pick<KnowledgeBaseClientNotice, "code" | "recoveryAction" | "recoveryToken" | "canRegenerate">,
) {
  if (notice.code === "KNOWLEDGE_BASE_LOGO_PROVENANCE_REQUIRED") return "logo_repair" as const;
  if (
    ["PACKAGE_REBIND_REQUIRED", "KNOWLEDGE_BASE_ATTACHMENTS_REQUIRED", "UPSTREAM_CREATE_3"].includes(notice.code ?? "") ||
    ["approve_reset", "resume_start_from_retained_sources", "reselect_start_sources", "retry_request",
      "start_new_generation", "create_new_canonical_from_snapshot", "regenerate_turn"].includes(notice.recoveryAction ?? "")
  ) return "reset" as const;
  if (["reconcile", "update_credential", "top_up"].includes(notice.recoveryAction ?? ""))
    return "reconcile" as const;
  return "none" as const;
}
