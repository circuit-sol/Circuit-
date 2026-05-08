'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { confirmDelivery, parseError } from '@/lib/solana-service';
import { DROP_ID, MAX_SUPPLY, GARMENT_MINT } from '@/lib/constants';
import { showToast } from '@/components/Toast';
import SignInModal from '@/components/SignInModal';
import { updateOrderStatus } from '@/lib/db';

type TxState = 'idle' | 'signing' | 'success' | 'error';

interface TxResult {
  txSignature?: string;
  solscanUrl?: string;
  fundsReleased?: number;
  designerAddress?: string;
  message?: string;
}

export default function ConfirmPage() {
  const { user, isSignedIn } = useAuth();
  const [txState, setTxState] = useState<TxState>('idle');
  const [txResult, setTxResult] = useState<TxResult>({});
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const processingRef = useRef(false);

  const handleDeliver = async () => {
    if (processingRef.current) return;

    if (!isSignedIn) {
      setIsSignInOpen(true);
      return;
    }

    processingRef.current = true;
    setTxState('signing');
    setTxResult({});

    try {
      const result = await confirmDelivery(
        'simulation-pda',
        DROP_ID,
        user?.walletAddress
      );

      await updateOrderStatus(result.txSignature, 'delivered');

      setTxState('success');
      setTxResult({
        txSignature: result.txSignature,
        solscanUrl: result.solscanUrl,
        fundsReleased: result.fundsReleased,
        designerAddress: result.designerAddress,
      });
      showToast('✓', 'Delivery confirmed');
    } catch (err) {
      setTxState('error');
      setTxResult({ message: parseError(err) });
      showToast('✗', 'Confirmation failed');
    } finally {
      processingRef.current = false;
    }
  };

  return (
    <section className="min-h-screen flex items-center justify-center px-6 pt-[72px] pb-12 overflow-hidden" aria-label="Confirm Delivery">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="ambient-orb orb-white" />
        <div className="ambient-orb orb-grey" />
      </div>

      <div className="card-glass max-w-[500px] w-full p-8 md:p-12 flex flex-col items-center text-center gap-8 relative z-10" style={{ animation: 'fadeIn 0.6s ease-out' }}>
        {/* Shield Icon */}
        <div className="relative">
          <div className="absolute inset-[-40%] bg-white/[0.05] blur-[30px] rounded-full animate-pulse" />
          <svg className="w-20 h-20 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Finalize Delivery</h1>
          <p className="text-sm text-[#A3A3A3] leading-relaxed max-w-[340px]">
            Once you confirm receipt, your payment will be released from escrow to the designer.
          </p>
        </div>

        {/* Item Preview */}
        <div className="w-full flex items-center gap-4 bg-white/[0.03] border border-white/[0.08] p-4 rounded-2xl">
          <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-white/10">
            <Image src="/dpp-image.png" alt="Wrap Dress" width={56} height={56} className="object-cover" />
          </div>
          <div className="flex flex-col text-left">
            <span className="text-[0.6rem] font-bold text-[#666] uppercase tracking-wider">Garment ID</span>
            <span className="text-sm font-bold">Drop Zero — Wrap Dress</span>
          </div>
        </div>

        {/* Action Button */}
        <button
          className={`btn-circuit w-full justify-center ${txState === 'signing' ? 'signing' : ''}`}
          onClick={handleDeliver}
          disabled={txState === 'signing' || txState === 'success'}
        >
          <span>
            {txState === 'signing' ? 'Processing...' :
             txState === 'success' ? '✓ Payment Released' :
             'Confirm Delivery'}
          </span>
          {!txState.includes('success') && (
            <span className="btn-arrow">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </span>
          )}
        </button>

        {/* Results */}
        {txState === 'success' && (
          <div className="tx-msg ok flex flex-col gap-3 w-full">
            <p className="font-bold">✓ Transaction Complete</p>
            <div className="flex gap-4 justify-center text-[0.65rem] font-bold uppercase tracking-widest">
              <a href={txResult.solscanUrl} target="_blank" rel="noopener" className="text-[#666] hover:text-white transition-colors">Explorer ↗</a>
              <Link href={`/garment/${GARMENT_MINT}`} className="text-white underline underline-offset-4">View Passport →</Link>
            </div>
          </div>
        )}

        {txState === 'error' && (
          <div className="tx-msg err w-full">
            <span>✗</span>
            <span>{txResult.message}</span>
          </div>
        )}

        <div className="flex items-center gap-2 text-[0.6rem] font-bold text-[#444] uppercase tracking-widest">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Secured by Solana Escrow
        </div>
      </div>

      <SignInModal isOpen={isSignInOpen} onClose={() => setIsSignInOpen(false)} />
    </section>
  );
}
