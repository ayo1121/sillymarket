# Attack Simulation Test Suite Design

**Document Date:** 2025-11-22  
**Scope:** Smart contract, backend API, frontend flows  
**Purpose:** Adversarial testing to validate security controls

---

## Executive Summary

**Total Test Scenarios:** 25+  
**Smart Contract Tests:** 15  
**Backend API Tests:** 10  
**Coverage:** Market creation, betting, resolution, claims, API abuse, DoS

**Goal:** Simulate real-world attacks to verify that security controls work as designed.

---

## Part 1: Smart Contract Attack Scenarios

### Test Suite: `programs/yesno_markets/tests/adversarial.rs`

---

### Category 1: Market Creation Edge Cases

#### Test 1.1: Market with Extreme Cutoff Time

**Attacker Goal:** Create market with cutoff in the past or far future to manipulate betting windows

**Test Code:**
```rust
#[tokio::test]
async fn test_market_creation_past_cutoff() {
    let mut context = setup_test_context().await;
    
    // Attempt to create market with cutoff in the past
    let past_cutoff = Clock::get().unwrap().unix_timestamp - 3600; // 1 hour ago
    
    let result = create_market(
        &mut context,
        "Will this work?",
        vec!["Yes", "No"],
        past_cutoff,
        None,
    ).await;
    
    // Expected: Should fail with BadParam error
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().to_string(),
        "BadParam" // Or specific error code
    );
}

#[tokio::test]
async fn test_market_creation_far_future_cutoff() {
    let mut context = setup_test_context().await;
    
    // Attempt to create market with cutoff 100 years in future
    let far_future = Clock::get().unwrap().unix_timestamp + (100 * 365 * 24 * 3600);
    
    let result = create_market(
        &mut context,
        "Will this work?",
        vec!["Yes", "No"],
        far_future,
        None,
    ).await;
    
    // Expected: Should succeed (no max cutoff limit in current code)
    // OR: Should fail if max cutoff is added
    // Document current behavior
    assert!(result.is_ok());
}
```

**Expected Protection:**
- ✅ Past cutoff: Should fail with `BadParam` error
- ⚠️ Far future: Currently allowed, consider adding max cutoff (e.g., 1 year)

---

#### Test 1.2: Market with Zero or Max Outcomes

**Attacker Goal:** Create market with invalid number of outcomes

**Test Code:**
```rust
#[tokio::test]
async fn test_market_creation_zero_outcomes() {
    let mut context = setup_test_context().await;
    
    let result = create_market(
        &mut context,
        "Invalid market",
        vec![], // Zero outcomes
        future_timestamp(),
        None,
    ).await;
    
    // Expected: Should fail
    assert!(result.is_err());
}

#[tokio::test]
async fn test_market_creation_max_outcomes() {
    let mut context = setup_test_context().await;
    
    // MAX_ANSWERS is 5 in lib.rs
    let result = create_market(
        &mut context,
        "Max outcomes",
        vec!["A", "B", "C", "D", "E", "F"], // 6 outcomes (over limit)
        future_timestamp(),
        None,
    ).await;
    
    // Expected: Should fail with BadParam
    assert!(result.is_err());
}
```

**Expected Protection:**
- ✅ Zero outcomes: Validation should fail
- ✅ Over MAX_ANSWERS (5): Should fail with `BadParam`

---

#### Test 1.3: Market with Extreme Question Length

**Attacker Goal:** Create market with very long question to bloat storage

**Test Code:**
```rust
#[tokio::test]
async fn test_market_creation_long_question() {
    let mut context = setup_test_context().await;
    
    // Create 2KB question (way over 1024 limit)
    let long_question = "A".repeat(2048);
    
    let result = create_market(
        &mut context,
        &long_question,
        vec!["Yes", "No"],
        future_timestamp(),
        None,
    ).await;
    
    // Expected: Should fail (question_hash is 32 bytes, but question itself is passed)
    // Check if frontend/backend validates before on-chain call
    assert!(result.is_err());
}
```

**Expected Protection:**
- ✅ Frontend validates max 1024 chars (CreateMarket.tsx:132)
- ⚠️ On-chain: Uses hash, but should validate question length if stored

---

### Category 2: Betting Timing Attacks

#### Test 2.1: Bet Exactly at Cutoff Time

**Attacker Goal:** Place bet at exact cutoff timestamp to exploit race condition

**Test Code:**
```rust
#[tokio::test]
async fn test_bet_at_exact_cutoff() {
    let mut context = setup_test_context().await;
    
    let cutoff = Clock::get().unwrap().unix_timestamp + 60; // 1 minute from now
    let market = create_market(&mut context, "Test", vec!["Yes", "No"], cutoff, None).await.unwrap();
    
    // Warp clock to exact cutoff time
    context.warp_to_timestamp(cutoff).await.unwrap();
    
    let result = place_bet(
        &mut context,
        market,
        0, // outcome_index
        lamports(1.0),
    ).await;
    
    // Expected: Should fail (betting closed at cutoff)
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().to_string(), "BettingClosed");
}

#[tokio::test]
async fn test_bet_one_second_before_cutoff() {
    let mut context = setup_test_context().await;
    
    let cutoff = Clock::get().unwrap().unix_timestamp + 60;
    let market = create_market(&mut context, "Test", vec!["Yes", "No"], cutoff, None).await.unwrap();
    
    // Warp to 1 second before cutoff
    context.warp_to_timestamp(cutoff - 1).await.unwrap();
    
    let result = place_bet(&mut context, market, 0, lamports(1.0)).await;
    
    // Expected: Should succeed (still before cutoff)
    assert!(result.is_ok());
}
```

**Expected Protection:**
- ✅ `place_bet` checks `now >= market.cutoff_ts` → fails with `BettingClosed`
- ✅ Exact cutoff: Betting closed
- ✅ Before cutoff: Betting allowed

---

#### Test 2.2: Bet After Market Resolved

**Attacker Goal:** Place bet after market is resolved to exploit state

**Test Code:**
```rust
#[tokio::test]
async fn test_bet_after_resolution() {
    let mut context = setup_test_context().await;
    
    let market = create_market(&mut context, "Test", vec!["Yes", "No"], past_timestamp(), None).await.unwrap();
    
    // Resolve market
    resolve_market(&mut context, market, 0).await.unwrap();
    
    // Attempt to bet after resolution
    let result = place_bet(&mut context, market, 0, lamports(1.0)).await;
    
    // Expected: Should fail with InvalidState
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().to_string(), "InvalidState");
}
```

**Expected Protection:**
- ✅ `place_bet` checks `market.state == STATE_OPEN` → fails with `InvalidState`

---

### Category 3: Over-Betting / Limit Tests

#### Test 3.1: Bet Below Minimum

**Attacker Goal:** Place tiny bet to spam the system

**Test Code:**
```rust
#[tokio::test]
async fn test_bet_below_minimum() {
    let mut context = setup_test_context().await;
    
    let market = create_market(&mut context, "Test", vec!["Yes", "No"], future_timestamp(), None).await.unwrap();
    
    // Attempt to bet 0.001 SOL (below 0.01 SOL minimum)
    let result = place_bet(&mut context, market, 0, lamports(0.001)).await;
    
    // Expected: Should fail with BadParam
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().to_string(), "BadParam");
}
```

**Expected Protection:**
- ✅ `place_bet` checks `amount_lamports < config.min_bet_lamports` → fails with `BadParam`

---

#### Test 3.2: Bet Above Maximum

**Attacker Goal:** Place huge bet to manipulate odds or drain funds

**Test Code:**
```rust
#[tokio::test]
async fn test_bet_above_maximum() {
    let mut context = setup_test_context().await;
    
    let market = create_market(&mut context, "Test", vec!["Yes", "No"], future_timestamp(), None).await.unwrap();
    
    // Attempt to bet 1,000,000 SOL (above 100,000 SOL maximum)
    let result = place_bet(&mut context, market, 0, lamports(1_000_000.0)).await;
    
    // Expected: Should fail with BadParam
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().to_string(), "BadParam");
}
```

**Expected Protection:**
- ✅ `place_bet` checks `amount_lamports > config.max_bet_lamports` → fails with `BadParam`

---

#### Test 3.3: Integer Overflow Attack

**Attacker Goal:** Cause integer overflow in pool calculations

**Test Code:**
```rust
#[tokio::test]
async fn test_bet_integer_overflow() {
    let mut context = setup_test_context().await;
    
    let market = create_market(&mut context, "Test", vec!["Yes", "No"], future_timestamp(), None).await.unwrap();
    
    // Place max bet multiple times to try to overflow total_pool
    let max_bet = lamports(100_000.0);
    
    for _ in 0..1000 {
        let result = place_bet(&mut context, market, 0, max_bet).await;
        
        // Should either succeed or fail gracefully (no overflow)
        if result.is_err() {
            // If it fails, should be Overflow error, not panic
            assert_eq!(result.unwrap_err().to_string(), "Overflow");
            break;
        }
    }
}
```

**Expected Protection:**
- ✅ Uses `checked_add()` for all arithmetic → fails with `Overflow` instead of panicking

---

### Category 4: Double-Resolution Attacks

#### Test 4.1: Resolve Market Twice

**Attacker Goal:** Resolve market twice to manipulate outcome or drain fees

**Test Code:**
```rust
#[tokio::test]
async fn test_double_resolution() {
    let mut context = setup_test_context().await;
    
    let market = create_market(&mut context, "Test", vec!["Yes", "No"], past_timestamp(), None).await.unwrap();
    
    // First resolution
    resolve_market(&mut context, market, 0).await.unwrap();
    
    // Attempt second resolution
    let result = resolve_market(&mut context, market, 1).await;
    
    // Expected: Should fail with InvalidState
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().to_string(), "InvalidState");
}
```

**Expected Protection:**
- ✅ `resolve` checks `market.state == STATE_LOCKED` → fails with `InvalidState` if already resolved

---

#### Test 4.2: Resolve Before Cutoff (Non-Admin)

**Attacker Goal:** Resolve market early as non-admin

**Test Code:**
```rust
#[tokio::test]
async fn test_resolve_before_cutoff_non_admin() {
    let mut context = setup_test_context().await;
    
    let cutoff = Clock::get().unwrap().unix_timestamp + 3600; // 1 hour from now
    let market = create_market(&mut context, "Test", vec!["Yes", "No"], cutoff, None).await.unwrap();
    
    // Attempt to resolve before cutoff as market creator (not admin)
    let result = resolve_market(&mut context, market, 0).await;
    
    // Expected: Should fail with Unauthorized
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().to_string(), "Unauthorized");
}
```

**Expected Protection:**
- ✅ `resolve` checks authorization: creator can only resolve after cutoff, admin can resolve anytime (if `admin_pre_cutoff` enabled)

---

### Category 5: Multiple Claim Attacks

#### Test 5.1: Claim Winnings Twice

**Attacker Goal:** Claim winnings multiple times to drain market funds

**Test Code:**
```rust
#[tokio::test]
async fn test_double_claim() {
    let mut context = setup_test_context().await;
    
    // Create market, place bet, resolve
    let market = create_market(&mut context, "Test", vec!["Yes", "No"], past_timestamp(), None).await.unwrap();
    place_bet(&mut context, market, 0, lamports(10.0)).await.unwrap();
    resolve_market(&mut context, market, 0).await.unwrap();
    
    // First claim
    claim_winnings(&mut context, market).await.unwrap();
    
    // Attempt second claim
    let result = claim_winnings(&mut context, market).await;
    
    // Expected: Should fail with AlreadyClaimed or NotClaimed
    assert!(result.is_err());
    let error = result.unwrap_err().to_string();
    assert!(error.contains("AlreadyClaimed") || error.contains("NotClaimed"));
}
```

**Expected Protection:**
- ✅ `claim_winnings` checks `position.claimed == false` → fails with custom error if already claimed
- ✅ Sets `position.claimed = true` after payout

---

#### Test 5.2: Claim on Losing Outcome

**Attacker Goal:** Claim winnings despite betting on losing outcome

**Test Code:**
```rust
#[tokio::test]
async fn test_claim_losing_outcome() {
    let mut context = setup_test_context().await;
    
    let market = create_market(&mut context, "Test", vec!["Yes", "No"], past_timestamp(), None).await.unwrap();
    
    // Bet on outcome 1 (No)
    place_bet(&mut context, market, 1, lamports(10.0)).await.unwrap();
    
    // Resolve to outcome 0 (Yes) - user loses
    resolve_market(&mut context, market, 0).await.unwrap();
    
    // Attempt to claim
    let result = claim_winnings(&mut context, market).await;
    
    // Expected: Should fail (no winnings to claim)
    assert!(result.is_err());
}
```

**Expected Protection:**
- ✅ `claim_winnings` calculates payout based on winning outcome
- ✅ If user bet on losing outcome, payout = 0, claim fails or succeeds with 0 payout

---

#### Test 5.3: Claim Before Resolution

**Attacker Goal:** Claim winnings before market is resolved

**Test Code:**
```rust
#[tokio::test]
async fn test_claim_before_resolution() {
    let mut context = setup_test_context().await;
    
    let market = create_market(&mut context, "Test", vec!["Yes", "No"], past_timestamp(), None).await.unwrap();
    place_bet(&mut context, market, 0, lamports(10.0)).await.unwrap();
    
    // Attempt to claim before resolution
    let result = claim_winnings(&mut context, market).await;
    
    // Expected: Should fail with InvalidState
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().to_string(), "InvalidState");
}
```

**Expected Protection:**
- ✅ `claim_winnings` checks `market.state == STATE_RESOLVED` → fails with `InvalidState`

---

### Category 6: Authorization Bypass

#### Test 6.1: Non-Creator Resolves Market

**Attacker Goal:** Resolve someone else's market

**Test Code:**
```rust
#[tokio::test]
async fn test_non_creator_resolve() {
    let mut context = setup_test_context().await;
    
    // User A creates market
    let market = create_market_as_user(&mut context, user_a, "Test", vec!["Yes", "No"], past_timestamp(), None).await.unwrap();
    
    // User B attempts to resolve
    let result = resolve_market_as_user(&mut context, user_b, market, 0).await;
    
    // Expected: Should fail with Unauthorized
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().to_string(), "Unauthorized");
}
```

**Expected Protection:**
- ✅ `resolve` checks `signer == market.creator || signer == config.authority` → fails with `Unauthorized`

---

#### Test 6.2: Set Authority Without Permission

**Attacker Goal:** Change config authority to gain admin access

**Test Code:**
```rust
#[tokio::test]
async fn test_unauthorized_set_authority() {
    let mut context = setup_test_context().await;
    
    // Attacker attempts to set themselves as authority
    let result = set_authority_as_user(&mut context, attacker, new_authority).await;
    
    // Expected: Should fail with Unauthorized
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().to_string(), "Unauthorized");
}
```

**Expected Protection:**
- ✅ `set_authority` checks `signer == config.authority` → fails with `Unauthorized`

---

### Test Suite Structure

```
programs/yesno_markets/tests/
├── adversarial.rs          # Main adversarial test suite
├── helpers/
│   ├── mod.rs              # Test helper functions
│   ├── setup.rs            # Test context setup
│   └── utils.rs            # Utility functions
└── fixtures/
    └── test_data.rs        # Test data constants
```

**File: `programs/yesno_markets/tests/adversarial.rs`**
```rust
use anchor_lang::prelude::*;
use solana_program_test::*;
use solana_sdk::{signature::Keypair, signer::Signer};

mod helpers;
use helpers::*;

// Category 1: Market Creation Edge Cases
#[tokio::test]
async fn test_market_creation_past_cutoff() { /* ... */ }

#[tokio::test]
async fn test_market_creation_far_future_cutoff() { /* ... */ }

#[tokio::test]
async fn test_market_creation_zero_outcomes() { /* ... */ }

#[tokio::test]
async fn test_market_creation_max_outcomes() { /* ... */ }

// Category 2: Betting Timing Attacks
#[tokio::test]
async fn test_bet_at_exact_cutoff() { /* ... */ }

#[tokio::test]
async fn test_bet_after_resolution() { /* ... */ }

// Category 3: Over-Betting / Limit Tests
#[tokio::test]
async fn test_bet_below_minimum() { /* ... */ }

#[tokio::test]
async fn test_bet_above_maximum() { /* ... */ }

#[tokio::test]
async fn test_bet_integer_overflow() { /* ... */ }

// Category 4: Double-Resolution Attacks
#[tokio::test]
async fn test_double_resolution() { /* ... */ }

#[tokio::test]
async fn test_resolve_before_cutoff_non_admin() { /* ... */ }

// Category 5: Multiple Claim Attacks
#[tokio::test]
async fn test_double_claim() { /* ... */ }

#[tokio::test]
async fn test_claim_losing_outcome() { /* ... */ }

#[tokio::test]
async fn test_claim_before_resolution() { /* ... */ }

// Category 6: Authorization Bypass
#[tokio::test]
async fn test_non_creator_resolve() { /* ... */ }

#[tokio::test]
async fn test_unauthorized_set_authority() { /* ... */ }
```

---

## Part 2: Backend API Attack Scenarios

### Test Suite: `server/tests/adversarial.test.ts`

---

### Category 1: Malformed JSON Attacks

#### Test 1.1: Invalid JSON Syntax

**Attacker Goal:** Crash server with malformed JSON

**Test Code:**
```typescript
// server/tests/adversarial.test.ts
import request from 'supertest';
import { app } from '../src/index';

describe('Malformed JSON Attacks', () => {
  test('should reject invalid JSON syntax', async () => {
    const response = await request(app)
      .post('/comments')
      .set('Content-Type', 'application/json')
      .send('{ invalid json }'); // Malformed JSON
    
    // Expected: 400 Bad Request
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/invalid|json|parse/i);
  });

  test('should reject JSON with wrong types', async () => {
    const response = await request(app)
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
```

**Expected Protection:**
- ✅ Express `express.json()` middleware catches malformed JSON
- ✅ Zod schemas validate types

---

#### Test 1.2: Missing Required Fields

**Attacker Goal:** Bypass validation with incomplete data

**Test Code:**
```typescript
describe('Missing Required Fields', () => {
  test('should reject comment without marketId', async () => {
    const response = await request(app)
      .post('/comments')
      .set('Cookie', validSessionCookie)
      .send({
        commentText: 'Test comment',
        // marketId missing
      });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/marketId.*required/i);
  });

  test('should reject SIWS finish without signature', async () => {
    const response = await request(app)
      .post('/auth/siws/finish')
      .send({
        pubkey: 'valid_pubkey',
        nonce: 'valid_nonce',
        // signatureBase58 missing
      });
    
    expect(response.status).toBe(400);
  });
});
```

**Expected Protection:**
- ✅ Zod `.safeParse()` validates required fields

---

### Category 2: Massive Payload Attacks

#### Test 2.1: Huge JSON Payload

**Attacker Goal:** DoS server with massive payload

**Test Code:**
```typescript
describe('Massive Payload Attacks', () => {
  test('should reject payload over 1MB limit', async () => {
    // Create 2MB comment
    const hugeComment = 'A'.repeat(2 * 1024 * 1024);
    
    const response = await request(app)
      .post('/comments')
      .set('Cookie', validSessionCookie)
      .send({
        marketId: 'test_market',
        commentText: hugeComment,
      });
    
    // Expected: 413 Payload Too Large
    expect(response.status).toBe(413);
  });

  test('should reject deeply nested JSON', async () => {
    // Create deeply nested object
    let nested: any = { value: 'deep' };
    for (let i = 0; i < 1000; i++) {
      nested = { nested };
    }
    
    const response = await request(app)
      .post('/comments')
      .set('Cookie', validSessionCookie)
      .send(nested);
    
    // Expected: 400 or 413
    expect([400, 413]).toContain(response.status);
  });
});
```

**Expected Protection:**
- ✅ `express.json({ limit: "1mb" })` rejects payloads over 1MB
- ⚠️ Add depth limit for nested JSON

**PATCH:**
```typescript
// server/src/index.ts
app.use(express.json({ 
  limit: "1mb",
  strict: true, // Only accept arrays and objects
}));
```

---

### Category 3: Rate Limit Bypass Attacks

#### Test 3.1: Rapid Authentication Attempts

**Attacker Goal:** Brute-force authentication with rapid requests

**Test Code:**
```typescript
describe('Rate Limit Bypass Attacks', () => {
  test('should rate limit SIWS start requests', async () => {
    const requests = [];
    
    // Send 20 requests rapidly (should be limited to 10 per 15 min)
    for (let i = 0; i < 20; i++) {
      requests.push(
        request(app)
          .post('/auth/siws/start')
          .send({ pubkey: 'test_pubkey' })
      );
    }
    
    const responses = await Promise.all(requests);
    
    // Expected: Some requests should be rate limited (429)
    const rateLimited = responses.filter(r => r.status === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
  });

  test('should rate limit comment posting', async () => {
    const requests = [];
    
    // Send 10 comments in 1 second (should be limited to 5 per minute)
    for (let i = 0; i < 10; i++) {
      requests.push(
        request(app)
          .post('/comments')
          .set('Cookie', validSessionCookie)
          .send({
            marketId: 'test',
            commentText: `Comment ${i}`,
          })
      );
    }
    
    const responses = await Promise.all(requests);
    const rateLimited = responses.filter(r => r.status === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
  });
});
```

**Expected Protection:**
- ⚠️ **NOT IMPLEMENTED** - Rate limiting needed (see backend_security_audit.md Issue #1)

**PATCH:** (Already provided in backend audit)
```typescript
import rateLimit from 'express-rate-limit';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many authentication attempts' },
});

app.post("/auth/siws/start", authLimiter, async (req, res) => { /* ... */ });
```

---

### Category 4: SQL Injection Attempts

#### Test 4.1: SQL Injection in Comment Text

**Attacker Goal:** Inject SQL to read/modify database

**Test Code:**
```typescript
describe('SQL Injection Attempts', () => {
  test('should sanitize SQL injection in comment text', async () => {
    const sqlInjection = "'; DROP TABLE comments; --";
    
    const response = await request(app)
      .post('/comments')
      .set('Cookie', validSessionCookie)
      .send({
        marketId: 'test',
        commentText: sqlInjection,
      });
    
    // Expected: Should succeed (parameterized query prevents injection)
    expect(response.status).toBe(200);
    
    // Verify comment was stored as-is (not executed)
    const comments = await getComments('test');
    expect(comments[0].commentText).toBe(sqlInjection);
    
    // Verify table still exists
    const tableExists = await checkTableExists('comments');
    expect(tableExists).toBe(true);
  });

  test('should sanitize SQL injection in market ID', async () => {
    const sqlInjection = "1' OR '1'='1";
    
    const response = await request(app)
      .get(`/comments?marketId=${encodeURIComponent(sqlInjection)}`);
    
    // Expected: Should return empty array (no matches)
    expect(response.status).toBe(200);
    expect(response.body.comments).toEqual([]);
  });
});
```

**Expected Protection:**
- ✅ Parameterized queries (`$1`, `$2`) prevent SQL injection
- ✅ All database queries use parameterized format

---

### Category 5: Authentication Bypass Attempts

#### Test 5.1: Forge JWT Token

**Attacker Goal:** Create fake JWT to bypass authentication

**Test Code:**
```typescript
describe('Authentication Bypass Attempts', () => {
  test('should reject forged JWT token', async () => {
    // Create JWT with wrong secret
    const fakeToken = jwt.sign(
      { id: 'fake_user', pubkey: 'fake_pubkey' },
      'wrong_secret',
      { algorithm: 'HS256' }
    );
    
    const response = await request(app)
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
    // Create expired token
    const expiredToken = jwt.sign(
      { id: 'user', pubkey: 'pubkey' },
      SESSION_SECRET,
      { algorithm: 'HS256', expiresIn: '-1d' } // Expired yesterday
    );
    
    const response = await request(app)
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
```

**Expected Protection:**
- ✅ JWT verified with correct secret
- ✅ Expired tokens rejected automatically by `jwt.verify()`

---

### Test Suite Structure

```
server/tests/
├── adversarial.test.ts     # Main adversarial test suite
├── setup.ts                # Test database setup
├── helpers.ts              # Test helper functions
└── fixtures/
    └── test_data.ts        # Test data
```

**File: `server/tests/adversarial.test.ts`**
```typescript
import request from 'supertest';
import { app } from '../src/index';
import { setupTestDatabase, cleanupTestDatabase } from './setup';

beforeAll(async () => {
  await setupTestDatabase();
});

afterAll(async () => {
  await cleanupTestDatabase();
});

describe('Malformed JSON Attacks', () => {
  // Tests here
});

describe('Massive Payload Attacks', () => {
  // Tests here
});

describe('Rate Limit Bypass Attacks', () => {
  // Tests here
});

describe('SQL Injection Attempts', () => {
  // Tests here
});

describe('Authentication Bypass Attempts', () => {
  // Tests here
});
```

---

## Part 3: DoS Protection Recommendations

### Rate Limiting Implementation

**Location:** `server/src/middleware/rateLimiting.ts`

```typescript
import rateLimit from 'express-rate-limit';

// Authentication endpoints (strict)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  // Use IP + user agent for better tracking
  keyGenerator: (req) => {
    return `${req.ip}-${req.get('user-agent')}`;
  },
});

// Comment posting (moderate)
export const commentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 comments per minute
  message: { error: 'Too many comments, please slow down' },
  skip: (req) => {
    // Skip rate limiting for admins (if implemented)
    return false;
  },
});

// General API (lenient)
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please slow down' },
});
```

**Apply to routes:**
```typescript
// server/src/index.ts
import { authLimiter, commentLimiter, generalLimiter } from './middleware/rateLimiting';

// Apply general rate limiting to all routes
app.use(generalLimiter);

// Apply specific rate limiting
app.post("/auth/siws/start", authLimiter, async (req, res) => { /* ... */ });
app.post("/auth/siws/finish", authLimiter, async (req, res) => { /* ... */ });
app.post("/comments", commentLimiter, async (req, res) => { /* ... */ });
```

---

### Connection Limits

**Location:** `server/src/index.ts`

```typescript
import helmet from 'helmet';

// Add security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
  },
}));

// Limit concurrent connections (if using cluster mode)
const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

server.maxConnections = 1000; // Limit concurrent connections
```

---

### Payload Size Limits

**Already Implemented:**
```typescript
// server/src/index.ts:142
app.use(express.json({ limit: "1mb" }));
```

**Additional Protection:**
```typescript
app.use(express.json({ 
  limit: "1mb",
  strict: true, // Only accept arrays and objects
  verify: (req, res, buf, encoding) => {
    // Additional validation if needed
    if (buf.length > 1024 * 1024) {
      throw new Error('Payload too large');
    }
  },
}));
```

---

## Test Execution Guide

### Smart Contract Tests

```bash
# Run all tests
cd programs/yesno_markets
anchor test

# Run specific test file
anchor test --skip-deploy -- --test adversarial

# Run specific test
anchor test --skip-deploy -- --test adversarial::test_double_claim

# Run with verbose output
RUST_LOG=debug anchor test
```

### Backend API Tests

```bash
# Install dependencies
cd server
npm install --save-dev supertest @types/supertest jest @types/jest

# Run all tests
npm test

# Run specific test file
npm test -- adversarial.test.ts

# Run with coverage
npm test -- --coverage

# Run in watch mode
npm test -- --watch
```

**Add to `package.json`:**
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "testMatch": ["**/tests/**/*.test.ts"]
  }
}
```

---

## Summary

**Smart Contract Tests:** 15 adversarial scenarios  
**Backend API Tests:** 10 adversarial scenarios  
**DoS Protection:** Rate limiting, payload limits, connection limits

**Coverage:**
- ✅ Market creation edge cases
- ✅ Betting timing attacks
- ✅ Over-betting / limit tests
- ✅ Double-resolution attacks
- ✅ Multiple claim attacks
- ✅ Authorization bypass
- ✅ Malformed JSON attacks
- ✅ Massive payload attacks
- ✅ Rate limit bypass
- ✅ SQL injection attempts
- ✅ Authentication bypass

**Next Steps:**
1. Implement test skeletons
2. Run tests to verify current protections
3. Fix any failing tests
4. Add rate limiting to backend
5. Deploy with DoS protection enabled

---

**Document Status:** Complete  
**Ready for Implementation:** Yes
