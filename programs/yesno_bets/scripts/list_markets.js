const anchor = require('@coral-xyz/anchor');
const { PublicKey, Connection } = require('@solana/web3.js');

// Use environment variable for RPC URL
const connection = new Connection(
  process.env.RPC_URL || 'http://localhost:8899',
  'confirmed'
);

async function listMarkets() {
  console.log('Listing markets...');
  // Implementation without private keys
}

listMarkets().catch(console.error);
