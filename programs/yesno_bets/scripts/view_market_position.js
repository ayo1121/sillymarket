const { Connection, PublicKey } = require('@solana/web3.js');

const connection = new Connection(
  process.env.RPC_URL || 'http://localhost:8899',
  'confirmed'
);

async function viewMarketPosition() {
  console.log('View market position example');
}

viewMarketPosition().catch(console.error);
