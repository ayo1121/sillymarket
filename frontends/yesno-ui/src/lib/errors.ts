/**
 * Error decoding helpers for Anchor + Solana.
 * - Loads your program's IDL errors to map custom codes -> names/messages.
 * - Parses tx logs to extract Anchor error codes (0x...) and require! messages.
 * - Falls back to friendly guesses for common Solana/RPC failures.
 */

type IdlError = { code: number; name?: string; msg?: string };

let idlErrors: Map<number, IdlError> | null = null;

// Lazy-load IDL errors once (tree-shakeable if unused)
async function loadIdlErrors(): Promise<Map<number, IdlError>> {
  if (idlErrors) return idlErrors;
  try {
    // NOTE: ensure your IDL stays here:
    const idl = (await import("@/idl/yesno_bets.json")) as any;
    const errs = new Map<number, IdlError>();
    if (Array.isArray(idl?.errors)) {
      for (const e of idl.errors) {
        errs.set(Number(e.code), { code: Number(e.code), name: e.name, msg: e.msg });
      }
    }
    idlErrors = errs;
  } catch {
    idlErrors = new Map();
  }
  return idlErrors!;
}

function hexToInt(hex: string): number | null {
  try {
    return parseInt(hex, 16);
  } catch {
    return null;
  }
}

/**
 * Parse Anchor-style logs to find either:
 * - "custom program error: 0xNN" (code)
 * - "Program log: AnchorError ... error Code: N" (rare older)
 * - "Program log: require: ..." / "Program log: Error: ..." (inline message)
 */
export function decodeFromLogsSync(logs: string[] | undefined): { code?: number; name?: string; msg?: string; raw?: string } | null {
  if (!logs || logs.length === 0) return null;

  // First, capture a nice inline require message if present
  for (const l of logs) {
    const m = l.match(/Program log: (?:require(?:_msg)?|Error):\s*(.+)$/i);
    if (m?.[1]) {
      return { msg: m[1].trim(), raw: l };
    }
  }

  // Anchor custom code as hex (most common)
  for (const l of logs) {
    const m = l.match(/custom program error: (0x[0-9a-fA-F]+)/);
    if (m?.[1]) {
      const n = hexToInt(m[1]);
      if (n !== null) return { code: n, raw: l };
    }
  }

  // Fallback: sometimes Anchor prints numeric code
  for (const l of logs) {
    const m = l.match(/AnchorError.*Code:\s*(\d+)/i);
    if (m?.[1]) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n)) return { code: n, raw: l };
    }
  }

  return null;
}

/**
 * Common Solana/RPC hints (last line wins — keep order from most specific to generic).
 */
function heuristicsFor(err: any, logs?: string[]): string | null {
  const msg = String(err?.message || "");
  const name = String(err?.name || "");

  const text = [name, msg, ...(logs ?? [])].join(" \n ");

  if (/blockhash.*not found/i.test(text) || /Transaction recentBlockhash required/i.test(text)) {
    return "Network tip moved — refresh blockhash and try again.";
  }
  if (/insufficient funds/i.test(text) || /lamports.*balance/i.test(text)) {
    return "Insufficient SOL to cover fees. Top up and retry.";
  }
  if (/ComputeBudget.*exceeded/i.test(text) || /comput(e|ed) units/i.test(text)) {
    return "Compute budget exceeded. Add a compute budget ix or simplify the transaction.";
  }
  if (/already in use/i.test(text)) {
    return "Account already in use or exists. If creating ATAs/PDAs, make creation idempotent.";
  }
  if (/signature verification failed/i.test(text)) {
    return "Signature verification failed (wrong wallet or modified tx). Re-approve the transaction.";
  }
  if (/invalid account data for instruction/i.test(text) || /account.*owner mismatch/i.test(text)) {
    return "Account owner mismatch or invalid account data. Check PDAs, seeds, and program IDs.";
  }
  if (/Program failed to complete/i.test(text) || /simulation failed/i.test(text)) {
    return "Transaction simulation failed. Check logs for the on-chain error.";
  }
  if (/recipient account not found/i.test(text) || /could not find account/i.test(text)) {
    return "Missing account (ATA/PDA). Ensure you create ATAs idempotently before the call.";
  }
  return null;
}

/**
 * Humanize a transaction error — IDL-aware and log-aware.
 * Pass the raw error from sendTransaction(), and optionally logs (if you have them).
 */
export async function humanizeSolanaError(err: any, logs?: string[]): Promise<{ title: string; details?: string; code?: number; name?: string }> {
  // 1) Try to decode from logs
  const decoded = decodeFromLogsSync(logs);
  const idlMap = await loadIdlErrors();

  if (decoded?.code !== undefined) {
    const found = idlMap.get(decoded.code);
    if (found) {
      return {
        title: found.msg || found.name || `Program error (code ${decoded.code})`,
        details: found.name ? `(${found.name}, code ${decoded.code})` : undefined,
        code: decoded.code,
        name: found.name,
      };
    }
    // Unknown code but we have a number
    return {
      title: `Program error (code ${decoded.code})`,
      details: "This code is not listed in the current IDL. Ensure frontend IDL matches deployed program.",
      code: decoded.code,
    };
  }

  if (decoded?.msg) {
    return { title: decoded.msg, details: "Program require!/Error message from logs." };
  }

  // 2) Heuristics for common client/RPC issues
  const h = heuristicsFor(err, logs);
  if (h) return { title: h };

  // 3) Last resort: trim the raw message
  const raw = String(err?.message || err || "Transaction failed");
  return { title: raw.replace(/^Error:\s*/i, "").slice(0, 300) };
}

/**
 * Utility: try to extract logs from a SendTransactionError (web3.js >=1.91)
 */
export function extractLogs(err: any): string[] | undefined {
  // web3.js throws SendTransactionError with 'logs' sometimes in 'value'
  const direct = err?.logs;
  if (Array.isArray(direct)) return direct as string[];

  const val = err?.value;
  if (val && Array.isArray(val.logs)) return val.logs as string[];

  // Some libs nest at err?.cause?.logs
  const cause = err?.cause;
  if (cause && Array.isArray(cause.logs)) return cause.logs as string[];

  return undefined;
}
