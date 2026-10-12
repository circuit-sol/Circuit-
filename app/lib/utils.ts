/**
 * Circuit — Utility Functions
 */

import { SOLSCAN_BASE, CLUSTER } from './constants';
import { DEFAULT_SOL_MARKET_PRICE } from './price-service';

// ── Address Helpers ──────────────────────────────────────────────────

const ADDR_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';

export function genAddress(): string {
  let addr = '';
  for (let i = 0; i < 44; i++) addr += ADDR_CHARS[Math.floor(Math.random() * ADDR_CHARS.length)];
  return addr;
}

export function genSignature(): string {
  let sig = '';
  for (let i = 0; i < 88; i++) sig += ADDR_CHARS[Math.floor(Math.random() * ADDR_CHARS.length)];
  return sig;
}

export function truncateAddress(addr: string, start = 6, end = 4): string {
  if (!addr || addr.length < start + end + 3) return addr;
  return `${addr.slice(0, start)}...${addr.slice(-end)}`;
}

// ── Solscan & Solana Explorer URL Builders ───────────────────────────

export function solscanTxUrl(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
}

export function solanaExplorerTxUrl(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
}

export function solscanAccountUrl(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=${CLUSTER}`;
}

export function solanaExplorerAccountUrl(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=${CLUSTER}`;
}

export function solscanTokenUrl(mint: string): string {
  return `https://explorer.solana.com/address/${mint}?cluster=${CLUSTER}`;
}

// ── Formatting ───────────────────────────────────────────────────────

export function formatUsd(amount: number | string | undefined | null, opts: { includeCode?: boolean; prefix?: string } = {}): string {
  const val = Number(amount || 0);
  const formatted = val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const prefix = opts.prefix !== undefined ? opts.prefix : '$';
  const code = opts.includeCode ? ' USD' : '';
  return `${prefix}${formatted}${code}`;
}

export function formatSol(amount: number | string | undefined | null, maxDecimals = 3): string {
  const val = Number(amount || 0);
  if (!val || isNaN(val)) return '0';
  if (val < 0.001) {
    return Number(val.toFixed(4)).toString();
  }
  return Number(val.toFixed(maxDecimals)).toString();
}

export interface PricingResolution {
  unitUsd: number;
  totalUsd: number;
  unitSol: number;
  totalSol: number;
  unitUsdFormatted: string;
  totalUsdFormatted: string;
  unitSolFormatted: string;
  totalSolFormatted: string;
}

export function resolvePricing(params: {
  editionPriceUsd?: number | string | null;
  batchLamports?: string | number | null;
  quantity?: number;
  selectedSize?: string;
  pricesBySize?: Record<string, number | string>;
  solRateUsd?: number | null;
}): PricingResolution {
  const {
    editionPriceUsd,
    batchLamports,
    quantity = 1,
    selectedSize,
    pricesBySize,
    solRateUsd,
  } = params;

  // 1. Resolve unit USD price: check variable size pricing first, then base edition price
  let unitUsd = 0;
  if (selectedSize && pricesBySize && pricesBySize[selectedSize] !== undefined && Number(pricesBySize[selectedSize]) > 0) {
    unitUsd = Number(pricesBySize[selectedSize]);
  } else if (editionPriceUsd !== undefined && editionPriceUsd !== null && Number(editionPriceUsd) > 0) {
    unitUsd = Number(editionPriceUsd);
  }

  // 2. Resolve unit SOL: use on-chain batch lamports if available; else derive using reference/live rate
  const referenceSolRate = (solRateUsd && solRateUsd > 0) ? solRateUsd : DEFAULT_SOL_MARKET_PRICE;
  let unitSol = 0;

  if (batchLamports) {
    unitSol = Number(BigInt(batchLamports)) / 1e9;
    // If unitUsd was not set on the edition, derive it from batch lamports
    if (unitUsd === 0) {
      unitUsd = Number((unitSol * referenceSolRate).toFixed(2));
    }
  } else if (unitUsd > 0) {
    unitSol = Number((unitUsd / referenceSolRate).toFixed(3));
  }

  const safeQuantity = Math.max(1, quantity || 1);
  const totalUsd = Number((unitUsd * safeQuantity).toFixed(2));
  const totalSol = Number((unitSol * safeQuantity).toFixed(4));

  return {
    unitUsd,
    totalUsd,
    unitSol,
    totalSol,
    unitUsdFormatted: formatUsd(unitUsd, { includeCode: true }),
    totalUsdFormatted: formatUsd(totalUsd, { includeCode: true }),
    unitSolFormatted: formatSol(unitSol),
    totalSolFormatted: formatSol(totalSol),
  };
}

export function formatEdition(n: number, total: number): string {
  return `${String(n).padStart(2, '0')} of ${total}`;
}

export function formatSerialNumber(serial: string | number | undefined, maxSupply: number | undefined): string {
  if (serial === undefined || serial === null || serial === '') return 'Pending';
  const supply = maxSupply || 50;
  const parsed = typeof serial === 'number' ? serial : parseInt(String(serial), 10);
  if (!isNaN(parsed) && parsed > 0) {
    return `#${String(parsed).padStart(2, '0')} of ${supply}`;
  }
  return `#${serial} of ${supply}`;
}

export interface OrderLike {
  garment_serial?: string;
  order_number?: number;
  drop_id?: string;
  batch_id?: string;
  created_at?: string;
  purchased_at?: string;
  [key: string]: any;
}

export function resolveUniqueOrderSerials<T extends OrderLike>(orders: T[]): T[] {
  if (!orders || orders.length === 0) return orders;

  // Group by drop/edition
  const byDrop = new Map<string, T[]>();
  orders.forEach((ord) => {
    const dropKey = ord.drop_id || ord.batch_id || 'default';
    if (!byDrop.has(dropKey)) byDrop.set(dropKey, []);
    byDrop.get(dropKey)!.push(ord);
  });

  byDrop.forEach((dropOrders) => {
    const usedSerials = new Set<number>();

    // 1. Collect already assigned numeric serials
    dropOrders.forEach((o) => {
      const existing = o.garment_serial || o.order_number;
      if (existing !== undefined && existing !== null && existing !== '') {
        const parsed = parseInt(String(existing), 10);
        if (!isNaN(parsed) && parsed > 0) {
          usedSerials.add(parsed);
          o.garment_serial = String(parsed);
          o.order_number = parsed;
        }
      }
    });

    // 2. Sort chronologically (oldest first) to assign sequential numbers
    const sorted = [...dropOrders].sort((a, b) => {
      const tA = new Date(a.created_at || a.purchased_at || 0).getTime();
      const tB = new Date(b.created_at || b.purchased_at || 0).getTime();
      return tA - tB;
    });

    // 3. Assign next available positive serial to orders lacking one
    let nextCandidate = 1;
    sorted.forEach((o) => {
      if (!o.garment_serial) {
        while (usedSerials.has(nextCandidate)) {
          nextCandidate++;
        }
        o.garment_serial = String(nextCandidate);
        o.order_number = nextCandidate;
        usedSerials.add(nextCandidate);
        nextCandidate++;
      }
    });
  });

  return orders;
}

export function formatRoyalty(bps: number): string {
  return `${bps / 100}%`;
}

export function formatDate(date?: Date): string {
  const d = date || new Date();
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ── Delay ────────────────────────────────────────────────────────────

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function randomDelay(min = 800, max = 2000): Promise<void> {
  return delay(min + Math.random() * (max - min));
}
