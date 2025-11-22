/**
 * Test helper utilities
 */

import jwt from 'jsonwebtoken';

/**
 * Create a valid test JWT token
 */
export function createTestJWT(payload: { id: string; pubkey: string }, secret?: string): string {
    const SESSION_SECRET = secret || process.env.SESSION_SECRET || 'dev-secret';
    return jwt.sign(payload, SESSION_SECRET, { algorithm: 'HS256', expiresIn: '1d' });
}

/**
 * Create an expired test JWT token
 */
export function createExpiredJWT(payload: { id: string; pubkey: string }, secret?: string): string {
    const SESSION_SECRET = secret || process.env.SESSION_SECRET || 'dev-secret';
    return jwt.sign(payload, SESSION_SECRET, { algorithm: 'HS256', expiresIn: '-1d' });
}

/**
 * Create a forged JWT token (wrong secret)
 */
export function createForgedJWT(payload: { id: string; pubkey: string }): string {
    return jwt.sign(payload, 'wrong-secret', { algorithm: 'HS256', expiresIn: '1d' });
}

/**
 * Generate test user data
 */
export function generateTestUser(index: number = 0) {
    return {
        id: `test-user-${index}`,
        pubkey: `test-pubkey-${index}`,
        username: `testuser${index}`,
    };
}

/**
 * Sleep utility for rate limit tests
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
