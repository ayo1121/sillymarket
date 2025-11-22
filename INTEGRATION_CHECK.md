# Backend-Frontend Integration Checklist

## ✅ Fixed Issues

1. **Header Component** - Updated to use `WalletIdentity` instead of Supabase Auth
   - Removed dependency on `useAuth()` from Supabase
   - Now uses `ConnectWalletAndUsername` component which handles SIWS authentication

## 🔧 Configuration Required

### Server Configuration (`server/.env`)
```env
APP_ORIGIN=http://localhost:8080
PORT=8787
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.rbcbyhjfjkbebjyipjqd.supabase.co:5432/postgres
SESSION_SECRET=change-me-to-random-string
```

### Frontend Configuration (`client/web/.env.local`)
```env
VITE_API_URL=http://localhost:8787
```

## 📋 Integration Points

### 1. Wallet Authentication (SIWS)
- **Frontend**: `client/web/src/components/ConnectWalletAndUsername.tsx`
- **Backend**: `server/src/index.ts` - `/auth/siws/start` and `/auth/siws/finish`
- **Flow**: Wallet connect → SIWS start → Sign message → SIWS finish → Session cookie set

### 2. Username Management
- **Frontend**: `client/web/src/components/UsernameModal.tsx`
- **Backend**: `server/src/index.ts` - `/user/username` (POST)
- **Storage**: PostgreSQL `users` table with unique username constraint

### 3. Market Creation (Solana)
- **Frontend**: `client/web/src/pages/CreateMarket.tsx`
- **Solana Program**: Uses `createMarket` from `@/solana/actions`
- **No backend required** - direct on-chain interaction

### 4. Market Listing
- **Frontend**: `client/web/src/pages/Index.tsx`
- **Solana Program**: Uses `fetchAllMarkets` from `@/solana/read`
- **No backend required** - direct on-chain read

### 5. Betting
- **Frontend**: `client/web/src/pages/Market.tsx`
- **Solana Program**: Uses `placeBet` from `@/solana/actions`
- **No backend required** - direct on-chain interaction

## 🚀 Testing Steps

1. **Start the server**:
   ```bash
   cd ~/yesno-anchor/yesno_markets/server
   npm run dev
   ```
   Should see: `API on http://localhost:8787`

2. **Start the frontend**:
   ```bash
   cd ~/yesno-anchor/yesno_markets/client/web
   npm run dev
   ```

3. **Test wallet connection**:
   - Click "connect wallet" button
   - Select a wallet
   - Should automatically trigger SIWS (sign message)
   - Username prompt should appear if no username set

4. **Test username setting**:
   - Enter a username (3-20 chars, alphanumeric + underscore)
   - Should save to database and display `@username` in header

5. **Test market creation**:
   - Navigate to create market page
   - Fill in question, answers, end date
   - Submit - should create market on-chain

6. **Test betting**:
   - Navigate to a market
   - Enter bet amount
   - Click "Yes" or "No"
   - Should place bet on-chain

## 🔍 Troubleshooting

### "Cannot connect to server" error
- Check if server is running: `curl http://localhost:8787/health`
- Verify `VITE_API_URL` in `client/web/.env.local`
- Check CORS settings in server (should allow `http://localhost:8080`)

### Database connection errors
- Verify `DATABASE_URL` in `server/.env`
- Test connection: `psql $DATABASE_URL -c "SELECT 1"`
- Check Supabase dashboard for connection string

### Username not saving
- Check browser console for errors
- Verify SIWS session is established (check cookies)
- Check server logs for database errors

### Wallet not connecting
- Ensure wallet extension is installed
- Check browser console for wallet adapter errors
- Verify `WalletProvider` is wrapping the app in `main.tsx`

