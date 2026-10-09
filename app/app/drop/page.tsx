'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAuth } from '@/lib/auth-context';
import * as backendApi from '@/lib/backendApi';
import {
  initializeEscrow,
  parseError,
  resetState,
  executeVerifiedPurchase,
} from '@/lib/solana-service';
import { solscanTxUrl } from '@/lib/utils';
import { showToast } from '@/components/Toast';
import SignInModal from '@/components/SignInModal';
import Selector from '@/components/Selector';
import { saveOrder, getEditionById, getEditions, DEFAULT_CIRCUIT_EDITION } from '@/lib/db';

type TxState = 'idle' | 'signing' | 'success' | 'error' | 'soldout';
type TxStep = 'idle' | 'prepare' | 'sign' | 'submit' | 'confirm';

interface TxResult {
  txSignature?: string;
  solscanUrl?: string;
  escrowPDA?: string;
  orderNumber?: number;
  message?: string;
}

const defaultFallbackBatches: backendApi.Batch[] = [
  {
    id: 'b1000000-0000-4000-8000-000000000001',
    edition_id: 'circuit-demo-drop-001',
    name: 'Batch 01 — Circuit Inaugural Run',
    opens_at: new Date(Date.now() - 3600000).toISOString(),
    closes_at: new Date(Date.now() + 86400000 * 7).toISOString(),
    production_starts_at: new Date(Date.now() + 86400000 * 10).toISOString(),
    release_at: new Date(Date.now() + 86400000 * 25).toISOString(),
    pickup_locations: [
      {
        id: 'c4b12345-6789-4abc-def0-123456789ab1',
        name: 'Circuit Atelier HQ',
        address: '14 Adeola Odeku Street, Victoria Island',
        city: 'Lagos',
        country: 'Nigeria',
        instructions: 'Show your digital passport QR code at the concierge.',
      },
      {
        id: 'c4b12345-6789-4abc-def0-123456789ab2',
        name: 'Soho Design Hub',
        address: '28 Peter Street',
        city: 'London',
        country: 'United Kingdom',
        instructions: 'Counter 3, open Tuesday to Saturday 10am-6pm.',
      },
    ],
    fulfillment_method: 'pickup',
    sales_window_status: 'open',
    checkout_enabled: true,
    cancellation_window_hours: 24,
    advance_payout_percent: 30,
    balance_payout_percent: 70,
  },
];

const fallbackEdition = DEFAULT_CIRCUIT_EDITION;

function DropPageContent() {
  const { user, isSignedIn } = useAuth();
  const { signTransaction } = useWallet();
  const searchParams = useSearchParams();
  const requestedEditionId = searchParams.get('edition');

  const [edition, setEdition] = useState<any>(fallbackEdition);
  const [batches, setBatches] = useState<backendApi.Batch[]>(defaultFallbackBatches);
  const [selectedBatch, setSelectedBatch] = useState<backendApi.Batch | null>(defaultFallbackBatches[0]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>(defaultFallbackBatches[0].pickup_locations[0].id || 'loc-lagos-1');
  const [mintedCount, setMintedCount] = useState(0);
  const [txState, setTxState] = useState<TxState>('idle');
  const [txStep, setTxStep] = useState<TxStep>('idle');
  const [txResult, setTxResult] = useState<TxResult>({});
  const [loading, setLoading] = useState(false);
  const [isVerifyingStock, setIsVerifyingStock] = useState(false);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [selectedSize, setSelectedSize] = useState('Medium');
  const [quantity, setQuantity] = useState(1);
  const [computedPrice, setComputedPrice] = useState(120);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<'fiat' | 'crypto'>('crypto');
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [showFiatModal, setShowFiatModal] = useState(false);
  const processingRef = useRef(false);
  const router = useRouter();

  // Auto-redirect to confirmation page after successful payment
  useEffect(() => {
    if (txState === 'success') {
      const timer = setTimeout(() => {
        router.push('/confirm');
      }, 1500); // 1.5s delay so user can see the success state briefly
      return () => clearTimeout(timer);
    }
  }, [txState, router]);

  // Fetch Drop, Supply Details, and Batches
  useEffect(() => {
    let isMounted = true;

    async function loadDropData() {
      try {
        if (requestedEditionId && requestedEditionId !== fallbackEdition.id) {
          setLoading(true);
        }
        let activeEdition = null;

        if (requestedEditionId) {
          activeEdition = await getEditionById(requestedEditionId);
          if (!activeEdition) {
            try {
              const myEditions = await getEditions(false);
              const matched = myEditions.find((e: any) => e.id === requestedEditionId);
              if (matched) activeEdition = matched;
            } catch {
              // fallback
            }
          }
        }

        if (!activeEdition) {
          const allEditions = await getEditions();
          if (allEditions && allEditions.length > 0) {
            activeEdition = allEditions[0];
          } else {
            activeEdition = fallbackEdition;
          }
        }

        if (!isMounted) return;
        setEdition(activeEdition);

        // Calculate dynamic price based on size
        if (activeEdition.has_variable_prices && activeEdition.prices_by_size) {
          const priceMap = activeEdition.prices_by_size;
          setComputedPrice(Number((priceMap as Record<string, number>)[selectedSize] || activeEdition.price_usd));
        } else {
          setComputedPrice(Number(activeEdition.price_usd));
        }

        // Fetch exact supply count from backend silently
        try {
          const BASE = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
          const countRes = await fetch(`${BASE}/api/db/orders/count/${encodeURIComponent(activeEdition.id)}`);
          if (countRes.ok && isMounted) {
            const { count } = await countRes.json();
            setMintedCount(count);
          }
        } catch (e) {
          console.error('Error fetching supply count:', e);
        }

        // Fetch Live SOL Price silently
        try {
          const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
          const data = await res.json();
          if (data?.solana?.usd && isMounted) {
            setSolPrice(Number(data.solana.usd));
          }
        } catch (e) {
          console.warn('Unable to fetch live SOL price, using cached/offline fallback:', e);
        }

        // Fetch batches for this edition
        try {
          const batchRes = await backendApi.getPublicBatches(activeEdition.id);
          if (!isMounted) return;
          if (batchRes?.batches && batchRes.batches.length > 0) {
            setBatches(batchRes.batches);
            setSelectedBatch(batchRes.batches[0]);
            if (batchRes.batches[0].pickup_locations?.length > 0) {
              setSelectedLocationId(batchRes.batches[0].pickup_locations[0].id || 'loc-1');
            }
          } else {
            // Check seller batches or fallback
            try {
              const myBatchRes = await backendApi.getMyBatches({ editionId: activeEdition.id });
              if (!isMounted) return;
              if (myBatchRes?.batches && myBatchRes.batches.length > 0) {
                setBatches(myBatchRes.batches);
                setSelectedBatch(myBatchRes.batches[0]);
                if (myBatchRes.batches[0].pickup_locations?.length > 0) {
                  setSelectedLocationId(myBatchRes.batches[0].pickup_locations[0].id || 'loc-1');
                }
              } else {
                setBatches(defaultFallbackBatches);
                setSelectedBatch(defaultFallbackBatches[0]);
                setSelectedLocationId(defaultFallbackBatches[0].pickup_locations[0].id || 'loc-lagos-1');
              }
            } catch {
              setBatches(defaultFallbackBatches);
              setSelectedBatch(defaultFallbackBatches[0]);
              setSelectedLocationId(defaultFallbackBatches[0].pickup_locations[0].id || 'loc-lagos-1');
            }
          }
        } catch (e) {
          console.warn('Could not fetch batches for edition, using default fallback:', e);
          setBatches(defaultFallbackBatches);
          setSelectedBatch(defaultFallbackBatches[0]);
          setSelectedLocationId(defaultFallbackBatches[0].pickup_locations[0].id || 'loc-lagos-1');
        }
      } catch (err) {
        console.error('Error fetching dynamic drop details:', err);
        setEdition(fallbackEdition);
        setBatches(defaultFallbackBatches);
        setSelectedBatch(defaultFallbackBatches[0]);
        setSelectedLocationId(defaultFallbackBatches[0].pickup_locations[0].id || 'loc-lagos-1');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadDropData();

    // ── Silent background stock sync: polls count only, NEVER reloads page ──
    const interval = setInterval(async () => {
      const currentId = requestedEditionId || edition?.id || fallbackEdition.id;
      if (!currentId) return;
      try {
        const BASE = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
        const countRes = await fetch(`${BASE}/api/db/orders/count/${encodeURIComponent(currentId)}`);
        if (countRes.ok && isMounted) {
          const { count } = await countRes.json();
          setMintedCount(count);
        }
      } catch {
        // Silent error
      }
    }, 15000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [requestedEditionId]);

  // Recalculate price when size updates
  useEffect(() => {
    if (edition) {
      if (edition.has_variable_prices && edition.prices_by_size) {
        const priceMap = edition.prices_by_size;
        setComputedPrice(Number(priceMap[selectedSize] || edition.price_usd));
      } else {
        setComputedPrice(Number(edition.price_usd));
      }
    }
  }, [selectedSize, edition]);

  const activeEdition = edition || fallbackEdition;
  const maxSupply = activeEdition.max_supply;
  const isSoldOut = mintedCount >= maxSupply;
  const fillPercent = Math.min(100, (mintedCount / maxSupply) * 100);

  // Prices: Primary in SOL, secondary in USD
  const unitSol = selectedBatch?.pricing?.unit_price_lamports
    ? Number(selectedBatch.pricing.unit_price_lamports) / 1e9
    : solPrice
      ? Number((computedPrice / solPrice).toFixed(3))
      : Number((computedPrice / 150).toFixed(3));
  const totalSol = Number((unitSol * quantity).toFixed(3));
  const totalUsd = Number((computedPrice * quantity).toFixed(2));

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

    if (paymentMethod === 'fiat') {
      setShowFiatModal(true);
      return;
    }

    processingRef.current = true;
    setIsVerifyingStock(true);
    setTxState('signing');
    setTxStep('prepare');
    setTxResult({});

    try {
      // 0. JIT Stock Availability Check right when buyer clicks Preorder
      try {
        const BASE = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
        const countRes = await fetch(`${BASE}/api/db/orders/count/${encodeURIComponent(activeEdition.id)}`);
        if (countRes.ok) {
          const { count } = await countRes.json();
          setMintedCount(count);
          if (count >= activeEdition.max_supply) {
            showToast('Sold Out', 'Sorry! This drop reached maximum capacity a moment ago.');
            setTxState('soldout');
            setIsVerifyingStock(false);
            processingRef.current = false;
            return;
          }
        }
      } catch {
        // Non-blocking fallback
      }
      setIsVerifyingStock(false);

      // 1. If wallet is connected and signTransaction is available, execute verified 4-step chain flow
      if (selectedBatch && signTransaction) {
        const pickupLocId = selectedLocationId || selectedBatch.pickup_locations?.[0]?.id || 'c4b12345-6789-4abc-def0-123456789ab1';
        try {
          showToast('Preparing Order', 'Generating verified intent on Solana Devnet...');
          const verified = await executeVerifiedPurchase({
            batchId: selectedBatch.id,
            quantity,
            size: selectedSize,
            pickupLocationId: pickupLocId,
            signTransaction,
            onStepChange: (step) => {
              setTxStep(step);
              if (step === 'sign') showToast('Signature Required', 'Please approve transaction in Phantom wallet.');
              if (step === 'submit') showToast('Submitting', 'Broadcasting transaction to Solana Devnet...');
              if (step === 'confirm') showToast('Confirming', 'Verifying on-chain state and escrow deposit...');
            },
          });

          // Cache order info for passport
          if (typeof window !== 'undefined') {
            localStorage.setItem('circuit_last_order_tx', verified.signature);
            localStorage.setItem('circuit_last_order_id', verified.orderId);
          }

          setMintedCount((prev) => prev + quantity);
          setTxState('success');
          setTxStep('idle');
          setTxResult({
            txSignature: verified.signature,
            solscanUrl: verified.solscanUrl,
            orderNumber: (mintedCount || 0) + 1,
          });
          showToast('✓ Confirmed', `Order #${(mintedCount || 0) + 1} confirmed on Solana Devnet!`);
          return;
        } catch (chainErr) {
          console.warn('Verified chain intent encountered issue, falling back gracefully:', chainErr);
          // Fall through to standard escrow handshake if chain engine in simulation/mock
        }
      }

      // 2. Fallback handshake (custodial/simulation escrow)
      const result = await initializeEscrow(edition.id, totalSol, user.walletAddress);

      await saveOrder({
        email: user.email,
        drop_id: edition.id,
        tx_signature: result.txSignature,
        escrow_pda: result.escrowPDA,
        amount_usd: totalUsd,
        size: selectedSize,
        quantity: quantity,
      });

      if (typeof window !== 'undefined') {
        localStorage.setItem('circuit_last_order_tx', result.txSignature);
      }

      setMintedCount((prev) => prev + quantity);
      setTxState('success');
      setTxStep('idle');
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
      setTxStep('idle');
    }
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-72px)] flex flex-col items-center justify-center pt-[72px] bg-black text-white">
        <div className="w-12 h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
        <span className="text-xs font-mono text-[#555] mt-4">Loading drop details...</span>
      </div>
    );
  }

  return (
    <section className="min-h-[calc(100vh-72px)] flex flex-col pt-[72px] overflow-x-hidden" aria-label={activeEdition.name}>
      {/* Ambient Orbs */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="ambient-orb orb-white" />
        <div className="ambient-orb orb-grey" />
      </div>

      {/* Hero */}
      <div className="flex-1 section-container py-10 md:py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center relative z-10">
        
        {/* Left: Checkout Specifications */}
        <div className="flex flex-col gap-8 order-2 lg:order-1" style={{ animation: 'fadeIn 0.6s ease-out' }}>
          {/* Tags */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="px-3 py-1 rounded-full text-[0.65rem] font-bold uppercase tracking-[0.08em] border border-white/20 text-[#A3A3A3]">
              Limited Drop
            </span>
            <span className="px-3 py-1 rounded-full text-[0.65rem] font-bold uppercase tracking-[0.08em] bg-white/[0.04] border border-white/[0.08] text-[#666]">
              Protected Payment
            </span>
            {!activeEdition.published && (
              <span className="px-3 py-1 rounded-full text-[0.65rem] font-bold uppercase tracking-[0.08em] bg-amber-500/10 border border-amber-500/25 text-amber-300 font-mono flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Atelier Preview Mode
              </span>
            )}
          </div>

          <div className="w-full flex justify-between items-center z-10 pt-4">
            <Link href="/" className="inline-flex items-center gap-2 text-[#888] hover:text-white transition-colors text-xs font-bold uppercase tracking-widest px-4 py-2 border border-white/10 rounded-full bg-white/[0.03]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              Explore Other Editions
            </Link>
          </div>

          {/* Title & Brand */}
          <div className="flex flex-col">
            <h1 className="text-[3.5rem] md:text-[5.5rem] leading-[0.85] font-bold tracking-[-0.04em] mb-4">
              <span className="block">Proceed</span>
              <span className="block bg-gradient-to-b from-white to-[#666] bg-clip-text text-transparent">With Order</span>
            </h1>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <h2 className="text-[1.8rem] md:text-[2.2rem] font-light text-[#A3A3A3] tracking-[-0.02em]">{activeEdition.name}</h2>
              {/* Brand Social & Support Links */}
              {activeEdition.social_links && (
                <div className="flex items-center gap-2">
                  {activeEdition.social_links.instagram && (
                    <a
                      href={activeEdition.social_links.instagram.startsWith('http') ? activeEdition.social_links.instagram : `https://instagram.com/${activeEdition.social_links.instagram.replace(/^@/, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Brand Instagram"
                      className="w-7 h-7 rounded-full bg-white/[0.04] hover:bg-white/10 border border-white/10 flex items-center justify-center text-xs text-[#A3A3A3] hover:text-white transition-all"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                    </a>
                  )}
                  {activeEdition.social_links.twitter && (
                    <a
                      href={activeEdition.social_links.twitter.startsWith('http') ? activeEdition.social_links.twitter : `https://x.com/${activeEdition.social_links.twitter.replace(/^@/, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Brand X / Twitter"
                      className="w-7 h-7 rounded-full bg-white/[0.04] hover:bg-white/10 border border-white/10 flex items-center justify-center text-xs text-[#A3A3A3] hover:text-white transition-all font-bold font-mono"
                    >
                      𝕏
                    </a>
                  )}
                  {activeEdition.social_links.whatsapp && (
                    <a
                      href={activeEdition.social_links.whatsapp.startsWith('http') ? activeEdition.social_links.whatsapp : `https://wa.me/${activeEdition.social_links.whatsapp.replace(/[^0-9]/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Customer Care / WhatsApp"
                      className="w-7 h-7 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-[10px] text-emerald-400 hover:text-emerald-300 transition-all font-bold"
                    >
                      💬
                    </a>
                  )}
                  {activeEdition.social_links.support_email && (
                    <a
                      href={activeEdition.social_links.support_email.startsWith('mailto:') ? activeEdition.social_links.support_email : `mailto:${activeEdition.social_links.support_email}`}
                      title="Support Email"
                      className="w-7 h-7 rounded-full bg-white/[0.04] hover:bg-white/10 border border-white/10 flex items-center justify-center text-xs text-[#A3A3A3] hover:text-white transition-all"
                    >
                      ✉️
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>

          <p className="text-[0.95rem] text-[#A3A3A3] leading-[1.8] max-w-[540px]">
            {activeEdition.description}
          </p>

          {/* Metadata Matrix */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-0 border border-white/[0.08] rounded-3xl overflow-hidden bg-white/[0.02] backdrop-blur-sm">
            <div className="p-4 md:p-5 border-r border-b sm:border-b-0 border-white/[0.08]">
              <span className="block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-1.5">Availability</span>
              <span className="text-sm font-semibold">{maxSupply - mintedCount} Left</span>
            </div>
            <div className="p-4 md:p-5 border-r border-b sm:border-b-0 border-white/[0.08]">
              <span className="block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-1.5">Unit Price</span>
              <span className="text-sm font-semibold text-emerald-400">{unitSol} SOL</span>
              <span className="block text-[0.6rem] text-[#666]">~${computedPrice} USD</span>
            </div>
            <div className="p-4 md:p-5 border-r border-white/[0.08]">
              <span className="block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-1.5">Main Fabric</span>
              <span className="text-sm font-semibold">{activeEdition.fabric || 'Duchess satin'}</span>
            </div>
            <div className="p-4 md:p-5 border-r border-white/[0.08]">
              <span className="block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-1.5">Headpiece</span>
              <span className="text-sm font-semibold">{activeEdition.headpiece || 'Velvet'}</span>
            </div>
            <div className="p-4 md:p-5">
              <span className="block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-1.5">Embroidery</span>
              <span className="text-sm font-semibold">{activeEdition.embroidery || 'Metallic thread'}</span>
            </div>
          </div>

          {/* Preorder Batch Selector */}
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-baseline">
              <span className="text-[0.65rem] text-[#666] uppercase tracking-[0.12em] font-bold">Select Preorder Batch</span>
              {selectedBatch?.closes_at && (
                <span className="text-[0.65rem] font-mono text-[#888]">
                  Closes: {new Date(selectedBatch.closes_at).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {batches.map((b) => {
                const isSelected = selectedBatch?.id === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      setSelectedBatch(b);
                      if (b.pickup_locations?.length > 0) {
                        setSelectedLocationId(b.pickup_locations[0].id || 'loc-1');
                      }
                    }}
                    className={`p-4 rounded-2xl text-left border transition-all ${
                      isSelected
                        ? 'border-white bg-white/[0.06] shadow-[0_0_20px_rgba(255,255,255,0.05)]'
                        : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-white tracking-wide">{b.name}</span>
                      <span className="text-[0.6rem] font-bold uppercase px-2 py-0.5 rounded-full border border-emerald-400/30 text-emerald-400 bg-emerald-400/10">
                        {b.sales_window_status || 'Open'}
                      </span>
                    </div>
                    <div className="text-[0.65rem] text-[#888] font-mono space-y-0.5">
                      <div>Estimated Arrival: {new Date(b.release_at).toLocaleDateString()}</div>
                      <div>{b.pickup_locations?.length || 1} Pickup Station{(b.pickup_locations?.length || 1) > 1 ? 's' : ''}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Fulfillment: In-Person Pickup Only */}
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-baseline">
              <span className="text-[0.65rem] text-[#666] uppercase tracking-[0.12em] font-bold">
                Fulfillment Station (Pickup Only)
              </span>
              <span className="text-[0.6rem] font-bold uppercase px-2 py-0.5 rounded bg-white/[0.05] border border-white/10 text-white/80">
                In-Person Collection
              </span>
            </div>

            {selectedBatch && selectedBatch.pickup_locations?.length > 0 ? (
              <div className="flex flex-col gap-2">
                <select
                  value={selectedLocationId}
                  onChange={(e) => setSelectedLocationId(e.target.value)}
                  className="w-full bg-[#0d0d0d] border border-white/[0.12] rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-white/40"
                >
                  {selectedBatch.pickup_locations.map((loc, idx) => (
                    <option key={loc.id || idx} value={loc.id || `loc-${idx}`}>
                      {loc.name} — {loc.address}, {loc.city}, {loc.country}
                    </option>
                  ))}
                </select>

                {(() => {
                  const activeLoc = selectedBatch.pickup_locations.find((l) => (l.id || '') === selectedLocationId) || selectedBatch.pickup_locations[0];
                  return activeLoc?.instructions ? (
                    <p className="text-[0.65rem] text-[#777] font-mono italic px-1">
                      ℹ Instructions: {activeLoc.instructions}
                    </p>
                  ) : null;
                })()}
              </div>
            ) : (
              <div className="p-3 text-xs text-[#888] border border-white/[0.08] rounded-xl bg-white/[0.02]">
                Official Brand Studio Collection Station
              </div>
            )}
          </div>

          {/* Sizing & Quantity */}
          <div className="flex flex-col gap-6">
            <Selector 
              label="Select Size" 
              options={['Small', 'Medium', 'Large', 'Extra Large']} 
              selected={selectedSize} 
              onChange={setSelectedSize} 
            />
            
            {/* Quantity Selector */}
            <div className="flex flex-col gap-3">
              <span className="text-[0.65rem] text-[#666] uppercase tracking-[0.12em] font-bold">Quantity</span>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center hover:bg-white/5 transition-colors"
                  type="button"
                >
                  <span className="text-white text-lg">−</span>
                </button>
                <span className="text-lg font-bold min-w-[20px] text-center">{quantity}</span>
                <button 
                  onClick={() => setQuantity(quantity + 1)}
                  className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center hover:bg-white/5 transition-colors"
                  type="button"
                >
                  <span className="text-white text-lg">+</span>
                </button>
              </div>
            </div>
          </div>

          {/* Supply Status Fill Bar */}
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-baseline">
              <span className="text-[0.65rem] text-[#666] uppercase tracking-[0.12em] font-bold">Drop Progress</span>
              <span className="text-sm font-mono">
                <strong>{mintedCount}</strong>
                <span className="text-[#444]"> of {maxSupply} confirmed</span>
              </span>
            </div>
            <div className="mp-track">
              <div className="mp-fill" style={{ width: `${fillPercent}%` }} />
            </div>
          </div>

          {/* Transaction CTA */}
          <div className="flex flex-col gap-6">
            
            {/* Payment Method Selector */}
            <div className="flex flex-col gap-3">
              <span className="text-[0.65rem] text-[#666] uppercase tracking-[0.12em] font-bold">Payment Method</span>
              <div className="flex bg-white/[0.02] border border-white/5 rounded-xl p-1 gap-1">
                <button 
                  onClick={() => setPaymentMethod('crypto')}
                  className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest rounded-lg transition-all ${paymentMethod === 'crypto' ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.1)]' : 'text-[#666] hover:text-white hover:bg-white/[0.02]'}`}
                >
                  Crypto ({totalSol} SOL)
                </button>
                <button 
                  onClick={() => setPaymentMethod('fiat')}
                  className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest rounded-lg transition-all ${paymentMethod === 'fiat' ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.1)]' : 'text-[#666] hover:text-white hover:bg-white/[0.02]'}`}
                >
                  Fiat (${totalUsd} USD)
                </button>
              </div>
            </div>

            {/* Escrow Protocol & Cancellation Guarantee Notice */}
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] text-[0.68rem] text-[#999] leading-relaxed space-y-2">
              <div className="flex items-center gap-2 text-white font-bold uppercase tracking-wider text-[0.65rem]">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Protected by Circuit Escrow</span>
              </div>
              <ul className="space-y-1 list-disc list-inside text-[#888] font-mono text-[0.63rem]">
                <li>
                  <strong className="text-white">24-Hour Free Cancellation:</strong> 100% individual refund available within 24 hours of purchase, even near batch close.
                </li>
                <li>
                  <strong className="text-white">Protected Payment:</strong> Your money is held safely in escrow until you receive and confirm your piece.
                </li>
                <li>
                  <strong className="text-white">Atelier Support & Mediation:</strong> Direct customer care backed by Circuit dispute protection.
                </li>
              </ul>
            </div>

            <div className="flex flex-col gap-3">
              {txState === 'signing' && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-[0.65rem] font-mono text-emerald-400">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M12 2a10 10 0 010 20 10 10 0 010-20"/></svg>
                  <span>
                    {txStep === 'prepare' && 'Step 1/4: Preparing on-chain purchase intent...'}
                    {txStep === 'sign' && 'Step 2/4: Requesting Phantom wallet signature...'}
                    {txStep === 'submit' && 'Step 3/4: Broadcasting transaction to Solana devnet...'}
                    {txStep === 'confirm' && 'Step 4/4: Confirming finality and recording escrow order...'}
                  </span>
                </div>
              )}

              <button
                className={`btn-circuit w-full ${txState === 'signing' || isVerifyingStock ? 'signing' : ''} ${isSoldOut || activeEdition.published === false ? '!bg-[#111] !text-[#555] !border-white/10' : ''}`}
                onClick={activeEdition.published !== false ? handleOrder : undefined}
                disabled={txState === 'signing' || isVerifyingStock || isSoldOut || activeEdition.published === false}
              >
                <span>
                  {isVerifyingStock ? 'Checking stock...' :
                   txState === 'signing' ? 'Processing on Solana...' : 
                   txState === 'success' ? '✓ Order Confirmed' :
                   activeEdition.published === false ? 'Preview Mode (Unpublished)' :
                   isSoldOut ? 'Sold Out' :
                   `Pre-Order (${totalSol} SOL)`}
                </span>
                <span className="btn-arrow">
                  {txState === 'signing' || isVerifyingStock ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M12 2a10 10 0 010 20 10 10 0 010-20"/></svg>
                  ) : isSoldOut || activeEdition.published === false ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-20"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  )}
                </span>
              </button>
            </div>
          </div>

          {/* Transaction Outputs */}
          <div id="drop-tx" role="status" aria-live="polite" className="min-h-[60px]">
            {txState === 'success' && txResult.txSignature && (
              <div className="tx-msg ok flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-white">✓</span>
                  <span>Payment secured in escrow. Order queued.</span>
                </div>
                <div className="flex gap-4 text-[0.7rem] font-bold uppercase tracking-widest">
                  <a href={txResult.solscanUrl} target="_blank" rel="noopener" className="text-[#666] hover:text-white transition-colors">Explorer Proof ↗</a>
                  <Link href="/confirm" className="text-white underline underline-offset-4">Next: Add Shipment Details →</Link>
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
                  <span>Drop Selection Closed</span>
                </div>
                <p className="text-[0.65rem] text-[#666] leading-relaxed uppercase tracking-tight">
                  All {maxSupply} pieces have been fully reserved. The manufacturing protocol for this edition is locked.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Premium Visual Gallery */}
        <div className="order-1 lg:order-2 flex flex-col justify-start lg:justify-start pt-8 lg:pt-0 items-center lg:items-end w-full" style={{ animation: 'fadeIn 0.8s ease-out 0.2s both' }}>
          <div className="relative w-full max-w-[480px]">
            {/* Ambient Background Radial */}
            <div className="absolute inset-0 md:inset-[-15%] bg-[radial-gradient(circle,rgba(255,255,255,.05)_0%,transparent_70%)] blur-[40px] pointer-events-none" />

            {/* Main Frame */}
            <div className="relative rounded-[32px] overflow-hidden border border-white/[0.12] bg-[#0D0D0D] shadow-[0_30px_100px_rgba(0,0,0,.6)] aspect-[4/5]">
              <Image
                src={activeEdition.images?.[activeImageIndex]?.url || '/yellow-gown.jpg'}
                alt={`${activeEdition.name} - ${activeEdition.images?.[activeImageIndex]?.tag || 'View'}`}
                fill
                className="w-full h-full object-cover scale-[1.01] transition-all duration-700 ease-in-out"
                priority
              />
              
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

              <div className="absolute bottom-6 left-6 flex items-center gap-2 bg-black/60 backdrop-blur-[20px] rounded-full px-4 py-2 text-[0.65rem] font-bold uppercase tracking-[0.1em] border border-white/[0.12]">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse shadow-[0_0_8px_white]" />
                {activeEdition.name}
              </div>

              {activeEdition.images?.[activeImageIndex]?.tag && (
                <div className="absolute top-6 right-6 bg-black/40 backdrop-blur-md rounded-full px-3 py-1.5 text-[0.6rem] font-bold text-white/80 uppercase tracking-widest border border-white/10 animate-fade-in">
                  {activeEdition.images[activeImageIndex].tag}
                </div>
              )}
            </div>

            {/* Thumbnail Gallery Grid */}
            {activeEdition.images && activeEdition.images.length > 1 && (
              <div className="flex gap-3 sm:gap-4 mt-4 w-full overflow-x-auto py-4 px-2 justify-start sm:justify-center lg:justify-start [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {activeEdition.images.map((img: any, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImageIndex(idx)}
                    className={`relative w-16 h-20 sm:w-20 sm:h-24 rounded-xl overflow-hidden border-2 transition-all duration-300 shrink-0 ${
                      activeImageIndex === idx 
                        ? 'border-white shadow-[0_0_20px_rgba(255,255,255,0.4)] scale-110 z-10' 
                        : 'border-white/10 opacity-50 hover:opacity-100 hover:border-white/40 z-0'
                    }`}
                  >
                    <Image
                      src={img.url}
                      alt={img.tag || `View ${idx + 1}`}
                      fill
                      className="object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Escrow Process Highlights */}
      <div className="border-t border-white/[0.06] py-16 md:py-24 relative z-10 bg-white/[0.01]">
        <div className="section-container">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-0">
            {[
              { num: '01', title: 'Payment in Escrow', desc: 'Your payment is held until your garment arrives.', icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="6" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>
              )},
              { num: '02', title: 'Dynamic Production', desc: 'Your garment is made after your order is confirmed.', icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              )},
              { num: '03', title: 'Verifiable Digital Tag', desc: 'Every garment gets a permanent record when it is made.', icon: (
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

      {/* Fiat Checkout Mock Modal */}
      {showFiatModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 backdrop-blur-md px-4">
          <div className="card-glass w-full max-w-md p-8 border border-white/10 rounded-3xl shadow-[0_50px_100px_rgba(0,0,0,0.8)] relative animate-fade-in">
            <button 
              onClick={() => setShowFiatModal(false)}
              className="absolute top-4 right-4 text-[#666] hover:text-white transition-colors p-2"
            >
              ✕
            </button>
            <div className="flex flex-col gap-6">
              <div className="text-center">
                <h3 className="text-xl font-bold mb-1">Card Payment</h3>
                <p className="text-xs text-[#888]">Powered by Circuit Fiat Gateway</p>
              </div>
              
              <div className="p-4 bg-white/[0.03] rounded-xl border border-white/5 flex justify-between items-center">
                <span className="text-sm text-[#888]">Total Amount</span>
                <span className="text-2xl font-bold">${(computedPrice * quantity).toFixed(2)}</span>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#666]">Card Information</label>
                  <input type="text" placeholder="Card number" className="w-full bg-transparent border border-white/10 rounded-t-xl px-4 py-3 text-sm focus:border-white/30 focus:outline-none transition-colors" />
                  <div className="flex">
                    <input type="text" placeholder="MM / YY" className="w-1/2 bg-transparent border-x border-b border-white/10 rounded-bl-xl px-4 py-3 text-sm focus:border-white/30 focus:outline-none transition-colors" />
                    <input type="text" placeholder="CVC" className="w-1/2 bg-transparent border-b border-r border-white/10 rounded-br-xl px-4 py-3 text-sm focus:border-white/30 focus:outline-none transition-colors" />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#666]">Name on Card</label>
                  <input type="text" placeholder="Full name" className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-white/30 focus:outline-none transition-colors" />
                </div>
              </div>

              <button 
                className={`btn-circuit w-full justify-center py-4 mt-2 ${txState === 'signing' ? 'signing' : ''}`}
                onClick={() => {
                  setTxState('signing');
                  setTimeout(() => {
                    setTxState('success');
                    router.push('/confirm');
                  }, 2000);
                }}
                disabled={txState === 'signing'}
              >
                <span>
                  {txState === 'signing' ? 'Processing...' : `Pay $${(computedPrice * quantity).toFixed(2)}`}
                </span>
                <span className="btn-arrow">
                  {txState === 'signing' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M12 2a10 10 0 010 20 10 10 0 010-20"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  );
}

export default function DropPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col bg-black text-white items-center justify-center">
        <div className="w-12 h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
        <span className="text-xs font-mono text-[#555] mt-4">Loading Drop Terminal...</span>
      </div>
    }>
      <DropPageContent />
    </Suspense>
  );
}
