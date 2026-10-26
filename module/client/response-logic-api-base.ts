/**
 * Shared REST base for the Brand response-logic API. Every response-logic
 * client call must go through the stable module namespace: the legacy
 * top-level /api/response-logic mount only exists in the full Dashboard and
 * the intent module container, never in the Brand module container, so a
 * top-level URL would 404 in production.
 */
export const RESPONSE_LOGIC_API_BASE = "/api/modules/brand/response-logic";
