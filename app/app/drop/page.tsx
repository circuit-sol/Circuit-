'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  initializeEscrow,
  parseError,
  resetState,
} from '@/lib/solana-service';
import { solscanTxUrl } from '@/lib/utils';
import { showToast } from '@/components/Toast';
import SignInModal from '@/components/SignInModal';
import Selector from '@/components/Selector';
import { saveOrder, supabase, getEditionById } from '@/lib/db';

type TxState = 'idle' | 'signing' | 'success' | 'error' | 'soldout';

interface TxResult {
  txSignature?: string;
  solscanUrl?: string;
  escrowPDA?: string;
  orderNumber?: number;
  message?: string;
}

const fallbackEdition = {
  id: 'drop-zero',
  name: '3 Piece Agbada',
  images: [{ url: '/satin.png', tag: 'Front View' }],
  description: 'Fashion sold before it’s made. Circuit reverses the order of production by making manufacturing conditional on confirmed demand.',
  price_sol: 0.8,
  has_variable_prices: false,
  prices_by_size: { 'Small': 0.8, 'Medium': 0.8, 'Large': 0.8, 'Extra Large': 0.8 },
  max_supply: 40,
  fabric: 'Duchess satin',
  headpiece: 'Velvet',
  embroidery: 'Metallic thread',
  is_active: true
};

function DropPageContent() {
  const { user, isSignedIn } = useAuth();
  const searchParams = useSearchParams();
  const editionId = searchParams.get('edition') || 'drop-zero';

  const [edition, setEdition] = useState<any>(null);
  const [mintedCount, setMintedCount] = useState(0);
  const [txState, setTxState] = useState<TxState>('idle');
  const [txResult, setTxResult] = useState<TxResult>({});
  const [loading, setLoading] = useState(true);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [selectedSize, setSelectedSize] = useState('Medium');
  const [quantity, setQuantity] = useState(1);
  const [computedPrice, setComputedPrice] = useState(0.8);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
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

  // Fetch Drop & Supply Details from Supabase
  useEffect(() => {
    async function loadDropData() {
      try {
        setLoading(true);
        // Query edition details
        const ed = await getEditionById(editionId);
        const activeEdition = ed || fallbackEdition;
        setEdition(activeEdition);

        // Calculate dynamic price based on size
        if (activeEdition.has_variable_prices && activeEdition.prices_by_size) {
          const priceMap = activeEdition.prices_by_size;
          setComputedPrice(Number(priceMap[selectedSize] || activeEdition.price_sol));
        } else {
          setComputedPrice(Number(activeEdition.price_sol));
        }

        // Fetch exact supply count from database
        if (supabase) {
          const { count, error } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('drop_id', editionId);
          
          if (!error && count !== null) {
            setMintedCount(count);
          }
        }
      } catch (err) {
        console.error('Error fetching dynamic drop details:', err);
        setEdition(fallbackEdition);
      } finally {
        setLoading(false);
      }
    }

    loadDropData();
    const interval = setInterval(loadDropData, 20000);
    return () => clearInterval(interval);
  }, [editionId]);

  // Recalculate price when size updates
  useEffect(() => {
    if (edition) {
      if (edition.has_variable_prices && edition.prices_by_size) {
        const priceMap = edition.prices_by_size;
        setComputedPrice(Number(priceMap[selectedSize] || edition.price_sol));
      } else {
        setComputedPrice(Number(edition.price_sol));
      }
    }
  }, [selectedSize, edition]);

  const activeEdition = edition || fallbackEdition;
  const maxSupply = activeEdition.max_supply;
  const isSoldOut = mintedCount >= maxSupply;
  const fillPercent = Math.min(100, (mintedCount / maxSupply) * 100);

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
      const unitPrice = computedPrice;
      const totalAmountSol = unitPrice * quantity;

      // 1. Solana Handshake (via backend custodial escrow transaction)
      const result = await initializeEscrow(user.email, activeEdition.id, totalAmountSol);

      // 2. Persist dynamic order state to database
      await saveOrder({
        email: user.email,
        drop_id: activeEdition.id,
        tx_signature: result.txSignature,
        escrow_pda: result.escrowPDA,
        amount_sol: totalAmountSol,
        size: selectedSize,
        quantity: quantity
      });

      // Update local storage of this order ID to cache for passport retrieval
      if (typeof window !== 'undefined' && supabase) {
        const { data: latestOrders } = await supabase
          .from('orders')
          .select('id')
          .eq('tx_signature', result.txSignature)
          .maybeSingle();

        if (latestOrders && latestOrders.id) {
          localStorage.setItem('circuit_last_order_id', latestOrders.id);
        }
      }

      setMintedCount(prev => prev + quantity);
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

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-72px)] flex flex-col items-center justify-center pt-[72px] bg-black text-white">
        <div className="w-12 h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
        <span className="text-xs font-mono text-[#555] mt-4">Querying Supabase Node...</span>
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
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1 rounded-full text-[0.65rem] font-bold uppercase tracking-[0.08em] border border-white/20 text-[#A3A3A3]">
              Limited Drop
            </span>
            <span className="px-3 py-1 rounded-full text-[0.65rem] font-bold uppercase tracking-[0.08em] bg-white/[0.04] border border-white/[0.08] text-[#666]">
              On-Chain Gated Escrow
            </span>
          </div>

          {/* Title */}
          <div className="flex flex-col">
            <h1 className="text-[3.5rem] md:text-[5.5rem] leading-[0.85] font-bold tracking-[-0.04em] mb-4">
              <span className="block">Proceed</span>
              <span className="block bg-gradient-to-b from-white to-[#666] bg-clip-text text-transparent">With Order</span>
            </h1>
            <h2 className="text-[1.8rem] md:text-[2.2rem] font-light text-[#A3A3A3] tracking-[-0.02em]">{activeEdition.name}</h2>
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
              <span className="text-sm font-semibold">{computedPrice} SOL</span>
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
                <span className="text-[#444]"> / {maxSupply}</span>
              </span>
            </div>
            <div className="mp-track">
              <div className="mp-fill" style={{ width: `${fillPercent}%` }} />
            </div>
          </div>

          {/* Transaction CTA */}
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
                   `Pay ${(computedPrice * quantity).toFixed(2)} SOL`}
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
                src={activeEdition.images?.[activeImageIndex]?.url || '/satin.png'}
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
              <div className="flex gap-3 mt-4 w-full overflow-x-auto pb-2 scrollbar-hide justify-center lg:justify-start">
                {activeEdition.images.map((img: any, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImageIndex(idx)}
                    className={`relative w-20 h-24 rounded-xl overflow-hidden border-2 transition-all duration-300 shrink-0 ${
                      activeImageIndex === idx 
                        ? 'border-white shadow-[0_0_15px_rgba(255,255,255,0.3)] scale-105' 
                        : 'border-white/10 opacity-50 hover:opacity-100 hover:border-white/40'
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
              { num: '01', title: 'Payment in Escrow', desc: 'Your crypto remains locked on-chain until shipment verification.', icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="6" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>
              )},
              { num: '02', title: 'Dynamic Production', desc: 'Crafting process starts once order status shifts to In Production.', icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              )},
              { num: '03', title: 'Verifiable Digital Tag', desc: 'Unique digital identity and Solscan verification minted upon production completion.', icon: (
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
