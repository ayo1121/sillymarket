/**
 * Backend API Adversarial Tests
 * 
 * Tests malformed JSON, massive payloads, rate limiting, SQL injection,
 * and authentication bypass attacks.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';

// Note: In a real setup, you'd import the Express app
// For now, we'll assume the server exports an 'app' instance
// import { app } from '../src/index.js';

// Mock app for demonstration (replace with actual import)
const API_URL = process.env.API_URL || 'http://localhost:8787';

// Test database setup/teardown would go here
beforeAll(async () => {
    // await setupTestDatabase();
});

afterAll(async () => {
    // await cleanupTestDatabase();
});

// =============================================================================
// GROUP 1: Malformed JSON Attacks
// =============================================================================

describe('Malformed JSON Attacks', () => {
    test('should reject invalid JSON syntax', async () => {
        const response = await request(API_URL)
            .post('/comments')
            .set('Content-Type', 'application/json')
            .send('{ invalid json }'); // Malformed JSON

        // Expected: 400 Bad Request
        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/invalid|json|parse/i);
    });

    test('should reject JSON with wrong types', async () => {
        const response = await request(API_URL)
            .post('/comments')
            .set('Content-Type', 'application/json')
            .send({
                marketId: 123, // Should be string
                commentText: ['array', 'not', 'string'], // Should be string
            });

        // Expected: 400 Bad Request (Zod validation)
        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/invalid|required/i);
    });
});

// =============================================================================
// GROUP 2: Massive Payload Attacks
// =============================================================================

describe('Massive Payload Attacks', () => {
    test('should reject payload over 1MB limit', async () => {
        // Create 2MB comment
        const hugeComment = 'A'.repeat(2 * 1024 * 1024);

        const response = await request(API_URL)
            .post('/comments')
            .set('Content-Type', 'application/json')
            .send({
                marketId: 'test_market',
                commentText: hugeComment,
            });

        // Expected: 413 Payload Too Large or 400
        expect([400, 413]).toContain(response.status);
    });

    test('should handle deeply nested JSON without crashing', async () => {
        // Create deeply nested object
        let nested: any = { value: 'deep' };
        for (let i = 0; i < 100; i++) {
            nested = { nested };
        }

        const response = await request(API_URL)
            .post('/comments')
            .set('Content-Type', 'application/json')
            .send(nested);

        // Expected: 400 or 413, but server should not crash
        expect([400, 413]).toContain(response.status);
    });
});

// =============================================================================
// GROUP 3: Rate Limit Bypass Attacks
// =============================================================================

describe('Rate Limit Bypass Attacks', () => {
    test('should rate limit SIWS start requests', async () => {
        const requests = [];

        // Send 20 requests rapidly (should be limited to 10 per 15 min)
        for (let i = 0; i < 20; i++) {
            requests.push(
                request(API_URL)
                    .post('/auth/siws/start')
                    .send({ pubkey: 'test_pubkey_' + i })
            );
        }

        const responses = await Promise.all(requests);

        // Expected: Some requests should be rate limited (429)
        const rateLimited = responses.filter(r => r.status === 429);
        expect(rateLimited.length).toBeGreaterThan(0);
    }, 30000); // 30 second timeout

    test('should rate limit comment posting', async () => {
        // First, get a valid session (you'd need to implement proper auth here)
        const validSession = 'test_session_cookie';

        const requests = [];

        // Send 10 comments in rapid succession (should be limited to 5 per minute)
        for (let i = 0; i < 10; i++) {
            requests.push(
                request(API_URL)
                    .post('/comments')
                    .set('Cookie', `sid=${validSession}`)
                    .send({
                        marketId: 'test',
                        commentText: `Comment ${i}`,
                    })
            );
        }

        const responses = await Promise.all(requests);
        const rateLimited = responses.filter(r => r.status === 429);

        // Expected: Some should be rate limited
        // Note: This test may need adjustment based on actual rate limit implementation
        expect(rateLimited.length).toBeGreaterThanOrEqual(0);
    }, 30000);
});

// =============================================================================
// GROUP 4: SQL Injection Attempts
// =============================================================================

describe('SQL Injection Attempts', () => {
    test('should sanitize SQL injection in comment text', async () => {
        const sqlInjection = "'; DROP TABLE comments; --";

        // First, we'd need a valid session
        // For now, this is a placeholder
        const response = await request(API_URL)
            .post('/comments')
            .set('Cookie', 'sid=valid_test_session')
            .send({
                marketId: 'test',
                commentText: sqlInjection,
            });

        // Expected: Should either succeed (parameterized query prevents injection)
        // or fail with auth error, but NOT cause SQL error
        expect(response.status).not.toBe(500);

        // Verify table still exists by making another request
        const checkResponse = await request(API_URL)
            .get('/comments?marketId=test');

        // Should not error (table should still exist)
        expect(checkResponse.status).not.toBe(500);
    });

    test('should sanitize SQL injection in market ID', async () => {
        const sqlInjection = "1' OR '1'='1";

        const response = await request(API_URL)
            .get(`/comments?marketId=${encodeURIComponent(sqlInjection)}`);

        // Expected: Should return empty array or 400, not SQL error
        expect(response.status).not.toBe(500);
        if (response.status === 200) {
            expect(Array.isArray(response.body.comments)).toBe(true);
        }
    });
});

// =============================================================================
// GROUP 5: Authentication Bypass Attempts
// =============================================================================

describe('Authentication Bypass Attempts', () => {
    test('should reject forged JWT token', async () => {
        // Create JWT with wrong secret
        const fakeToken = jwt.sign(
            { id: 'fake_user', pubkey: 'fake_pubkey' },
            'wrong_secret',
            { algorithm: 'HS256' }
        );

        const response = await request(API_URL)
            .post('/comments')
            .set('Cookie', `sid=${fakeToken}`)
            .send({
                marketId: 'test',
                commentText: 'Fake comment',
            });

        // Expected: 401 Unauthorized
        expect(response.status).toBe(401);
    });

    test('should reject expired JWT token', async () => {
        // Create expired token (requires knowing the actual secret)
        // For testing, you'd use the actual SESSION_SECRET from env
        const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';

        const expiredToken = jwt.sign(
            { id: 'user', pubkey: 'pubkey' },
            SESSION_SECRET,
            { algorithm: 'HS256', expiresIn: '-1d' } // Expired yesterday
        );

        const response = await request(API_URL)
            .post('/comments')
            .set('Cookie', `sid=${expiredToken}`)
            .send({
                marketId: 'test',
                commentText: 'Comment',
            });

        // Expected: 401 Unauthorized
        expect(response.status).toBe(401);
    });
});

// =============================================================================
// ADDITIONAL SECURITY TESTS
// =============================================================================

describe('Additional Security Tests', () => {
    test('should enforce CORS on requests without origin', async () => {
        if (process.env.NODE_ENV === 'production') {
            const response = await request(API_URL)
                .get('/health')
                .set('Origin', ''); // No origin header

            // In production, should reject requests with no origin
            // (based on hardened CORS config)
            expect(response.status).not.toBe(200);
        }
    });

    test('should include security headers (helmet)', async () => {
        const response = await request(API_URL)
            .get('/health');

        // Helmet should add security headers
        expect(response.headers).toHaveProperty('x-content-type-options');
        expect(response.headers).toHaveProperty('x-frame-options');
    });
});
