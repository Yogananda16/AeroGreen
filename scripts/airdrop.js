require('dotenv').config();
const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const pubkey = new PublicKey(process.env.SOLANA_AUTHORITY_PUBKEY);
  const sig = await connection.requestAirdrop(pubkey, 2e9);
  await connection.confirmTransaction(sig);
  const bal = await connection.getBalance(pubkey);
  console.log(`✅ Balance: ${bal / 1e9} SOL`);
}

main().catch(console.error);