'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import {
  initializeEscrow,
  fetchDropData,
  parseError,
  resetState,
  getCount,
  setCount,
} from '@/lib/solana-service';
import {
  DROP_ID,
  PRICE_SOL,
  PRICE_DISPLAY,
  MAX_SUPPLY,
  FABRIC,
  GARMENT_MINT,
} from '@/lib/constants';
import { solscanTxUrl } from '@/lib/utils';
import { showToast } from '@/components/Toast';
import SignInModal from '@/components/SignInModal';
import { saveOrder } from '@/lib/db';

type TxState = 'idle' | 'signing' | 'success' | 'error' | 'soldout';

interface TxResult {
  txSignature?: string;
  solscanUrl?: string;
  escrowPDA?: string;
  orderNumber?: number;
  message?: string;
}

export default function DropPage() {
  const { user, isSignedIn } = useAuth();
  const [mintedCount, setMintedCount] = useState(0);
  const [txState, setTxState] = useState<TxState>('idle');
  const [txResult, setTxResult] = useState<TxResult>({});
  const [loading, setLoading] = useState(true);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const processingRef = useRef(false);

  // Fetch drop data on mount
  useEffect(() => {
    fetchDropData(DROP_ID).then((data) => {
      setMintedCount(data.currentCount);
      setLoading(false);
    });
  }, []);

  const handleOrder = async () => {
    if (processingRef.current) return;

    if (!isSignedIn) {
      setIsSignInOpen(true);
      return;
    }

    processingRef.current = true;
    setTxState('signing');
    setTxResult({});

    try {
      // 1. Solana Handshake
      const result = await initializeEscrow(
        DROP_ID,
        PRICE_SOL,
        user?.walletAddress
      );

      // 2. Persist to DB (Invisible record)
      if (user?.email) {
        await saveOrder({
          email: user.email,
          drop_id: DROP_ID,
          tx_signature: result.txSignature,
          escrow_pda: result.escrowPDA,
          amount_sol: PRICE_SOL
        });
      }

      setMintedCount(result.currentCount);
      setTxState('success');
      setTxResult({
        txSignature: result.txSignature,
        solscanUrl: result.solscanUrl,
        escrowPDA: result.escrowPDA,
        orderNumber: result.orderNumber,
      });
      showToast('✓', `Order #${result.orderNumber} confirmed`);
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e?.code === 'DropSoldOut') {
        setTxState('soldout');
        setTxResult({ message: parseError(err) });
        showToast('Scarcity Enforced', 'Drop sold out!');
      } else {
        setTxState('error');
        setTxResult({ message: parseError(err) });
        showToast('✗', 'Order failed');
      }
    } finally {
      processingRef.current = false;
    }
  };

  const handleReset = () => {
    resetState();
    setMintedCount(getCount());
    setTxState('idle');
    setTxResult({});
    showToast('↻', 'Demo reset');
  };

  const handleForceSoldOut = () => {
    setCount(MAX_SUPPLY);
    setMintedCount(MAX_SUPPLY);
    showToast('⚡', 'Supply filled');
  };

  const fillPercent = (mintedCount / MAX_SUPPLY) * 100;
  const isSoldOut = mintedCount >= MAX_SUPPLY;

  return (
    <section className="min-h-[calc(100vh-72px)] flex flex-col" aria-label="Drop Zero">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="ambient-orb orb-white" />
        <div className="ambient-orb orb-grey" />
      </div>

      {/* Hero */}
      <div className="flex-1 max-w-[1400px] mx-auto w-full px-6 md:px-8 py-10 md:py-16 grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center relative z-10">
        
        {/* Left: Content */}
        <div className="flex flex-col gap-6 order-2 lg:order-1" style={{ animation: 'fadeIn 0.6s ease-out' }}>
          {/* Tags */}
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1 rounded-full text-[0.7rem] font-semibold uppercase tracking-[0.06em] border border-[#D1D1D1] text-[#D1D1D1]">
              Limited Edition
            </span>
            <span className="px-3 py-1 rounded-full text-[0.7rem] font-semibold uppercase tracking-[0.06em] bg-white/[0.04] border border-white/[0.12] text-[#A3A3A3]">
              Verified Origin
            </span>
          </div>

          {/* Title */}
          <h1 className="text-[3rem] md:text-[4.5rem] leading-[0.95] font-bold tracking-[-0.03em]">
            <span className="block">Drop</span>
            <span className="block bg-gradient-to-b from-white to-[#666] bg-clip-text text-transparent">Zero</span>
          </h1>

          <h2 className="text-[1.5rem] md:text-[1.8rem] font-light text-[#A3A3A3] tracking-[-0.01em]">The Wrap Dress</h2>

          <p className="text-[0.9rem] text-[#A3A3A3] leading-[1.7] max-w-[500px]">
            Made-to-order infrastructure. Nothing is manufactured until you confirm.
            Your payment is held in a trustless escrow — secured by code, not by middle-men.
          </p>

          {/* Meta Strip */}
          <div className="flex flex-wrap gap-0 border border-white/[0.12] rounded-2xl overflow-hidden">
            <div className="flex-1 min-w-[120px] p-4 border-r border-white/[0.12]">
              <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-[#666] mb-1">Edition</span>
              <span className="text-sm font-semibold">01 of {MAX_SUPPLY}</span>
            </div>
            <div className="flex-1 min-w-[120px] p-4 border-r border-white/[0.12]">
              <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-[#666] mb-1">Price</span>
              <span className="text-sm font-semibold">{PRICE_DISPLAY}</span>
            </div>
            <div className="flex-1 min-w-[120px] p-4">
              <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-[#666] mb-1">Fabric</span>
              <span className="text-sm font-semibold">{FABRIC}</span>
            </div>
          </div>

          {/* Mint Progress */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-[#666] uppercase tracking-[0.1em] font-semibold">Availability</span>
              <span className="text-sm">
                <strong id="minted-count">{loading ? '—' : mintedCount}</strong>
                <span className="text-[#666]"> / {MAX_SUPPLY}</span>
              </span>
            </div>
            <div className="mp-track">
              <div className="mp-fill" style={{ width: `${fillPercent}%` }} />
            </div>
            <span className="text-[0.7rem] text-[#D1D1D1] font-semibold uppercase tracking-[0.1em]">
              {isSoldOut ? '✗ No longer available' : 'Limited Supply'}
            </span>
          </div>

          {/* CTA */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3 items-center">
              <button
                className={`btn-circuit ${txState === 'signing' ? 'signing' : ''}`}
                onClick={handleOrder}
                disabled={txState === 'signing'}
                aria-label="Confirm your order"
              >
                <span>
                  {txState === 'signing' ? 'Processing payment...' : 
                   txState === 'success' ? '✓ Order Confirmed' :
                   txState === 'soldout' ? '✗ Sold Out' :
                   'Confirm Order'}
                </span>
                <span className="btn-arrow" aria-hidden="true">
                  {txState === 'signing' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 010 20 10 10 0 010-20" strokeLinecap="round" className="animate-spin origin-center"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  )}
                </span>
              </button>
              
              <div className="flex gap-4 ml-2">
                <button onClick={handleReset} className="text-xs text-[#666] hover:text-white transition-colors">↻ Reset</button>
                <button onClick={handleForceSoldOut} className="text-xs text-[#666] hover:text-white transition-colors">⚡ Fill</button>
              </div>
            </div>
            <span className="text-[0.7rem] text-[#666]">Simple, secure checkout</span>
          </div>

          {/* Transaction Result */}
          <div id="drop-tx" role="status" aria-live="polite">
            {txState === 'success' && txResult.txSignature && (
              <div className="tx-msg ok flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-white">✓</span>
                  <span>Order confirmed. Payment secured in escrow.</span>
                </div>
                <div className="flex flex-wrap gap-3 text-xs">
                  <a href={txResult.solscanUrl} target="_blank" rel="noopener" className="text-[#D1D1D1] hover:text-white transition-colors underline underline-offset-2">
                    Proof of transaction ↗
                  </a>
                  <Link href="/confirm" className="text-[#D1D1D1] hover:text-white transition-colors underline underline-offset-2">
                    Next: Confirm Delivery →
                  </Link>
                </div>
              </div>
            )}

            {txState === 'error' && (
              <div className="tx-msg err">
                <span>✗</span>
                <span>{txResult.message}</span>
              </div>
            )}

            {txState === 'soldout' && (
              <div className="sold-out-flash tx-msg err flex flex-col gap-2 !border-[#ff5050]/40 !bg-[#ff5050]/[0.08]">
                <div className="flex items-center gap-2 text-base font-semibold">
                  <span>✗</span>
                  <span>Supply Exhausted — Order Rejected</span>
                </div>
                <p className="text-xs text-[#ff5050]/80 leading-relaxed">
                  Scarcity Enforced. The system has reached its maximum supply of {MAX_SUPPLY} units. 
                  Atomic validation failed. No payment was taken.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Image */}
        <div className="order-1 lg:order-2 flex justify-center lg:justify-end" style={{ animation: 'fadeIn 0.8s ease-out 0.2s both' }}>
          <div className="relative w-full max-w-[420px]">
            {/* Glow */}
            <div className="absolute inset-[-10%] bg-[radial-gradient(circle,rgba(255,255,255,.04)_0%,transparent_70%)] blur-[30px] pointer-events-none" aria-hidden="true" />
            
            {/* Image Frame */}
            <div className="relative rounded-[24px] overflow-hidden border border-white/[0.12] bg-[#0D0D0D] shadow-[0_20px_60px_rgba(0,0,0,.5)]">
              <Image
                src="/dpp-image.png"
                alt="Circuit Wrap Dress — Drop Zero"
                width={500}
                height={600}
                className="w-full h-auto object-cover"
                priority
              />
              
              {/* On-Chain badge */}
              <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/70 backdrop-blur-[12px] rounded-full px-3 py-1.5 text-[0.7rem] font-semibold border border-white/[0.12]">
                <span className="w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.4)] animate-pulse" aria-hidden="true" />
                Verified Authentic
              </div>

              {/* Edition badge */}
              <div className="absolute top-4 right-4 bg-black/70 backdrop-blur-[12px] rounded-full px-3 py-1.5 text-[0.7rem] font-mono font-bold border border-white/[0.12]">
                01 / {MAX_SUPPLY}
              </div>
            </div>
          </div>
        </div>
      </div>

      <SignInModal isOpen={isSignInOpen} onClose={() => setIsSignInOpen(false)} />

      {/* Escrow Flow Strip */}
      <div className="border-t border-white/[0.12] py-12 px-6 md:px-8 relative z-10">
        <div className="max-w-[1000px] mx-auto flex flex-col md:flex-row items-stretch gap-0">
          {[
            { num: '01', title: 'Buyer Confirms', desc: 'Payment secured in trustless escrow', icon: (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="6" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>
            )},
            { num: '02', title: 'Production Begins', desc: 'Garment is made-to-order', icon: (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            )},
            { num: '03', title: 'Delivery Confirmed', desc: 'Payment released to designer', icon: (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
            )},
          ].map((step, i) => (
            <div key={step.num} className="flex items-center flex-1">
              <div className="flex-1 text-center px-4 py-6">
                <div className="flex flex-col items-center gap-3">
                  <div className="text-[#D1D1D1] opacity-60">{step.icon}</div>
                  <span className="text-[0.65rem] text-[#666] font-bold tracking-[0.1em]">{step.num}</span>
                  <strong className="text-sm">{step.title}</strong>
                  <p className="text-xs text-[#A3A3A3]">{step.desc}</p>
                </div>
              </div>
              {i < 2 && (
                <div className="hidden md:flex items-center" aria-hidden="true">
                  <div className="w-12 h-px bg-gradient-to-r from-white/20 to-white/5" />
                  <div className="w-1.5 h-1.5 rounded-full bg-white/20 shrink-0" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
