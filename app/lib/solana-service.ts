/**
 * ═══════════════════════════════════════════════════════════════════════
 * Circuit — Solana Service Layer (TypeScript)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Clean separation between UI and blockchain logic.
 * In SIMULATION mode, realistic mock data is returned with latency.
 * When disabled, stubs are ready for Anchor RPC replacement.
 *
 * Source of Truth: Circuit-/INTEGRATION.md
 *
 * PDA Seeds:
 *   Escrow:  ["escrow", dropId, buyerPubkey]
 *   Drop:    ["drop", dropId]
 * ═══════════════════════════════════════════════════════════════════════
 */

import {
  SIMULATION_MODE,
  ESCROW_PROGRAM_ID,
  DROPS_PROGRAM_ID,
  GARMENT_MINT,
  DROP_ID,
  DESIGNER_PUBKEY,
  PRICE_SOL,
  MAX_SUPPLY,
  PRODUCTION_DATE,
  FABRIC,
  HEADPIECE,
  EMBROIDERY,
  BRAND,
  DEMO_START_COUNT,
  RPC_ENDPOINT,
} from './constants';



import { Connection, clusterApiUrl, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, type Idl } from '@coral-xyz/anchor';
import * as backendApi from './backendApi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplTokenMetadata, fetchDigitalAsset } from '@metaplex-foundation/mpl-token-metadata';
import { publicKey as umiPublicKey } from '@metaplex-foundation/umi';

import {
  genAddress,
  genSignature,
  solscanTxUrl,
  solscanTokenUrl,
  randomDelay,
} from './utils';

// ── Types ────────────────────────────────────────────────────────────

export interface EscrowResult {
  success: boolean;
  orderNumber: number;
  currentCount: number;
  maxSupply: number;
  txSignature: string;
  escrowPDA: string;
  solscanUrl: string;
}

export interface OrderResult {
  success: boolean;
  orderNumber: number;
  currentCount: number;
  maxSupply: number;
  txSignature: string;
}

export interface DeliveryResult {
  success: boolean;
  txSignature: string;
  fundsReleased: number;
  designerAddress: string;
  solscanUrl: string;
}

export interface DropData {
  dropId: string;
  maxSupply: number;
  currentCount: number;
  active: boolean;
  designerPubkey: string;
}

export interface EscrowStatus {
  buyer: string;
  designer: string;
  amount: number;
  delivered: boolean;
  dropId: string;
}

export interface PassportData {
  garmentName: string;
  edition: string;
  dropId: string;
  productionDate: string;
  fabric: string;
  cap: string;
  embroidery: string;
  owner: string;

  creator: string;
  symbol: string;
  royaltyBps: number;
  royaltyPercent: string;
  mintAddress: string;
  isMutable: boolean;
  standard: string;
  solscanUrl: string;
}

export interface CircuitError {
  code: string;
  errorCode?: number;
  message: string;
  program?: string;
}

// ── Anchor IDLs (minimal — read-only account fetching) ───────────────

const DROPS_IDL = {
  address:      DROPS_PROGRAM_ID,
  metadata:     { name: 'circuit_drops', version: '0.1.0', spec: '0.1.0' },
  instructions: [{
    name:          'register_order',
    discriminator: [92, 37, 29, 46, 77, 250, 219, 6],
    accounts: [
      { name: 'authority',   signer: true              },
      { name: 'drop_account', writable: true            },
    ],
    args: [],
  }],
  accounts:     [{ name: 'DropAccount', discriminator: [173, 242, 121, 245, 229, 150, 14, 87] }],
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
} as unknown as Idl;

const ESCROW_IDL = {
  address:      ESCROW_PROGRAM_ID,
  metadata:     { name: 'circuit_escrow', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name:          'initialize_escrow',
      discriminator: [243, 160, 77, 153, 11, 92, 48, 209],
      accounts: [
        { name: 'buyer',          writable: true, signer: true },
        { name: 'designer'                                      },
        { name: 'escrow_account', writable: true               },
        { name: 'system_program', address: '11111111111111111111111111111111' },
      ],
      args: [
        { name: 'drop_id', type: 'string' },
        { name: 'amount',  type: 'u64'    },
      ],
    },
    {
      name:          'confirm_delivery',
      discriminator: [11, 109, 227, 53, 179, 190, 88, 155],
      accounts: [
        { name: 'buyer',          writable: true, signer: true },
        { name: 'designer',       writable: true               },
        { name: 'escrow_account', writable: true               },
      ],
      args: [],
    },
  ],
  accounts:     [{ name: 'EscrowAccount', discriminator: [36, 69, 48, 18, 128, 225, 125, 135] }],
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
} as unknown as Idl;

// ── Anchor provider (read-only, for data fetching) ───────────────────

function makeReadOnlyProvider(): AnchorProvider {
  const connection = new Connection(RPC_ENDPOINT, 'confirmed');

  return new AnchorProvider(
    connection,
    {
      publicKey:           PublicKey.default,
      signTransaction:     async <T>(tx: T): Promise<T> => tx,
      signAllTransactions: async <T>(txs: T[]): Promise<T[]> => txs,
    },
    { commitment: 'confirmed' }
  );
}

// ── Internal State ───────────────────────────────────────────────────
let _currentCount = DEMO_START_COUNT;

// ── PDA Derivation Stubs ─────────────────────────────────────────────

/**
 * Derive Escrow PDA address.
 * Seeds: ["escrow", dropId, buyerPubkey]
 * See INTEGRATION.md §7
 */
export function deriveEscrowPDA(dropId: string, buyerPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), Buffer.from(dropId), buyerPubkey.toBuffer()],
    new PublicKey(ESCROW_PROGRAM_ID)
  );
}

/**
 * Derive Drop PDA address.
 * Seeds: ["drop", dropId]
 * See INTEGRATION.md §7
 */
export function deriveDropPDA(dropId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('drop'), Buffer.from(dropId)],
    new PublicKey(DROPS_PROGRAM_ID)
  );
}

// ── Core Transactions ────────────────────────────────────────────────

/**
 * Lock buyer's payment in the on-chain escrow via the backend wallet service.
 * Creates a custodial wallet for userId on first call (idempotent).
 * Maps to INTEGRATION.md §4.1: initialize_escrow.
 */
export async function initializeEscrow(
  dropId: string,
  amount: number,
): Promise<EscrowResult> {
  // No createWallet call needed — backend identifies the user from their JWT
  const result = await backendApi.confirmOrder(dropId, amount);
  const drop   = await fetchDropData(dropId).catch(() => ({ currentCount: 0, maxSupply: MAX_SUPPLY }));

  return {
    success:      true,
    orderNumber:  drop.currentCount,
    currentCount: drop.currentCount,
    maxSupply:    drop.maxSupply,
    txSignature:  result.signature,
    escrowPDA:    result.escrowPDA,
    solscanUrl:   solscanTxUrl(result.signature),
  };
}

/**
 * Increment the on-chain supply counter via the backend wallet service.
 * Maps to INTEGRATION.md §5.2: register_order.
 */
export async function registerOrder(
  dropId: string,
): Promise<OrderResult> {
  let result: { signature: string };
  try {
    result = await backendApi.registerOrder(dropId);
  } catch (err) {
    const e = err as Record<string, unknown>;
    if (e['error'] === 'DropSoldOut' || String(err).includes('DropSoldOut')) {
      throw { code: 'DropSoldOut', errorCode: 6000, message: 'This drop is sold out.', program: 'circuit_drops' } as CircuitError;
    }
    throw err;
  }

  const drop = await fetchDropData(dropId).catch(() => ({ currentCount: 0, maxSupply: MAX_SUPPLY }));

  return {
    success:      true,
    orderNumber:  drop.currentCount,
    currentCount: drop.currentCount,
    maxSupply:    drop.maxSupply,
    txSignature:  result.signature,
  };
}

/**
 * Release escrowed funds to the designer via the backend wallet service.
 * Maps to INTEGRATION.md §4.2: confirm_delivery.
 */
export async function confirmDelivery(
  dropId: string,
): Promise<DeliveryResult> {
  const result = await backendApi.deliverOrder(dropId);

  return {
    success:         true,
    txSignature:     result.signature,
    fundsReleased:   result.fundsReleased,
    designerAddress: result.designer,
    solscanUrl:      solscanTxUrl(result.signature),
  };
}

// ── Data Fetching ────────────────────────────────────────────────────

/**
 * Fetch current drop data directly from the circuit_drops program.
 * Maps to INTEGRATION.md §5.3: fetchDrop.
 */
export async function fetchDropData(dropId?: string): Promise<DropData> {
  const id = dropId || DROP_ID;
  const [dropPda] = deriveDropPDA(id);
  const program = new Program(DROPS_IDL, makeReadOnlyProvider());

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await (program.account as any)['dropAccount'].fetch(dropPda) as Record<string, unknown>;
    return {
      dropId:         data['dropId']       as string,
      maxSupply:      (data['maxSupply']    as { toNumber(): number }).toNumber(),
      currentCount:   (data['currentCount'] as { toNumber(): number }).toNumber(),
      active:         data['active']        as boolean,
      designerPubkey: (data['designer']     as PublicKey).toBase58(),
    };
  } catch (err) {
    if (String(err).includes('Account does not exist')) throw new Error(`Drop not found: ${id}`);
    throw err;
  }
}

/**
 * Fetch escrow account status directly from the circuit_escrow program.
 * Returns null if the escrow has not been initialized yet.
 * Maps to INTEGRATION.md §4.3: fetchEscrow.
 */
export async function fetchEscrowStatus(
  dropId: string,
  buyerPubkey: PublicKey,
): Promise<EscrowStatus | null> {
  const [escrowPda] = deriveEscrowPDA(dropId, buyerPubkey);
  const program = new Program(ESCROW_IDL, makeReadOnlyProvider());

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await (program.account as any)['escrowAccount'].fetch(escrowPda) as Record<string, unknown>;
    return {
      buyer:     (data['buyer']    as PublicKey).toBase58(),
      designer:  (data['designer'] as PublicKey).toBase58(),
      amount:    (data['amount']   as { toNumber(): number }).toNumber() / 1e9, // lamports → SOL
      delivered:  data['delivered'] as boolean,
      dropId:     data['dropId']    as string,
    };
  } catch (err) {
    if (String(err).includes('Account does not exist')) return null;
    throw err;
  }
}

/**
 * Fetch garment passport data from Metaplex (on-chain) + off-chain JSON.
 * Metaplex pads on-chain names with null bytes — these are stripped.
 * Maps to INTEGRATION.md §6.1: fetchGarmentMetadata.
 */
export async function fetchPassportData(mintAddress?: string): Promise<PassportData> {
  const mint = mintAddress || GARMENT_MINT;
  const umi  = createUmi(RPC_ENDPOINT).use(mplTokenMetadata());

  const asset = await fetchDigitalAsset(umi, umiPublicKey(mint));
  const meta  = asset.metadata;

  // Pull attributes from off-chain JSON when a real URI is available
  const attrs: Record<string, string> = {};
  if (meta.uri && !meta.uri.includes('placeholder')) {
    try {
      const res  = await fetch(meta.uri);
      const json = await res.json() as { attributes?: { trait_type: string; value: string }[] };
      for (const a of (json.attributes ?? [])) attrs[a.trait_type] = a.value;
    } catch { /* fallback to constants below */ }
  }

  const royaltyBps = meta.sellerFeeBasisPoints;
  return {
    garmentName:    meta.name.replace(/\0/g, '').trim(),
    edition:        attrs['Edition']         ?? '01',
    dropId:         attrs['Drop']            ?? DROP_ID,
    productionDate: attrs['Production Date'] ?? PRODUCTION_DATE,
    fabric:         attrs['Fabric']          ?? FABRIC,
    cap:            attrs['Cap']             ?? HEADPIECE,
    embroidery:     attrs['Embroidery']      ?? EMBROIDERY,
    owner:          mint,

    creator:        BRAND.name,
    symbol:         meta.symbol,
    royaltyBps,
    royaltyPercent: `${royaltyBps / 100}%`,
    mintAddress:    mint,
    isMutable:      meta.isMutable,
    standard:       'Programmable Non-Fungible',
    solscanUrl:     solscanTokenUrl(mint),
  };
}

// ── Error Parser ─────────────────────────────────────────────────────
/**
 * Parse errors into user-friendly messages.
 * Maps to INTEGRATION.md §8: Error Codes Reference.
 */
export function parseError(err: unknown): string {
  if (!err) return 'An unexpected error occurred. Please try again.';

  const e = err as CircuitError;
  const code = e.code;
  const msg = e.message || '';

  // Escrow errors
  if (code === 'AlreadyDelivered') return 'This order has already been confirmed.';
  if (code === 'UnauthorizedBuyer') return 'Only the original buyer can confirm delivery.';
  if (code === 'InvalidDesigner') return 'Designer account mismatch. Please contact support.';

  // Drop errors
  if (code === 'DropSoldOut') return `Drop has reached maximum supply. No more orders can be registered.`;
  if (code === 'DropNotActive') return 'This drop is no longer active.';

  // Wallet / network errors
  if (msg.includes('User rejected') || msg.includes('cancelled')) {
    return 'Transaction cancelled. You can try again when ready.';
  }
  if (msg.includes('insufficient') || msg.includes('Insufficient')) {
    return 'Insufficient funds. Get devnet SOL from faucet.solana.com';
  }
  if (msg.includes('Network') || msg.includes('fetch') || msg.includes('timeout')) {
    return 'Unable to reach Solana devnet. Please check your connection.';
  }

  return 'Transaction failed. Please try again.';
}

// ── Demo Controls ────────────────────────────────────────────────────

export function resetState(): void {
  _currentCount = DEMO_START_COUNT;
}

export function setCount(n: number): void {
  _currentCount = n;
}

export function getCount(): number {
  return _currentCount;
}

// ── Init Log ─────────────────────────────────────────────────────────
if (typeof window !== 'undefined' && SIMULATION_MODE) {
  console.log(
    '%c⚡ Circuit running in SIMULATION mode — mock data active',
    'color: #D1D1D1; font-weight: bold; font-size: 12px;'
  );
  console.log(
    '%cProgram IDs (Devnet):\n' +
    `  Escrow:        ${ESCROW_PROGRAM_ID}\n` +
    `  Drop Registry: ${DROPS_PROGRAM_ID}\n` +
    `  Garment NFT:   ${GARMENT_MINT}`,
    'color: #888; font-size: 10px;'
  );
}
