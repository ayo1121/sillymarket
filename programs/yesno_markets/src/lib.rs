use anchor_lang::prelude::*;
use anchor_lang::system_program;
use solana_sha256_hasher::hash;
use anchor_lang::solana_program::rent::Rent;

// -----------------------------------------------------------------------------
// Program
// -----------------------------------------------------------------------------

declare_id!("8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb");

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

pub const CONFIG_SEED: &[u8] = b"config";
pub const MARKET_SEED: &[u8] = b"market";
pub const POS_SEED: &[u8] = b"pos";

pub const STATE_ACTIVE: u8 = 1;
pub const STATE_RESOLVED: u8 = 2;

pub const WIN_UNSET: i8 = -1;
pub const WIN_VOID: i8 = -2;

pub const MAX_ANSWERS: usize = 5;
pub const ANSWER_MAX: usize = 64;
pub const QUESTION_MAX: usize = 1024;
pub const IMAGE_MAX: usize = 200;

pub const MIN_CUTOFF_SECS: i64 = 5 * 60;
pub const MAX_CUTOFF_SECS: i64 = 48 * 60 * 60;

pub const BPS_DENOMINATOR: u64 = 10_000;
pub const TOTAL_FEE_BPS: u64 = 200; // 2.00%

pub const CREATION_FEE_LAMPORTS: u64 = 20_000_000;         // 0.02 SOL
pub const MIN_BET_LAMPORTS: u64 = 10_000_000;              // 0.01 SOL
pub const MAX_BET_LAMPORTS: u64 = 100_000 * 1_000_000_000; // 100k SOL
pub const MARKET_POOL_CAP: u64 = 10_000_000 * 1_000_000_000; // 10M SOL cap

pub const AUTO_VOID_GRACE_SECS: i64 = 7 * 24 * 60 * 60;

pub const DISCRIMINATOR: usize = 8;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")] Unauthorized,
    #[msg("Overflow")] Overflow,
    #[msg("Bad parameter")] BadParam,
    #[msg("Betting closed")] BettingClosed,
    #[msg("Already resolved")] AlreadyResolved,
    #[msg("Insufficient funds")] InsufficientFunds,
    #[msg("Not claimed")] NotClaimed,
    #[msg("Invalid state")] InvalidState,
    #[msg("Already claimed")] AlreadyClaimed,
}

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub cutoff_ts: i64,
    pub outcomes_count: u8,
    pub question_hash: [u8;32],
    pub question_len: u16,
    pub image_url_len: u16,
}

#[event]
pub struct BetPlaced {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub outcome_index: u8,
    pub amount_lamports: u64,
    pub pools_after: Vec<u64>,
}

#[event]
pub struct WinnerResolved {
    pub market: Pubkey,
    pub winner_index: i8,
    pub auto_void: bool,
    pub resolved_total_pool: u64,
    pub resolved_win_pool: u64,
    pub fees_transferred: u64,
}

#[event]
pub struct WinningsClaimed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ConfigFeeWalletChanged {
    pub old_wallet: Pubkey,
    pub new_wallet: Pubkey,
}

#[event]
pub struct ConfigAuthorityChanged {
    pub old_auth: Pubkey,
    pub new_auth: Pubkey,
}

#[event]
pub struct MarketSettledDustRouted {
    pub market: Pubkey,
    pub dust: u64,
    pub to: Pubkey,
}

// -----------------------------------------------------------------------------
// Accounts
// -----------------------------------------------------------------------------

#[account]
pub struct Config {
    pub authority: Pubkey,        // 32
    pub fee_wallet: Pubkey,       // 32
    pub min_bet_lamports: u64,    // 8
    pub max_bet_lamports: u64,    // 8
    pub admin_pre_cutoff: bool,   // 1
    pub _pad: [u8;7],             // 7
}
impl Config { pub const LEN: usize = 32+32+8+8+1+7; }

#[account]
pub struct Market {
    pub creator: Pubkey,                 // 32
    pub platform_fee_wallet: Pubkey,     // 32
    pub cutoff_ts: i64,                  // 8
    pub created_ts: i64,                 // 8
    pub state: u8,                       // 1
    pub outcomes_count: u8,              // 1
    pub winning_index: i8,               // 1
    pub bump: u8,                        // 1
    pub pools: [u64; MAX_ANSWERS],       // 40 (gross)
    pub total_pool: u64,                 // 8  (gross)
    pub resolved_total_pool: u64,        // 8  (claimable after fees if non-VOID)
    pub resolved_total_pool_remaining: u64, // 8
    pub resolved_win_pool: u64,          // 8  (winner gross)
    pub question_hash: [u8; 32],         // 32
    pub min_bet_snapshot: u64,           // 8
    pub max_bet_snapshot: u64,           // 8
    pub pos_counts: [u32; MAX_ANSWERS],  // 20  (saturating counters)
    pub win_unclaimed: u32,              // 4
    pub fees_accrued_total: u64,         // 8  (escrow inside market)
    pub image_url: String,               // 4 + IMAGE_MAX
}
impl Market {
    pub const LEN_FIXED: usize = 32+32+8+8+1+1+1+1+40+8+8+8+8+32+8+8+20+4+8; // 236
    pub const LEN: usize = Self::LEN_FIXED + 4 + IMAGE_MAX; // 236 + 204 = 440
    pub const SPACE: usize = DISCRIMINATOR + Self::LEN;     // 8 + 440 = 448
}

#[account]
pub struct Position {
    pub owner: Pubkey,          // 32
    pub market: Pubkey,         // 32
    pub amount: u64,            // 8  (gross contributed)
    pub outcome_index: u8,      // 1
    pub claimed: bool,          // 1
    pub bump: u8,               // 1
    pub _pad: [u8;5],           // 5
}
impl Position { pub const LEN: usize = 32+32+8+1+1+1+5; }

// -----------------------------------------------------------------------------
// Instruction handlers
// -----------------------------------------------------------------------------

#[program]
pub mod yesno_markets {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        fee_wallet: Pubkey,
        min_bet_lamports: u64,
        max_bet_lamports: u64,
        admin_pre_cutoff: bool,
    ) -> Result<()> {
        let (expected_pda, _expected_bump) = Pubkey::find_program_address(&[CONFIG_SEED], ctx.program_id);
        
        // Verify the config account matches the expected PDA
        require_keys_eq!(
            ctx.accounts.config.key(),
            expected_pda,
            ErrorCode::BadParam
        );
        
        require!(ctx.accounts.fee_wallet_acc.owner == &system_program::ID, ErrorCode::BadParam);
        require_keys_eq!(ctx.accounts.fee_wallet_acc.key(), fee_wallet, ErrorCode::BadParam);
        require!(min_bet_lamports >= MIN_BET_LAMPORTS, ErrorCode::BadParam);
        require!(max_bet_lamports >= min_bet_lamports, ErrorCode::BadParam);
        require!(max_bet_lamports <= MAX_BET_LAMPORTS, ErrorCode::BadParam);

        let cfg = &mut ctx.accounts.config;
        cfg.authority = ctx.accounts.authority.key();
        cfg.fee_wallet = fee_wallet;
        cfg.min_bet_lamports = min_bet_lamports;
        cfg.max_bet_lamports = max_bet_lamports;
        cfg.admin_pre_cutoff = admin_pre_cutoff;
        Ok(())
    }

    pub fn set_fee_wallet(ctx: Context<SetFeeWallet>, new_fee_wallet: Pubkey) -> Result<()> {
        // Enforce admin is the config authority, even if has_one is present
        require_keys_eq!(
            ctx.accounts.config.authority,
            ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );

        let config = &mut ctx.accounts.config;
        let old = config.fee_wallet;
        config.fee_wallet = new_fee_wallet;
        msg!("set_fee_wallet: old={}, new={}", old, new_fee_wallet);
        Ok(())
    }

    pub fn set_authority(ctx: Context<SetAuthority>, new_authority: Pubkey) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let signer = ctx.accounts.authority.key();
        require!(
            cfg.authority == signer || cfg.fee_wallet == signer,
            ErrorCode::Unauthorized
        );
        let old = ctx.accounts.config.authority;
        ctx.accounts.config.authority = new_authority;
        emit!(ConfigAuthorityChanged{ old_auth: old, new_auth: new_authority });
        Ok(())
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        cutoff_ts: i64,
        question_hash: [u8;32],
        question: String,
        answers: Vec<String>,
        image_url: String,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let platform_fee_wallet = &ctx.accounts.platform_fee_wallet;
        
        require_keys_eq!(
            platform_fee_wallet.key(),
            config.fee_wallet,
            ErrorCode::BadParam
        );
        
        let mut question = question;
        let mut answers = answers;
        let mut image_url = image_url;
        let now = Clock::get()?.unix_timestamp;
        require!((2..=MAX_ANSWERS).contains(&answers.len()), ErrorCode::BadParam);
        require!(cutoff_ts >= now + MIN_CUTOFF_SECS, ErrorCode::BadParam);
        require!(cutoff_ts <= now + MAX_CUTOFF_SECS, ErrorCode::BadParam);

        // Creator must cover creation fee + market rent
        let creator_balance = ctx.accounts.creator.lamports();
        let market_rent = Rent::get()?.minimum_balance(Market::SPACE);
        require!(creator_balance >= CREATION_FEE_LAMPORTS + market_rent, ErrorCode::InsufficientFunds);

        // Normalize and validate inputs (ASCII, no control, pre-trimmed)
        require_trim_ascii_no_ctrl(&mut question)?;
        require!(!question.is_empty() && question.len() <= QUESTION_MAX, ErrorCode::BadParam);
        for a in answers.iter_mut() {
            require_trim_ascii_no_ctrl(a)?;
            require!(!a.is_empty() && a.len() <= ANSWER_MAX, ErrorCode::BadParam);
        }
        require_trim_ascii_no_ctrl(&mut image_url)?;
        require!(image_url.len() <= IMAGE_MAX, ErrorCode::BadParam);

        // ASCII case-insensitive uniqueness without UTF-8 risks
        {
            use std::collections::HashSet;
            let mut seen: HashSet<Vec<u8>> = HashSet::with_capacity(answers.len());
            for a in answers.iter() {
                let lowered: Vec<u8> = a.bytes().map(|b| b.to_ascii_lowercase()).collect();
                require!(seen.insert(lowered), ErrorCode::BadParam);
            }
        }

        // Verify hash matches normalized inputs
        let qhash_check = hash_question_and_answers(&question, &answers);
        require!(qhash_check == question_hash, ErrorCode::BadParam);

        // Charge creation fee
        require!(ctx.accounts.platform_fee_wallet.owner == &system_program::ID, ErrorCode::BadParam);
        sys_transfer_from_user(
            &ctx.accounts.system_program,
            &ctx.accounts.creator,
            &ctx.accounts.platform_fee_wallet.to_account_info(),
            CREATION_FEE_LAMPORTS,
        )?;

        // Initialize market
        let m = &mut ctx.accounts.market;
        m.creator = ctx.accounts.creator.key();
        m.platform_fee_wallet = ctx.accounts.platform_fee_wallet.key();
        m.cutoff_ts = cutoff_ts;
        m.created_ts = now;
        m.state = STATE_ACTIVE;
        m.outcomes_count = answers.len() as u8;
        m.winning_index = WIN_UNSET;
        m.bump = ctx.bumps.market;
        m.pools = [0u64; MAX_ANSWERS];
        m.total_pool = 0;
        m.resolved_total_pool = 0;
        m.resolved_total_pool_remaining = 0;
        m.resolved_win_pool = 0;
        m.question_hash = qhash_check;
        m.min_bet_snapshot = ctx.accounts.config.min_bet_lamports;
        m.max_bet_snapshot = ctx.accounts.config.max_bet_lamports;
        m.pos_counts = [0u32; MAX_ANSWERS];
        m.win_unclaimed = 0;
        m.fees_accrued_total = 0;
        m.image_url = image_url;

        emit!(MarketCreated{
            market: m.key(),
            creator: m.creator,
            cutoff_ts,
            outcomes_count: m.outcomes_count,
            question_hash: qhash_check,
            question_len: question.len() as u16,
            image_url_len: m.image_url.len() as u16
        });
        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, outcome_index: u8, amount_lamports: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let m = &mut ctx.accounts.market;
        require!(m.state == STATE_ACTIVE, ErrorCode::InvalidState);
        require!(now < m.cutoff_ts, ErrorCode::BettingClosed);

        require!(amount_lamports >= m.min_bet_snapshot, ErrorCode::BadParam);
        require!(amount_lamports <= m.max_bet_snapshot, ErrorCode::BadParam);

        let oc = m.outcomes_count as usize;
        let oi = outcome_index as usize;
        require!(oi < oc, ErrorCode::BadParam);

        // Precheck balance; CPI is authoritative
        require!(ctx.accounts.user.lamports() >= amount_lamports, ErrorCode::InsufficientFunds);

        // Compute fee, move GROSS to market
        let total_fee = mul_div_ceil_u64(amount_lamports, TOTAL_FEE_BPS, BPS_DENOMINATOR)?;
        sys_transfer_from_user(
            &ctx.accounts.system_program,
            &ctx.accounts.user,
            &m.to_account_info(),
            amount_lamports,
        )?;

        // Position logic
        let p = &mut ctx.accounts.position;
        if p.amount == 0 {
            p.owner = ctx.accounts.user.key();
            p.market = m.key();
            p.outcome_index = outcome_index;
            p.claimed = false;
            p.bump = ctx.bumps.position;
            m.pos_counts[oi] = m.pos_counts[oi].saturating_add(1);
        } else {
            require!(p.outcome_index == outcome_index, ErrorCode::BadParam);
            require!(!p.claimed, ErrorCode::AlreadyClaimed);
        }
        p.amount = p.amount.checked_add(amount_lamports).ok_or(ErrorCode::Overflow)?;

        // Pools and fee accrual AFTER transfer
        m.pools[oi] = m.pools[oi].checked_add(amount_lamports).ok_or(ErrorCode::Overflow)?;
        m.total_pool = m.total_pool.checked_add(amount_lamports).ok_or(ErrorCode::Overflow)?;
        require!(m.total_pool <= MARKET_POOL_CAP, ErrorCode::BadParam);

        m.fees_accrued_total = m.fees_accrued_total.checked_add(total_fee).ok_or(ErrorCode::Overflow)?;
        require!(m.fees_accrued_total <= m.total_pool, ErrorCode::InvalidState);

        // Build pools_after vector (only active outcomes)
        let oc = m.outcomes_count as usize;
        let pools_after: Vec<u64> = m.pools[0..oc].to_vec();

        emit!(BetPlaced {
            market: m.key(),
            bettor: ctx.accounts.user.key(),
            outcome_index,
            amount_lamports,
            pools_after,
        });
        Ok(())
    }

    pub fn resolve(ctx: Context<Resolve>, winner_index: i8) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let m = &mut ctx.accounts.market;
        require!(m.state == STATE_ACTIVE, ErrorCode::InvalidState);
        require!(m.winning_index == WIN_UNSET, ErrorCode::AlreadyResolved);

        let now = Clock::get()?.unix_timestamp;
        if ctx.accounts.signer.key() == m.creator {
            require!(now >= m.cutoff_ts, ErrorCode::BettingClosed);
        } else {
            require_keys_eq!(cfg.authority, ctx.accounts.signer.key(), ErrorCode::Unauthorized);
            if !cfg.admin_pre_cutoff { require!(now >= m.cutoff_ts, ErrorCode::BettingClosed); }
        }

        let oc = m.outcomes_count as usize;
        let total_pool_recalc = m.pools[0..oc]
            .iter()
            .try_fold(0u64, |acc,x| acc.checked_add(*x).ok_or(ErrorCode::Overflow))?;
        require!(total_pool_recalc == m.total_pool, ErrorCode::InvalidState);
        require!(m.fees_accrued_total <= total_pool_recalc, ErrorCode::InvalidState);

        let (intended, auto_void) = if winner_index == WIN_VOID {
            let allow = total_pool_recalc == 0
                || now >= m.cutoff_ts + AUTO_VOID_GRACE_SECS
                || cfg.authority == ctx.accounts.signer.key();
            require!(allow, ErrorCode::Unauthorized);
            (WIN_VOID, false)
        } else {
            require!(winner_index >= 0, ErrorCode::BadParam);
            let w = winner_index as usize;
            require!(w < oc, ErrorCode::BadParam);
            let win_pool = m.pools[w];
            if win_pool == 0 && total_pool_recalc > 0 { (WIN_VOID, true) } else { (winner_index, false) }
        };

        let available = available_lamports_above_rent(&m.to_account_info(), Market::SPACE)?;
        require!(available >= total_pool_recalc, ErrorCode::InsufficientFunds);

        let mut fees_transferred: u64 = 0;

        if intended == WIN_VOID {
            // VOID: refund gross; no fees; reset escrow
            m.resolved_total_pool = total_pool_recalc;
            m.resolved_total_pool_remaining = total_pool_recalc;
            m.resolved_win_pool = 0;
            m.winning_index = WIN_VOID;
            m.state = STATE_RESOLVED;
            m.win_unclaimed = m.pos_counts.iter().take(oc).fold(0u32, |acc, &v| acc.saturating_add(v));
            m.fees_accrued_total = 0;
        } else {
            // Non-VOID: collect fees atomically
            let (creator_fee, platform_fee) = split_fee(m.fees_accrued_total);

            require!(ctx.accounts.platform_fee_wallet.owner == &system_program::ID, ErrorCode::BadParam);
            require!(ctx.accounts.creator_wallet.owner == &system_program::ID, ErrorCode::BadParam);
            require_keys_eq!(ctx.accounts.platform_fee_wallet.key(), m.platform_fee_wallet, ErrorCode::BadParam);
            require_keys_eq!(ctx.accounts.creator_wallet.key(), m.creator, ErrorCode::BadParam);

            if platform_fee > 0 {
                pda_transfer_from_market(
                    &ctx.accounts.system_program,
                    m,
                    &ctx.accounts.platform_fee_wallet.to_account_info(),
                    platform_fee,
                    &[
                        MARKET_SEED,
                        m.creator.as_ref(),
                        &m.cutoff_ts.to_le_bytes(),
                        &m.question_hash,
                        &[m.bump],
                    ],
                )?;
                fees_transferred = fees_transferred.checked_add(platform_fee).ok_or(ErrorCode::Overflow)?;
            }
            if creator_fee > 0 {
                pda_transfer_from_market(
                    &ctx.accounts.system_program,
                    m,
                    &ctx.accounts.creator_wallet.to_account_info(),
                    creator_fee,
                    &[
                        MARKET_SEED,
                        m.creator.as_ref(),
                        &m.cutoff_ts.to_le_bytes(),
                        &m.question_hash,
                        &[m.bump],
                    ],
                )?;
                fees_transferred = fees_transferred.checked_add(creator_fee).ok_or(ErrorCode::Overflow)?;
            }

            let claimable = total_pool_recalc.checked_sub(m.fees_accrued_total).ok_or(ErrorCode::Overflow)?;
            let w = intended as usize;
            let win_pool = m.pools[w];

            m.resolved_total_pool = claimable;
            m.resolved_total_pool_remaining = claimable;
            m.resolved_win_pool = win_pool;
            m.winning_index = intended;
            m.state = STATE_RESOLVED;
            m.win_unclaimed = m.pos_counts[w];
            m.fees_accrued_total = 0;
        }

        emit!(WinnerResolved{
            market: m.key(),
            winner_index: m.winning_index,
            auto_void,
            resolved_total_pool: m.resolved_total_pool,
            resolved_win_pool: m.resolved_win_pool,
            fees_transferred
        });
        Ok(())
    }

    pub fn void_expired(ctx: Context<VoidExpired>) -> Result<()> {
        let m = &mut ctx.accounts.market;
        require!(m.state == STATE_ACTIVE, ErrorCode::InvalidState);
        require!(m.winning_index == WIN_UNSET, ErrorCode::AlreadyResolved);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= m.cutoff_ts + AUTO_VOID_GRACE_SECS, ErrorCode::BettingClosed);

        let oc = m.outcomes_count as usize;
        let total_pool_recalc = m.pools[0..oc]
            .iter()
            .try_fold(0u64, |acc,x| acc.checked_add(*x).ok_or(ErrorCode::Overflow))?;
        require!(total_pool_recalc == m.total_pool, ErrorCode::InvalidState);

        let available = available_lamports_above_rent(&m.to_account_info(), Market::SPACE)?;
        require!(available >= total_pool_recalc, ErrorCode::InsufficientFunds);

        m.resolved_total_pool = total_pool_recalc;
        m.resolved_total_pool_remaining = total_pool_recalc;
        m.resolved_win_pool = 0;
        m.winning_index = WIN_VOID;
        m.state = STATE_RESOLVED;
        m.win_unclaimed = m.pos_counts.iter().take(oc).fold(0u32, |acc, &v| acc.saturating_add(v));
        m.fees_accrued_total = 0;

        emit!(WinnerResolved{
            market: m.key(),
            winner_index: WIN_VOID,
            auto_void: true,
            resolved_total_pool: m.resolved_total_pool,
            resolved_win_pool: 0,
            fees_transferred: 0
        });
        Ok(())
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let m = &mut ctx.accounts.market;
        require!(m.state == STATE_RESOLVED, ErrorCode::InvalidState);

        let p = &mut ctx.accounts.position;
        require_keys_eq!(p.owner, ctx.accounts.user.key(), ErrorCode::Unauthorized);
        require_keys_eq!(p.market, m.key(), ErrorCode::BadParam);
        require!(!p.claimed, ErrorCode::AlreadyClaimed);

        let was_last = m.win_unclaimed == 1;

        let mut pay: u64 = if m.winning_index == WIN_VOID {
            p.amount
        } else {
            require!(p.outcome_index as i8 == m.winning_index, ErrorCode::Unauthorized);
            let winners = m.resolved_win_pool as u128;
            require!(winners > 0, ErrorCode::InvalidState);
            let num = (m.resolved_total_pool as u128)
                .checked_mul(p.amount as u128).ok_or(ErrorCode::Overflow)?;
            let share = num.checked_div(winners).ok_or(ErrorCode::Overflow)?;
            u64::try_from(share).map_err(|_| error!(ErrorCode::Overflow))?
        };

        require!(m.resolved_total_pool_remaining >= pay, ErrorCode::InsufficientFunds);
        m.resolved_total_pool_remaining = m.resolved_total_pool_remaining.checked_sub(pay).ok_or(ErrorCode::Overflow)?;

        p.claimed = true;

        if was_last {
            require!(m.win_unclaimed == 1, ErrorCode::InvalidState);
            m.win_unclaimed = 0;
            if m.resolved_total_pool_remaining > 0 {
                let dust = m.resolved_total_pool_remaining;
                m.resolved_total_pool_remaining = 0;
                pay = pay.checked_add(dust).ok_or(ErrorCode::Overflow)?;
                emit!(MarketSettledDustRouted{ market: m.key(), dust, to: ctx.accounts.user.key() });
            }
        } else {
            if m.win_unclaimed > 0 {
                m.win_unclaimed = m.win_unclaimed.saturating_sub(1);
            }
        }

        pda_transfer_from_market(
            &ctx.accounts.system_program,
            m,
            &ctx.accounts.user.to_account_info(),
            pay,
            &[
                MARKET_SEED,
                m.creator.as_ref(),
                &m.cutoff_ts.to_le_bytes(),
                &m.question_hash,
                &[m.bump],
            ],
        )?;

        emit!(WinningsClaimed{ market: m.key(), user: p.owner, amount: pay });
        Ok(())
    }

    pub fn close_position(_ctx: Context<ClosePosition>) -> Result<()> {
        // Intentional no-op: constraints perform close and return rent after claim.
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// Contexts
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(fee_wallet: Pubkey, min_bet_lamports: u64, max_bet_lamports: u64, admin_pre_cutoff: bool)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Config::LEN,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: must be the declared fee wallet and a system account
    #[account(address = fee_wallet)]
    pub fee_wallet_acc: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetAuthority<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(cutoff_ts: i64, question_hash: [u8;32])]
pub struct CreateMarket<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub creator: Signer<'info>,
    /// CHECK: validated in handler
    #[account(mut)]
    pub platform_fee_wallet: UncheckedAccount<'info>,
    #[account(
        init,
        payer = creator,
        space = Market::SPACE,
        seeds = [
            MARKET_SEED,
            creator.key().as_ref(),
            &cutoff_ts.to_le_bytes(),
            &question_hash,
        ],
        bump
    )]
    pub market: Account<'info, Market>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init_if_needed,
        payer = user,
        space = DISCRIMINATOR + Position::LEN,
        seeds = [POS_SEED, market.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(constraint = signer.key() == market.creator || signer.key() == config.authority @ ErrorCode::Unauthorized)]
    pub signer: Signer<'info>,
    /// CHECK: fee recipients; snapshot on market
    #[account(mut, address = market.platform_fee_wallet)]
    pub platform_fee_wallet: UncheckedAccount<'info>,
    /// CHECK: creator as recipient of fee split
    #[account(mut, address = market.creator)]
    pub creator_wallet: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VoidExpired<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [POS_SEED, market.key().as_ref(), user.key().as_ref()],
        bump = position.bump,
        constraint = position.owner == user.key() @ ErrorCode::Unauthorized,
        constraint = position.market == market.key() @ ErrorCode::BadParam,
    )]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        close = user,
        seeds = [POS_SEED, position.market.as_ref(), user.key().as_ref()],
        bump = position.bump,
        constraint = position.owner == user.key() @ ErrorCode::Unauthorized,
        constraint = position.claimed @ ErrorCode::NotClaimed,
    )]
    pub position: Account<'info, Position>,
}

#[derive(Accounts)]
pub struct SetFeeWallet<'info> {
    /// Global config for the program
    #[account(
        mut,
        has_one = authority,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// Admin authority that is allowed to change the fee wallet
    pub authority: Signer<'info>,

    /// System program (not used, but kept for consistency)
    pub system_program: Program<'info, System>,
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

#[inline]
fn split_fee(total_fee: u64) -> (u64, u64) {
    let creator = (total_fee + 1) / 2;
    (creator, total_fee - creator)
}

#[inline]
fn mul_div_ceil_u64(a: u64, b: u64, denom: u64) -> Result<u64> {
    let num = (a as u128).checked_mul(b as u128).ok_or(ErrorCode::Overflow)?;
    let q = num / (denom as u128);
    let r = num % (denom as u128);
    let res = if r == 0 { q } else { q + 1 };
    u64::try_from(res).map_err(|_| error!(ErrorCode::Overflow))
}

#[inline]
fn sys_transfer_from_user<'info>(
    sys: &Program<'info, System>,
    from: &Signer<'info>,
    to: &AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    if lamports == 0 { return Ok(()); }
    let ix = system_program::Transfer { from: from.to_account_info(), to: to.clone() };
    anchor_lang::system_program::transfer(CpiContext::new(sys.to_account_info(), ix), lamports)
}

#[inline]
fn pda_transfer_from_market<'info>(
    sys: &Program<'info, System>,
    market: &Account<'info, Market>,
    to: &AccountInfo<'info>,
    lamports: u64,
    _seeds: &[&[u8]],
) -> Result<()> {
    let _ = sys; // silence unused param in case features change
    if lamports == 0 { return Ok(()); }
    let market_info = market.to_account_info();
    let available = available_lamports_above_rent(&market_info, Market::SPACE)?;
    require!(available >= lamports, ErrorCode::InsufficientFunds);

    let mut from_lamports = market_info.try_borrow_mut_lamports()?;
    let new_from = (*from_lamports).checked_sub(lamports).ok_or(ErrorCode::Overflow)?;
    **from_lamports = new_from;

    let mut to_lamports = to.try_borrow_mut_lamports()?;
    let new_to = (*to_lamports).checked_add(lamports).ok_or(ErrorCode::Overflow)?;
    **to_lamports = new_to;
    Ok(())
}

#[inline]
fn available_lamports_above_rent(acc: &AccountInfo, account_space: usize) -> Result<u64> {
    let lamports = acc.lamports();
    let rent_min = Rent::get()?.minimum_balance(account_space);
    Ok(lamports.saturating_sub(rent_min))
}

// Validate only. No on-chain reallocation.
#[inline]
fn require_trim_ascii_no_ctrl(s: &mut String) -> Result<()> {
    let t = s.trim();
    require!(!t.is_empty(), ErrorCode::BadParam);
    require!(t.bytes().all(|b| b.is_ascii() && !matches!(b, 0x00..=0x1F | 0x7F)), ErrorCode::BadParam);
    require!(t.len() == s.len(), ErrorCode::BadParam); // pre-trim required
    Ok(())
}

#[inline]
fn hash_question_and_answers(question: &str, answers: &[String]) -> [u8; 32] {
    let mut buf: Vec<u8> = Vec::new();
    buf.extend_from_slice(b"yesno_markets_v1");
    buf.extend_from_slice(&(question.len() as u32).to_le_bytes());
    buf.extend_from_slice(question.as_bytes());
    buf.extend_from_slice(&(answers.len() as u32).to_le_bytes());
    for a in answers {
        buf.extend_from_slice(&(a.len() as u32).to_le_bytes());
        buf.extend_from_slice(a.as_bytes());
    }
    hash(&buf).to_bytes()
}
