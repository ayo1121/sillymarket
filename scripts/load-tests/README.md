# Load Tests

This directory contains load testing scripts using [k6](https://k6.io/).

## Prerequisites

1.  **Install k6**:
    *   **Linux (Debian/Ubuntu)**:
        ```bash
        sudo gpg -k
        sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
        echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
        sudo apt-get update
        sudo apt-get install k6
        ```
    *   **macOS**: `brew install k6`
    *   **Windows**: `winget install k6`

## Running Tests

Set the `BASE_URL` environment variable to point to your target environment (default is `http://localhost:8787`).

### 1. Authentication Stress Test
Tests the SIWS (Sign-In With Solana) endpoints (`/auth/siws/start` and `/auth/siws/finish`).
*   **Goal**: Verify rate limiting and database write performance for nonces.
*   **Command**:
    ```bash
    k6 run auth_stress.js
    # Or against production/staging:
    # k6 run -e BASE_URL=https://your-api.railway.app auth_stress.js
    ```

### 2. Comments Stress Test
Tests the `/comments` POST endpoint.
*   **Goal**: Verify rate limiting (5 requests/min) works as expected under load.
*   **Command**:
    ```bash
    k6 run comments_stress.js
    ```

### 3. Read-Only Traffic
Tests GET endpoints (`/health`, `/comments`, `/me`).
*   **Goal**: Verify general API responsiveness and database read performance.
*   **Command**:
    ```bash
    k6 run read_only_traffic.js
    ```

## Interpreting Results

*   **http_req_duration**: Look at `p(95)` (95th percentile). It should generally be under 500ms.
*   **http_req_failed**:
    *   For `read_only_traffic.js`, this should be near 0%.
    *   For `auth_stress.js` and `comments_stress.js`, a non-zero failure rate is **expected** due to rate limiting (HTTP 429).
