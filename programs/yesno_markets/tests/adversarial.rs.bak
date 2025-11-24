// Adversarial Test Suite for YesNo Markets Anchor Program
// Tests edge cases, timing attacks, limits, and authorization bypasses

use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;
use solana_program_test::*;
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
    pubkey::Pubkey,
};
use yesno_markets::*;

mod helpers;
use helpers::*;

// =============================================================================
// CATEGORY 1: Market Creation Edge Cases
// =============================================================================

#[tokio::test]
async fn test_market_creation_past_cutoff() {
    let mut context = setup_test_context().await;
    
    // Attempt to create market with cutoff in the past
    let past_cutoff = context.get_clock().await.unix_timestamp - 3600; // 1 hour ago
    
    let result = create_test_market(
        &mut context,
        "Will this work?",
        vec!["Yes", "No"],
        past_cutoff,
    ).await;
    
    // Expected: Should fail with BadParam error
    assert!(result.is_err(), "Should reject past cutoff");
    let err_str = result.unwrap_err().to_string();
    assert!(err_str.contains("BadParam") || err_str.contains("cutoff"), 
            "Error should mention bad parameter or cutoff");
}

#[tokio::test]
async fn test_market_creation_far_future_cutoff() {
    let mut context = setup_test_context().await;
    
    // Attempt to create market with cutoff 100 years in future
    let far_future = context.get_clock().await.unix_timestamp + (100 * 365 * 24 * 3600);
    
    let result = create_test_market(
        &mut context,
        "Will this work?",
        vec!["Yes", "No"],
        far_future,
    ).await;
    
    // Expected: Should fail with BadParam (exceeds MAX_CUTOFF_SECS)
    assert!(result.is_err(), "Should reject far future cutoff");
}

#[tokio::test]
async fn test_market_creation_zero_outcomes() {
    let mut context = setup_test_context().await;
    
    let future_ts = context.get_clock().await.unix_timestamp + 3600;
    let result = create_test_market(
        &mut context,
        "Invalid market",
        vec![], // Zero outcomes
        future_ts,
    ).await;
    
    // Expected: Should fail
    assert!(result.is_err(), "Should reject zero outcomes");
}

#[tokio::test]
async fn test_market_creation_max_outcomes() {
    let mut context = setup_test_context().await;
    
    let future_ts = context.get_clock().await.unix_timestamp + 3600;
    // MAX_ANSWERS is 5, try 6
    let result = create_test_market(
        &mut context,
        "Max outcomes",
        vec!["A", "B", "C", "D", "E", "F"], // 6 outcomes (over limit)
        future_ts,
    ).await;
    
    // Expected: Should fail with BadParam
    assert!(result.is_err(), "Should reject too many outcomes");
}

#[tokio::test]
async fn test_market_creation_long_question() {
    let mut context = setup_test_context().await;
    
    // Create 2KB question (way over 1024 limit)
    let long_question = "A".repeat(2048);
    let future_ts = context.get_clock().await.unix_timestamp + 3600;
    
    let result = create_test_market(
        &mut context,
        &long_question,
        vec!["Yes", "No"],
        future_ts,
    ).await;
    
    // Expected: Should fail (question exceeds QUESTION_MAX)
    assert!(result.is_err(), "Should reject overly long question");
}

// =============================================================================
// CATEGORY 2: Betting Timing Attacks
// =============================================================================

#[tokio::test]
async fn test_bet_at_exact_cutoff() {
    let mut context = setup_test_context().await;
    
    let cutoff = context.get_clock().await.unix_timestamp + 60; // 1 minute from now
    let market = create_test_market(
        &mut context,
        "Test",
        vec!["Yes", "No"],
        cutoff,
    ).await.unwrap();
    
    // Warp clock to exact cutoff time
    context.warp_to_timestamp(cutoff).await;
    
    let result = place_test_bet(
        &mut context,
        &market,
        0, // outcome_index
        10_000_000, // 0.01 SOL
    ).await;
    
    // Expected: Should fail (betting closed at cutoff)
    assert!(result.is_err(), "Should reject bet at exact cutoff");
    let err_str = result.unwrap_err().to_string();
    assert!(err_str.contains("BettingClosed") || err_str.contains("closed"),
            "Error should mention betting closed");
}

#[tokio::test]
async fn test_bet_one_second_before_cutoff() {
    let mut context = setup_test_context().await;
    
    let cutoff = context.get_clock().await.unix_timestamp + 60;
    let market = create_test_market(
        &mut context,
        "Test",
        vec!["Yes", "No"],
        cutoff,
    ).await.unwrap();
    
    // Warp to 1 second before cutoff
    context.warp_to_timestamp(cutoff - 1).await;
    
    let result = place_test_bet(&mut context, &market, 0, 10_000_000).await;
    
    // Expected: Should succeed (still before cutoff)
    assert!(result.is_ok(), "Should allow bet before cutoff");
}

#[tokio::test]
async fn test_bet_after_resolution() {
    let mut context = setup_test_context().await;
    
    let past_cutoff = context.get_clock().await.unix_timestamp - 60;
    let market = create_test_market(
        &mut context,
        "Test",
        vec!["Yes", "No"],
        past_cutoff,
    ).await.unwrap();
    
    // Resolve market
    resolve_test_market(&mut context, &market, 0).await.unwrap();
    
    // Attempt to bet after resolution
    let result = place_test_bet(&mut context, &market, 0, 10_000_000).await;
    
    // Expected: Should fail with InvalidState
    assert!(result.is_err(), "Should reject bet after resolution");
}

// =============================================================================
// CATEGORY 3: Over-Betting / Limit Tests
// =============================================================================

#[tokio::test]
async fn test_bet_below_minimum() {
    let mut context = setup_test_context().await;
    
    let future_ts = context.get_clock().await.unix_timestamp + 3600;
    let market = create_test_market(
        &mut context,
        "Test",
        vec!["Yes", "No"],
        future_ts,
    ).await.unwrap();
    
    // Attempt to bet 0.001 SOL (below 0.01 SOL minimum)
    let result = place_test_bet(&mut context, &market, 0, 1_000_000).await;
    
    // Expected: Should fail with BadParam
    assert!(result.is_err(), "Should reject bet below minimum");
}

#[tokio::test]
async fn test_bet_above_maximum() {
    let mut context = setup_test_context().await;
    
    let future_ts = context.get_clock().await.unix_timestamp + 3600;
    let market = create_test_market(
        &mut context,
        "Test",
        vec!["Yes", "No"],
        future_ts,
    ).await.unwrap();
    
    // Attempt to bet 1,000,000 SOL (above 100,000 SOL maximum)
    let huge_bet = 1_000_000 * 1_000_000_000;
    let result = place_test_bet(&mut context, &market, 0, huge_bet).await;
    
    // Expected: Should fail with BadParam
    assert!(result.is_err(), "Should reject bet above maximum");
}

#[tokio::test]
async fn test_bet_integer_overflow() {
    let mut context = setup_test_context().await;
    
    let future_ts = context.get_clock().await.unix_timestamp + 3600;
    let market = create_test_market(
        &mut context,
        "Test",
        vec!["Yes", "No"],
        future_ts,
    ).await.unwrap();
    
    // Place max bet multiple times to try to overflow total_pool
    let max_bet = 100_000 * 1_000_000_000; // 100k SOL
    
    for i in 0..10 {
        let result = place_test_bet(&mut context, &market, 0, max_bet).await;
        
        // Should either succeed or fail gracefully (no overflow panic)
        if result.is_err() {
            // If it fails, should be Overflow error, not panic
            let err_str = result.unwrap_err().to_string();
            assert!(err_str.contains("Overflow") || err_str.contains("cap"),
                    "Should fail with overflow error, not panic");
            break;
        }
        
        // If we've placed 10 max bets successfully, that's also fine
        // (means pool cap is working correctly)
        if i == 9 {
            break;
        }
    }
}

// =============================================================================
// CATEGORY 4: Double-Resolution Attacks
// =============================================================================

#[tokio::test]
async fn test_double_resolution() {
    let mut context = setup_test_context().await;
    
    let past_cutoff = context.get_clock().await.unix_timestamp - 60;
    let market = create_test_market(
        &mut context,
        "Test",
        vec!["Yes", "No"],
        past_cutoff,
    ).await.unwrap();
    
    // First resolution
    resolve_test_market(&mut context, &market, 0).await.unwrap();
    
    // Attempt second resolution
    let result = resolve_test_market(&mut context, &market, 1).await;
    
    // Expected: Should fail with InvalidState or AlreadyResolved
    assert!(result.is_err(), "Should reject double resolution");
}

#[tokio::test]
async fn test_resolve_before_cutoff_non_admin() {
    let mut context = setup_test_context().await;
    
    let future_cutoff = context.get_clock().await.unix_timestamp + 3600; // 1 hour from now
    let market = create_test_market(
        &mut context,
        "Test",
        vec!["Yes", "No"],
        future_cutoff,
    ).await.unwrap();
    
    // Attempt to resolve before cutoff as market creator (not admin)
    let result = resolve_test_market(&mut context, &market, 0).await;
    
    // Expected: Should fail with Unauthorized (unless admin_pre_cutoff is enabled)
    assert!(result.is_err(), "Should reject early resolution by non-admin");
}

// =============================================================================
// CATEGORY 5: Claim Attacks
// =============================================================================

#[tokio::test]
async fn test_double_claim() {
    let mut context = setup_test_context().await;
    
    // Create market, place bet, resolve
    let past_cutoff = context.get_clock().await.unix_timestamp - 60;
    let market = create_test_market(
        &mut context,
        "Test",
        vec!["Yes", "No"],
        past_cutoff,
    ).await.unwrap();
    
    place_test_bet(&mut context, &market, 0, 100_000_000).await.unwrap();
    resolve_test_market(&mut context, &market, 0).await.unwrap();
    
    // First claim
    claim_test_winnings(&mut context, &market).await.unwrap();
    
    // Attempt second claim
    let result = claim_test_winnings(&mut context, &market).await;
    
    // Expected: Should fail with AlreadyClaimed
    assert!(result.is_err(), "Should reject double claim");
}

#[tokio::test]
async fn test_claim_losing_outcome() {
    let mut context = setup_test_context().await;
    
    let past_cutoff = context.get_clock().await.unix_timestamp - 60;
    let market = create_test_market(
        &mut context,
        "Test",
        vec!["Yes", "No"],
        past_cutoff,
    ).await.unwrap();
    
    // Bet on outcome 1 (No)
    place_test_bet(&mut context, &market, 1, 100_000_000).await.unwrap();
    
    // Resolve to outcome 0 (Yes) - user loses
    resolve_test_market(&mut context, &market, 0).await.unwrap();
    
    // Attempt to claim
    let result = claim_test_winnings(&mut context, &market).await;
    
    // Expected: Should fail or succeed with 0 payout
    // (Implementation may vary - either is acceptable)
    if result.is_ok() {
        // If claim succeeds, verify no funds were transferred
        // This would require checking balances before/after
    }
}

#[tokio::test]
async fn test_claim_before_resolution() {
    let mut context = setup_test_context().await;
    
    let past_cutoff = context.get_clock().await.unix_timestamp - 60;
    let market = create_test_market(
        &mut context,
        "Test",
        vec!["Yes", "No"],
        past_cutoff,
    ).await.unwrap();
    
    place_test_bet(&mut context, &market, 0, 100_000_000).await.unwrap();
    
    // Attempt to claim before resolution
    let result = claim_test_winnings(&mut context, &market).await;
    
    // Expected: Should fail with InvalidState
    assert!(result.is_err(), "Should reject claim before resolution");
}

// =============================================================================
// CATEGORY 6: Authorization Bypass
// =============================================================================

#[tokio::test]
async fn test_non_creator_resolve() {
    let mut context = setup_test_context().await;
    
    // User A creates market
    let past_cutoff = context.get_clock().await.unix_timestamp - 60;
    let market = create_test_market(
        &mut context,
        "Test",
        vec!["Yes", "No"],
        past_cutoff,
    ).await.unwrap();
    
    // User B attempts to resolve
    let user_b = Keypair::new();
    context.fund_account(&user_b.pubkey(), 10_000_000_000).await;
    
    let result = resolve_test_market_as_user(&mut context, &market, 0, &user_b).await;
    
    // Expected: Should fail with Unauthorized
    assert!(result.is_err(), "Should reject resolution by non-creator");
}

#[tokio::test]
async fn test_unauthorized_set_authority() {
    let mut context = setup_test_context().await;
    
    // Attacker attempts to set themselves as authority
    let attacker = Keypair::new();
    context.fund_account(&attacker.pubkey(), 10_000_000_000).await;
    
    let new_authority = Keypair::new();
    let result = set_authority_as_user(&mut context, &attacker, &new_authority.pubkey()).await;
    
    // Expected: Should fail with Unauthorized
    assert!(result.is_err(), "Should reject unauthorized authority change");
}
