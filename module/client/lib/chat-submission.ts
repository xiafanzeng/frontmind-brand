

export type ChatSubmission = {
  token: string;
  conversationId: string | null;
  messageId: string;
  text: string;
  startedAt: number;
  completedAt?: number;
  phase: "preparing" | "uploading" | "synchronizing" | "submitting" | "failed";
};
