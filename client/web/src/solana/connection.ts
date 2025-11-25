// src/solana/connection.ts
import { Connection } from "@solana/web3.js";
import { RPC_URL } from "./env";
import { toast } from "sonner";

const url = RPC_URL;

export const commitment: "processed" | "confirmed" | "finalized" =
  (import.meta.env.VITE_COMMITMENT as any) || "confirmed";

/**
 * Shared Solana Connection Instance
 * 
 * IMPORTANT: Always use getConnection() instead of creating new Connection instances.
 * This ensures proper rate limiting and request deduplication.
 */
const sharedConnection = new Connection(url, { commitment });

/**
 * Rate Limiter for RPC Requests
 * 
 * Features:
 * - Request deduplication (same request within 1s returns cached promise)
 * - 429 error handling with exponential backoff
 * - Circuit breaker (stops all requests after consecutive 429s)
 * - User-friendly error notifications
 */
class RPCRateLimiter {
  private requestCache = new Map<string, { promise: Promise<any>; timestamp: number }>();
  private rateLimitedUntil: number | null = null;
  private consecutiveRateLimits = 0;
  private lastToastTime = 0;
  private readonly CACHE_DURATION = 1000; // 1 second
  private readonly TOAST_COOLDOWN = 10000; // 10 seconds between toasts
  private readonly MAX_CONSECUTIVE_LIMITS = 3;

  /**
   * Execute a request with rate limiting and deduplication
   */
  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Check circuit breaker
    if (this.rateLimitedUntil && Date.now() < this.rateLimitedUntil) {
      const waitSeconds = Math.ceil((this.rateLimitedUntil - Date.now()) / 1000);

      // Show toast only once per cooldown period
      if (Date.now() - this.lastToastTime > this.TOAST_COOLDOWN) {
        toast.error(`RPC rate limit active. Please wait ${waitSeconds}s.`, {
          duration: 5000,
        });
        this.lastToastTime = Date.now();
      }

      throw new Error(`Rate limited. Please wait ${waitSeconds} seconds.`);
    }

    // Check cache for duplicate request
    const cached = this.requestCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      if (import.meta.env.DEV) {
        console.log(`[RPC] Cache hit for: ${key.substring(0, 50)}...`);
      }
      return cached.promise;
    }

    // Execute request with error handling
    const promise = fn()
      .then((result) => {
        // Success - reset consecutive limit counter
        this.consecutiveRateLimits = 0;
        return result;
      })
      .catch((err) => {
        // Check for 429 rate limit error
        if (this.is429Error(err)) {
          this.handle429();
        }
        throw err;
      });

    // Cache the promise
    this.requestCache.set(key, { promise, timestamp: Date.now() });

    // Clean up cache after duration
    setTimeout(() => {
      const entry = this.requestCache.get(key);
      if (entry && Date.now() - entry.timestamp >= this.CACHE_DURATION) {
        this.requestCache.delete(key);
      }
    }, this.CACHE_DURATION);

    return promise;
  }

  /**
   * Check if error is a 429 rate limit error
   */
  private is429Error(err: any): boolean {
    const message = err?.message?.toLowerCase() || '';
    const status = err?.status || err?.statusCode;

    return (
      status === 429 ||
      message.includes('429') ||
      message.includes('rate limit') ||
      message.includes('too many requests')
    );
  }

  /**
   * Handle 429 rate limit error
   */
  private handle429() {
    this.consecutiveRateLimits++;

    // Exponential backoff: 30s, 60s, 120s
    const backoffSeconds = Math.min(30 * Math.pow(2, this.consecutiveRateLimits - 1), 120);
    this.rateLimitedUntil = Date.now() + (backoffSeconds * 1000);

    // Show user-friendly toast (only once per cooldown)
    if (Date.now() - this.lastToastTime > this.TOAST_COOLDOWN) {
      toast.error(
        `RPC rate limit reached on devnet. Pausing requests for ${backoffSeconds}s. Please wait.`,
        { duration: 8000 }
      );
      this.lastToastTime = Date.now();
    }

    if (import.meta.env.DEV) {
      console.warn(`[RPC] Rate limited. Backoff: ${backoffSeconds}s. Consecutive: ${this.consecutiveRateLimits}`);
    }

    // Circuit breaker: if too many consecutive limits, increase backoff
    if (this.consecutiveRateLimits >= this.MAX_CONSECUTIVE_LIMITS) {
      this.rateLimitedUntil = Date.now() + (120 * 1000); // 2 minutes

      if (Date.now() - this.lastToastTime > this.TOAST_COOLDOWN) {
        toast.error(
          'Multiple rate limits detected. Pausing all RPC requests for 2 minutes.',
          { duration: 10000 }
        );
        this.lastToastTime = Date.now();
      }
    }
  }

  /**
   * Clear the rate limit (for testing or manual override)
   */
  clearRateLimit() {
    this.rateLimitedUntil = null;
    this.consecutiveRateLimits = 0;
    if (import.meta.env.DEV) {
      console.log('[RPC] Rate limit cleared');
    }
  }

  /**
   * Get current rate limit status
   */
  getStatus() {
    return {
      isRateLimited: this.rateLimitedUntil !== null && Date.now() < this.rateLimitedUntil,
      rateLimitedUntil: this.rateLimitedUntil,
      consecutiveRateLimits: this.consecutiveRateLimits,
      cacheSize: this.requestCache.size,
    };
  }
}

// Singleton rate limiter instance
const rateLimiter = new RPCRateLimiter();

/**
 * Get the shared Solana connection instance
 * 
 * ALWAYS use this instead of creating new Connection instances.
 * This ensures proper rate limiting and request deduplication.
 */
export function getConnection(): Connection {
  return sharedConnection;
}

/**
 * Legacy export for backward compatibility
 * @deprecated Use getConnection() instead
 */
export const connection = sharedConnection;

/**
 * Wrap an RPC call with rate limiting and deduplication
 * 
 * @param key - Unique key for this request (for deduplication)
 * @param fn - Function that makes the RPC call
 * @returns Promise with the result
 * 
 * @example
 * const balance = await withRateLimit(
 *   `getBalance:${pubkey}`,
 *   () => connection.getBalance(pubkey)
 * );
 */
export async function withRateLimit<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  return rateLimiter.execute(key, fn);
}

/**
 * Get rate limiter status (for debugging)
 */
export function getRateLimiterStatus() {
  return rateLimiter.getStatus();
}

/**
 * Clear rate limit (for testing/debugging)
 */
export function clearRateLimit() {
  rateLimiter.clearRateLimit();
}

// Log connection info in development
if (typeof window !== "undefined" && import.meta.env.DEV) {
  console.log("[RPC] Shared connection initialized:", url);
  console.log("[RPC] Rate limiter active");
}
