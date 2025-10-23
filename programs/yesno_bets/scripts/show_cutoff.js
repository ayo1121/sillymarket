const { Connection } = require('@solana/web3.js');

const connection = new Connection(
  process.env.RPC_URL || 'http://localhost:8899',
  'confirmed'
);

async function showCutoff() {
  console.log('Show cutoff example');
}

showCutoff().catch(console.error);
