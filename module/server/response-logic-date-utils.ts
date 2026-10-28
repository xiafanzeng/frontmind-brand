/**
 * Date normalization for MySQL2 / drizzle timestamp columns.
 *
 * MySQL2 may return timestamp columns as strings (dateStrings mode) or Date
 * objects depending on the connection config. When a Date-like value arrives
 * (string | number | Date), normalize it; null/undefined falls back to now.
 * Invalid Date objects are also replaced with now rather than letting
 * downstream `.toISOString()` throw RangeError or TypeError.
 */
export function toDateOrNow(value: Date | string | number | null | undefined): Date {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? new Date() : value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  return new Date();
}

/**
 * Resolve a provider upload `detail.expiresAt` (Unix seconds) to a Date,
 * or null when the provider omits it. Never returns an Invalid Date that
 * would crash drizzle's timestamp mapper with a confusing TypeError.
 */
export function providerExpiresAtToDate(
  expiresAt: unknown,
): Date | null {
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    return new Date(expiresAt * 1_000);
  }
  return null;
}
