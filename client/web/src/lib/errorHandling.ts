/**
 * Error Handling Utilities
 * 
 * Provides safe error message sanitization and toast helpers
 * to prevent sensitive information leakage to users.
 */

import { toast } from "sonner";

/**
 * Known safe error patterns from Anchor/Solana and backend
 * These can be shown directly to users
 */
const SAFE_ERROR_PATTERNS = [
    /Unauthorized/i,
    /InvalidState/i,
    /AlreadyResolved/i,
    /AlreadyClaimed/i,
    /BettingClosed/i,
    /InsufficientFunds/i,
    /BadParam/i,
    /NotClaimed/i,
    /Overflow/i,
    /User rejected/i,
    /Transaction simulation failed/i,
    /Signature verification failed/i,
    /Invalid signature/i,
    /Nonce expired/i,
    /Nonce not found/i,
    /Username taken/i,
    /Invalid username/i,
    /Too many/i, // Rate limiting
    /Not allowed by CORS/i,
];

/**
 * Normalize Anchor program errors into user-friendly strings
 * so toasts don't expose internal codes or prefixes.
 */
export function normalizeAnchorErrorMessage(error: unknown, context?: string): string {
    const raw = (error as any)?.message ?? String(error ?? "Unknown error");
    const message = typeof raw === "string" ? raw : String(raw);

    const anchorMatch = message.match(/Anchor error\s+([A-Za-z0-9_]+)\s*\((\d+)\):\s*(.+)$/);
    if (!anchorMatch) {
        return message;
    }

    const name = anchorMatch[1];
    const code = anchorMatch[2];
    const detail = anchorMatch[3]?.trim();

    if (name === "BettingClosed" || code === "6003") {
        return "betting closed";
    }

    if (detail) {
        return detail.toLowerCase();
    }

    return "transaction failed";
}

/**
 * Sanitize error messages for user display
 * 
 * Removes sensitive information (stack traces, internal paths, etc.)
 * while preserving useful context for known error types.
 * 
 * @param error - Any error object (Error, string, or unknown)
 * @returns Safe error message suitable for display to users
 */
export function sanitizeErrorMessage(error: unknown, context?: string): string {
    if (!error) {
        return "An unknown error occurred";
    }

    // Extract raw message from various error formats
    const raw = (error as any)?.message ?? String(error ?? "Unknown error");
    let rawMessage = typeof raw === "string" ? raw : String(raw);

    // Anchor normalization (keep before generic fallbacks)
    const anchorNormalized = normalizeAnchorErrorMessage({ message: rawMessage }, context);
    if (anchorNormalized && anchorNormalized !== rawMessage) {
        return anchorNormalized;
    }

    // Strip common prefixes
    rawMessage = rawMessage.replace(/^(Anchor Error|Program Error|Error):?\s*/i, "");

    // Check if error matches known safe patterns
    for (const pattern of SAFE_ERROR_PATTERNS) {
        if (pattern.test(rawMessage)) {
            return rawMessage;
        }
    }

    // For unknown errors, log full error for debugging but return generic message
    console.error("[ErrorHandler] Sanitized error:", {
        message: rawMessage,
        error: error,
    });

    return "An error occurred. Please try again or contact support.";
}

/**
 * Show error toast with sanitized message
 * 
 * @param error - Any error object
 * @param fallbackMessage - Optional prefix message (e.g., "Failed to create market")
 */
export function showErrorToast(error: unknown, fallbackMessage?: string, context?: string) {
    const sanitized = sanitizeErrorMessage(error, context);
    const message = fallbackMessage ? `${fallbackMessage}: ${sanitized}` : sanitized;
    toast.error(message);
}

/**
 * Show success toast
 * Convenience wrapper for consistency
 */
export function showSuccessToast(message: string) {
    toast.success(message);
}

/**
 * Map common Solana/wallet errors to user-friendly messages
 * 
 * Handles:
 * - Wallet rejections
 * - Insufficient funds
 * - RPC errors (rate limits, timeouts)
 * - Simulation failures
 * - Network errors
 */
export function mapSolanaError(error: unknown): string {
    const raw = (error as any)?.message ?? String(error ?? "Unknown error");
    const message = typeof raw === "string" ? raw : String(raw);

    // Wallet rejection
    if (message.includes("User rejected") || message.includes("User denied") || message.includes("rejected the request")) {
        return "Transaction cancelled by user";
    }

    // Insufficient funds
    if (message.includes("Insufficient funds") || message.includes("insufficient lamports") || message.includes("Attempt to debit an account but found no record of a prior credit")) {
        return "Insufficient SOL balance for this transaction";
    }

    // RPC errors
    if (message.includes("429") || message.includes("Too many requests")) {
        return "Network busy. Please try again in a moment";
    }

    if (message.includes("timeout") || message.includes("timed out")) {
        return "Network timeout. Please check your connection and try again";
    }

    if (message.includes("blockhash not found")) {
        return "Transaction expired. Please try again";
    }

    // Simulation errors
    if (message.includes("Transaction simulation failed")) {
        // Try to extract specific reason
        if (message.includes("insufficient funds")) {
            return "Insufficient SOL balance";
        }
        if (message.includes("custom program error")) {
            return "Transaction would fail. Please check your inputs";
        }
        return "Transaction simulation failed. Please try again";
    }

    // Signature verification
    if (message.includes("Signature verification failed")) {
        return "Transaction signature invalid. Please try again";
    }

    // Network errors
    if (message.includes("Failed to fetch") || message.includes("NetworkError") || message.includes("Network request failed")) {
        return "Network error. Please check your connection";
    }

    // Anchor program errors (already handled by normalizeAnchorErrorMessage)
    if (message.includes("Anchor error")) {
        return normalizeAnchorErrorMessage(error);
    }

    // Generic fallback
    return sanitizeErrorMessage(error);
}

/**
 * Handle Solana transaction errors with user-friendly toast
 * 
 * @param error - The error from Solana transaction
 * @param context - Optional context (e.g., "Place bet", "Create market")
 */
export function handleSolanaError(error: unknown, context?: string) {
    const message = mapSolanaError(error);
    const prefix = context ? `${context}: ` : "";
    toast.error(prefix + message);

    // Log full error for debugging
    console.error("[Solana Error]", { context, error });
}
