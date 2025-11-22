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
 * Sanitize error messages for user display
 * 
 * Removes sensitive information (stack traces, internal paths, etc.)
 * while preserving useful context for known error types.
 * 
 * @param error - Any error object (Error, string, or unknown)
 * @returns Safe error message suitable for display to users
 */
export function sanitizeErrorMessage(error: any): string {
    if (!error) {
        return "An unknown error occurred";
    }

    // Extract raw message from various error formats
    let rawMessage: string;
    if (typeof error === "string") {
        rawMessage = error;
    } else if (error?.message) {
        rawMessage = error.message;
    } else if (error?.toString) {
        rawMessage = error.toString();
    } else {
        rawMessage = "Unknown error";
    }

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
export function showErrorToast(error: any, fallbackMessage?: string) {
    const sanitized = sanitizeErrorMessage(error);
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
