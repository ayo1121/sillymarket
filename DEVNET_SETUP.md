# YesNo Markets - Devnet Deployment Guide

This guide walks you through deploying YesNo Markets to Solana devnet with your own program ID and owner wallet.

## 📋 Prerequisites

1. **Solana CLI installed**
   ```bash
   sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
   ```

2. **Anchor CLI installed**
   ```bash
   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
   avm install latest
   avm use latest
   ```

3. **Node.js 18+ and npm**

## 🔑 Step 1: Create Owner Wallet

```bash
# Create a new keypair for devnet owner
solana-keygen new --outfile ~/.config/solana/devnet-owner.json

# Set Solana CLI to use devnet
solana config set --url https://api.devnet.solana.com

# Airdrop devnet SOL to your owner wallet
solana airdrop 2 $(solana-keygen pubkey ~/.config/solana/devnet-owner.json)

# Verify balance
solana balance $(solana-keygen pubkey ~/.config/solana/devnet-owner.json)
```

**Save this info:**
- Owner Pubkey: `solana-keygen pubkey ~/.config/solana/devnet-owner.json`
- You'll need this address for configuration

## 💰 Step 2: Create or Use Test Token

### Option A: Use Devnet USDC (Recommended)
Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

### Option B: Create Your Own Test Token
```bash
# Install SPL Token CLI
cargo install spl-token-cli

# Create a new token mint with 6 decimals
spl-token create-token --decimals 6

# Note the token address (this is your mint)
# Create an associated token account for yourself
spl-token create-account <YOUR_MINT_ADDRESS>

# Mint yourself some tokens (e.g., 1,000,000 tokens)
spl-token mint <YOUR_MINT_ADDRESS> 1000000
```

**Save this info:**
- Mint Address: (from output above)
- Decimals: 6
- Symbol: (your choice, e.g., "TEST")

## 🛠️ Step 3: Configure Smart Contract

Edit `programs/yesno_bets/programs/yesno_bets/src/lib.rs`:

```rust
// Lines 14-16: Update these constants with YOUR values
pub const OWNER: Pubkey = solana_program::pubkey!("YOUR_OWNER_PUBKEY_HERE");
pub const FEE_WALLET: Pubkey = solana_program::pubkey!("YOUR_FEE_WALLET_PUBKEY_HERE");
// If using devnet USDC:
pub const BET_MINT: Pubkey = solana_program::pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
```

**Example:**
```rust
pub const OWNER: Pubkey = solana_program::pubkey!("8jKAeYqKV3xzMfKFh4Zn9XJrGPx7L1mYqP3zN4vT2wQx");
pub const FEE_WALLET: Pubkey = solana_program::pubkey!("8jKAeYqKV3xzMfKFh4Zn9XJrGPx7L1mYqP3zN4vT2wQx");
pub const BET_MINT: Pubkey = solana_program::pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
```

## 🏗️ Step 4: Build and Deploy Contract

**IMPORTANT:** The contract has been updated to use a PDA for market metadata instead of a random keypair. This makes metadata deterministically fetchable from the blockchain. Make sure you're using the latest version before building.

```bash
# Navigate to the Anchor project directory
cd programs/yesno_bets

# Build the program
anchor build

# Get the program ID from the build
solana address -k target/deploy/yesno_bets-keypair.json

# Update Anchor.toml with your program ID
# Edit Anchor.toml and replace the program ID under [programs.devnet]

# Also update declare_id! in lib.rs with the same program ID
# Edit src/lib.rs line 1: declare_id!("YOUR_PROGRAM_ID_HERE");

# Rebuild after updating program ID
anchor build

# Deploy to devnet (make sure you have enough SOL)
anchor deploy --provider.cluster devnet --provider.wallet ~/.config/solana/devnet-owner.json

# If deployment fails due to insufficient funds, airdrop more SOL:
# solana airdrop 2 $(solana-keygen pubkey ~/.config/solana/devnet-owner.json)
```

**Save this info:**
- Program ID: (from `solana address -k target/deploy/yesno_bets-keypair.json`)

## ⚙️ Step 5: Initialize Program

After deployment, you need to initialize the program stats PDA:

```bash
# From the programs/yesno_bets directory
anchor run initialize-program --provider.cluster devnet --provider.wallet ~/.config/solana/devnet-owner.json
```

Or create an initialize script (`scripts/initialize.ts`):

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { YesnoBets } from "../target/types/yesno_bets";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const program = anchor.workspace.YesnoBets as Program<YesnoBets>;
  
  const [programStats] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("program-stats")],
    program.programId
  );
  
  console.log("Initializing program...");
  console.log("Program Stats PDA:", programStats.toString());
  
  try {
    const tx = await program.methods
      .initializeProgram()
      .accounts({
        owner: provider.wallet.publicKey,
        programStats,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    
    console.log("✅ Program initialized successfully!");
    console.log("Transaction signature:", tx);
  } catch (err) {
    console.error("❌ Initialization failed:", err);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run with:
```bash
ts-node scripts/initialize.ts
```

## 🌐 Step 6: Configure Frontend

Create or update `frontends/yesno-ui/.env.local`:

```bash
# Program configuration
NEXT_PUBLIC_PROGRAM_ID=YOUR_DEPLOYED_PROGRAM_ID
NEXT_PUBLIC_OWNER=YOUR_OWNER_PUBKEY

# Token configuration
NEXT_PUBLIC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
NEXT_PUBLIC_MINT_SYMBOL=USDC
NEXT_PUBLIC_DECIMALS=6

# Network configuration
NEXT_PUBLIC_CLUSTER=devnet
NEXT_PUBLIC_RPC_ENDPOINT=https://api.devnet.solana.com
```

**Example:**
```bash
NEXT_PUBLIC_PROGRAM_ID=8jKAeYqKV3xzMfKFh4Zn9XJrGPx7L1mYqP3zN4vT2wQx
NEXT_PUBLIC_OWNER=8jKAeYqKV3xzMfKFh4Zn9XJrGPx7L1mYqP3zN4vT2wQx
NEXT_PUBLIC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
NEXT_PUBLIC_MINT_SYMBOL=USDC
NEXT_PUBLIC_DECIMALS=6
NEXT_PUBLIC_CLUSTER=devnet
NEXT_PUBLIC_RPC_ENDPOINT=https://api.devnet.solana.com
```

## 🚀 Step 7: Start Frontend

```bash
cd frontends/yesno-ui
npm install
npm run dev
```

Visit `http://localhost:3000` and:
1. Connect your owner wallet (using Phantom, Solflare, etc.)
2. Make sure your wallet is set to devnet
3. Get some devnet USDC from a faucet if needed

## 🧪 Step 8: Test the Platform

### Create Your First Market

1. Go to `/create` page
2. Fill in:
   - Question: "Will it rain tomorrow?"
   - Category: "Weather"
   - Cutoff: 60 (minutes)
3. Click "Create Market"
4. Approve the transaction in your wallet

### Get Test Tokens

If using devnet USDC:
```bash
# Use a devnet USDC faucet (search online)
# Or create your own test tokens and airdrop them
```

If using your own token:
```bash
# Mint tokens to your wallet
spl-token mint <YOUR_MINT_ADDRESS> 1000 <YOUR_WALLET_ADDRESS>
```

### Place Test Bets

1. Navigate to your created market
2. Click "Yes" or "No"
3. Enter amount
4. Place bet
5. Approve transaction

### Test Admin Functions (Owner Only)

1. On a market page, scroll to "Admin Controls" (only visible to owner)
2. Test:
   - **Update Cutoff**: Change betting deadline
   - **Pause Market**: Emergency pause trading
   - **Update Fee Receiver**: Change where fees go

### Resolve Market

1. Wait for cutoff to pass
2. Click "Resolve Market"
3. Select winning outcome
4. Approve transaction

### Claim Winnings

1. If you bet on winning side
2. Click "Claim Winnings"
3. Receive your tokens

## 📊 Monitoring & Debugging

### Check Program Logs
```bash
solana logs <YOUR_PROGRAM_ID> --url devnet
```

### Check Account Data
```bash
# Check market account
solana account <MARKET_PUBKEY> --url devnet

# Check program stats PDA
solana account <PROGRAM_STATS_PDA> --url devnet
```

### View Transactions
Visit Solana Explorer:
- `https://explorer.solana.com/?cluster=devnet`
- Search for your program ID or transaction signatures

## 🐛 Troubleshooting

### "Insufficient funds" error
```bash
# Airdrop more SOL
solana airdrop 2 $(solana-keygen pubkey ~/.config/solana/devnet-owner.json)
```

### "Program not found" error
- Verify your program ID in `.env.local` matches deployed program
- Check deployment succeeded: `solana program show <PROGRAM_ID> --url devnet`

### "Account does not exist" error
- Make sure you initialized the program (Step 5)
- Verify program stats PDA exists

### Wallet connection issues
- Make sure wallet is set to devnet
- Clear browser cache
- Try different wallet (Phantom, Solflare, etc.)

### Transaction fails with custom error
- Check program logs: `solana logs <PROGRAM_ID> --url devnet`
- Common errors:
  - `NotOwner`: Only owner can perform this action
  - `BettingClosed`: Cutoff time has passed
  - `MarketNotResolved`: Need to resolve market first
  - `AlreadyResolved`: Market already resolved
  - `InsufficientFunds`: Not enough tokens in vault

## 🔐 Security Reminders

- ✅ **Never commit** your keypair files to git
- ✅ **Never share** your private keys
- ✅ **Devnet only**: This is for testing, not real money
- ✅ **Update constants**: Always update OWNER and FEE_WALLET before deploying
- ✅ **Test thoroughly**: Test all functions on devnet before considering mainnet

## 📝 Summary Checklist

- [ ] Created owner wallet and funded with devnet SOL
- [ ] Configured contract with owner pubkey and mint address
- [ ] Built and deployed contract to devnet
- [ ] Initialized program (program_stats PDA)
- [ ] Configured frontend `.env.local` with correct values
- [ ] Started frontend and connected wallet
- [ ] Created test market successfully
- [ ] Placed test bets
- [ ] Tested admin functions (owner only)
- [ ] Resolved market
- [ ] Claimed winnings

## 🎯 Next Steps

Once everything works on devnet:
1. Consider adding more features
2. Improve UI/UX based on testing
3. Add comprehensive error handling
4. Implement unit tests
5. Security audit before mainnet
6. Get legal advice for prediction markets
7. Plan tokenomics and fee structure

---

**Need help?** Check the logs, Solana documentation, or Anchor documentation for more details.
