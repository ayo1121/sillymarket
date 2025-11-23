# Edge Function Setup Guide

## Problem: Bets Not Being Indexed

If bets are not appearing in `public.bets` table, it's likely because:
1. Edge function environment variables are not configured
2. Helius webhook is not set up

## Required Setup

### Step 1: Configure Edge Function Secrets

Edge functions use **Deno environment variables**, separate from frontend `.env.local`.

```bash
cd client/web

# Get your service role key from: Supabase Dashboard > Settings > API
# Copy the "service_role" key (NOT the anon key!)

# Set Supabase URL (same as your VITE_SUPABASE_URL)
npx supabase secrets set SUPABASE_URL=https://ibuzpjefotihoagusrqz.supabase.co

# Set service role key
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Set Helius API key (from https://dev.helius.xyz)
npx supabase secrets set HELIUS_API_KEY=your_helius_api_key_here

# Optional: Set program ID (defaults to devnet if not set)
npx supabase secrets set YESNO_PROGRAM_ID=8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb
```

**Verify secrets are set:**
```bash
npx supabase secrets list
```

Expected output:
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
HELIUS_API_KEY
YESNO_PROGRAM_ID
```

### Step 2: Deploy Edge Function

```bash
cd client/web
npx supabase functions deploy index_bet_event
```

**Expected**: Deployment succeeds with version number.

### Step 3: Configure Helius Webhook

1. Go to https://dev.helius.xyz/webhooks
2. Click "Create Webhook" (or verify existing webhook)
3. Configure:
   - **Webhook URL**: `https://ibuzpjefotihoagusrqz.supabase.co/functions/v1/index_bet_event`
   - **Webhook Type**: Enhanced Transactions
   - **Account Addresses**: Add `8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb`
   - **Transaction Types**: Any/All
   - **Network**: devnet (or mainnet-beta for production)
4. Save webhook

### Step 4: Test the Setup

**Place a test bet:**
1. Open app: http://localhost:5173
2. Connect wallet
3. Place bet on any devnet market
4. Wait 10 seconds

**Check edge function logs:**
```bash
npx supabase functions logs index_bet_event --tail
```

**Expected logs:**
```
[bets-indexer] ✅ All environment variables configured
[bets-indexer] Supabase URL: https://ibuzpjefotihoagusrqz.supabase.co
[bets-indexer] Received request: {...}
[bets-indexer] Inserting bet row: {...}
[bets-indexer] ✅ Row inserted successfully: {...}
```

**Check Supabase database:**
1. Go to Supabase Dashboard > Table Editor
2. Open `bets` table
3. Look for new row with your market's `market_pubkey`

**Check frontend:**
1. Reload market details page
2. Verify:
   - Probability chart shows data
   - Recent activity shows your bet
   - Outcome sparklines update

## Troubleshooting

### Error: "Missing required environment variables"

**Cause**: Secrets not set in Supabase.

**Fix**: Run Step 1 above to set all required secrets.

### No logs appearing

**Cause**: Helius webhook not configured or not triggering.

**Fix**:
1. Verify webhook exists at https://dev.helius.xyz/webhooks
2. Check webhook URL matches your Supabase project
3. Verify account address is correct
4. Test webhook delivery in Helius dashboard

### Logs show "INSERT FAILED"

**Cause**: Schema mismatch or RLS policy blocking insert.

**Fix**:
1. Verify migrations 0007 and 0008 are applied
2. Check RLS policies allow service role to insert
3. Review error details in logs

### Frontend still shows "no activity"

**Cause**: Frontend querying wrong project or market_pubkey mismatch.

**Fix**:
1. Verify `.env.local` has correct `VITE_SUPABASE_URL`
2. Check that `market_pubkey` in database matches market pubkey in frontend
3. Check browser console for errors

## Architecture

```
Bet Transaction → Solana Blockchain
                       ↓
                 Helius Webhook
                       ↓
              Edge Function (index_bet_event)
                       ↓
              Supabase Database (public.bets)
                       ↓
              Frontend (Realtime subscription)
                       ↓
              UI Updates (charts, activity)
```

## Environment Variables Reference

### Frontend (.env.local)
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` - Anon key (safe for frontend)

### Edge Function (Supabase secrets)
- `SUPABASE_URL` - Same as VITE_SUPABASE_URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (NEVER in frontend!)
- `HELIUS_API_KEY` - Helius API key for transaction decoding
- `YESNO_PROGRAM_ID` - Solana program ID (optional, has default)
