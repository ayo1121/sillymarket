const anchor = require('@coral-xyz/anchor');
const { Connection } = require('@solana/web3.js');

const connection = new Connection(
  process.env.RPC_URL || 'http://localhost:8899', 
  'confirmed'
);

async function listPositions() {
  console.log('Listing positions...');
  // Safe implementation
}

listPositions().catch(console.error);
