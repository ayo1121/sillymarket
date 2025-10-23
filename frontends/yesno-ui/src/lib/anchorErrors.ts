// src/lib/anchorErrors.ts
import type { Connection } from '@solana/web3.js';
import type { Idl } from '@coral-xyz/anchor';

/** Collect IDL error lookups once per IDL */
function buildAnchorErrorLookup(idl: Idl | null) {
  const byCode = new Map<number, { name?: string; msg?: string }>();
  const byName = new Map<string, { code?: number; msg?: string }>();
  if (!idl) return { byCode, byName };
  const errs: any[] = (idl as any)?.errors ?? [];
  for (const e of errs) {
    if (typeof e?.code === 'number') byCode.set(e.code, { name: e?.name, msg: e?.msg });
    if (typeof e?.name === 'string') byName.set(e.name, { code: e?.code, msg: e?.msg });
  }
  return { byCode, byName };
}

/** Parse Anchor-style + common web3 logs */
function parseFromLogs(logs?: string[]) {
  if (!logs?.length) return null as null | { code?: number; name?: string; msg?: string };

  let code: number | undefined;
  let name: string | undefined;
  let msg: string | undefined;

  for (const l of logs) {
    // AnchorError: Error Code: Name. Error Number: 6001. Error Message: blah
    const m1 = l.match(
      /AnchorError.*?Error Code:\s*([A-Za-z0-9_]+).*?Error Number:\s*(\d+).*?Error Message:\s*(.*)$/
    );
    if (m1) {
      name = m1[1];
      code = Number(m1[2]);
      msg = m1[3].trim();
      break;
    }

    // custom program error: 0xNNN
    const m2 = l.match(/custom program error: 0x([0-9a-fA-F]+)/);
    if (m2) {
      code = parseInt(m2[1], 16);
      // keep looking for a better message but at least capture the code
    }

    // Generic messages worth surfacing
    if (/ComputeBudget.*exceeded/i.test(l) || /comput.*unit.*exceed/i.test(l)) {
      msg = 'Compute units exceeded (raise CU budget or optimize)';
    }
    if (/Blockhash.*not found/i.test(l)) {
      msg = 'Blockhash not found (network or send delay)';
    }
    if (/insufficient funds/i.test(l)) {
      msg = 'Insufficient funds';
    }
    if (/Program failed to complete/i.test(l)) {
      msg = 'Program failed to complete';
    }
    if (/signature verification failed/i.test(l)) {
      msg = 'Signature verification failed';
    }
  }

  if (!code && !name && !msg) return null;
  return { code, name, msg: msg?.trim() };
}

/** Try to read simulation logs from a thrown SendTransactionError or RPC error JSON */
async function extractLogsFromError(e: any, connection: Connection): Promise<string[] | undefined> {
  try {
    // anchor/web3 SendTransactionError
    if (e && typeof e.getLogs === 'function') {
      const logs = await e.getLogs(connection);
      if (Array.isArray(logs) && logs.length) return logs;
    }
  } catch {}
  // Some RPCs include logs in `e.logs` or nested json
  const cand = e?.logs || e?.data?.logs || e?.response?.data?.logs;
  if (Array.isArray(cand)) return cand as string[];

  // Sometimes message contains serialized logs
  const msg = String(e?.message || '');
  const m = msg.match(/logs.*?:\s*(\[[\s\S]*?\])/i);
  if (m) {
    try {
      const parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {}
  }
  return undefined;
}

/** Format a human-friendly message using IDL + logs + common RPC error patterns */
export async function formatTxError(
  e: any,
  connection: Connection,
  idl: Idl | null,
  fallback = 'Transaction failed'
): Promise<string> {
  const raw = String(e?.message || e || fallback);

  // 1) Pull logs (best signal)
  const logs = await extractLogsFromError(e, connection);
  const parsed = parseFromLogs(logs);

  // 2) Map via IDL if possible
  const { byCode, byName } = buildAnchorErrorLookup(idl);
  if (parsed?.code !== undefined && byCode.has(parsed.code)) {
    const m = byCode.get(parsed.code)!;
    const label = m.name ? `${m.name} (${parsed.code})` : `Code ${parsed.code}`;
    const text = m.msg || parsed.msg || fallback;
    return `${label}: ${text}`;
  }
  if (parsed?.name && byName.has(parsed.name)) {
    const m = byName.get(parsed.name)!;
    const label = m.code !== undefined ? `${parsed.name} (${m.code})` : parsed.name;
    const text = m.msg || parsed.msg || fallback;
    return `${label}: ${text}`;
  }
  if (parsed?.msg) return parsed.msg;
  if (parsed?.code !== undefined) return `Program error 0x${parsed.code.toString(16)} (${parsed.code})`;

  // 3) Common web3 / RPC patterns from message body
  if (/0x1\b/.test(raw) && /Instruction/i.test(raw)) return 'Invalid instruction data';
  if (/0x5\b/.test(raw) && /Instruction/i.test(raw)) return 'Account not rent exempt';
  if (/0x9\b/.test(raw) && /Instruction/i.test(raw)) return 'Insufficient funds';
  if (/custom program error: 0x([0-9a-fA-F]+)/.test(raw)) {
    const code = parseInt(RegExp.$1, 16);
    return `Program error 0x${code.toString(16)} (${code})`;
  }
  if (/ComputeBudget.*exceeded/i.test(raw)) return 'Compute units exceeded (raise CU budget or optimize)';
  if (/Blockhash.*not found/i.test(raw)) return 'Blockhash not found (network or send delay)';
  if (/Transaction simulation failed/i.test(raw)) return raw.replace(/.*Transaction simulation failed: */i, '');

  // 4) Fall back to trimmed message
  return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
}
