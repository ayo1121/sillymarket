type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 60;  // 60 req/min per IP (tweak as you like)
const buckets = new Map<string, Bucket>();

export function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, b);
  }
  b.count += 1;
  return b.count <= MAX_REQUESTS;
}

export function rateLimitHeaders(ip: string) {
  const b = buckets.get(ip);
  const remaining = Math.max(0, (b ? MAX_REQUESTS - b.count : MAX_REQUESTS));
  const resetSec = Math.ceil(((b?.resetAt ?? Date.now()) - Date.now()) / 1000);
  return {
    "X-RateLimit-Limit": String(MAX_REQUESTS),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(Math.max(0, resetSec)),
  };
}
