// src/solana/env.ts
import { RPC_URL as CONFIG_RPC, PROGRAM_ID as CONFIG_PID, COMMITMENT as CONFIG_COMMITMENT, PRIORITY_MICROLAMPORTS as CONFIG_PRIORITY } from "@/lib/config";

/**
 * @deprecated Use `RPC_URL` from `@/lib/config` instead.
 */
export const RPC_URL = CONFIG_RPC;

/**
 * @deprecated Use `PROGRAM_ID` from `@/lib/config` instead.
 */
export const PROGRAM_ID = CONFIG_PID || (undefined as unknown as string);

/**
 * @deprecated Use `COMMITMENT` from `@/lib/config` instead.
 */
export const COMMITMENT = CONFIG_COMMITMENT;

/**
 * @deprecated Use `PRIORITY_MICROLAMPORTS` from `@/lib/config` instead.
 */
export const PRIORITY_MICROLAMPORTS = CONFIG_PRIORITY;

if (typeof window !== "undefined") {
  console.debug("[env.ts] This module is deprecated. Please import from @/lib/config instead.");
}
