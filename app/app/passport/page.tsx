'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { QRCodeCanvas } from 'qrcode.react';
import { useWallet } from '@solana/wallet-adapter-react';
import { getEditionById, getUserOrders, updateOrderStatusLifecycle } from '@/lib/db';
import { useAuth } from '@/lib/auth-context';
import * as backendApi from '@/lib/backendApi';
import { executeVerifiedCancel } from '@/lib/solana-service';
import { solscanTxUrl, formatSerialNumber } from '@/lib/utils';
import { showToast } from '@/components/Toast';
import Navbar from '@/components/Navbar';
import Image from 'next/image';

function PassportContent() {
  const searchParams = useSearchParams();
  const orderIdParam = searchParams.get('order');
  const [orderId, setOrderId] = useState<string | null>(orderIdParam);
  const [order, setOrder] = useState<any>(null);
  const [edition, setEdition] = useState<any>(null);
  const [batch, setBatch] = useState<backendApi.Batch | null>(null);
  const [loading, setLoading] = useState(true);
  const [showQR, setShowQR] = useState(false);
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportMessage, setReportMessage] = useState('');
  const [isReporting, setIsReporting] = useState(false);
  const [isReported, setIsReported] = useState(false);
  const { user, isSignedIn } = useAuth();
  const { signTransaction } = useWallet();

  const handleConfirmCollection = async () => {
    if (!order) return;
    setConfirmingReceipt(true);
    try {
      try {
        await backendApi.recordOrderCollected(order.id);
      } catch (e) {
        console.warn('Backend chain collection call notice:', e);
      }
      await updateOrderStatusLifecycle(order.id, 'collected');
      setOrder((prev: any) => ({ ...prev, status: 'collected', collected_at: new Date().toISOString() }));
      showToast('✓ Pickup Recorded', 'Item collection logged on-chain. Note: Seller 70% balance payout will release 7 days post-release date.');
    } catch (err) {
      console.error(err);
      showToast('✗ Error', 'Failed to record collection.');
    } finally {
      setConfirmingReceipt(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!order || !signTransaction) return;
    if (!confirm('Are you sure you want to cancel this order? 100% of your deposit will be refunded to your wallet.')) return;
    setIsCancelling(true);
    try {
      await executeVerifiedCancel(order.id, signTransaction);
      setOrder((prev: any) => ({ ...prev, cancelled: true, status: 'cancelled' }));
      showToast('✓ Order Cancelled', 'Refund returned to your wallet on Solana devnet.');
    } catch (err) {
      console.error(err);
      showToast('✗ Cancellation Failed', 'Unable to cancel. The 24-hour window may have expired.');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleSendReport = async () => {
    if (!order || !reportMessage.trim()) return;
    if (batch?.release_at && Date.now() < new Date(batch.release_at).getTime()) {
      showToast('Notice', `Dispute reporting opens on the batch release date (${new Date(batch.release_at).toLocaleDateString()}).`);
      return;
    }
    setIsReporting(true);
    try {
      await backendApi.reportOrderIssue(order.id, reportMessage.trim());
      setIsReported(true);
      setShowReportModal(false);
      showToast('✓ Report Submitted', 'Dispute logged with Circuit admin. Remaining payouts will be reviewed.');
    } catch (err: any) {
      console.error(err);
      const msg = err?.error === 'REPORTING_NOT_OPEN'
        ? `Dispute reporting only opens on the batch release date (${batch?.release_at ? new Date(batch.release_at).toLocaleDateString() : 'scheduled'}).`
        : (err?.message || 'Failed to submit report.');
      showToast('✗ Error', msg);
    } finally {
      setIsReporting(false);
    }
  };

  // Sync orderId parameter, retrieve cached order ID from localStorage, or query most recent order
  useEffect(() => {
    async function resolveOrderId() {
      if (orderIdParam) {
        setOrderId(orderIdParam);
        return;
      }

      if (typeof window !== 'undefined') {
        const cachedTx = localStorage.getItem('circuit_last_order_tx');
        if (cachedTx) {
          setOrderId(cachedTx);
          return;
        }
      }

      // Check verified chain orders if authenticated
      if (isSignedIn) {
        try {
          const chainRes = await backendApi.getMyChainOrders();
          if (chainRes?.orders && chainRes.orders.length > 0) {
            const latest = chainRes.orders[0];
            setOrderId(latest.purchase_signature || latest.id);
            return;
          }
        } catch {
          // fallback to db query
        }
      }

      // Fallback: Query the database for the user's most recent order if signed in
      if (isSignedIn && user?.email) {
        try {
          const orders = await getUserOrders(user.email);
          if (orders && orders.length > 0) {
            const latestOrder = orders[0];
            setOrderId(latestOrder.tx_signature);
            if (typeof window !== 'undefined') {
              localStorage.setItem('circuit_last_order_tx', latestOrder.tx_signature);
            }
            return;
          }
        } catch (err) {
          console.error('Error resolving fallback order:', err);
        }
      }

      setLoading(false);
    }

    resolveOrderId();
  }, [orderIdParam, isSignedIn, user]);

  useEffect(() => {
    if (orderId) {
      fetchOrderAndEdition();
    }
  }, [orderId]);

  async function fetchOrderAndEdition() {
    try {
      setLoading(true);
      const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';
      let ord: any = null;

      // 1. Check chain order by ID or signature
      try {
        const chainRes = await backendApi.getChainOrderById(orderId!);
        if (chainRes?.order) ord = chainRes.order;
      } catch {
        // fallback to db
      }

      if (!ord) {
        const res = await fetch(`${BASE}/api/db/orders/by-tx/${encodeURIComponent(orderId!)}`);
        if (res.ok) {
          ord = await res.json();
        }
      }

      // Check local storage fallback if legacy endpoint is 410 or order not yet synced
      if (!ord && typeof window !== 'undefined') {
        const localOrders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
        ord = localOrders.find((o: any) => o.tx_signature === orderId || o.id === orderId);
      }

      if (!ord) throw new Error('Order not found');

      setOrder(ord);

      if (ord.batch_id) {
        try {
          const bRes = await backendApi.getPublicBatchById(ord.batch_id);
          if (bRes?.batch) setBatch(bRes.batch);
        } catch {
          // fallback
        }
      }

      if (ord.drop_id) {
        const ed = await getEditionById(ord.drop_id);
        setEdition(ed);
      }
    } catch (err) {
      console.error('Error fetching dynamic passport records:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black">
        <div className="w-12 h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
        <span className="text-xs font-mono text-[#555] mt-4">Connecting Identity Node...</span>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black p-6 text-center">
        <h1 className="text-2xl font-bold mb-4">Passport Not Loaded</h1>
        <p className="text-[#666] max-w-sm mb-8 leading-relaxed">
          No active product passport is currently cached. Order a collection run to generate your passport digital certificate.
        </p>
        <div className="flex gap-4">
          <a href="/passport/history" className="btn-circuit py-4 px-10 text-xs">
            <span>View Purchases History</span>
          </a>
          <a href="/drop" className="btn-outline-circuit py-4 px-10 text-xs border-white/10 hover:border-white/30">
            Visit Shop
          </a>
        </div>
      </div>
    );
  }

  const status = order.status || 'pending';
  const isMinted = ['produced', 'shipped', 'delivered'].includes(status);
  const passportUrl = typeof window !== 'undefined' ? `${window.location.origin}/passport?order=${orderId}` : '';
  const activeEdition = edition || {
    name: '3 Piece Agbada',
    fabric: 'Duchess satin',
    headpiece: 'Velvet',
    embroidery: 'Metallic thread',
    max_supply: 40,
    images: [{ url: '/satin.png', tag: 'Front' }]
  };

  return (
    <div className="min-h-screen flex flex-col bg-black text-white selection:bg-white selection:text-black overflow-x-hidden">
      <Navbar />
      
      <main className="flex-1 flex flex-col py-24 md:py-32">
        <div className="section-container">
          
          {/* Header Portal Navigation */}
          <div className="flex justify-end mb-8 relative z-10">
            <a href="/passport/history" className="btn-outline-circuit py-2 px-6 text-[0.65rem] border-white/10 hover:border-white/20">
              View Purchases History ➔
            </a>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 items-start">
            
            {/* Left Column: Premium Interactive Garment Frame */}
            <div className="lg:col-span-5 sticky top-32" style={{ animation: 'fadeIn 0.6s ease-out' }}>
              <div className="relative aspect-[4/5] md:aspect-square w-full rounded-[2.5rem] overflow-hidden border border-white/10 group shadow-2xl">
                <Image 
                  src={activeEdition.images?.[0]?.url || "/satin.png"} 
                  alt={activeEdition.name} 
                  fill 
                  className="object-cover group-hover:scale-105 transition-transform duration-1000"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80" />
                
                {/* Micro animation overlay */}
                <div className="absolute bottom-6 left-6 right-6 flex items-center justify-between z-10">
                  <div className="bg-black/60 backdrop-blur-[20px] rounded-full px-4 py-2 text-[0.6rem] font-bold uppercase tracking-[0.1em] border border-white/[0.12] flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${isMinted ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse'}`} />
                    {activeEdition.name}
                  </div>
                  {order.garment_serial ? (
                    <span className="text-[0.6rem] font-mono text-white/50 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
                      Edition: {formatSerialNumber(order.garment_serial, activeEdition.max_supply)}
                    </span>
                  ) : (
                    <span className="text-[0.6rem] font-mono text-white/50 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full animate-pulse">
                      Edition: Pending Tailoring
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Dynamic Credentials Gating */}
            <div className="lg:col-span-7 flex flex-col gap-12" style={{ animation: 'fadeIn 0.6s ease-out 0.2s both' }}>
              <header className="flex justify-between items-start gap-8">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-[0.65rem] font-bold text-[#666] uppercase tracking-[0.25em]">
                      Digital Product Passport
                    </span>
                    <div className={`px-3 py-1 rounded-full text-[0.55rem] font-bold uppercase tracking-widest border ${
                      status === 'pending' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' :
                      status === 'in_production' ? 'bg-blue-500/10 border-blue-500/20 text-blue-500' :
                      status === 'cancelled' ? 'bg-red-500/10 border-red-500/20 text-red-500' :
                      'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                    }`}>
                      {status === 'pending' ? 'Pending Production' : 
                       status === 'in_production' ? 'In Production' : 
                       status === 'cancelled' ? 'Cancelled' : 
                       'Authenticated & Minted'}
                    </div>
                  </div>
                  <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">Garment Identity</h1>
                  <p className="text-[#888] leading-relaxed max-w-xl text-base md:text-lg font-light">
                    {status === 'pending' && 'Payment held securely in escrow.'}
                    {status === 'in_production' && 'Your piece is being made.'}
                    {status === 'cancelled' && 'This order has been cancelled and funds are being returned to your escrow source.'}
                    {isMinted && 'Made. Your ownership record is ready.'}
                  </p>
                </div>

                {/* Share/Verify (Visible ONLY if produced/minted) */}
                {isMinted && (
                  <button 
                    onClick={() => setShowQR(!showQR)}
                    className="flex flex-col items-center gap-3 group shrink-0"
                  >
                    <div className="w-16 h-16 rounded-[1.5rem] bg-white/[0.03] border border-white/10 flex items-center justify-center group-hover:bg-white/[0.06] transition-all group-hover:scale-105 shadow-2xl">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M7 7h.01M17 7h.01M17 17h.01M7 17h.01"/>
                      </svg>
                    </div>
                    <span className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#444] group-hover:text-white transition-colors">Verify</span>
                  </button>
                )}
              </header>

              {/* Social Verify Modal */}
              {showQR && isMinted && (
                <div className="card-glass p-10 md:p-14 flex flex-col items-center animate-scale-in border-white/20 relative rounded-[2.5rem]">
                  <button 
                    onClick={() => setShowQR(false)}
                    className="absolute top-6 right-6 w-10 h-10 rounded-full border border-white/10 flex items-center justify-center hover:bg-white/5 transition-colors text-xl"
                  >
                    ×
                  </button>
                  <div className="bg-white p-6 rounded-[2rem] mb-10 shadow-[0_0_60px_rgba(255,255,255,0.1)]">
                    <QRCodeCanvas 
                      value={passportUrl}
                      size={220}
                      level="H"
                    />
                  </div>
                  <div className="text-center">
                    <h4 className="text-sm font-bold uppercase tracking-[0.25em] mb-3 text-white">Authenticity Shield</h4>
                    <p className="text-[0.65rem] text-[#666] max-w-[260px] leading-relaxed mx-auto uppercase tracking-widest font-medium">
                      Scan this QR code to verify physical ownership verification on the Circuit Ledger.
                    </p>
                  </div>
                </div>
              )}

              {/* Dynamic Gated Credentials Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Edition', value: order.garment_serial ? formatSerialNumber(order.garment_serial, activeEdition.max_supply) : 'Locked (Pending Production)' },
                  { label: 'Size', value: order.size || 'Medium' },
                  { label: 'Collection Cap', value: `${activeEdition.max_supply} Units` },
                  { label: 'Origin', value: 'Nigeria' },
                ].map((stat, i) => (
                  <div key={i} className="p-6 rounded-3xl bg-white/[0.02] border border-white/10 flex flex-col justify-between min-h-[110px]">
                    <span className="block text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#444] mb-2">{stat.label}</span>
                    <span className={`text-base md:text-lg font-bold tracking-tight ${!order.garment_serial && stat.label === 'Edition' ? 'text-amber-500/80 font-mono text-sm' : ''}`}>
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Dynamic Gated Ledger details */}
              {isMinted ? (
                <div className="card-glass p-6 md:p-8 border-white/5 flex flex-col gap-4 animate-fade-in">
                  <span className="text-[0.65rem] font-bold uppercase tracking-widest text-[#666]">Ledger Signature Credentials</span>
                  <div className="space-y-4 text-xs font-mono">
                    <div className="flex justify-between items-center py-2 border-b border-white/5">
                      <span className="text-[#444]">Digital Registry Address</span>
                      <a href={solscanTxUrl(order.tx_signature)} target="_blank" rel="noopener" className="text-white hover:underline truncate max-w-[200px] text-right">
                        {order.mint_address || 'Mint address loading...'}
                      </a>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-white/5">
                      <span className="text-[#444]">Blockchain Escrow Contract</span>
                      <span className="text-emerald-400 truncate max-w-[200px] text-right">{order.escrow_pda}</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-[#444]">Escrow Funds Secured</span>
                      <span className="text-white">${order.amount_usd} USD</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card-glass p-6 md:p-8 border-white/5 bg-amber-500/[0.01] border-amber-500/10 flex flex-col gap-4 animate-pulse">
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    <span className="text-[0.65rem] font-bold uppercase tracking-widest text-amber-500">Passport Activation</span>
                  </div>
                  <p className="text-xs text-[#888] leading-relaxed">
                    Your garment's permanent record is created when production begins.
                  </p>
                </div>
              )}

              {/* 24-Hour Individual Cancellation Window */}
              {!order.cancelled && (order.cancel_until ? new Date() < new Date(order.cancel_until) : (Date.now() - new Date(order.created_at || Date.now()).getTime()) < 86400000) && (
                <div className="card-glass p-5 border-amber-500/30 bg-amber-500/[0.04] rounded-2xl flex flex-col gap-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-400 font-mono">24-Hour Cancellation Eligible</span>
                    <span className="text-[0.65rem] font-mono text-[#888]">100% Refund Guarantee</span>
                  </div>
                  <p className="text-xs text-white/80 leading-relaxed">
                    You have an individual 24-hour cancellation window from your purchase time. Cancelling immediately refunds 100% of your deposit from the Solana escrow vault.
                  </p>
                  <button
                    onClick={handleCancelOrder}
                    disabled={isCancelling}
                    className="btn-outline-circuit py-2.5 text-xs uppercase tracking-wider text-amber-400 border-amber-500/40 hover:border-amber-400 w-full"
                  >
                    <span>{isCancelling ? 'Processing Refund on Solana...' : 'Cancel Order (100% Refund)'}</span>
                  </button>
                </div>
              )}

              {order.cancelled && (
                <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 animate-fade-in">
                  <span className="text-red-400 text-lg">✗</span>
                  <div>
                    <span className="text-xs font-bold text-red-400 uppercase tracking-wider font-mono block">Order Cancelled & Refunded</span>
                    <span className="text-[0.65rem] text-red-400/80 font-mono">100% deposit returned to your wallet from the batch escrow pool.</span>
                  </div>
                </div>
              )}

              {/* Buyer In-Person Pickup Collection Confirmation (Decoupled from Payout) */}
              {!order.cancelled && status !== 'delivered' && status !== 'collected' && (
                <div className="card-glass p-6 border-emerald-500/30 bg-emerald-500/[0.04] rounded-2xl flex flex-col gap-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 font-mono">In-Person Collection</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  </div>
                  <p className="text-xs text-white/80 leading-relaxed">
                    Have you collected your garment at the designated pickup station? Confirming logs your physical receipt on-chain.
                  </p>
                  <p className="text-[0.65rem] text-[#888] font-mono leading-relaxed">
                    * Policy: In accordance with the Circuit staged settlement agreement, seller balance payout unlocks 7 days after the batch release date.
                  </p>
                  <button
                    onClick={handleConfirmCollection}
                    disabled={confirmingReceipt}
                    className="btn-circuit py-3 text-xs uppercase tracking-wider justify-center w-full mt-1"
                  >
                    <span>{confirmingReceipt ? 'Logging Pickup On-Chain...' : 'Confirm Item Collected'}</span>
                  </button>
                </div>
              )}

              {(status === 'delivered' || status === 'collected') && (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 animate-fade-in">
                  <span className="text-emerald-400 text-lg">✓</span>
                  <div>
                    <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider font-mono block">Item Collected & Verified</span>
                    <span className="text-[0.65rem] text-emerald-400/80 font-mono">Physical receipt recorded on-chain. Staged balance payout scheduled 7 days post-release.</span>
                  </div>
                </div>
              )}

              {/* Staged Escrow Financial Schedule Breakdown */}
              <div className="flex flex-col gap-3 border border-white/[0.08] rounded-2xl p-5 bg-white/[0.02]">
                <div className="flex justify-between items-baseline">
                  <span className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[#666]">Staged Escrow Schedule</span>
                  <span className="text-[0.6rem] font-mono text-emerald-400">Solana Devnet Vault</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                    <span className="text-[0.6rem] text-[#666] uppercase block">30% Advance (Production)</span>
                    <span className="text-white font-semibold block">Batch Closing + 48h</span>
                    <span className="text-[0.62rem] text-[#888] block">Disbursed to fund initial manufacturing costs.</span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                    <span className="text-[0.6rem] text-[#666] uppercase block">70% Balance (Final Settlement)</span>
                    <span className="text-white font-semibold block">Release Date + 7 Days</span>
                    <span className="text-[0.62rem] text-[#888] block">Held in vault unless disputed or admin frozen.</span>
                  </div>
                </div>
              </div>

              {/* Dispute & Incident Reporting */}
              <div className="p-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-white block">Order Issue or Missing Item?</span>
                  <span className="text-[0.65rem] text-[#777] font-mono">Available from batch release date. Reports go directly to Circuit admin.</span>
                </div>
                <button
                  onClick={() => setShowReportModal(true)}
                  disabled={isReported}
                  className="btn-outline-circuit py-2 px-4 text-xs border-white/20 text-[#aaa] hover:text-white"
                >
                  {isReported ? 'Report Logged' : 'Report Issue'}
                </button>
              </div>

              {/* Report Issue Modal */}
              {showReportModal && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="bg-[#111] border border-white/10 rounded-3xl p-6 max-w-md w-full flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">Report Order Issue</h3>
                      <button onClick={() => setShowReportModal(false)} className="text-[#666] hover:text-white text-lg">✕</button>
                    </div>
                    <p className="text-xs text-[#888] leading-relaxed">
                      Reports are submitted directly to Circuit administration. An admin can freeze the batch payout to investigate and issue refunds or partial payments.
                    </p>
                    {batch?.release_at && Date.now() < new Date(batch.release_at).getTime() && (
                      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono">
                        Notice: Dispute reporting formally opens on the batch release date ({new Date(batch.release_at).toLocaleDateString()}).
                      </div>
                    )}
                    <textarea
                      value={reportMessage}
                      onChange={(e) => setReportMessage(e.target.value)}
                      placeholder="Please describe the issue (e.g. item missing from station, defect, etc.)..."
                      className="w-full bg-black border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30 min-h-[100px]"
                    />
                    <div className="flex gap-3 justify-end">
                      <button
                        onClick={() => setShowReportModal(false)}
                        className="btn-outline-circuit py-2 px-4 text-xs border-white/10 text-[#888]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSendReport}
                        disabled={isReporting || !reportMessage.trim()}
                        className="btn-circuit py-2 px-5 text-xs uppercase"
                      >
                        <span>{isReporting ? 'Submitting...' : 'Submit to Circuit'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Dynamic Journey Timeline */}
              <div className="flex flex-col gap-8 mt-4">
                <h4 className="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-[#666]">Garment Lifecycle</h4>
                <div className="space-y-2">
                  <TimelineItem 
                    date={new Date(order.created_at || Date.now()).toLocaleDateString()} 
                    title="Order Confirmed & Escrowed" 
                    desc="Payment locked in decentralized Solana batch escrow vault."
                    active={true}
                  />
                  <TimelineItem 
                    date={status === 'in_production' || isMinted ? 'Active' : '—'} 
                    title="Production Started (30% Advance)" 
                    desc="Manufacturing begins once batch closes + 48h advance is eligible."
                    active={status !== 'pending' && status !== 'cancelled'}
                  />
                  <TimelineItem 
                    date={isMinted ? 'Minted' : '—'} 
                    title="Digital Passport Ready" 
                    desc="Made. Your digital authenticity certificate is registered."
                    active={isMinted}
                  />
                  <TimelineItem 
                    date={status === 'collected' || status === 'delivered' ? 'Collected' : '—'} 
                    title="In-Person Station Collection" 
                    desc={order.pickup_location_id ? `Station pickup logged. Receipt verified.` : (order.shipment_details || 'Ready for collection at designated brand station.')}
                    active={['collected', 'shipped', 'delivered'].includes(status)}
                  />
                  <TimelineItem 
                    date={status === 'delivered' || status === 'collected' ? 'Scheduled' : '—'} 
                    title="Final Settlement (70% Balance)" 
                    desc="Released to designer 7 days post-release date unless disputed."
                    active={status === 'delivered' || status === 'collected'}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function TimelineItem({ date, title, desc, active }: { date: string, title: string, desc: string, active: boolean }) {
  return (
    <div className={`flex gap-6 relative pb-8 last:pb-0 ${active ? 'opacity-100' : 'opacity-30'}`}>
      {/* Line */}
      <div className="absolute left-[7px] top-[24px] bottom-0 w-px bg-white/10" />
      
      {/* Dot */}
      <div className={`relative z-10 w-4 h-4 rounded-full mt-1.5 border-2 ${active ? 'bg-white border-white shadow-[0_0_10px_white]' : 'bg-black border-white/20'}`} />
      
      <div className="flex flex-col gap-1">
        <span className="text-[0.6rem] font-bold text-[#444] uppercase tracking-widest">{date}</span>
        <h5 className="text-sm font-bold text-white uppercase tracking-tight">{title}</h5>
        <p className="text-xs text-[#666] leading-relaxed max-w-sm">{desc}</p>
      </div>
    </div>
  );
}

export default function PassportPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    }>
      <PassportContent />
    </Suspense>
  );
}
