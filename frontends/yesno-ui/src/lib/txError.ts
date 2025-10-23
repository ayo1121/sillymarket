// src/lib/txError.ts
import type { Idl } from '@coral-xyz/anchor';
import { SendTransactionError } from '@solana/web3.js';

/** Extract logs from different Solana error shapes */
export function extractLogs(err: unknown): string[] | undefined {
  // @solana/web3.js SendTransactionError
  if (err instanceof SendTransactionError) {
    try {
      // web3.js v1.95+ has getLogs()
      // @ts-ignore
      const logs = typeof err.getLogs === 'function' ? err.getLogs() : undefined;
      if (Array.isArray(logs) && logs.length) return logs;
    } catch {}
  }
  // fallback: common nested places logs appear
  const maybe = (err as any) ?? {};
  const candidates: any[] = [
    maybe.logs,
    maybe.value?.logs,
    maybe.simulationResponse?.logs,
    maybe.simulation?.logs,
    maybe.err?.logs,
  ].filter(Boolean);
  for (const c of candidates) if (Array.isArray(c) && c.length) return c as string[];
  return undefined;
}

/** Try to parse Anchor code/name/message from logs */
function parseAnchorFromLogs(logs?: string[]) {
  if (!logs || !logs.length) return null as { code?: number; name?: string; msg?: string } | null;
  let code: number | undefined;
  let name: string | undefined;
  let msg: string | undefined;

  for (const l of logs) {
    const m1 = l.match(
      /AnchorError.*?Error Code:\s*([A-Za-z0-9_]+).*?Error Number:\s*(\d+).*?Error Message:\s*(.*)$/
    );
    if (m1) {
      name = m1[1];
      code = Number(m1[2]);
      msg = m1[3]?.trim();
      break;
    }
    const mHex = l.match(/custom program error: 0x([0-9a-fA-F]+)/);
    if (mHex) code = parseInt(mHex[1], 16);
    const mMsg = l.match(/Program log: (?:Error: )(.+)$/);
    if (mMsg && !msg) msg = mMsg[1]?.trim();
  }
  if (!code && !name && !msg) return null;
  return { code, name, msg };
}

/** Build lookup from IDL errors to friendly strings */
function buildAnchorErrorLookup(idl: Idl | null) {
  const byCode = new Map<number, { name?: string; msg?: string }>();
  const byName = new Map<string, { code?: number; msg?: string }>();
  const errs: any[] = (idl as any)?.errors ?? [];
  for (const e of errs) {
    if (typeof e?.code === 'number') byCode.set(e.code, { name: e?.name, msg: e?.msg });
    if (typeof e?.name === 'string') byName.set(e.name, { code: e?.code, msg: e?.msg });
  }
  return { byCode, byName };
}

/** Clean potentially sensitive bits for on-screen display */
export function sanitize(msg: string) {
  return (msg || '')
    .replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .replace(/api[-_ ]?key=[A-Za-z0-9-_]+/gi, 'api-key=[redacted]');
}

/**
 * Turn a Solana/Anchor error + optional IDL into a user-friendly message.
 * Falls back to any provided label/fallback.
 */
export function humanizeSolanaError(
  err: unknown,
  idl: Idl | null,
  fallback = 'Transaction failed'
) {
  const logs = extractLogs(err);
  const parsed = parseAnchorFromLogs(logs ?? undefined);
  const { byCode, byName } = buildAnchorErrorLookup(idl);

  if (parsed?.code !== undefined && byCode.has(parsed.code)) {
    const m = byCode.get(parsed.code)!;
    const label = m.name ? `${m.name} (${parsed.code})` : `Code ${parsed.code}`;
    const text = m.msg ?? parsed.msg ?? fallback;
    return sanitize(`${label}: ${text}`);
  }
  if (parsed?.name && byName.has(parsed.name)) {
    const m = byName.get(parsed.name)!;
    const label = m.code !== undefined ? `${parsed.name} (${m.code})` : parsed.name;
    const text = m.msg ?? fallback;
    return sanitize(`${label}: ${text}`);
  }
  if (parsed?.msg) return sanitize(parsed.msg);
  // If logs contain "insufficient funds" or similar human text, surface it
  if (logs?.length) {
    const last = logs.slice().reverse().find((l) => /error|insufficient|fail/i.test(l));
    if (last) return sanitize(last);
  }
  // Final fallback: err.message (if any)
  const rawMsg =
    (err as any)?.message ??
    (err as any)?.toString?.() ??
    fallback;
  return sanitize(String(rawMsg));
}
