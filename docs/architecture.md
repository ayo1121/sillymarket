# Architecture Documentation

## Authentication & Authorization

### Custom SIWS (Sign-In With Solana)

The application uses a **custom SIWS authentication flow** managed entirely by the Node.js backend server, **not** Supabase Auth.

#### Authentication Flow
1. User connects wallet via Solana Wallet Adapter
2. Frontend requests a nonce from `/auth/siws/start`
3. User signs the message with their wallet
4. Frontend sends signed message to `/auth/siws/finish`
5. Server validates signature and creates a session
6. Session is stored server-side and tracked via HTTP-only cookies

#### Key Implications
- **Supabase `auth.uid()` is NOT used** by the frontend
- Frontend Supabase client operates in **anonymous mode**
- All authenticated writes must go through the Node.js server API
- RLS policies relying on `auth.uid()` effectively restrict writes to server/service role only

---

## Data Sources & Single Source of Truth

### User Data: `public.users`

**Table**: `public.users`  
**Managed By**: Node.js Server (via `DATABASE_URL`)  
**Schema**: `id uuid`, `pubkey text`, `username text`, `created_at timestamptz`

**Frontend Access**:
- Read via Supabase client (RLS allows public SELECT)
- Write via Node.js API (`/user/username`)

**Usage**:
- `fetchUsernamesForPubkeys()` in `read.ts`
- `fetchMarketsMetadataByPubkeys()` in `markets.ts` (for creator names)
- User profile pages, market cards, leaderboards

**Important**: The `public.profiles` table (if it exists) is **deprecated** and should not be used. It was tied to Supabase Auth (`auth.users`) which is not active in this application.

---

### Market Data

**On-Chain (Solana Program)**: Source of truth for market state, pools, resolution  
**Supabase `public.markets`**: Metadata (question, description, image_url, answers)

**Frontend Flow**:
1. Fetch on-chain market account via Anchor
2. Enrich with metadata from `public.markets` (Supabase)
3. Merge into `UIMarket` type

**Writes**:
- On-chain: Via Solana transactions (create, bet, resolve)
- Metadata: Via Node.js server or Edge Functions (RLS blocks frontend writes)

---

### Bet Data

**On-Chain (Solana Program)**: Source of truth for positions, stakes, outcomes  
**Supabase `public.bets`**: Indexed bet events (tx_sig, username, timestamp, pools_after)

**Frontend Flow**:
1. Fetch on-chain `Position` accounts for user's bets
2. Enrich with `public.bets` for transaction signatures and history
3. Display in MyBets, UserProfile, MarketDetails

**Indexing**:
- Helius webhook → Supabase Edge Function (`index_bet_event`)
- Frontend **never writes** to `public.bets` (RLS enforced)

---

### Comments

**Table**: `public.comments`  
**Managed By**: Node.js Server (via `DATABASE_URL`)  
**RLS**: Disabled (server handles authorization)

**Frontend Flow**:
- Read via Node.js API (`GET /comments?marketPubkey=...`)
- Write via Node.js API (`POST /comments`)

---

## Row Level Security (RLS) Policies

### Summary

| Table | Frontend Access | Write Access |
|-------|----------------|--------------|
| `users` | SELECT (public) | Server only (via `DATABASE_URL`) |
| `markets` | SELECT (public) | Service role / Server only |
| `bets` | SELECT (public) | Service role only (Edge Function) |
| `comments` | RLS disabled | Server only (via `DATABASE_URL`) |
| `siws_nonces` | Blocked | Server only |

### Key Points

1. **Frontend writes are blocked** by RLS for all critical tables
2. **Server bypasses RLS** because it connects with `DATABASE_URL` (full PostgreSQL access)
3. **Edge Functions** use service role key to write to `bets` and `markets`
4. **Frontend Supabase client** is read-only for most tables

---

## Security Best Practices

### ✅ DO
- Use Node.js API for all authenticated writes (comments, username updates)
- Use Supabase client for read-only operations (markets, bets, users)
- Validate all inputs on the server before writing to database
- Use RLS policies as defense-in-depth (even though frontend is anon)

### ❌ DON'T
- Attempt to write directly to Supabase from frontend
- Rely on `auth.uid()` in RLS policies (it will always be null)
- Use `public.profiles` table (deprecated, tied to unused Supabase Auth)
- Bypass server APIs for authenticated operations

---

## Data Flow Diagrams

### User Authentication
```
Wallet → Frontend → Node.js Server → PostgreSQL (users table)
                  ↓
            Session Cookie
```

### Market Creation
```
Wallet → Solana Program (on-chain) → Helius → Edge Function → Supabase (markets)
```

### Betting
```
Wallet → Solana Program (position) → Helius → Edge Function → Supabase (bets)
       ↓
   Frontend reads from Supabase for history/tx_sig
```

### Comments
```
Frontend → Node.js API → PostgreSQL (comments table)
```

---

## Migration Notes

If you need to modify the database schema or RLS policies:

1. **Always test RLS changes** in a staging environment
2. **Document any new tables** in this file
3. **Update frontend types** to match schema changes
4. **Verify Edge Functions** still have correct permissions after RLS changes

---

## References

- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [SIWS Specification](https://github.com/phantom/sign-in-with-solana)
- Full-stack audit: `docs/fullstack_audit_overview.md`
- Audit TODOs: `docs/fullstack_audit_todos.md`
