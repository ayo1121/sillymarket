/** ---------- Safe market name extraction (UTF-8 + readability guard) ---------- */
const NAME_KEYS = ["name", "title", "question", "label", "marketName", "market_name", "prompt"];

function trimZeros(u8: Uint8Array) {
  let end = u8.length;
  while (end > 0 && u8[end - 1] === 0) end--;
  return u8.subarray(0, end);
}
function decodeUtf8Bytes(x: Uint8Array | number[]): string | null {
  try {
    const u8 = x instanceof Uint8Array ? x : Uint8Array.from(x);
    const s = new TextDecoder().decode(trimZeros(u8));
    return s;
  } catch {
    return null;
  }
}
function isReadable(s: string | null): s is string {
  if (!s) return false;
  const t = s.trim();
  if (!t) return false;
  if (t.includes("\uFFFD")) return false;               // replacement char = bad UTF8
  const printable = t.match(/[\p{L}\p{N}\p{P}\p{Zs}]/gu)?.length ?? 0;
  return printable / t.length >= 0.9;                    // mostly printable
}
/** Try several shapes: string, Vec<u8>, [u8;N], preferred keys first, then DFS */
export function safeMarketName(decoded: any): string | null {
  if (!decoded) return null;

  // direct string
  if (typeof decoded === "string" && isReadable(decoded)) return decoded.trim();

  // direct bytes
  if (decoded instanceof Uint8Array) {
    const s = decodeUtf8Bytes(decoded);
    return isReadable(s) ? s!.trim() : null;
  }
  if (Array.isArray(decoded) && decoded.every((n) => typeof n === "number")) {
    const s = decodeUtf8Bytes(decoded as number[]);
    return isReadable(s) ? s!.trim() : null;
  }

  if (typeof decoded === "object") {
    // 1) preferred keys
    for (const k of Object.keys(decoded)) {
      if (NAME_KEYS.includes(k) || NAME_KEYS.some((n) => k.toLowerCase().includes(n.toLowerCase()))) {
        const s = safeMarketName(decoded[k]);
        if (s) return s;
      }
    }
    // 2) general DFS
    for (const v of Object.values(decoded)) {
      const s = safeMarketName(v);
      if (s) return s;
    }
  }
  return null;
}
