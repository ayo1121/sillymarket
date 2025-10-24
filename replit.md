# Overview

A decentralized prediction market platform built on Solana, allowing users to create binary (yes/no) markets, place bets, and claim winnings. The system consists of a Solana program (smart contract) for on-chain bet settlement and a Next.js web application providing a Windows 95-themed user interface.

The platform enables:
- Creating prediction markets with custom questions and deadlines
- Placing bets on either YES or NO outcomes using SPL tokens
- Automatic position tracking for each user
- Market resolution by authorized owners
- Claiming winnings after market resolution
- Activity feed showing recent transactions

# User Preferences

Preferred communication style: Simple, everyday language.

# Recent Changes

## October 24, 2025 - Vercel to Replit Migration
- **Environment Migration**: Successfully migrated Next.js application from Vercel to Replit
- **Port Configuration**: Updated dev and start scripts to bind to 0.0.0.0:5000 for Replit compatibility
- **Dependencies**: Installed Python 3.11 and system packages (pkg-config, libusb1) for native module compilation
- **Tailwind CSS Fix**: Updated postcss.config.mjs from Tailwind v4 (@tailwindcss/postcss) to Tailwind v3 (tailwindcss + autoprefixer) for Next.js 16 Turbopack compatibility
- **Next.js Config**: Added allowedDevOrigins to next.config.ts to suppress cross-origin warnings
- **Deployment**: Configured autoscale deployment with proper build and start commands for production
- **Environment Variables**: All Solana configuration variables stored securely in Replit Secrets

# System Architecture

## Frontend Architecture

**Technology Stack:**
- Next.js 16 with App Router (React 19)
- TypeScript for type safety
- Tailwind CSS for styling with custom Windows 95 theme
- Solana wallet adapter for blockchain connectivity

**Key Design Decisions:**
- **Client-Side Rendering**: Core betting functionality renders client-side to access wallet adapters and maintain real-time blockchain state
- **Retro UI Theme**: Windows 95 aesthetic with custom CSS classes (`btn95`, `frame`, `titlebar`) for distinctive branding
- **Component Architecture**: Modular components (`ConnectGate`, `MintBadge`, `Toast`) provide reusable UI patterns
- **Custom Hooks**: `useMarketSnapshot` and `useUserMarketSnapshot` encapsulate blockchain data fetching logic with automatic retries and caching
- **Error Handling**: Centralized error decoding (`txError.ts`, `errors.ts`) translates Anchor program errors into user-friendly messages

**Rationale**: App Router enables server components for static content while maintaining client interactivity. The retro theme differentiates the platform visually. Custom hooks prevent component bloat and enable testing.

## Backend Architecture

**Solana Program (Anchor Framework):**
- Written in Rust using Anchor 0.32
- Program ID: Configured via environment variable
- Manages market state, positions, and settlement logic on-chain

**API Routes (Next.js):**
- RESTful endpoints under `/api/` for:
  - Market listing and retrieval
  - Transaction building (place bet, resolve, claim)
  - Activity feed aggregation
  - Blockhash caching

**Transaction Building Pattern:**
- Action-style API endpoints (`/api/actions/*`) build unsigned transactions server-side
- Client signs and submits transactions
- Supports versioned transactions (v0) with lookup tables
- Includes compute budget optimization

**Rationale**: Separating transaction building to the server prevents exposing RPC endpoints to clients, enables rate limiting, and centralizes instruction construction logic. Versioned transactions reduce transaction size and costs.

## Data Storage

**On-Chain State (Solana Accounts):**
- **Market Account**: Stores question, pools (yes/no atoms), cutoff time, resolution status, mint address
- **Position Account**: Tracks individual user bets (bettor, market, side, amount)
- **Vault Authority PDA**: Controls token vault using program-derived addresses

**Client-Side Storage:**
- **sessionStorage**: Caches activity feed data (30s TTL) to reduce RPC calls
- **localStorage**: Persists market names/titles for offline display (`yesno:name:v1` key)

**IDL (Interface Definition Language):**
- JSON schema defining program accounts, instructions, and errors
- Located at `src/idl/yesno_bets.json`
- Used by BorshCoder for serialization/deserialization

**Rationale**: On-chain storage ensures trustless settlement. Client caching reduces RPC load and improves UX. Local storage provides graceful degradation when RPC is unavailable.

## Authentication & Authorization

**Wallet-Based Authentication:**
- Solana wallet adapters (Phantom, Solflare, Ledger) for user identity
- Public key serves as user identifier
- Transaction signatures prove ownership

**Authorization Model:**
- **Owner-only actions**: Market creation and resolution restricted to configured OWNER public key
- **User actions**: Any connected wallet can place bets or claim winnings
- **PDA-based security**: Vault authority derived from market address prevents unauthorized withdrawals

**Rationale**: Wallet signatures eliminate password management. On-chain authorization via PDAs ensures only valid transactions succeed, even if frontend is compromised.

## External Dependencies

**Blockchain Services:**
- **Solana RPC**: Primary blockchain interaction (configurable endpoint via `NEXT_PUBLIC_RPC_URL` or `RPC_URL`)
- **Helius RPC** (optional): Enhanced RPC with transaction parsing for activity feeds (`HELIUS_RPC_URL`)
- **Solscan/Explorer**: Transaction viewing links generated for user verification

**Solana Program Libraries:**
- **SPL Token**: Handles token transfers and associated token accounts
- **SPL Memo**: Attaches metadata to transactions (bet side, market name)
- **@coral-xyz/anchor**: Framework for interacting with Rust programs

**Frontend Libraries:**
- **@solana/wallet-adapter-**: Suite of packages for wallet connectivity
- **@solana/web3.js**: Core Solana JavaScript SDK
- **html2canvas**: Generates shareable images of market positions

**Development Tools:**
- **Anchor CLI**: Building and deploying Solana programs
- **TypeScript**: Static typing across frontend and scripts
- **ESLint**: Code quality enforcement

**Environment Variables Required:**
- `NEXT_PUBLIC_PROGRAM_ID`: Deployed Solana program address
- `NEXT_PUBLIC_MINT`: SPL token used for betting
- `NEXT_PUBLIC_OWNER`: Authorized wallet for admin actions
- `NEXT_PUBLIC_DECIMALS`: Token decimal places (typically 6)
- `NEXT_PUBLIC_RPC_URL` (optional): Custom RPC endpoint
- `RPC_URL` (server-side): Backend RPC for API routes
- `CORS_ALLOW_ORIGIN` (optional): Allowed origins for API CORS

**Rate Limiting & Security:**
- In-memory rate limiting (60 req/min per IP) on API routes
- CORS protection with origin validation
- No private keys stored in codebase (enforced via SECURITY.md)
- Environment variable validation at build time

**Rationale**: Helius provides enhanced transaction data unavailable in standard RPC. Anchor simplifies program interaction. Rate limiting prevents abuse. Strict CORS and secret management protect user funds.