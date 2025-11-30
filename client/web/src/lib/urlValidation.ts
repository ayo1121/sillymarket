/**
 * SECURITY: URL validation to prevent XSS via malicious URLs
 * 
 * This validates user-provided URLs (e.g., image URLs from Supabase) to ensure:
 * - Only http/https protocols (no javascript:, data:, etc.)
 * - Valid URL format
 * - No obvious XSS attempts
 */

const ALLOWED_PROTOCOLS = ['http:', 'https:'];
const MAX_URL_LENGTH = 2048; // Standard max URL length

export function isValidImageUrl(url: string | null | undefined): boolean {
    if (!url || typeof url !== 'string') {
        return false;
    }

    // Check length
    if (url.length > MAX_URL_LENGTH) {
        console.warn('[Security] URL exceeds maximum length:', url.substring(0, 100));
        return false;
    }

    // Trim whitespace
    const trimmedUrl = url.trim();
    if (trimmedUrl.length === 0) {
        return false;
    }

    // Try to parse as URL
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(trimmedUrl);
    } catch (e) {
        console.warn('[Security] Invalid URL format:', trimmedUrl.substring(0, 100));
        return false;
    }

    // Check protocol
    if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
        console.warn('[Security] Disallowed protocol:', parsedUrl.protocol);
        return false;
    }

    // Check for obvious XSS attempts in URL
    const lowerUrl = trimmedUrl.toLowerCase();
    const suspiciousPatterns = [
        'javascript:',
        'data:text/html',
        'vbscript:',
        '<script',
        'onerror=',
        'onload=',
    ];

    for (const pattern of suspiciousPatterns) {
        if (lowerUrl.includes(pattern)) {
            console.warn('[Security] Suspicious pattern detected in URL:', pattern);
            return false;
        }
    }

    return true;
}

/**
 * Sanitize and validate an image URL before using it in <img> tags
 * Returns null if URL is invalid or suspicious
 */
export function sanitizeImageUrl(url: string | null | undefined): string | null {
    if (!isValidImageUrl(url)) {
        return null;
    }
    return url!.trim();
}

/**
 * Validate external link URLs (for <a> tags)
 * More permissive than image URLs (allows mailto:, tel:, etc.)
 */
export function isValidExternalLink(url: string | null | undefined): boolean {
    if (!url || typeof url !== 'string') {
        return false;
    }

    const trimmedUrl = url.trim();
    if (trimmedUrl.length === 0 || trimmedUrl.length > MAX_URL_LENGTH) {
        return false;
    }

    // Allow relative URLs
    if (trimmedUrl.startsWith('/')) {
        return true;
    }

    // Allow hash links
    if (trimmedUrl.startsWith('#')) {
        return true;
    }

    // Check for dangerous protocols
    const lowerUrl = trimmedUrl.toLowerCase();
    const dangerousProtocols = [
        'javascript:',
        'data:text/html',
        'vbscript:',
    ];

    for (const protocol of dangerousProtocols) {
        if (lowerUrl.startsWith(protocol)) {
            console.warn('[Security] Dangerous protocol in link:', protocol);
            return false;
        }
    }

    // Try to parse as URL for absolute URLs
    if (trimmedUrl.includes('://')) {
        try {
            new URL(trimmedUrl);
        } catch (e) {
            console.warn('[Security] Invalid absolute URL:', trimmedUrl.substring(0, 100));
            return false;
        }
    }

    return true;
}

/**
 * Sanitize user-generated text content
 * Removes any HTML tags and dangerous characters
 */
export function sanitizeTextContent(text: string | null | undefined): string {
    if (!text || typeof text !== 'string') {
        return '';
    }

    // Remove HTML tags
    let sanitized = text.replace(/<[^>]*>/g, '');

    // Remove null bytes
    sanitized = sanitized.replace(/\0/g, '');

    return sanitized.trim();
}
