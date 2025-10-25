# Smart Contract Deployment Guide

This guide will help you deploy your prediction market smart contract to Solana and configure your frontend.

## Prerequisites

Before deploying, you'll need:

1. **Solana CLI** installed on your local machine
2. **Anchor CLI** (version 0.32 or higher)
3. **A Solana wallet** with SOL for deployment fees
4. **Node.js** and **npm** installed

## Step 1: Install Required Tools

### Install Solana CLI

```bash
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
```

### Install Anchor CLI

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.32.1
avm use 0.32.1
```

## Step 2: Configure Your Wallet

### Generate a new wallet (or use existing)

```bash
solana-keygen new
```

This creates a wallet at `~/.config/solana/id.json`

### Set your Solana cluster

For devnet (testing):
```bash
solana config set --url https://api.devnet.solana.com
```

For mainnet (production):
```bash
solana config set --url https://api.mainnet-beta.solana.com
```

### Fund your wallet

For devnet:
```bash
solana airdrop 2
```

For mainnet, you'll need to purchase SOL and transfer it to your wallet.

## Step 3: Update Contract Configuration

### 1. Update Owner and Fee Wallet

Edit `programs/yesno_bets/programs/yesno_bets/src/lib.rs`:

```rust
pub const OWNER: &str = "YOUR_WALLET_PUBLIC_KEY_HERE";
pub const FEE_WALLET: &str = "YOUR_FEE_WALLET_PUBLIC_KEY_HERE";
```

Get your public key:
```bash
solana address
```

### 2. Update Anchor.toml

Edit `programs/yesno_bets/Anchor.toml`:

```toml
[provider]
cluster = "devnet"  # or "mainnet-beta" for production
wallet = "~/.config/solana/id.json"
```

## Step 4: Build the Program

Navigate to the program directory:
```bash
cd programs/yesno_bets
```

Build the program:
```bash
anchor build
```

This generates:
- Compiled program at `target/deploy/yesno_bets.so`
- Program ID in `target/deploy/yesno_bets-keypair.json`
- IDL at `target/idl/yesno_bets.json`

## Step 5: Get Your Program ID and Update Configuration

After building, get your program ID:
```bash
solana address -k target/deploy/yesno_bets-keypair.json
```

Copy this program ID - you'll need it for the next steps.

### Update declare_id!() with your Program ID

Edit `programs/yesno_bets/programs/yesno_bets/src/lib.rs`:

```rust
declare_id!("YOUR_NEW_PROGRAM_ID_HERE");
```

### Update Anchor.toml with your Program ID

This step is **critical** - without it, deployment will fail!

Edit `programs/yesno_bets/Anchor.toml`:

```toml
[programs.devnet]
yesno_bets = "YOUR_NEW_PROGRAM_ID_HERE"

# If deploying to mainnet, use:
# [programs.mainnet]
# yesno_bets = "YOUR_NEW_PROGRAM_ID_HERE"
```

Replace `YOUR_NEW_PROGRAM_ID_HERE` with the program ID from the previous step.

### Rebuild after updating

```bash
anchor build
```

## Step 6: Deploy to Solana

### Check deployment cost
```bash
solana program show --programs
```

### Deploy the program
```bash
anchor deploy
```

If successful, you'll see:
```
Program Id: YOUR_PROGRAM_ID
```

## Step 7: Initialize the Program

After deployment, you need to initialize the program stats account. This only needs to be done **once** after deploying.

### Install Node dependencies (if not already installed)

```bash
cd programs/yesno_bets
npm install
```

### Set up environment variables

You need to configure your Anchor provider. You have two options:

#### Option A: Export environment variables (recommended)

```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com  # or mainnet URL
export ANCHOR_WALLET=~/.config/solana/id.json
```

For mainnet:
```bash
export ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com
```

#### Option B: Use Anchor's built-in configuration

If you already ran `solana config set --url`, Anchor will use that automatically.

### Create the initialization script

Create a script at `programs/yesno_bets/scripts/initialize.js`:

```javascript
const anchor = require("@coral-xyz/anchor");
const { PublicKey } = require("@solana/web3.js");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.YesnoBets;
  
  const [programStats] = PublicKey.findProgramAddressSync(
    [Buffer.from("program-stats")],
    program.programId
  );

  console.log("Program ID:", program.programId.toBase58());
  console.log("Initializing with owner:", provider.wallet.publicKey.toBase58());
  console.log("Program Stats PDA:", programStats.toBase58());

  try {
    const tx = await program.methods
      .initializeProgram()
      .accounts({
        owner: provider.wallet.publicKey,
        programStats: programStats,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    
    console.log("✅ Program initialized successfully!");
    console.log("Transaction signature:", tx);
  } catch (error) {
    if (error.message?.includes("already in use")) {
      console.log("⚠️  Program stats already initialized");
    } else {
      console.error("❌ Error initializing program:", error);
      throw error;
    }
  }
}

main();
```

### Run the initialization script

Using Node directly (after setting environment variables):
```bash
cd programs/yesno_bets
node scripts/initialize.js
```

**OR** using Anchor CLI (automatically uses your config):
```bash
cd programs/yesno_bets
anchor run initialize
```

If using `anchor run`, add this to your `Anchor.toml` file:

```toml
[scripts]
initialize = "node scripts/initialize.js"
```

### Verify initialization

Check that the program stats account was created:
```bash
solana account <PROGRAM_STATS_PDA> --url devnet
```

Replace `<PROGRAM_STATS_PDA>` with the address printed by the initialization script.

## Step 8: Create or Use SPL Token for Betting

You'll need an SPL token mint address. You can either:

### Option A: Use an existing token (e.g., USDC)
- Devnet USDC: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- Mainnet USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

### Option B: Create your own token

```bash
spl-token create-token
spl-token create-account YOUR_TOKEN_MINT
spl-token mint YOUR_TOKEN_MINT 1000000
```

## Step 9: Configure Frontend Environment Variables

Update `frontends/yesno-ui/.env.local`:

```env
# Required: Your deployed program ID
NEXT_PUBLIC_PROGRAM_ID=YOUR_DEPLOYED_PROGRAM_ID

# Required: SPL Token mint for betting
NEXT_PUBLIC_MINT=YOUR_TOKEN_MINT_ADDRESS

# Required: Owner wallet (same as OWNER in contract)
NEXT_PUBLIC_OWNER=YOUR_WALLET_PUBLIC_KEY

# Required: Token decimals (usually 6 for most SPL tokens)
NEXT_PUBLIC_DECIMALS=6

# Optional: Cluster (devnet, testnet, or mainnet)
NEXT_PUBLIC_CLUSTER=devnet

# Optional: Custom RPC URL (leave empty for default)
NEXT_PUBLIC_RPC_URL=

# Optional: Token symbol for display
NEXT_PUBLIC_MINT_SYMBOL=TOKEN

# Server-side RPC URL
RPC_URL=https://api.devnet.solana.com
```

## Step 10: Update Frontend IDL

Copy the generated IDL to your frontend:

```bash
cp programs/yesno_bets/target/idl/yesno_bets.json frontends/yesno-ui/src/idl/yesno_bets.json
```

## Step 11: Test Your Deployment

### 1. Start the frontend
```bash
cd frontends/yesno-ui
npm run dev
```

### 2. Connect your wallet

### 3. Create a test market (owner only)
Use the create market function with:
- Question (max 280 chars)
- Category (max 50 chars)
- Cutoff timestamp (future date)

### 4. Place a test bet

### 5. Verify on Solana Explorer
Visit: `https://explorer.solana.com/address/YOUR_PROGRAM_ID?cluster=devnet`

## Available Contract Functions

Your deployed contract now supports:

1. **initialize_program** - Initialize program stats (run once after deployment)
2. **create_market** - Create a new prediction market (owner only)
3. **update_cutoff** - Update market deadline (owner only)
4. **place_bet** - Place a bet on YES or NO
5. **resolve_market** - Resolve market with winning outcome (owner only)
6. **claim_winnings** - Claim winnings after market resolution
7. **emergency_pause** - Pause/unpause a market (owner only)
8. **update_fee_receiver** - Update fee receiver for a market (owner only)
9. **get_potential_payout** - Calculate potential payout for a position

## Contract Features

### Fee System
- 2.5% fee on all bets (250 basis points)
- Fees automatically sent to FEE_WALLET
- Configurable via FEE_BPS constant

### Bet Limits
- Minimum bet: 1,000 lamports (MIN_BET_AMOUNT)
- Maximum bet per position: 100 tokens (MAX_BET_LIMIT)

### Market Duration
- Maximum: 30 days (MAX_MARKET_DURATION)

### Market Categories
Markets support custom categories for organization and filtering.

### Program Stats
Global stats tracking:
- Total markets created
- Total betting volume
- Total fees collected
- Total unique bettors

## Troubleshooting

### "Program not deployed"
- Verify program ID matches in lib.rs and .env.local
- Check cluster (devnet vs mainnet)

### "Insufficient funds"
- Ensure wallet has enough SOL
- For devnet: `solana airdrop 2`

### "Invalid owner"
- Verify OWNER constant matches your wallet public key
- Rebuild and redeploy after changing OWNER

### Frontend shows "Missing required env"
- Check all required environment variables in .env.local
- Restart the Next.js dev server after updating env vars

## Security Notes

1. **Never commit private keys** to version control
2. **Test on devnet first** before mainnet deployment
3. **Audit fee wallet** address before deploying
4. **Verify owner wallet** has secure backup
5. **Consider multisig** for production deployments

## Upgrade Strategy

To upgrade your program:

1. Make changes to lib.rs
2. Rebuild: `anchor build`
3. Deploy with `--program-id` flag:
   ```bash
   anchor deploy --program-id target/deploy/yesno_bets-keypair.json
   ```

Note: Anchor programs are upgradeable by default. The upgrade authority is the wallet that deployed the program.

## Production Checklist

Before deploying to mainnet:

- [ ] Update OWNER to secure production wallet
- [ ] Update FEE_WALLET to production fee receiver
- [ ] Test all functions thoroughly on devnet
- [ ] Verify fee calculations are correct
- [ ] Audit smart contract code
- [ ] Set up monitoring for program activity
- [ ] Prepare incident response plan
- [ ] Have sufficient SOL for deployment (~5-10 SOL)
- [ ] Back up program keypair securely
- [ ] Document all wallet addresses used

## Support

For issues with:
- **Anchor/Solana**: Check Anchor documentation at https://www.anchor-lang.com
- **Smart Contract**: Review code in `programs/yesno_bets/programs/yesno_bets/src/lib.rs`
- **Frontend**: Check Next.js logs and browser console
