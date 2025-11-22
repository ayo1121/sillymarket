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
