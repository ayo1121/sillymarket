import http from 'k6/http';
import { check, sleep } from 'k6';

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8787';

export const options = {
    stages: [
        { duration: '30s', target: 50 }, // Ramp up to 50 users
        { duration: '2m', target: 50 },  // Sustained load
        { duration: '30s', target: 100 }, // Spike to 100
        { duration: '1m', target: 100 },
        { duration: '30s', target: 0 },
    ],
    thresholds: {
        http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
        http_req_failed: ['rate<0.01'],   // Error rate should be very low for GETs
    },
};

export default function () {
    // 1. GET /health
    const healthRes = http.get(`${BASE_URL}/health`);
    check(healthRes, {
        'health status is 200': (r) => r.status === 200,
    });

    // 2. GET /comments?marketId=...
    // We use a dummy market ID.
    const marketId = 'test-market-id';
    const commentsRes = http.get(`${BASE_URL}/comments?marketId=${marketId}`);

    check(commentsRes, {
        'comments status is 200': (r) => r.status === 200,
        'comments body has array': (r) => r.json('comments') !== undefined,
    });

    // 3. GET /me (should be null but 200)
    const meRes = http.get(`${BASE_URL}/me`);
    check(meRes, {
        'me status is 200': (r) => r.status === 200,
    });

    sleep(1);
}
