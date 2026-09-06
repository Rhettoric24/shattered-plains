export function normalizeVapidKey(value: string | undefined) {
  const normalized = value?.trim().replace(/=+$/, "") ?? "";
  return normalized || undefined;
}
