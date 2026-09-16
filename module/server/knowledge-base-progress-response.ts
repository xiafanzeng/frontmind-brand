export const KNOWLEDGE_BASE_RESPONSE_HEADER = "x-frontmind-knowledge-response";
export const KNOWLEDGE_BASE_OBSERVATION_RESPONSE = "observation-v1";

/**
 * Legacy browsers read the top-level aliases. Current browsers opt into one
 * atomic observation, so its full progress tree is serialized only once.
 * Keep the fallback envelope when no observation exists or an alias differs.
 */
export function knowledgeBaseProgressResponse(body: unknown, format: unknown) {
  if (
    format !== KNOWLEDGE_BASE_OBSERVATION_RESPONSE ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  )
    return body;
  const envelope = body as Record<string, unknown>;
  const observation = envelope.observation as
    | { interaction?: { progress?: unknown } }
    | null
    | undefined;
  const interaction = observation?.interaction;
  if (
    !interaction ||
    ("interaction" in envelope && envelope.interaction !== interaction) ||
    ("progress" in envelope && envelope.progress !== interaction.progress)
  )
    return body;

  const {
    progress: _progress,
    interaction: _interaction,
    ...compact
  } = envelope;
  return compact;
}
