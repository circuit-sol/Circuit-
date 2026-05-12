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
  HEADPIECE,
  EMBROIDERY,
  GARMENT_MINT,
} from '@/lib/constants';

import { solscanTxUrl } from '@/lib/utils';
import { showToast } from '@/components/Toast';
import SignInModal from '@/components/SignInModal';
import Selector from '@/components/Selector';
import { saveOrder, supabase } from '@/lib/db';


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
  const [selectedSize, setSelectedSize] = useState('Medium');
  const processingRef = useRef(false);


  // Fetch drop data on mount (Real data from DB)
  useEffect(() => {
    async function fetchRealSupply() {
      try {
        if (!supabase) return;
        const { count, error } = await supabase
          .from('orders')
          .select('*', { count: 'exact', head: true });
        
        if (!error && count !== null) {
          setMintedCount(count);
        }
      } catch (err) {
        console.error('Error fetching supply:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchRealSupply();
    const interval = setInterval(fetchRealSupply, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleOrder = async () => {
    if (processingRef.current) return;

    if (!isSignedIn) {
      setIsSignInOpen(true);
      return;
    }

    if (!user?.email) {
      showToast('Sign in required', 'Please sign in to place an order.');
      return;
    }

    processingRef.current = true;
    setTxState('signing');
    setTxResult({});

    try {
      // 1. Solana Handshake (via backend custodial wallet)
      const result = await initializeEscrow(user.email, DROP_ID, PRICE_SOL);

      // 2. Persist to DB
      if (user?.email) {
        await saveOrder({
          email: user.email,
          drop_id: DROP_ID,
          tx_signature: result.txSignature,
          escrow_pda: result.escrowPDA,
          amount_sol: PRICE_SOL,
          size: selectedSize
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
    <section className="min-h-[calc(100vh-72px)] flex flex-col pt-[72px] overflow-x-hidden" aria-label="Drop Zero">

      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="ambient-orb orb-white" />
        <div className="ambient-orb orb-grey" />
      </div>

      {/* Hero */}
      <div className="flex-1 section-container py-10 md:py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center relative z-10">
        
        {/* Left: Content */}
        <div className="flex flex-col gap-8 order-2 lg:order-1" style={{ animation: 'fadeIn 0.6s ease-out' }}>
          {/* Tags */}
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1 rounded-full text-[0.65rem] font-bold uppercase tracking-[0.08em] border border-white/20 text-[#A3A3A3]">
              Limited Edition
            </span>
            <span className="px-3 py-1 rounded-full text-[0.65rem] font-bold uppercase tracking-[0.08em] bg-white/[0.04] border border-white/[0.08] text-[#666]">
              Made in Nigeria
            </span>
          </div>

          {/* Title */}
          <div className="flex flex-col">
            <h1 className="text-[3.5rem] md:text-[5.5rem] leading-[0.85] font-bold tracking-[-0.04em] mb-4">
              <span className="block">Drop</span>
              <span className="block bg-gradient-to-b from-white to-[#666] bg-clip-text text-transparent">Zero</span>
            </h1>
            <h2 className="text-[1.8rem] md:text-[2.2rem] font-light text-[#A3A3A3] tracking-[-0.02em]">3 Piece Agbada</h2>
          </div>

          <p className="text-[0.95rem] text-[#A3A3A3] leading-[1.8] max-w-[540px]">
            Your payment will be released to the designer once you confirm receipt
          </p>

          {/* Meta Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-0 border border-white/[0.08] rounded-3xl overflow-hidden bg-white/[0.02] backdrop-blur-sm">
            <div className="p-4 md:p-5 border-r border-b sm:border-b-0 border-white/[0.08]">
              <span className="block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-1.5">Edition</span>
              <span className="text-sm font-semibold">01 of {MAX_SUPPLY}</span>
            </div>
            <div className="p-4 md:p-5 border-r border-b sm:border-b-0 border-white/[0.08]">
              <span className="block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-1.5">Price</span>
              <span className="text-sm font-semibold">{PRICE_DISPLAY}</span>
            </div>
            <div className="p-4 md:p-5 border-r border-white/[0.08]">
              <span className="block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-1.5">Main Fabric</span>
              <span className="text-sm font-semibold">{FABRIC}</span>
            </div>
            <div className="p-4 md:p-5 border-r border-white/[0.08]">
              <span className="block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-1.5">Headpiece</span>
              <span className="text-sm font-semibold">{HEADPIECE}</span>
            </div>
            <div className="p-4 md:p-5">
              <span className="block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-1.5">Embroidery</span>
              <span className="text-sm font-semibold">{EMBROIDERY}</span>
            </div>
          </div>



          {/* Selection */}
          <div className="flex flex-col gap-6">
            <Selector 
              label="Select Size" 
              options={['Small', 'Medium', 'Large', 'Extra Large']} 
              selected={selectedSize} 
              onChange={setSelectedSize} 
            />
          </div>

          {/* Mint Progress */}

          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-baseline">
              <span className="text-[0.65rem] text-[#666] uppercase tracking-[0.12em] font-bold">Supply Status</span>
              <span className="text-sm font-mono">
                <strong>{loading ? '—' : mintedCount}</strong>
                <span className="text-[#444]"> / {MAX_SUPPLY}</span>
              </span>
            </div>
            <div className="mp-track">
              <div className="mp-fill" style={{ width: `${fillPercent}%` }} />
            </div>
          </div>

          {/* CTA */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row gap-4 items-center">
              <button
                className={`btn-circuit w-full sm:w-auto ${txState === 'signing' ? 'signing' : ''} ${isSoldOut ? '!bg-[#111] !text-[#444] !border-white/5' : ''}`}
                onClick={handleOrder}
                disabled={txState === 'signing' || isSoldOut}
              >
                <span>
                  {txState === 'signing' ? 'Confirming...' : 
                   txState === 'success' ? '✓ Order Confirmed' :
                   isSoldOut ? 'Scarcity Reached' :
                   'Confirm Order'}
                </span>
                <span className="btn-arrow">
                  {txState === 'signing' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M12 2a10 10 0 010 20 10 10 0 010-20"/></svg>
                  ) : isSoldOut ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-20"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  )}
                </span>
              </button>
            </div>
          </div>

          {/* Transaction Result */}
          <div id="drop-tx" role="status" aria-live="polite" className="min-h-[60px]">
            {txState === 'success' && txResult.txSignature && (
              <div className="tx-msg ok flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-white">✓</span>
                  <span>Payment secured in escrow. Production scheduled.</span>
                </div>
                <div className="flex gap-4 text-[0.7rem] font-bold uppercase tracking-widest">
                  <a href={txResult.solscanUrl} target="_blank" rel="noopener" className="text-[#666] hover:text-white transition-colors">Proof ↗</a>
                  <Link href="/confirm" className="text-white underline underline-offset-4">Next: Delivery →</Link>
                </div>
              </div>
            )}

            {txState === 'error' && (
              <div className="tx-msg err">
                <span>✗</span>
                <span>{txResult.message}</span>
              </div>
            )}

            {isSoldOut && txState !== 'success' && (
              <div className="tx-msg err flex flex-col gap-2 !border-white/10 !bg-white/[0.02]">
                <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-white">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  <span>Series Zero Closed</span>
                </div>
                <p className="text-[0.65rem] text-[#666] leading-relaxed uppercase tracking-tight">
                  All {MAX_SUPPLY} units of the 3 Piece Agbada have been reserved. The production protocol for this edition is now locked.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Image */}
        <div className="order-1 lg:order-2 flex justify-center lg:justify-end" style={{ animation: 'fadeIn 0.8s ease-out 0.2s both' }}>
          <div className="relative w-full max-w-[480px]">
            {/* Glow */}
            <div className="absolute inset-0 md:inset-[-15%] bg-[radial-gradient(circle,rgba(255,255,255,.05)_0%,transparent_70%)] blur-[40px] pointer-events-none" />

            
            {/* Image Frame */}
            <div className="relative rounded-[32px] overflow-hidden border border-white/[0.12] bg-[#0D0D0D] shadow-[0_30px_100px_rgba(0,0,0,.6)]">
                <Image
                  src="/satin.png"


                alt="3 Piece Agbada"
                width={600}
                height={720}
                className="w-full h-auto object-cover scale-[1.01]"
                priority
              />
              


              <div className="absolute bottom-6 left-6 flex items-center gap-2 bg-black/60 backdrop-blur-[20px] rounded-full px-4 py-2 text-[0.65rem] font-bold uppercase tracking-[0.1em] border border-white/[0.12]">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse shadow-[0_0_8px_white]" />
                3 Piece Agbada
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Escrow Flow Strip */}
      <div className="border-t border-white/[0.06] py-16 md:py-24 relative z-10 bg-white/[0.01]">
        <div className="section-container">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-0">
            {[
              { num: '01', title: 'Secured Payment', desc: 'Payment protected until delivery confirmation.', icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="6" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>
              )},
              { num: '02', title: 'Ethical Production', desc: 'Garment is made-to-order', icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              )},
              { num: '03', title: 'Garment passport', desc: 'Digital Passport generated', icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
              )},
            ].map((step, i) => (
              <div key={step.num} className="flex flex-col items-center text-center px-4 group">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center mb-6 group-hover:bg-white group-hover:text-black transition-all duration-500">
                  {step.icon}
                </div>
                <span className="text-[0.6rem] font-bold text-[#444] uppercase tracking-[0.2em] mb-2">{step.num}</span>
                <strong className="text-sm font-bold uppercase tracking-wider mb-2">{step.title}</strong>
                <p className="text-xs text-[#666] max-w-[200px]">{step.desc}</p>
                {i < 2 && <div className="hidden md:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-12 bg-white/[0.06]" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <SignInModal isOpen={isSignInOpen} onClose={() => setIsSignInOpen(false)} />
    </section>
  );
}
