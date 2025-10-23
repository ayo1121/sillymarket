// Tiny local cache for market titles: "yesno:name:v1" -> { [pubkey]: title }
const KEY = "yesno:name:v1";

function readMap(): Record<string, string> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {}
}

export function getCachedTitle(pk: string): string | null {
  const m = readMap();
  return m[pk] ?? null;
}

export function setCachedTitle(pk: string, title: string) {
  const m = readMap();
  m[pk] = title;
  writeMap(m);
}
