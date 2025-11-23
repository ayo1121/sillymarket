# Helius Webhook Configuration Check

## Current Status
✅ Edge function deployed and active (version 44)
✅ All secrets configured correctly
❓ Helius webhook - **NEEDS VERIFICATION**

## What to Check

### 1. Go to Helius Dashboard
URL: https://dev.helius.xyz/webhooks

### 2. Look for Existing Webhook
Check if a webhook exists for your project.

### 3. If Webhook Exists - Verify These Settings:
- **Webhook URL**: `https://ibuzpjefotihoagusrqz.supabase.co/functions/v1/index_bet_event`
- **Account Addresses**: Must include `8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb`
- **Webhook Type**: Enhanced Transactions or Raw Transactions
- **Status**: Active
- **Network**: Your network (devnet or mainnet-beta)

### 4. If Webhook Does NOT Exist - Create One:

**Steps to create:**
1. Click "Create Webhook" or "New Webhook"
2. Fill in:
   - **Webhook URL**: `https://ibuzpjefotihoagusrqz.supabase.co/functions/v1/index_bet_event`
   - **Webhook Type**: Select "Enhanced Transactions"
   - **Account Addresses**: Add `8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb`
   - **Transaction Types**: Select "Any" or "All"
   - **Network**: Select your network (devnet or mainnet-beta)
3. Click "Create" or "Save"

### 5. After Webhook is Configured:
1. Place a test bet on any market
2. Wait 30 seconds
3. Check Helius webhook logs to see if it was triggered
4. Check Supabase edge function logs for activity
5. Check bets table for new rows

## Why This Matters

The bet indexing flow is:
```
Place Bet → Solana Blockchain → Helius Webhook → Edge Function → Supabase Database
```

Without the webhook, the edge function never gets called, so bets are never indexed.

## Next Steps

Please check the Helius dashboard and let me know:
- Does a webhook exist?
- If yes, what are its current settings?
- If no, do you need help creating one?
