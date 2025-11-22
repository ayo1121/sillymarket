/**
 * Centralized application configuration
 * 
 * This module provides a single source of truth for all environment variables
 * with proper validation and clear error messages.
 */

// ============================================================================
// API Configuration
// ============================================================================

/**
 * Backend API URL
 * - Development: http://localhost:8787
 * - Production: https://api.sillymarket.fun (or your Railway URL)
 */
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

// ============================================================================
// Solana Configuration
// ============================================================================

/**
 * Solana RPC endpoint URL
 * - Devnet: https://api.devnet.solana.com
 * - Mainnet: Use your own RPC provider (e.g., Helius, QuickNode)
 */
export const RPC_URL = import.meta.env.VITE_RPC_URL || "https://api.devnet.solana.com";

/**
 * Deployed Solana program ID (public key)
 */
export const PROGRAM_ID = import.meta.env.VITE_PROGRAM_ID;

/**
 * Solana commitment level for transactions
 * Options: "processed" | "confirmed" | "finalized"
 */
export const COMMITMENT = (import.meta.env.VITE_COMMITMENT as "processed" | "confirmed" | "finalized") || "confirmed";

/**
 * Priority fee in microlamports for transactions
 */
export const PRIORITY_MICROLAMPORTS = Number(import.meta.env.VITE_PRIORITY_MICROLAMPORTS || 0);

// ============================================================================
// Supabase Configuration
// ============================================================================

/**
 * Supabase project URL
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/**
 * Supabase anonymous/public key (safe to expose in frontend)
 */
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// ============================================================================
// Feature Flags
// ============================================================================

/**
 * Whether to require wallet connection for app access
 * Set to "1" to require wallet, "0" to allow guest browsing
 */
export const REQUIRE_WALLET = import.meta.env.VITE_REQUIRE_WALLET === "1";

/**
 * Whether to show debug wallet dock (development only)
 * Set to "1" to show, "0" to hide
 */
export const DEBUG_DOCK = import.meta.env.VITE_DEBUG_DOCK === "1";

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate that required environment variables are set
 * Call this early in the application lifecycle to catch missing config
 */
export function validateConfig() {
    const errors: string[] = [];

    // API URL is required
    if (!API_URL) {
        errors.push("VITE_API_URL is not set");
    }

    // Warn about missing optional but important variables
    if (!PROGRAM_ID) {
        console.warn("[config] VITE_PROGRAM_ID is not set - Solana features may not work");
    }

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        console.warn("[config] Supabase credentials not set - storage features may not work");
    }

    if (errors.length > 0) {
        const message = `Missing required environment variables:\n${errors.join("\n")}`;
        console.error("[config]", message);
        throw new Error(message);
    }

    // Log configuration in development
    if (import.meta.env.DEV) {
        console.log("[config] Configuration loaded:", {
            API_URL,
            RPC_URL,
            PROGRAM_ID: PROGRAM_ID ? `${PROGRAM_ID.slice(0, 8)}...` : "not set",
            COMMITMENT,
            REQUIRE_WALLET,
            DEBUG_DOCK,
        });
    }
}

// ============================================================================
// Exports
// ============================================================================

export const config = {
    // API
    API_URL,

    // Solana
    RPC_URL,
    PROGRAM_ID,
    COMMITMENT,
    PRIORITY_MICROLAMPORTS,

    // Supabase
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,

    // Features
    REQUIRE_WALLET,
    DEBUG_DOCK,

    // Validation
    validate: validateConfig,
} as const;

export default config;
