# Manual DAST Playbook

This document outlines a manual Dynamic Application Security Testing (DAST) plan for the YesNo Markets backend API. Use tools like **OWASP ZAP**, **Burp Suite**, or **Postman** to execute these tests.

**Target Base URL**: `http://localhost:8787` (Local) or your deployed URL.

---

## 1. Authentication & Session Management

### AUTH-01: Session Cookie Tampering
*   **Description**: Verify that the server correctly rejects invalid or tampered session cookies.
*   **Tool**: Browser DevTools / Postman / Burp Repeater
*   **Endpoint**: `GET /me`
*   **Steps**:
    1.  Log in normally to get a valid `sid` cookie.
    2.  Send a request to `/me` with the valid cookie. Confirm 200 OK and user data.
    3.  Modify the `sid` cookie value (e.g., change the last character).
    4.  Send the request again.
*   **Expected Result**: Server returns `200 OK` with `user: null` (guest state) or `401 Unauthorized`. It must **not** return 500 error or crash.

### AUTH-02: SIWS Replay Attack
*   **Description**: Ensure that a valid signature and nonce cannot be reused to authenticate a second time.
*   **Tool**: Burp Repeater / Postman
*   **Endpoint**: `POST /auth/siws/finish`
*   **Steps**:
    1.  Perform a full SIWS flow: `/auth/siws/start` -> Sign -> `/auth/siws/finish`.
    2.  Capture the payload of the successful `/auth/siws/finish` request.
    3.  Send the exact same request payload again.
*   **Expected Result**: `400 Bad Request` with error "Nonce not found" or "Nonce expired". The nonce should be consumed upon first use.

### AUTH-03: Logout Invalidation
*   **Description**: Verify that logging out effectively invalidates the session on the client side (cookie clearing).
*   **Tool**: Browser / Postman
*   **Endpoint**: `POST /auth/logout`
*   **Steps**:
    1.  Log in and confirm `sid` cookie exists.
    2.  Call `POST /auth/logout`.
    3.  Check the response headers.
*   **Expected Result**: Response contains `Set-Cookie` header that clears `sid` (e.g., `Max-Age=0` or `Expires` in the past).

---

## 2. Input Validation

### INP-01: SQL Injection (Market ID)
*   **Description**: Test for SQL injection vulnerabilities in the `marketId` query parameter.
*   **Tool**: OWASP ZAP / Burp Scanner / Manual
*   **Endpoint**: `GET /comments`
*   **Steps**:
    1.  Send `GET /comments?marketId=' OR 1=1 --`
    2.  Send `GET /comments?marketId='; DROP TABLE users; --`
*   **Expected Result**: `200 OK` with empty list or `400/500` error, but **no** data leakage and **no** successful SQL execution. The application uses parameterized queries, so this should be safe.

### INP-02: Stored XSS (Comments)
*   **Description**: Attempt to inject malicious scripts into comments.
*   **Tool**: Browser / Postman
*   **Endpoint**: `POST /comments`
*   **Steps**:
    1.  Log in.
    2.  Post a comment with payload: `<script>alert('XSS')</script>` or `<img src=x onerror=alert(1)>`.
    3.  Call `GET /comments` to retrieve it.
    4.  Check if the payload is returned raw or escaped.
*   **Expected Result**: The payload should be stored, but the **Frontend** must render it safely (escaped). The API itself usually stores raw text. Verify the Content-Type header is `application/json`.

### INP-03: Long Input Denial of Service
*   **Description**: Send excessively long strings to test buffer handling and database limits.
*   **Tool**: Burp Intruder / Python Script
*   **Endpoint**: `POST /comments`
*   **Steps**:
    1.  Log in.
    2.  Send a comment with 10,000 characters.
    3.  Send a `marketId` with 10,000 characters.
*   **Expected Result**: `400 Bad Request` or `413 Payload Too Large`. The server should reject it quickly without crashing.

---

## 3. Authorization / Access Control

### AUTHZ-01: Unauthenticated State Changes
*   **Description**: Attempt to perform privileged actions without logging in.
*   **Tool**: Postman / Curl
*   **Endpoint**: `POST /comments`, `POST /user/username`
*   **Steps**:
    1.  Ensure no `sid` cookie is sent.
    2.  Send a valid POST request to `/comments`.
    3.  Send a valid POST request to `/user/username`.
*   **Expected Result**: `401 Unauthorized`.

### AUTHZ-02: Horizontal Privilege Escalation (Username)
*   **Description**: Attempt to change another user's username.
*   **Tool**: Burp Repeater
*   **Endpoint**: `POST /user/username`
*   **Steps**:
    1.  Log in as User A.
    2.  Intercept the request to change username.
    3.  Try to inject a `userId` or `id` field into the JSON body to target User B (if you know their UUID).
    4.  Example Body: `{"username": "hacked", "userId": "target-uuid"}`.
*   **Expected Result**: The server should ignore the injected `userId` and only update the user associated with the session cookie.

---

## 4. Error Handling & Info Leakage

### ERR-01: Malformed JSON
*   **Description**: Check if the server leaks stack traces on parsing errors.
*   **Tool**: Postman / Curl
*   **Endpoint**: `POST /auth/siws/start`
*   **Steps**:
    1.  Send a POST request with `Content-Type: application/json`.
    2.  Body: `{"pubkey": "broken-json...` (invalid syntax).
*   **Expected Result**: `400 Bad Request` (likely from Express body-parser). Response should **not** contain a stack trace or internal file paths.

### ERR-02: Invalid HTTP Methods
*   **Description**: Check response for unsupported methods.
*   **Tool**: Curl
*   **Endpoint**: `GET /auth/siws/start` (Endpoint only supports POST)
*   **Steps**:
    1.  Send `GET` request to `/auth/siws/start`.
    2.  Send `PUT` request to `/comments`.
*   **Expected Result**: `404 Not Found` (Express default) or `405 Method Not Allowed`.

---

## 5. Rate Limiting & DoS

### DOS-01: Auth Endpoint Flooding
*   **Description**: Verify rate limits on authentication endpoints.
*   **Tool**: Burp Intruder / OWASP ZAP / k6
*   **Endpoint**: `POST /auth/siws/start`
*   **Steps**:
    1.  Send 20 requests in rapid succession (e.g., within 10 seconds) from the same IP.
*   **Expected Result**: After ~10 requests (configured limit), the server should respond with `429 Too Many Requests`.

### DOS-02: Comment Flooding
*   **Description**: Verify rate limits on comment posting.
*   **Tool**: Burp Intruder
*   **Endpoint**: `POST /comments`
*   **Steps**:
    1.  Log in.
    2.  Send 10 comments in rapid succession.
*   **Expected Result**: After 5 requests (configured limit), the server should respond with `429 Too Many Requests`.

---

## 6. CORS & CSRF

### CORS-01: Origin Reflection
*   **Description**: Verify that the server does not blindly reflect the Origin header.
*   **Tool**: Curl
*   **Endpoint**: `GET /health`
*   **Steps**:
    1.  `curl -H "Origin: http://evil.com" -v http://localhost:8787/health`
*   **Expected Result**: The response should **not** have `Access-Control-Allow-Origin: http://evil.com`. It should either be missing or match the configured allowed origin (e.g., `http://localhost:8080`).

### CSRF-01: SameSite Cookie Attribute
*   **Description**: Verify session cookies are protected against CSRF.
*   **Tool**: Browser DevTools
*   **Endpoint**: `POST /auth/siws/finish`
*   **Steps**:
    1.  Log in.
    2.  Inspect the `sid` cookie attributes.
*   **Expected Result**: `SameSite` should be `Lax` (dev) or `None` + `Secure` (prod). `HttpOnly` must be true.
