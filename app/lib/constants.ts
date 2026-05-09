/**
 * ═══════════════════════════════════════════════════════════════════════
 * Circuit — Application Constants
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Environment Flags ────────────────────────────────────────────────
export const SIMULATION_MODE = process.env.NEXT_PUBLIC_SIMULATION_MODE !== 'false';

// ── Program IDs (from INTEGRATION.md & .env) ─────────────────────────
export const ESCROW_PROGRAM_ID = 
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID || '8b866KXrU94jAEuZYNr8WTkuXJELPvu6eW1v89pSAUrN';

export const DROPS_PROGRAM_ID = 
  process.env.NEXT_PUBLIC_DROPS_PROGRAM_ID || '3i1KUa7S1FjRx34SzqRAKAYsp3S8AJkCB3x7odjua7kL';

export const GARMENT_MINT = 
  process.env.NEXT_PUBLIC_GARMENT_MINT || 'G17eNpsCn4S2Xtr4f9t9fmgyf6ZVFEpdXnpqJBiBCFEo';

// ── Solana Network ───────────────────────────────────────────────────
export const CLUSTER = 'devnet';
export const SOLSCAN_BASE = 'https://solscan.io';
export const RPC_ENDPOINT = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// ── Drop Configuration ───────────────────────────────────────────────
export const DROP_ID = 'drop-zero';
export const PRICE_SOL = 2.5;
export const PRICE_DISPLAY = '2.5 SOL';
export const MAX_SUPPLY = 40;
export const DEMO_START_COUNT = 38; // Close to sold out for demo dramatic effect

// ── Brand Identity ──────────────────────────────────────────────────
export const BRAND = {
  name: 'Circuit',
  symbol: 'CRCT',
  designer: 'Marvelous',
  royaltyBps: 500, // 5%
  royaltyPercent: '5%',
};

export const DESIGNER_PUBKEY = 'Marv...Design...Key';
export const PRODUCTION_DATE = 'October 2026';
export const FABRIC = 'Duchess satin';

