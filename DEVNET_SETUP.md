# Devnet Setup Guide

This project is configured to use **Solana Devnet** as the default cluster for development.

## Configuration

### Anchor CLI
- **Default cluster**: `Devnet` (set in `Anchor.toml` under `[provider].cluster`)
- **Program ID**: `8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb`
- The same program ID is configured for both `localnet` and `devnet` in `Anchor.toml`

### Frontend Environment
The frontend is configured via `client/web/.env.local`:

```env
VITE_RPC_URL=https://api.devnet.solana.com
VITE_PROGRAM_ID=8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb
VITE_COMMITMENT=confirmed
VITE_PRIORITY_MICROLAMPORTS=0
```

### Wallet Configuration
**Important**: The wallet connected in your browser (Phantom, Solflare, etc.) must be set to **Solana Devnet** network.

To switch your wallet to devnet:
- **Phantom**: Settings → Developer Mode → Change Network → Devnet
- **Solflare**: Settings → Network → Devnet

## Running the Application

1. **Start the backend server**:
   ```bash
   cd server
   npm run dev
   ```

2. **Start the frontend** (in a separate terminal):
   ```bash
   cd client/web
   npm run dev
   ```

3. **Connect your wallet** to the application and ensure it's on Devnet.

## Anchor Commands

All Anchor CLI commands will use Devnet by default:

```bash
# Deploy to devnet
anchor deploy

# Build
anchor build

# Test
anchor test --skip-local-validator
```

To use localnet instead, you can override the cluster:
```bash
anchor deploy --provider.cluster localnet
```

## Notes

- The program ID remains the same across localnet and devnet configurations
- No business logic changes are required when switching between clusters
- Make sure your wallet has devnet SOL for transactions (use a faucet if needed)

## Quick Checklist

Before running the app, verify these steps:

1. **Backend Setup**:
   ```bash
   cd server
   npm run dev
   ```
   - Should print: `✅ API listening on http://localhost:8787 (CORS: http://localhost:8080)`
   - Should show database connection status

2. **Frontend Setup**:
   ```bash
   cd client/web
   npm run dev
   ```
   - Should start Vite dev server on `http://localhost:8080`
   - Open `http://localhost:8080` in your browser

3. **Wallet Configuration**:
   - Ensure Phantom (or Solflare) is set to **Devnet** network
   - Connect wallet from the UI
   - Check browser console for `[yesno] ✅ Program initialized` message

4. **Verify Markets Load**:
   - After connecting wallet, markets should load automatically
   - If no markets exist, you'll see "no markets found. create one to get started!"

5. **Test Market Creation with Image**:
   - Navigate to "create market" page
   - Fill in question, answers, and end time
   - Upload an image (optional)
   - Submit the form
   - Image should upload to Supabase Storage before market creation
   - Market should be created on-chain and you should be redirected to the market page

