import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8787';

export const options = {
    stages: [
        { duration: '30s', target: 10 }, // Ramp up to 10 users
        { duration: '1m', target: 10 },  // Stay at 10 users
        { duration: '30s', target: 0 },  // Ramp down
    ],
    thresholds: {
        http_req_duration: ['p(95)<200'],
        // We expect many 429s because the limit is low (5/min), so we don't fail on high error rate
    },
};

export default function () {
    // POST /comments
    // This endpoint is rate limited (5 per minute).
    // We are testing unauthenticated requests first (should be 401).
    // The rate limiter runs BEFORE auth check in the code provided? 
    // app.post("/comments", commentLimiter, async (req, res) => ...)
    // Yes, middleware order: commentLimiter -> handler.
    // So even unauthenticated requests should trigger the rate limiter if sent from same IP.
    // Note: k6 VUs might share IP depending on execution environment, usually yes on local.

    const payload = JSON.stringify({
        marketId: 'test-market',
        commentText: 'This is a load test comment ' + randomString(10),
    });

    const params = {
        headers: {
            'Content-Type': 'application/json',
        },
    };

    const res = http.post(`${BASE_URL}/comments`, payload, params);

    check(res, {
        'status is 401 (unauth) or 429 (rate limit)': (r) => r.status === 401 || r.status === 429,
    });

    sleep(1);
}
