// Example: Claim winnings script
// Replace YOUR_WALLET_PATH with your actual wallet path

const anchor = require('@coral-xyz/anchor');
const { PublicKey } = require('@solana/web3.js');

async function claimWinnings() {
  // Use environment variable for wallet path
  const walletPath = process.env.WALLET_PATH || '~/.config/solana/id.json';
  console.log('Wallet path:', walletPath);
  
  // Your claim winnings logic here
  console.log('Claim winnings example - implement your logic');
}

module.exports = { claimWinnings };
