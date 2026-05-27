'use strict';

const { createClient } = require('@supabase/supabase-js');
const CryptoJS  = require('crypto-js');
const {
  Keypair,
  Connection,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const fs = require('fs');
const os = require('os');

const SECRET_KEY = process.env.SECRET_KEY;
if (!SECRET_KEY) throw new Error('SECRET_KEY is not set in environment');

if (!process.env.SUPABASE_URL)         throw new Error('SUPABASE_URL is not set in environment');
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY is not set in environment');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Encrypt a byte array → AES ciphertext string
function encrypt(secretKeyArray) {
  return CryptoJS.AES.encrypt(JSON.stringify(secretKeyArray), SECRET_KEY).toString();
}

// Decrypt ciphertext → Keypair
function decrypt(ciphertext) {
  const bytes   = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);
  const decoded = bytes.toString(CryptoJS.enc.Utf8);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(decoded)));
}

/**
 * Create a new Solana keypair for userId and persist it encrypted.
 * Idempotent — returns existing wallet if already created.
 * New wallets are auto-funded with 2 SOL from the deployer wallet.
 */
async function createWallet(userId) {
  const { data: existing, error: fetchError } = await supabase
    .from('wallets')
    .select('public_key')
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchError) throw new Error(`Supabase fetch error: ${fetchError.message}`);

  if (existing) {
    return { publicKey: existing.public_key, created: false };
  }

  const keypair = Keypair.generate();
  const encKey  = encrypt(Array.from(keypair.secretKey));

  const { error: insertError } = await supabase
    .from('wallets')
    .insert({
      user_id:    userId,
      enc_key:    encKey,
      public_key: keypair.publicKey.toBase58(),
      created_at: new Date().toISOString(),
    });

  if (insertError) throw new Error(`Supabase insert error: ${insertError.message}`);

  const connection = new Connection(clusterApiUrl('devnet'));

  let deployerKeypair;
  if (process.env.DEPLOYER_KEYPAIR) {
    deployerKeypair = Keypair.fromSecretKey(
      Buffer.from(process.env.DEPLOYER_KEYPAIR, 'base64')
    );
  } else {
    const keypairData = JSON.parse(fs.readFileSync(os.homedir() + '/.config/solana/id.json', 'utf-8'));
    deployerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  }

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: deployerKeypair.publicKey,
      toPubkey:   keypair.publicKey,
      lamports:   2 * LAMPORTS_PER_SOL,
    })
  );

  await sendAndConfirmTransaction(connection, transaction, [deployerKeypair]);

  return { publicKey: keypair.publicKey.toBase58(), created: true };
}

/**
 * Return the decrypted Keypair for userId (used internally for signing).
 * Never expose the Keypair or secret key over the API.
 */
async function getKeypair(userId) {
  const { data, error } = await supabase
    .from('wallets')
    .select('enc_key')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`Supabase fetch error: ${error.message}`);
  if (!data) throw new Error(`No wallet found for user: ${userId}`);

  return decrypt(data.enc_key);
}

/**
 * Return the public key (safe to expose over API).
 */
async function getWallet(userId) {
  const { data, error } = await supabase
    .from('wallets')
    .select('public_key')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`Supabase fetch error: ${error.message}`);
  if (!data) return null;

  return { publicKey: data.public_key };
}

module.exports = { createWallet, getKeypair, getWallet };
