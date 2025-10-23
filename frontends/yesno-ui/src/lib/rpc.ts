// src/lib/rpc.ts
import {
  Connection,
  PublicKey,
  GetProgramAccountsConfig,
} from '@solana/web3.js';

/* ───────── small utils ───────── */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeLimiter(rps = 15, burst = 15) {
  let tokens = burst;
  let last = Date.now();
  const queue: Array<() => void> = [];

  function refill() {
    const now = Date.now();
    const delta = (now - last) / 1000;
    last = now;
    tokens = Math.min(burst, tokens + delta * rps);
  }

  async function acquire() {
    while (true) {
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      await new Promise<void>((res) => queue.push(res));
      await sleep(0);
    }
  }

  setInterval(() => {
    refill();
    while (tokens >= 1 && queue.length) {
      tokens -= 1;
      queue.shift()!();
    }
  }, 50);

  return { acquire };
}

const DEFAULT_LIMITER = makeLimiter(15, 15);

async function retry<T>(fn: () => Promise<T>, attempts = 5, baseDelay = 250): Promise<T> {
  let err: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      err = e;
      const msg = String(e?.message ?? e ?? '');
      const hit429 = /429|Too Many Requests/i.test(msg);
      const backoff = baseDelay * Math.pow(2, i) + Math.floor(Math.random() * 100);
      await sleep(hit429 ? backoff : baseDelay);
    }
  }
  throw err;
}

/* ───────── exported helpers ───────── */
export async function getProgramAccountsRetry(
  connection: Connection,
  programId: PublicKey,
  cfg: GetProgramAccountsConfig = { commitment: 'confirmed' as any },
  limiter = DEFAULT_LIMITER,
) {
  await limiter.acquire();
  return retry(() => connection.getProgramAccounts(programId, cfg));
}

export async function getSignaturesForAddressRL(
  connection: Connection,
  address: PublicKey,
  opts?: { limit?: number; before?: string; until?: string },
  limiter = DEFAULT_LIMITER,
) {
  await limiter.acquire();
  return retry(() => connection.getSignaturesForAddress(address, opts, 'confirmed'));
}

/**
 * withRpc – tiny wrapper that binds a Connection to the retry/limited helpers.
 * Usage:
 *   const rpc = withRpc(connection);
 *   const accs = await rpc.getProgramAccountsRetry(PROGRAM_ID, {...});
 *   const sigs = await rpc.getSignaturesForAddressRL(pubkey, { limit: 1 });
 */
export function withRpc(connection: Connection) {
  return {
    getProgramAccountsRetry: (programId: PublicKey, cfg?: GetProgramAccountsConfig) =>
      getProgramAccountsRetry(connection, programId, cfg),
    getSignaturesForAddressRL: (
      address: PublicKey,
      opts?: { limit?: number; before?: string; until?: string },
    ) => getSignaturesForAddressRL(connection, address, opts),
  };
}
