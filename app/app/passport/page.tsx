'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { QRCodeCanvas } from 'qrcode.react';
import { getEditionById, getUserOrders } from '@/lib/db';
import { useAuth } from '@/lib/auth-context';
import { solscanTxUrl, formatSerialNumber } from '@/lib/utils';
import Navbar from '@/components/Navbar';
import Image from 'next/image';

function PassportContent() {
  const searchParams = useSearchParams();
  const orderIdParam = searchParams.get('order');
  const [orderId, setOrderId] = useState<string | null>(orderIdParam);
  const [order, setOrder] = useState<any>(null);
  const [edition, setEdition] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showQR, setShowQR] = useState(false);
  const { user, isSignedIn } = useAuth();

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
      const res = await fetch(`${BASE}/api/db/orders/by-tx/${encodeURIComponent(orderId!)}`);

      if (!res.ok) throw new Error('Order not found');
      const ord = await res.json();

      setOrder(ord);
      if (ord && ord.drop_id) {
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
                    {isMinted && 'Physical garment successfully constructed. Digital passport metadata permanently minted onto the Solana ledger.'}
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
                    Your digital passport activates automatically once your garment is completed.
                  </p>
                </div>
              )}

              {/* Dynamic Journey Timeline */}
              <div className="flex flex-col gap-8 mt-4">
                <h4 className="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-[#666]">Garment Lifecycle</h4>
                <div className="space-y-2">
                  <TimelineItem 
                    date={new Date(order.created_at).toLocaleDateString()} 
                    title="Order Confirmed" 
                    desc="Payment secured in escrow."
                    active={true}
                  />
                  <TimelineItem 
                    date={status === 'in_production' || isMinted ? 'Active' : '—'} 
                    title="In Production" 
                    desc="Your piece is being made."
                    active={status !== 'pending' && status !== 'cancelled'}
                  />
                  <TimelineItem 
                    date={isMinted ? 'Minted' : '—'} 
                    title="Digital Passport Ready" 
                    desc="Garment ready. Digital passport ready."
                    active={isMinted}
                  />
                  <TimelineItem 
                    date={status === 'shipped' || status === 'delivered' ? 'Shipped' : '—'} 
                    title="Shipment" 
                    desc={order.shipment_details || 'Tracking details available after dispatch.'}
                    active={['shipped', 'delivered'].includes(status)}
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
