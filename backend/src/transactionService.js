'use strict';

const anchor = require('@coral-xyz/anchor');
const {
  Connection,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} = require('@solana/web3.js');
const { getKeypair } = require('./walletManager');

// ── Program IDs ───────────────────────────────────────────────────────────────

const ESCROW_PROGRAM_ID  = new PublicKey(process.env.ESCROW_PROGRAM_ID);
const DROPS_PROGRAM_ID   = new PublicKey(process.env.DROPS_PROGRAM_ID);
const DESIGNER_PUBKEY    = new PublicKey('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');

// ── Minimal IDLs (discriminators match deployed programs) ─────────────────────

const ESCROW_IDL = {
  address:  process.env.ESCROW_PROGRAM_ID,
  metadata: { name: 'circuit_escrow', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'initialize_escrow',
      discriminator: [243, 160, 77, 153, 11, 92, 48, 209],
      accounts: [
        { name: 'buyer',          writable: true, signer: true },
        { name: 'designer' },
        { name: 'escrow_account', writable: true },
        { name: 'system_program', address: '11111111111111111111111111111111' },
      ],
      args: [
        { name: 'drop_id', type: 'string' },
        { name: 'amount',  type: 'u64'    },
      ],
    },
    {
      name: 'confirm_delivery',
      discriminator: [11, 109, 227, 53, 179, 190, 88, 155],
      accounts: [
        { name: 'buyer',          writable: true, signer: true },
        { name: 'designer',       writable: true               },
        { name: 'escrow_account', writable: true               },
      ],
      args: [],
    },
  ],
  accounts: [{ name: 'EscrowAccount', discriminator: [36, 69, 48, 18, 128, 225, 125, 135] }],
  types: [{
    name: 'EscrowAccount',
    type: {
      kind: 'struct',
      fields: [
        { name: 'buyer',     type: 'pubkey' },
        { name: 'designer',  type: 'pubkey' },
        { name: 'amount',    type: 'u64'    },
        { name: 'drop_id',   type: 'string' },
        { name: 'delivered', type: 'bool'   },
        { name: 'bump',      type: 'u8'     },
      ],
    },
  }],
  errors: [],
};

const DROPS_IDL = {
  address:  process.env.DROPS_PROGRAM_ID,
  metadata: { name: 'circuit_drops', version: '0.1.0', spec: '0.1.0' },
  instructions: [{
    name: 'register_order',
    discriminator: [92, 37, 29, 46, 77, 250, 219, 6],
    accounts: [
      { name: 'authority',   signer: true   },
      { name: 'drop_account', writable: true },
    ],
    args: [],
  }],
  accounts: [{ name: 'DropAccount', discriminator: [173, 242, 121, 245, 229, 150, 14, 87] }],
  types: [{
    name: 'DropAccount',
    type: {
      kind: 'struct',
      fields: [
        { name: 'designer',      type: 'pubkey' },
        { name: 'max_supply',    type: 'u64'    },
        { name: 'current_count', type: 'u64'    },
        { name: 'drop_id',       type: 'string' },
        { name: 'active',        type: 'bool'   },
        { name: 'bump',          type: 'u8'     },
      ],
    },
  }],
  errors: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getConnection() {
  return new Connection(clusterApiUrl(process.env.CLUSTER || 'devnet'), 'confirmed');
}

function makeProvider(keypair) {
  const wallet = new anchor.Wallet(keypair);
  return new anchor.AnchorProvider(getConnection(), wallet, { commitment: 'confirmed' });
}

function deriveEscrowPDA(dropId, buyerPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), Buffer.from(dropId), buyerPubkey.toBuffer()],
    ESCROW_PROGRAM_ID
  );
}

function deriveDropPDA(dropId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('drop'), Buffer.from(dropId)],
    DROPS_PROGRAM_ID
  );
}

// ── Transactions ──────────────────────────────────────────────────────────────

/**
 * Lock amountSol in escrow, then increment the drop supply counter.
 * If register_order fails (e.g. DropSoldOut), the escrow already exists
 * on-chain — the error is re-thrown so the caller can surface it.
 * Returns { signature, registerSignature, escrowPDA, buyer, amountSol }.
 */
async function initializeEscrow(userId, dropId, amountSol) {
  const keypair  = await getKeypair(userId);
  const provider = makeProvider(keypair);
  const program  = new anchor.Program(ESCROW_IDL, provider);

  const [escrowPda] = deriveEscrowPDA(dropId, keypair.publicKey);
  const lamports    = Math.round(amountSol * LAMPORTS_PER_SOL);

  // Step 1: Lock payment in escrow
  const escrowSig = await program.methods
    .initializeEscrow(dropId, new anchor.BN(lamports))
    .accounts({
      buyer:         keypair.publicKey,
      designer:      DESIGNER_PUBKEY,
      escrowAccount: escrowPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  // Step 2: Increment supply counter — throws if drop is sold out
  const { signature: registerSig } = await registerOrder(userId, dropId);

  return {
    signature:         escrowSig,
    registerSignature: registerSig,
    escrowPDA:         escrowPda.toBase58(),
    buyer:             keypair.publicKey.toBase58(),
    amountSol,
  };
}

/**
 * Increment the drop supply counter on behalf of userId.
 * Returns { signature }.
 */
async function registerOrder(userId, dropId) {
  const keypair  = await getKeypair(userId);
  const provider = makeProvider(keypair);
  const program  = new anchor.Program(DROPS_IDL, provider);

  const [dropPda] = deriveDropPDA(dropId);

  const sig = await program.methods
    .registerOrder()
    .accounts({
      authority:   keypair.publicKey,
      dropAccount: dropPda,
    })
    .rpc();

  return { signature: sig };
}

/**
 * Release escrowed funds to the designer on behalf of userId.
 * Fetches designer address from the live escrow account.
 * Returns { signature, fundsReleased, designer }.
 */
async function confirmDelivery(userId, dropId) {
  const keypair  = await getKeypair(userId);
  const provider = makeProvider(keypair);
  const program  = new anchor.Program(ESCROW_IDL, provider);

  const [escrowPda] = deriveEscrowPDA(dropId, keypair.publicKey);
  const escrow      = await program.account['escrowAccount'].fetch(escrowPda);

  const sig = await program.methods
    .confirmDelivery()
    .accounts({
      buyer:         keypair.publicKey,
      designer:      escrow.designer,
      escrowAccount: escrowPda,
    })
    .rpc();

  return {
    signature:    sig,
    fundsReleased: escrow.amount.toNumber() / LAMPORTS_PER_SOL,
    designer:     escrow.designer.toBase58(),
  };
}

module.exports = { initializeEscrow, registerOrder, confirmDelivery };
