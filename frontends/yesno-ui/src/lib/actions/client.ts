// src/lib/actions/client.ts
/**
 * Client utilities for calling your Solana Action endpoints.
 * Guarantees: endpoint is ALWAYS absolute (http/https).
 */

export function absUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return new URL(pathOrUrl, window.location.origin).toString();
  }
  const base = process.env.NEXT_PUBLIC_SITE_ORIGIN;
  if (!base || !/^https?:\/\//i.test(base)) {
    throw new Error(
      'Set NEXT_PUBLIC_SITE_ORIGIN in your .env (e.g. http://localhost:3000 or https://your.domain)'
    );
  }
  return new URL(pathOrUrl, base).toString();
}

/**
 * Calls an Action endpoint using an ABSOLUTE URL and includes that URL
 * in BOTH query and body (so your server can read it either way).
 *
 * The endpoint should return { tx: "<base64>" }
 */
export async function callActionAbsolute(
  actionPathOrUrl: string,
  query: Record<string, string | number | boolean>,
  account: string
): Promise<{ txB64: string; endpoint: string }> {
  const absolute = absUrl(actionPathOrUrl);

  const url = new URL(absolute);
  url.searchParams.set('endpoint', absolute);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account, endpoint: absolute }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  if (!json?.tx) throw new Error('Action response missing "tx"');

  return { txB64: String(json.tx), endpoint: absolute };
}
