/**
 * Centralized API Client
 * 
 * Provides type-safe HTTP client with consistent error handling,
 * automatic credential inclusion, and error sanitization.
 */

import { API_URL } from "./config";
import { sanitizeErrorMessage } from "./errorHandling";

/**
 * Custom API Error class
 * Extends Error with HTTP status and response data
 */
export class APIError extends Error {
    constructor(
        message: string,
        public status: number,
        public data?: any
    ) {
        super(message);
        this.name = "APIError";
    }
}

/**
 * API request options
 */
export interface APIOptions extends RequestInit {
    /** If true, don't throw on non-2xx status codes */
    noThrow?: boolean;
    /** If true, don't include credentials (cookies) */
    noCredentials?: boolean;
}

/**
 * Safe API client with consistent error handling
 * 
 * Features:
 * - Automatic credential inclusion (cookies)
 * - Consistent error handling and sanitization
 * - Type-safe responses
 * - Automatic JSON parsing
 * 
 * @param endpoint - API endpoint (relative or absolute URL)
 * @param options - Request options
 * @returns Parsed JSON response
 * @throws APIError on non-2xx responses (unless noThrow is true)
 */
export async function apiClient<T = any>(
    endpoint: string,
    options: APIOptions = {}
): Promise<T> {
    const { noThrow, noCredentials, ...fetchOptions } = options;

    // Build full URL
    const url = endpoint.startsWith("http") ? endpoint : `${API_URL}${endpoint}`;

    // Build request config
    const config: RequestInit = {
        ...fetchOptions,
        credentials: noCredentials ? "omit" : "include",
        headers: {
            "Content-Type": "application/json",
            ...fetchOptions.headers,
        },
    };

    try {
        const response = await fetch(url, config);

        // Handle non-2xx responses
        if (!response.ok) {
            let errorData: any;
            try {
                errorData = await response.json();
            } catch {
                errorData = { error: response.statusText };
            }

            const errorMessage = errorData?.error || `HTTP ${response.status}`;

            if (noThrow) {
                return { error: errorMessage, status: response.status } as any;
            }

            throw new APIError(
                sanitizeErrorMessage({ message: errorMessage }),
                response.status,
                errorData
            );
        }

        // Parse JSON response
        const data = await response.json();
        return data as T;
    } catch (error: any) {
        // Network errors, parse errors, etc.
        if (error instanceof APIError) {
            throw error;
        }

        // Wrap other errors
        throw new APIError(
            sanitizeErrorMessage(error),
            0,
            { originalError: error }
        );
    }
}

/**
 * Convenience methods for common HTTP verbs
 */
export const api = {
    /**
     * GET request
     */
    get: <T = any>(endpoint: string, options?: APIOptions) =>
        apiClient<T>(endpoint, { ...options, method: "GET" }),

    /**
     * POST request
     */
    post: <T = any>(endpoint: string, body?: any, options?: APIOptions) =>
        apiClient<T>(endpoint, {
            ...options,
            method: "POST",
            body: body ? JSON.stringify(body) : undefined,
        }),

    /**
     * PUT request
     */
    put: <T = any>(endpoint: string, body?: any, options?: APIOptions) =>
        apiClient<T>(endpoint, {
            ...options,
            method: "PUT",
            body: body ? JSON.stringify(body) : undefined,
        }),

    /**
     * DELETE request
     */
    delete: <T = any>(endpoint: string, options?: APIOptions) =>
        apiClient<T>(endpoint, { ...options, method: "DELETE" }),
};
