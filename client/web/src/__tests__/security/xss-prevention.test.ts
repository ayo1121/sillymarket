/**
 * SECURITY TESTS: Frontend XSS Prevention and Input Validation
 * 
 * These tests verify that the frontend properly handles malicious input
 * and prevents XSS attacks through various vectors.
 */

import { describe, it, expect } from 'vitest';
import { isValidImageUrl, sanitizeImageUrl, isValidExternalLink, sanitizeTextContent } from '@/lib/urlValidation';
import { sanitizeSvg } from '@/lib/sanitize';

describe('URL Validation Security', () => {
    describe('isValidImageUrl', () => {
        it('should accept valid HTTP URLs', () => {
            expect(isValidImageUrl('http://example.com/image.png')).toBe(true);
            expect(isValidImageUrl('https://example.com/image.jpg')).toBe(true);
        });

        it('should accept valid HTTPS URLs', () => {
            expect(isValidImageUrl('https://cdn.example.com/images/photo.webp')).toBe(true);
        });

        it('should reject javascript: protocol', () => {
            expect(isValidImageUrl('javascript:alert(1)')).toBe(false);
            expect(isValidImageUrl('JavaScript:alert(1)')).toBe(false);
        });

        it('should reject data: URLs with HTML', () => {
            expect(isValidImageUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
        });

        it('should reject vbscript: protocol', () => {
            expect(isValidImageUrl('vbscript:msgbox(1)')).toBe(false);
        });

        it('should reject URLs with script tags', () => {
            expect(isValidImageUrl('https://example.com/<script>alert(1)</script>')).toBe(false);
        });

        it('should reject URLs with event handlers', () => {
            expect(isValidImageUrl('https://example.com/image.png?onerror=alert(1)')).toBe(false);
            expect(isValidImageUrl('https://example.com/image.png?onload=alert(1)')).toBe(false);
        });

        it('should reject null and undefined', () => {
            expect(isValidImageUrl(null)).toBe(false);
            expect(isValidImageUrl(undefined)).toBe(false);
        });

        it('should reject empty strings', () => {
            expect(isValidImageUrl('')).toBe(false);
            expect(isValidImageUrl('   ')).toBe(false);
        });

        it('should reject malformed URLs', () => {
            expect(isValidImageUrl('not a url')).toBe(false);
            expect(isValidImageUrl('htp://broken')).toBe(false);
        });

        it('should reject overly long URLs', () => {
            const longUrl = 'https://example.com/' + 'a'.repeat(3000);
            expect(isValidImageUrl(longUrl)).toBe(false);
        });
    });

    describe('sanitizeImageUrl', () => {
        it('should return valid URLs unchanged', () => {
            const url = 'https://example.com/image.png';
            expect(sanitizeImageUrl(url)).toBe(url);
        });

        it('should trim whitespace', () => {
            expect(sanitizeImageUrl('  https://example.com/image.png  ')).toBe('https://example.com/image.png');
        });

        it('should return null for invalid URLs', () => {
            expect(sanitizeImageUrl('javascript:alert(1)')).toBe(null);
            expect(sanitizeImageUrl(null)).toBe(null);
            expect(sanitizeImageUrl(undefined)).toBe(null);
        });
    });

    describe('isValidExternalLink', () => {
        it('should accept valid HTTP/HTTPS URLs', () => {
            expect(isValidExternalLink('https://example.com')).toBe(true);
            expect(isValidExternalLink('http://example.com')).toBe(true);
        });

        it('should accept relative URLs', () => {
            expect(isValidExternalLink('/markets')).toBe(true);
            expect(isValidExternalLink('/profile/abc123')).toBe(true);
        });

        it('should accept hash links', () => {
            expect(isValidExternalLink('#section')).toBe(true);
        });

        it('should reject javascript: protocol', () => {
            expect(isValidExternalLink('javascript:alert(1)')).toBe(false);
        });

        it('should reject data: URLs with HTML', () => {
            expect(isValidExternalLink('data:text/html,<script>alert(1)</script>')).toBe(false);
        });
    });

    describe('sanitizeTextContent', () => {
        it('should remove HTML tags but preserve text content', () => {
            // Note: sanitizeTextContent removes tags but keeps text inside them
            // This is correct behavior - React will escape the text when rendering
            expect(sanitizeTextContent('<script>alert(1)</script>Hello')).toBe('alert(1)Hello');
            expect(sanitizeTextContent('<b>Bold</b> text')).toBe('Bold text');
            expect(sanitizeTextContent('<img src=x onerror=alert(1)>')).toBe('');
        });

        it('should remove null bytes', () => {
            expect(sanitizeTextContent('Hello\0World')).toBe('HelloWorld');
        });

        it('should handle null and undefined', () => {
            expect(sanitizeTextContent(null)).toBe('');
            expect(sanitizeTextContent(undefined)).toBe('');
        });

        it('should preserve safe text', () => {
            expect(sanitizeTextContent('This is safe text')).toBe('This is safe text');
            expect(sanitizeTextContent('Numbers 123 and symbols !@#')).toBe('Numbers 123 and symbols !@#');
        });
    });
});

describe('SVG Sanitization', () => {
    describe('sanitizeSvg', () => {
        it('should remove script tags', () => {
            const malicious = '<svg><script>alert(1)</script></svg>';
            const sanitized = sanitizeSvg(malicious);
            expect(sanitized).not.toContain('<script');
            expect(sanitized).not.toContain('alert');
        });

        it('should remove event handlers', () => {
            const malicious = '<svg onload="alert(1)"><circle onclick="alert(2)" /></svg>';
            const sanitized = sanitizeSvg(malicious);
            expect(sanitized).not.toContain('onload');
            expect(sanitized).not.toContain('onclick');
        });

        it('should remove javascript: protocol', () => {
            const malicious = '<a href="javascript:alert(1)">Click</a>';
            const sanitized = sanitizeSvg(malicious);
            expect(sanitized.toLowerCase()).not.toContain('javascript:');
        });

        it('should handle null and undefined', () => {
            expect(sanitizeSvg(null as any)).toBe('');
            expect(sanitizeSvg(undefined as any)).toBe('');
        });

        it('should preserve safe SVG', () => {
            const safe = '<svg><circle cx="50" cy="50" r="40" /></svg>';
            const sanitized = sanitizeSvg(safe);
            expect(sanitized).toContain('circle');
            expect(sanitized).toContain('cx="50"');
        });
    });
});

describe('XSS Prevention in User Content', () => {
    it('should safely render market descriptions as plain text', () => {
        // This is a conceptual test - in practice, React automatically escapes text
        const maliciousDescription = '<script>alert("XSS")</script>Market description';

        // When rendered as {description}, React escapes it automatically
        // We verify our sanitization layer removes tags (but keeps text content)
        const sanitized = sanitizeTextContent(maliciousDescription);
        expect(sanitized).not.toContain('<script');
        // Note: sanitizeTextContent removes tags but keeps text - React will escape when rendering
        expect(sanitized).toBe('alert("XSS")Market description');
    });

    it('should safely render comment text as plain text', () => {
        const maliciousComment = '<img src=x onerror=alert(1)>Nice market!';
        const sanitized = sanitizeTextContent(maliciousComment);
        expect(sanitized).not.toContain('<img');
        expect(sanitized).not.toContain('onerror');
        expect(sanitized).toBe('Nice market!');
    });

    it('should safely render usernames as plain text', () => {
        const maliciousUsername = '<svg/onload=alert(1)>';
        const sanitized = sanitizeTextContent(maliciousUsername);
        expect(sanitized).not.toContain('<svg');
        expect(sanitized).not.toContain('onload');
    });
});

describe('Supabase Data Handling', () => {
    it('should handle null/undefined values from Supabase gracefully', () => {
        // Simulate Supabase returning null values
        const market = {
            description: null,
            image_url: undefined,
            creator_name: null,
        };

        expect(sanitizeTextContent(market.description)).toBe('');
        expect(sanitizeImageUrl(market.image_url)).toBe(null);
        expect(sanitizeTextContent(market.creator_name)).toBe('');
    });

    it('should handle unexpected data types from Supabase', () => {
        // Simulate Supabase returning unexpected types
        const invalidData = {
            description: 123 as any,
            image_url: {} as any,
            creator_name: [] as any,
        };

        expect(sanitizeTextContent(invalidData.description)).toBe('');
        expect(sanitizeImageUrl(invalidData.image_url)).toBe(null);
        expect(sanitizeTextContent(invalidData.creator_name)).toBe('');
    });
});
