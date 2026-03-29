require('dotenv').config();
const { Connection, Keypair, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount, mintTo } = require('@solana/spl-token');
const bs58 = require('bs58');

const connection = new Connection(clusterApiUrl(process.env.SOLANA_NETWORK || 'devnet'), 'confirmed');
const authority  = Keypair.fromSecretKey(bs58.default.decode(process.env.SOLANA_AUTHORITY_SECRET));
const MINT       = new PublicKey(process.env.SOLANA_MINT_ADDRESS);

function baselineCO2(distanceKm) {
  return parseFloat(((distanceKm * 4.5 * 3.16) / 1000).toFixed(1));
}

async function mintCarbonCredits(toWalletAddress, optimizedCO2t, distanceKm) {
  const baseline = baselineCO2(distanceKm);
  const saved    = parseFloat((baseline - optimizedCO2t).toFixed(1));
  const tokens   = Math.floor(saved);

  if (tokens <= 0) return { tokens: 0, saved, baseline };

  const toWallet  = new PublicKey(toWalletAddress);
  const tokenAcct = await getOrCreateAssociatedTokenAccount(
    connection, authority, MINT, toWallet
  );

  await mintTo(connection, authority, MINT, tokenAcct.address, authority, tokens);

  console.log(`✅ Minted ${tokens} carbon credits → ${toWalletAddress}`);
  return { tokens, saved, baseline };
}

async function getTokenBalance(walletAddress) {
  try {
    const wallet = new PublicKey(walletAddress);
    const acct   = await getOrCreateAssociatedTokenAccount(
      connection, authority, MINT, wallet
    );
    return Number(acct.amount);
  } catch {
    return 0;
  }
}

module.exports = { mintCarbonCredits, getTokenBalance, baselineCO2 };