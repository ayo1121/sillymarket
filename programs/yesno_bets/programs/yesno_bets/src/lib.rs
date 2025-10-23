#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};
use std::str::FromStr;

declare_id!("GhbaNQ13QTBsahrcW3Yq7i2Uq7ANFsFqBCS5YX27fyTm");

// --------- Owner & constants ---------
pub const OWNER: &str = "9sjC1DmEhMXHwmSNaq3jQrfAFzfSrPBooDjDDjukuyoR";
pub const VAULT_AUTH_SEED: &[u8] = b"vault-auth";
pub const POSITION_SEED: &[u8] = b"position";
pub const FEE_BPS: u64 = 300;       // 3%
pub const BPS_DENOM: u64 = 10_000;  // 100%

#[program]
pub mod yesno_bets {
    use super::*;

    // ---------------- Create Market (Owner-only) ----------------
    pub fn create_market(ctx: Context<CreateMarket>, cutoff_ts: i64) -> Result<()> {
        require_keys_eq!(ctx.accounts.owner.key(), owner_pubkey(), ErrorCode::Unauthorized);

        let m = &mut ctx.accounts.market;
        m.creator = ctx.accounts.owner.key();
        m.bet_mint = ctx.accounts.bet_mint.key();
        m.vault = ctx.accounts.vault.key();
        m.vault_authority = ctx.accounts.vault_authority.key();
        m.cutoff_ts = cutoff_ts;
        m.resolved = false;
        m.winning_outcome = Outcome::Unset as u8;
        m.total_yes = 0;
        m.total_no = 0;
        m.fees_accrued = 0;
        Ok(())
    }

    // ---------------- Update Cutoff (Owner-only) ----------------
    pub fn update_cutoff(ctx: Context<UpdateCutoff>, new_cutoff_ts: i64) -> Result<()> {
        require_keys_eq!(ctx.accounts.owner.key(), owner_pubkey(), ErrorCode::Unauthorized);
        let m = &mut ctx.accounts.market;
        require!(!m.resolved, ErrorCode::AlreadyResolved);

        let now = Clock::get()?.unix_timestamp;
        require!(now < m.cutoff_ts, ErrorCode::BettingClosed);
        require!(new_cutoff_ts > now, ErrorCode::InvalidCutoff);

        m.cutoff_ts = new_cutoff_ts;
        Ok(())
    }

    // ---------------- Place Bet (fee taken now; position holds NET) ----------------
    pub fn place_bet(ctx: Context<PlaceBet>, outcome: Outcome, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let now = Clock::get()?.unix_timestamp;
        let m = &mut ctx.accounts.market;

        require!(!m.resolved, ErrorCode::MarketResolved);
        require!(now < m.cutoff_ts, ErrorCode::BettingClosed);
        require_keys_eq!(m.bet_mint, ctx.accounts.bet_mint.key(), ErrorCode::WrongMint);

        // fee + net (we transfer full amount to vault; only net contributes to pools)
        let fee = amount.saturating_mul(FEE_BPS) / BPS_DENOM;
        let net = amount.saturating_sub(fee);

        // move full amount into the market vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.bettor_ata.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.bettor.to_account_info(),
                },
            ),
            amount,
        )?;

        // init / reuse position
        let p = &mut ctx.accounts.position;
        if p.amount == 0 {
            p.owner = ctx.accounts.bettor.key();
            p.market = m.key();
            p.outcome = outcome as u8;
            p.claimed = false;
        } else {
            require!(p.outcome == outcome as u8, ErrorCode::CannotSwitchSide);
        }

        // cumulative cap: <= 100 tokens (respect mint decimals)
        let decimals = ctx.accounts.bet_mint.decimals as u32;
        let max_total: u128 = 100u128
            .checked_mul(10u128.pow(decimals))
            .ok_or(ErrorCode::Overflow)?;
        let new_total = (p.amount as u128)
            .checked_add(net as u128)
            .ok_or(ErrorCode::Overflow)?;
        require!(new_total <= max_total, ErrorCode::BetExceedsLimit);

        p.amount = new_total as u64;

        // update pools with net only
        match outcome {
            Outcome::Yes => m.total_yes = m.total_yes.saturating_add(net),
            Outcome::No => m.total_no = m.total_no.saturating_add(net),
            Outcome::Unset | Outcome::Void => return err!(ErrorCode::InvalidOutcomeArg),
        }

        // accumulate fees (owner can sweep later)
        m.fees_accrued = m.fees_accrued.saturating_add(fee);
        Ok(())
    }

    // ---------------- Resolve Market (Owner-only) ----------------
    // Auto-voids if one side has no net bets. Fees are NOT refunded.
    pub fn resolve_market(ctx: Context<ResolveMarket>, winning_outcome: Outcome) -> Result<()> {
        require_keys_eq!(ctx.accounts.owner.key(), owner_pubkey(), ErrorCode::Unauthorized);

        let m = &mut ctx.accounts.market;
        require!(!m.resolved, ErrorCode::AlreadyResolved);

        // must be past cutoff
        let now = Clock::get()?.unix_timestamp;
        require!(now >= m.cutoff_ts, ErrorCode::TooEarly);

        // auto-void if one pool is zero
        let auto_void = m.total_yes == 0 || m.total_no == 0;

        m.resolved = true;
        m.winning_outcome = if auto_void {
            Outcome::Void as u8
        } else {
            // only Yes/No allowed when not void
            match winning_outcome {
                Outcome::Yes | Outcome::No => winning_outcome as u8,
                _ => return err!(ErrorCode::InvalidOutcomeArg),
            }
        };
        Ok(())
    }

    // ---------------- Claim Winnings / Refund (winners or void) ----------------
    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let m = &mut ctx.accounts.market;
        let p = &mut ctx.accounts.position;

        require!(m.resolved, ErrorCode::NotResolved);
        require!(!p.claimed, ErrorCode::AlreadyClaimed);
        require_keys_eq!(p.market, m.key(), ErrorCode::WrongMarket);
        require_keys_eq!(ctx.accounts.bet_mint.key(), m.bet_mint, ErrorCode::WrongMint);

        // payout amount
        let payout: u64 = if m.winning_outcome == Outcome::Void as u8 {
            // void => refund NET (fees were already kept on place_bet)
            require!(p.amount > 0, ErrorCode::NoPayout);
            p.amount
        } else {
            // winners only
            require!(p.outcome == m.winning_outcome, ErrorCode::NoPayout);

            let total_yes = m.total_yes as u128;
            let total_no = m.total_no as u128;
            let total_pool = total_yes
                .checked_add(total_no)
                .ok_or(ErrorCode::Overflow)?;
            let winning_pool: u128 = if m.winning_outcome == Outcome::Yes as u8 {
                total_yes
            } else {
                total_no
            };
            require!(winning_pool > 0, ErrorCode::NoPayout);

            let user_amt = p.amount as u128;
            let payout_u128 = total_pool
                .checked_mul(user_amt)
                .ok_or(ErrorCode::Overflow)?
                / winning_pool;
            u64::try_from(payout_u128).map_err(|_| ErrorCode::Overflow)?
        };

        // PDA signer seeds
        let market_key = m.key();
        let bump: u8 = ctx.bumps.vault_authority;
        let seeds: &[&[u8]] = &[VAULT_AUTH_SEED, market_key.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        // transfer from vault to bettor
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.bettor_ata.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer,
            ),
            payout,
        )?;

        p.claimed = true;
        Ok(())
    }

    // ---------------- Sweep Fees (Owner-only) ----------------
    pub fn sweep_fees(ctx: Context<SweepFees>) -> Result<()> {
        require_keys_eq!(ctx.accounts.owner.key(), owner_pubkey(), ErrorCode::Unauthorized);

        let m = &mut ctx.accounts.market;
        let amount = m.fees_accrued;
        require!(amount > 0, ErrorCode::NoFees);

        let market_key = m.key();
        let bump: u8 = ctx.bumps.vault_authority;
        let seeds: &[&[u8]] = &[VAULT_AUTH_SEED, market_key.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.owner_fee_ata.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        m.fees_accrued = 0;
        Ok(())
    }
}

// ---------------------- State ----------------------
#[account]
pub struct Market {
    pub creator: Pubkey,        // 32
    pub bet_mint: Pubkey,       // 32
    pub vault: Pubkey,          // 32 (ATA)
    pub vault_authority: Pubkey,// 32 (PDA)
    pub cutoff_ts: i64,         // 8
    pub resolved: bool,         // 1
    pub winning_outcome: u8,    // 1 (0=Unset, 1=Yes, 2=No, 3=Void)
    pub total_yes: u64,         // 8 (net after fees)
    pub total_no: u64,          // 8 (net after fees)
    pub fees_accrued: u64,      // 8
}
impl Market {
    pub const LEN: usize = 8  // disc
        + 32 + 32 + 32 + 32
        + 8 + 1 + 1 + 8 + 8 + 8;
}

#[account]
pub struct Position {
    pub owner: Pubkey,   // 32
    pub market: Pubkey,  // 32
    pub outcome: u8,     // 1 (1 yes, 2 no)
    pub claimed: bool,   // 1
    pub amount: u64,     // 8 (accumulated NET after fee)
}
impl Position {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 1 + 8;
}

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Unset = 0,
    Yes   = 1,
    No    = 2,
    Void  = 3, // internal marker on resolution when a side has zero net
}

// ---------------------- Accounts ----------------------
#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(init, payer = owner, space = Market::LEN)]
    pub market: Account<'info, Market>,

    pub bet_mint: Account<'info, Mint>,

    /// CHECK: PDA authority (no data)
    #[account(seeds = [VAULT_AUTH_SEED, market.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = owner,
        associated_token::mint = bet_mint,
        associated_token::authority = vault_authority
    )]
    pub vault: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct UpdateCutoff<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,

    #[account(mut, has_one = bet_mint)]
    pub market: Account<'info, Market>,

    pub bet_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = bet_mint,
        associated_token::authority = bettor
    )]
    pub bettor_ata: Account<'info, TokenAccount>,

    /// CHECK: PDA authority (no data)
    #[account(seeds = [VAULT_AUTH_SEED, market.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = bet_mint,
        associated_token::authority = vault_authority
    )]
    pub vault: Account<'info, TokenAccount>,

    // Fixed literal owner address (fee receiver) – used for initializing fee ATA
    /// CHECK: matches OWNER
    #[account(address = owner_pubkey())]
    pub owner: UncheckedAccount<'info>,

    // Owner's fee ATA (init if missing; payer = bettor)
    #[account(
        init_if_needed,
        payer = bettor,
        associated_token::mint = bet_mint,
        associated_token::authority = owner
    )]
    pub owner_fee_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = bettor,
        space = Position::LEN,
        seeds = [POSITION_SEED, market.key().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,

    #[account(mut, has_one = bet_mint)]
    pub market: Account<'info, Market>,

    pub bet_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = bet_mint,
        associated_token::authority = bettor
    )]
    pub bettor_ata: Account<'info, TokenAccount>,

    /// CHECK: PDA authority (no data)
    #[account(seeds = [VAULT_AUTH_SEED, market.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = bet_mint,
        associated_token::authority = vault_authority
    )]
    pub vault: Account<'info, TokenAccount>,

    // Close the position to the bettor after successful claim
    #[account(
        mut,
        close = bettor,
        seeds = [POSITION_SEED, market.key().as_ref(), bettor.key().as_ref()],
        bump,
        constraint = position.owner == bettor.key() @ ErrorCode::Unauthorized
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SweepFees<'info> {
    pub owner: Signer<'info>,

    #[account(mut, has_one = bet_mint)]
    pub market: Account<'info, Market>,

    pub bet_mint: Account<'info, Mint>,

    /// CHECK: PDA authority (no data)
    #[account(seeds = [VAULT_AUTH_SEED, market.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = bet_mint,
        associated_token::authority = vault_authority
    )]
    pub vault: Account<'info, TokenAccount>,

    // Owner fee destination
    #[account(
        mut,
        associated_token::mint = bet_mint,
        associated_token::authority = owner
    )]
    pub owner_fee_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ---------------------- Utils & Errors ----------------------
fn owner_pubkey() -> Pubkey {
    Pubkey::from_str(OWNER).unwrap()
}

#[error_code]
pub enum ErrorCode {
    #[msg("Only the owner can perform this action.")]
    Unauthorized,
    #[msg("Betting period is closed.")]
    BettingClosed,
    #[msg("Market already resolved.")]
    AlreadyResolved,
    #[msg("This market is resolved.")]
    MarketResolved,
    #[msg("Wrong bet mint for this market.")]
    WrongMint,
    #[msg("Bet exceeds the 100-token limit.")]
    BetExceedsLimit,
    #[msg("Arithmetic overflow.")]
    Overflow,
    #[msg("Market not resolved.")]
    NotResolved,
    #[msg("No payout for this position.")]
    NoPayout,
    #[msg("Position already claimed.")]
    AlreadyClaimed,
    #[msg("Wrong market for position.")]
    WrongMarket,
    #[msg("Cannot switch sides after placing a bet.")]
    CannotSwitchSide,
    #[msg("Invalid amount.")]
    InvalidAmount,
    #[msg("No fees available to sweep.")]
    NoFees,
    #[msg("New cutoff must be in the future.")]
    InvalidCutoff,
    #[msg("Too early to resolve.")]
    TooEarly,
    #[msg("Invalid outcome argument.")]
    InvalidOutcomeArg,
}
