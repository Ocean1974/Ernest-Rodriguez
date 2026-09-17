export function normalizeSearch(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}
