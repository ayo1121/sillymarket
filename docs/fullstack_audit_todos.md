# Full Stack Audit Checklist & TODOs

This document contains the findings from the exhaustive full-stack audit of the **sillymarket** application.

## ✅ Completed

### 1. User vs. Profile Table Mismatch - **DONE**
- **Severity**: **CRITICAL**
- **Problem**: The Node.js server manages user identity and writes to the `public.users` table. However, frontend components (`UserProfile.tsx`, `markets.ts`) query the `public.profiles` table or `public.user_profiles` view to resolve usernames.
- **Solution Implemented**:
  - Updated `fetchUsernamesForPubkeys` in `read.ts` to query `public.users` exclusively.
  - Updated `fetchMarketsMetadataByPubkeys` in `markets.ts` to query `public.users` for creator names.
  - Removed fallback logic for `profiles` / `user_profiles`.

### 2. Bet Data Source Divergence - **DONE**
- **Severity**: **High**
- **Problem**: `MyBets.tsx` derives bet status and PnL purely from on-chain `Position` accounts, lacking metadata like `tx_sig` (transaction signature).
- **Solution Implemented**:
  - Added Supabase query to fetch `public.bets` for the connected user.
  - Enriched `BetView` interface with `txSig` field.
  - Added "View on Solscan" link to bet cards when `tx_sig` is available.

### 3. Inconsistent Status Indicators - **DONE**
- **Severity**: Medium
- **Problem**: Different pages used different status badge implementations (ResolutionPill, ad-hoc spans, etc.).
- **Solution Implemented**:
  - Created shared `MarketStatusBadge` component in `components/common/`.
  - Replaced `ResolutionPill` in `MarketDetails.tsx` with `MarketStatusBadge`.
  - Replaced ad-hoc status badges in `MyBets.tsx` with `MarketStatusBadge`.

### 6. RLS Relies on Unused Auth - **DONE**
- **Severity**: **Important Note**
- **Action**: Document this explicitly in `docs/architecture.md`.
- **Solution Implemented**:
  - Created comprehensive `docs/architecture.md` documenting:
    - Custom SIWS authentication flow
    - Supabase RLS implications
    - Single source of truth for each data entity
    - Security best practices

---

## 🎨 UI/UX & Consistency (Remaining)

### 4. Share Functionality Fragmentation
- **Severity**: Low
- **Problem**:
  - `Index.tsx` uses a `ShareMarketModal`.
  - `MarketDetails.tsx` has a "Share" button that triggers a local state share target.
  - `MyBets.tsx` has no share functionality.
- **Suggested Fix**: Extract `ShareMarketModal` logic into a global hook or context (`useShareMarket`) so it can be triggered consistently from any card or page.

### 5. "Fees Collected" Display
- **Severity**: Low
- **Problem**: Both `MarketDetails` and `MyBets` display "Fees Collected". The logic (estimated from volume) appears consistent, but ensuring they use the exact same utility function would prevent future drift.
- **Suggested Fix**: Move fee calculation logic to `src/utils/marketMath.ts`.

---

## ⚡ Performance & DX (Remaining)

### 7. Optimistic UI for Betting
- **Severity**: Low (Enhancement)
- **Observation**: `MarketDetails` polls or waits for Realtime updates after placing a bet.
- **Suggested Fix**: Implement optimistic updates in React Query to immediately show the user's new position before the chain/indexer confirms it.

### 8. Batch Fetching Optimization
- **Severity**: Low
- **Observation**: `UserProfile` fetches user positions, then batch fetches markets. This is good.
- **Suggested Fix**: Ensure `MyBets` also uses the exact same batch fetching logic (it currently does, but verify cache sharing).

---

## ✅ API Contract Verification

- **Status**: **PASSED**
- **Verified Routes**:
  - `POST /user/username`: Matches Server.
  - `GET /me`: Matches Server.
  - `POST /auth/siws/start`: Matches Server.
  - `POST /auth/siws/finish`: Matches Server.
  - `POST /comments`: Matches Server.
- **Unused Routes**: None found.

