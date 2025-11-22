/**
 * SECURITY: SVG/HTML sanitizer to prevent XSS attacks
 * 
 * This is a conservative sanitizer that removes potentially dangerous content:
 * - <script> tags
 * - Event handler attributes (onclick, onload, etc.)
 * - javascript: protocol URLs
 * 
 * Use this before injecting any user-controlled HTML with dangerouslySetInnerHTML.
 */
export function sanitizeSvg(html: string): string {
    if (!html || typeof html !== 'string') {
        return '';
    }

    return html
        // Remove <script> tags and their content
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
        // Remove event handler attributes (onclick, onload, onerror, etc.)
        .replace(/\son\w+="[^"]*"/gi, '')
        .replace(/\son\w+='[^']*'/gi, '')
        // Remove javascript: protocol
        .replace(/javascript:/gi, '');
}
