import request from 'supertest';
import fc from 'fast-check';
import app from '../src/app'; // Assuming app is exported from src/app.ts or src/index.ts
import { describe, it, expect } from '@jest/globals';

// Mock app if not directly exportable, but usually for integration tests we import the app
// If app is not exported, we might need to start the server or refactor index.ts
// For now, assuming standard Express app export pattern.

describe('API Fuzz Testing', () => {

    // Fuzzing /auth/siws/start
    it('should handle random inputs to /auth/siws/start gracefully', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string(), // Random pubkey string
                async (pubkey) => {
                    const res = await request(app)
                        .post('/auth/siws/start')
                        .send({ pubkey });

                    // Invariant: Should never 500
                    expect(res.status).not.toBe(500);

                    // If valid base58 (rare in random string), might be 200, otherwise 400
                    if (res.status === 200) {
                        expect(res.body).toHaveProperty('message');
                    }
                }
            ),
            { numRuns: 50 } // Run 50 random variations
        );
    });

    // Fuzzing /comments
    it('should handle random comment inputs gracefully', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string(), // Random market ID
                fc.string(), // Random content
                async (marketId, content) => {
                    const res = await request(app)
                        .post('/comments')
                        .send({ marketId, content });

                    // Invariant: Should never 500
                    expect(res.status).not.toBe(500);

                    // Without auth token, should probably be 401, but might be 429 if rate limited
                    expect([401, 429]).toContain(res.status);
                }
            ),
            { numRuns: 50 }
        );
    });

    // Fuzzing /auth/siws/finish with random signatures
    it('should reject invalid signatures deterministically', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string(), // pubkey
                fc.string(), // message
                fc.string(), // signature
                async (pubkey, message, signature) => {
                    const res = await request(app)
                        .post('/auth/siws/finish')
                        .send({
                            pubkey,
                            message,
                            signature
                        });

                    expect(res.status).not.toBe(500);
                    // Almost certainly 400 or 401 for random strings
                    expect(res.status).toBeGreaterThanOrEqual(400);
                }
            ),
            { numRuns: 50 }
        );
    });
});
