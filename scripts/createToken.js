require('dotenv').config();
const { Connection, Keypair, clusterApiUrl } = require('@solana/web3.js');
const { createMint } = require('@solana/spl-token');
const bs58 = require('bs58');

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const secret   = bs58.default.decode(process.env.SOLANA_AUTHORITY_SECRET);
  const authority = Keypair.fromSecretKey(secret);

  const mint = await createMint(
    connection,
    authority,
    authority.publicKey,
    authority.publicKey,
    0
  );

  console.log('✅ Token Mint Address:', mint.toBase58());
}

main().catch(console.error);