/**
 * Circuit — Utility Functions
 */

import { SOLSCAN_BASE, CLUSTER } from './constants';

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

export function formatEdition(n: number, total: number): string {
  return `${String(n).padStart(2, '0')} of ${total}`;
}

export function formatSerialNumber(serial: string | undefined, maxSupply: number | undefined): string {
  if (!serial) return 'Pending';
  const supply = maxSupply || 40;
  const parsed = parseInt(serial, 10);
  if (!isNaN(parsed)) {
    return `${String(parsed).padStart(2, '0')} of ${supply}`;
  }
  return `${serial} of ${supply}`;
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
