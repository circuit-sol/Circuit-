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
  BRAND,
  DEMO_START_COUNT,
} from './constants';

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

// ── Internal State ───────────────────────────────────────────────────
let _currentCount = DEMO_START_COUNT;

// ── PDA Derivation Stubs ─────────────────────────────────────────────

/**
 * Derive Escrow PDA address.
 * Seeds: ["escrow", dropId, buyerPubkey]
 * See INTEGRATION.md §7
 */
export function deriveEscrowPDA(dropId: string, buyerPubkey: string): string {
  if (SIMULATION_MODE) return genAddress();
  // TODO: Replace with PublicKey.findProgramAddressSync(
  //   [Buffer.from("escrow"), Buffer.from(dropId), buyerPubkey.toBuffer()],
  //   new PublicKey(ESCROW_PROGRAM_ID)
  // );
  throw new Error('Live mode not implemented — see INTEGRATION.md §7');
}

/**
 * Derive Drop PDA address.
 * Seeds: ["drop", dropId]
 * See INTEGRATION.md §7
 */
export function deriveDropPDA(dropId: string): string {
  if (SIMULATION_MODE) return genAddress();
  // TODO: Replace with PublicKey.findProgramAddressSync(
  //   [Buffer.from("drop"), Buffer.from(dropId)],
  //   new PublicKey(DROPS_PROGRAM_ID)
  // );
  throw new Error('Live mode not implemented — see INTEGRATION.md §7');
}

// ── Core Transactions ────────────────────────────────────────────────

/**
 * Place order: register on Drop Registry + lock payment in escrow.
 * Maps to INTEGRATION.md §9: placeOrder() sequence.
 */
export async function initializeEscrow(
  dropId: string,
  amountSol: number,
  buyerPubkey?: string
): Promise<EscrowResult> {
  if (SIMULATION_MODE) {
    await randomDelay(1200, 2200);

    if (_currentCount >= MAX_SUPPLY) {
      const err: CircuitError = {
        code: 'DropSoldOut',
        errorCode: 6000,
        message: `Drop has reached maximum supply of ${MAX_SUPPLY}. No more orders can be registered.`,
        program: 'circuit_drops',
      };
      throw err;
    }

    _currentCount++;
    const sig = genSignature();
    const escrowPDA = deriveEscrowPDA(dropId, buyerPubkey || genAddress());

    return {
      success: true,
      orderNumber: _currentCount,
      currentCount: _currentCount,
      maxSupply: MAX_SUPPLY,
      txSignature: sig,
      escrowPDA,
      solscanUrl: solscanTxUrl(sig),
    };
  }

  // TODO: see INTEGRATION.md §9
  throw new Error('Live mode not implemented');
}

/**
 * Register order on-chain (increment supply counter).
 * Maps to INTEGRATION.md §5.2: register_order.
 */
export async function registerOrder(dropId: string): Promise<OrderResult> {
  if (SIMULATION_MODE) {
    await randomDelay(800, 1500);

    if (_currentCount >= MAX_SUPPLY) {
      const err: CircuitError = {
        code: 'DropSoldOut',
        errorCode: 6000,
        message: 'This drop is sold out.',
        program: 'circuit_drops',
      };
      throw err;
    }

    _currentCount++;
    const sig = genSignature();

    return {
      success: true,
      orderNumber: _currentCount,
      currentCount: _currentCount,
      maxSupply: MAX_SUPPLY,
      txSignature: sig,
    };
  }

  throw new Error('Live mode not implemented');
}

/**
 * Confirm delivery — release escrowed funds to designer.
 * Maps to INTEGRATION.md §4.2: confirm_delivery.
 */
export async function confirmDelivery(
  escrowPDA: string,
  dropId: string,
  buyerPubkey?: string
): Promise<DeliveryResult> {
  if (SIMULATION_MODE) {
    await randomDelay(1500, 2500);

    const sig = genSignature();
    return {
      success: true,
      txSignature: sig,
      fundsReleased: PRICE_SOL,
      designerAddress: DESIGNER_PUBKEY,
      solscanUrl: solscanTxUrl(sig),
    };
  }

  throw new Error('Live mode not implemented');
}

// ── Data Fetching ────────────────────────────────────────────────────

/**
 * Fetch current drop data.
 * Maps to INTEGRATION.md §5.3: fetchDrop.
 */
export async function fetchDropData(dropId?: string): Promise<DropData> {
  if (SIMULATION_MODE) {
    await randomDelay(400, 800);
    return {
      dropId: dropId || DROP_ID,
      maxSupply: MAX_SUPPLY,
      currentCount: _currentCount,
      active: true,
      designerPubkey: DESIGNER_PUBKEY,
    };
  }
  throw new Error('Live mode not implemented');
}

/**
 * Fetch escrow account status.
 * Maps to INTEGRATION.md §4.3: fetchEscrow.
 */
export async function fetchEscrowStatus(
  escrowPDA: string,
  dropId?: string,
  buyerPubkey?: string
): Promise<EscrowStatus | null> {
  if (SIMULATION_MODE) {
    await randomDelay(300, 600);
    return {
      buyer: buyerPubkey || genAddress(),
      designer: DESIGNER_PUBKEY,
      amount: PRICE_SOL,
      delivered: false,
      dropId: dropId || DROP_ID,
    };
  }
  throw new Error('Live mode not implemented');
}

/**
 * Fetch passport/NFT metadata.
 * Maps to INTEGRATION.md §6.1: fetchGarmentMetadata.
 */
export async function fetchPassportData(mintAddress?: string): Promise<PassportData> {
  if (SIMULATION_MODE) {
    await randomDelay(500, 1000);
    const mint = mintAddress || GARMENT_MINT;
    return {
      garmentName: 'Circuit Drop 001 — Garment 01 of 40',
      edition: '01 of 40',
      dropId: DROP_ID,
      productionDate: PRODUCTION_DATE,
      fabric: FABRIC,
      owner: genAddress(),
      creator: BRAND.name,
      symbol: BRAND.symbol,
      royaltyBps: BRAND.royaltyBps,
      royaltyPercent: BRAND.royaltyPercent,
      mintAddress: mint,
      isMutable: false,
      standard: 'Programmable Non-Fungible',
      solscanUrl: solscanTokenUrl(mint),
    };
  }
  throw new Error('Live mode not implemented');
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
