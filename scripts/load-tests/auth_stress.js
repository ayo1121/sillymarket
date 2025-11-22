import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8787';

export const options = {
    stages: [
        { duration: '30s', target: 20 }, // Ramp up to 20 users
        { duration: '1m', target: 20 },  // Stay at 20 users
        { duration: '30s', target: 50 }, // Spike to 50 users
        { duration: '1m', target: 50 },  // Stay at 50 users
        { duration: '30s', target: 0 },  // Ramp down
    ],
    thresholds: {
        http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
        http_req_failed: ['rate<0.1'],    // Error rate should be less than 10% (allowing for some rate limiting)
    },
};

export default function () {
    // 1. Start SIWS (POST /auth/siws/start)
    // We need a valid-looking pubkey (base58). 
    // Since we can't easily generate real ones, we'll use a fixed one or random string 
    // that passes the regex if possible, or just test the validation failure.
    // The server checks for 44 chars base58.

    // Generating a fake base58 string of length 44
    const fakePubkey = '1' + randomString(43, '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz');

    const startPayload = JSON.stringify({
        pubkey: fakePubkey,
    });

    const params = {
        headers: {
            'Content-Type': 'application/json',
        },
    };

    const startRes = http.post(`${BASE_URL}/auth/siws/start`, startPayload, params);

    check(startRes, {
        'start status is 200 or 429': (r) => r.status === 200 || r.status === 429,
        'start response has nonce': (r) => r.status === 200 ? r.json('nonce') !== undefined : true,
    });

    // If we got a nonce, try to finish (POST /auth/siws/finish)
    // We can't sign it properly without a private key, so we expect 400 (Invalid signature)
    // This still tests the endpoint's load handling and rate limiting.
    if (startRes.status === 200) {
        const nonce = startRes.json('nonce');

        // Fake signature (base58, 87-88 chars)
        const fakeSignature = randomString(88, '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz');

        const finishPayload = JSON.stringify({
            pubkey: fakePubkey,
            nonce: nonce,
            signatureBase58: fakeSignature,
        });

        const finishRes = http.post(`${BASE_URL}/auth/siws/finish`, finishPayload, params);

        check(finishRes, {
            'finish status is 400 (invalid sig) or 429': (r) => r.status === 400 || r.status === 429,
        });
    }

    sleep(1);
}
