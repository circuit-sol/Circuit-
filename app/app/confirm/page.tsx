'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { confirmDelivery, parseError } from '@/lib/solana-service';
import { DROP_ID, PRICE_SOL, MAX_SUPPLY, GARMENT_MINT } from '@/lib/constants';
import { truncateAddress } from '@/lib/utils';
import { showToast } from '@/components/Toast';

type TxState = 'idle' | 'signing' | 'success' | 'error';

interface TxResult {
  txSignature?: string;
  solscanUrl?: string;
  fundsReleased?: number;
  designerAddress?: string;
  message?: string;
}

export default function ConfirmPage() {
  const { publicKey, connected } = useWallet();
  const [txState, setTxState] = useState<TxState>('idle');
  const [txResult, setTxResult] = useState<TxResult>({});
  const processingRef = useRef(false);

  const handleDeliver = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setTxState('signing');
    setTxResult({});

    try {
      const result = await confirmDelivery(
        'simulation-pda',
        DROP_ID,
        publicKey?.toBase58()
      );

      setTxState('success');
      setTxResult({
        txSignature: result.txSignature,
        solscanUrl: result.solscanUrl,
        fundsReleased: result.fundsReleased,
        designerAddress: result.designerAddress,
      });
      showToast('✓', 'Delivery confirmed — funds released to designer');
    } catch (err) {
      setTxState('error');
      setTxResult({ message: parseError(err) });
      showToast('✗', 'Confirmation failed');
    } finally {
      processingRef.current = false;
    }
  };

  return (
    <section className="min-h-[calc(100vh-72px)] flex items-center justify-center px-6 py-12" aria-label="Confirm Delivery">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="ambient-orb orb-white" />
        <div className="ambient-orb orb-grey" />
      </div>

      <div className="card-glass max-w-[520px] w-full p-8 md:p-10 flex flex-col items-center text-center gap-6 relative z-10" style={{ animation: 'fadeIn 0.6s ease-out' }}>
        {/* Shield */}
        <div className="relative" aria-hidden="true">
          <div className="absolute inset-[-30%] bg-[radial-gradient(circle,rgba(255,255,255,.06)_0%,transparent_70%)] blur-[20px] pointer-events-none" />
          <svg className="w-20 h-20" viewBox="0 0 80 80" fill="none">
            <path
              d="M40 6L10 20V38C10 56.4 22.8 73.4 40 78C57.2 73.4 70 56.4 70 38V20L40 6Z"
              stroke="url(#sg)" strokeWidth="2"
            />
            <path
              d="M28 40L36 48L52 32"
              stroke="url(#sg)" strokeWidth="3"
              strokeLinecap="round" strokeLinejoin="round"
              className="check-path"
            />
            <defs>
              <linearGradient id="sg" x1="10" y1="6" x2="70" y2="78">
                <stop stopColor="#FFFFFF" />
                <stop offset="1" stopColor="#666666" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <h1 className="text-2xl md:text-3xl font-bold tracking-[-0.02em]">Confirm Your Delivery</h1>

        {/* Garment Preview */}
        <div className="flex items-center gap-4 bg-white/[0.04] border border-white/[0.12] rounded-2xl p-4 w-full">
          <Image
            src="/dpp-image.png"
            alt="Wrap Dress"
            width={56}
            height={56}
            className="rounded-xl object-cover"
          />
          <div className="text-left">
            <strong className="text-sm">Circuit Drop Zero</strong>
            <span className="block text-xs text-[#A3A3A3]">The Wrap Dress · Edition 01/{MAX_SUPPLY}</span>
          </div>
        </div>

        <p className="text-sm text-[#A3A3A3] leading-relaxed">
          Received your garment? Tap below to confirm. Your confirmation
          releases payment from escrow to the designer.
        </p>

        {/* Order Summary */}
        <div className="w-full flex flex-col gap-0 border border-white/[0.12] rounded-2xl overflow-hidden text-left text-sm">
          <div className="flex justify-between p-4 border-b border-white/[0.12]">
            <span className="text-[#666]">Order</span>
            <span>Circuit Drop Zero — Wrap Dress</span>
          </div>
          <div className="flex justify-between p-4 border-b border-white/[0.12]">
            <span className="text-[#666]">Escrow</span>
            <span className="font-mono text-xs text-[#A3A3A3]">PDA held by program</span>
          </div>
          <div className="flex justify-between p-4">
            <span className="text-[#666]">Action</span>
            <span>Release funds to designer</span>
          </div>
        </div>

        {/* CTA */}
        <button
          className={`btn-circuit w-full justify-center ${txState === 'signing' ? 'signing' : ''}`}
          onClick={handleDeliver}
          disabled={txState === 'signing' || txState === 'success'}
          aria-label="Confirm delivery and release escrow"
        >
          <span>
            {txState === 'signing' ? 'Processing on Solana...' :
             txState === 'success' ? '✓ Delivery Confirmed' :
             'Confirm Delivery'}
          </span>
          <span className="btn-arrow" aria-hidden="true">
            {txState === 'signing' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 010 20 10 10 0 010-20" strokeLinecap="round"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            )}
          </span>
        </button>

        {/* Result */}
        <div role="status" aria-live="polite" className="w-full">
          {txState === 'success' && txResult.txSignature && (
            <div className="tx-msg ok flex flex-col gap-2 w-full" style={{ animation: 'celebrate 0.5s ease' }}>
              <div className="flex items-center gap-2">
                <span>✓</span>
                <span>Delivery confirmed. {txResult.fundsReleased} SOL released to designer.</span>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <a href={txResult.solscanUrl} target="_blank" rel="noopener" className="text-[#D1D1D1] hover:text-white transition-colors underline underline-offset-2">
                  View on Solscan ↗
                </a>
                <Link href={`/garment/${GARMENT_MINT}`} className="text-[#D1D1D1] hover:text-white transition-colors underline underline-offset-2">
                  View Digital Passport →
                </Link>
              </div>
            </div>
          )}

          {txState === 'error' && (
            <div className="tx-msg err w-full">
              <span>✗</span>
              <span>{txResult.message}</span>
            </div>
          )}
        </div>

        <p className="text-xs text-[#666]">This transaction requires your wallet signature.</p>
      </div>
    </section>
  );
}
