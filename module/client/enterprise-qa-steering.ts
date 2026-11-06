/** Server-owned receipt for supplemental input accepted by the current turn. */
export type EnterpriseQaSteering = {
  supported: boolean;
  turnId: string;
  revision: number;
  effectiveQuestion: string;
  supplements: Array<{ clientRequestId: string; text: string; revision: number }>;
};

export function readEnterpriseQaSteering(value: unknown): EnterpriseQaSteering | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as EnterpriseQaSteering;
  if (typeof item.supported !== "boolean" || typeof item.turnId !== "string" ||
    !Number.isInteger(item.revision) || item.revision < 0 || typeof item.effectiveQuestion !== "string" ||
    !Array.isArray(item.supplements) || item.supplements.some(part =>
      !part || typeof part.clientRequestId !== "string" || typeof part.text !== "string" ||
      !Number.isInteger(part.revision) || part.revision < 1 || part.revision > item.revision)) return null;
  return item;
}
