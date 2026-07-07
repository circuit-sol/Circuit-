'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Image from 'next/image';
import { useAuth } from '@/lib/auth-context';
import { getUserOrders, getEditions } from '@/lib/db';
import { solscanTxUrl, formatSerialNumber } from '@/lib/utils';
import SignInModal from '@/components/SignInModal';
import { showToast } from '@/components/Toast';

interface ShipmentModalProps {
  order: any;
  edition: any;
  onClose: () => void;
}

function ShipmentModal({ order, edition, onClose }: ShipmentModalProps) {
  const status = order.status || 'pending';
  const activeEdition = edition || {
    name: '3 Piece Agbada',
    fabric: 'Duchess satin',
    headpiece: 'Velvet',
    embroidery: 'Metallic thread',
    max_supply: 40,
  };

  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'unset'; };
  }, []);

  return (
    <div 
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4 md:p-6 bg-black/80 backdrop-blur-md animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card-glass w-full max-w-lg border-white/20 p-8 md:p-10 relative rounded-[2.5rem] shadow-2xl max-h-[90vh] overflow-y-auto no-scrollbar">
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 w-10 h-10 rounded-full border border-white/10 flex items-center justify-center hover:bg-white/5 transition-colors text-xl z-10"
        >
          ×
        </button>

        <span className="text-[0.6rem] font-bold text-[#666] uppercase tracking-[0.25em] block mb-2">
          Tracking Overview
        </span>
        <h3 className="text-2xl font-bold mb-6">Logistics & Escrow Details</h3>

        <div className="space-y-6">
          {/* Status timeline overview */}
          <div className="flex gap-4 items-center p-4 rounded-2xl bg-white/[0.02] border border-white/10">
            <div className={`w-3 h-3 rounded-full shrink-0 ${
              status === 'pending' ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse' :
              status === 'in_production' ? 'bg-blue-400 shadow-[0_0_8px_#60a5fa] animate-pulse' :
              status === 'cancelled' ? 'bg-red-400 shadow-[0_0_8px_#f87171]' :
              'bg-emerald-400 shadow-[0_0_8px_#34d399]'
            }`} />
            <div>
              <strong className="text-sm font-bold uppercase tracking-wider text-white">
                {status.replace('_', ' ')}
              </strong>
            </div>
          </div>

          {/* Shipment Notes */}
          <div className="space-y-2">
            <span className="text-[0.6rem] text-[#666] uppercase block font-mono">Updates</span>
            <div className="p-5 rounded-2xl bg-white/[0.01] border border-white/5 text-xs text-[#888] leading-relaxed">
              {order.shipment_details || 'Your tracking details will appear here once your garment ships.'}
            </div>
          </div>

          {/* Technical Specs */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <span className="text-[0.6rem] text-[#444] uppercase block mb-1">Size</span>
              <strong className="text-xs font-semibold">{order.size || 'Medium'}</strong>
            </div>
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <span className="text-[0.6rem] text-[#444] uppercase block mb-1">Quantity</span>
              <strong className="text-xs font-semibold">{order.quantity || 1} Unit(s)</strong>
            </div>
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <span className="text-[0.6rem] text-[#444] uppercase block mb-1">Edition</span>
              <strong className="text-xs font-semibold text-amber-400">
                {order.garment_serial ? formatSerialNumber(order.garment_serial, activeEdition.max_supply) : 'Pending Tailoring'}
              </strong>
            </div>
          </div>

          {/* Ledger Proofs */}
          <div className="space-y-3 font-mono text-[0.65rem] pt-4 border-t border-white/5">
            <div className="flex justify-between items-center text-[#666]">
              <span>Payment Reference</span>
              <span className="text-white truncate max-w-[240px]">{order.escrow_pda}</span>
            </div>
            <div className="flex justify-between items-center text-[#666]">
              <span>Payment Held</span>
              <strong className="text-white">${order.amount_usd} USD</strong>
            </div>
          </div>

          <div className="pt-4 flex gap-4">
            {order.tx_signature && (
              <a 
                href={solscanTxUrl(order.tx_signature)}
                target="_blank"
                rel="noopener"
                className="btn-outline-circuit flex-1 py-3 text-[0.65rem] text-center justify-center border-white/10 hover:border-white/20"
              >
                View Record ↗
              </a>
            )}
            <a 
              href={`/passport?order=${order.id}`}
              className="btn-circuit flex-1 py-3 text-[0.65rem] text-center justify-center"
            >
              <span>View Passport</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const { user, isSignedIn } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [editionsMap, setEditionsMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  useEffect(() => {
    if (isSignedIn && user?.email) {
      loadHistory();
    } else {
      setLoading(false);
    }
  }, [isSignedIn, user]);

  async function loadHistory() {
    try {
      setLoading(true);
      if (!user?.email) return;

      // 1. Fetch editions metadata to map drop details quickly
      const editionsList = await getEditions();
      const em: Record<string, any> = {};
      editionsList.forEach((e: any) => {
        em[e.id] = e;
      });
      setEditionsMap(em);

      // 2. Fetch user orders from database
      const userOrders = await getUserOrders(user.email);
      setOrders(userOrders || []);
    } catch (err) {
      console.error('Error fetching dynamic history records:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleOrderClick = (order: any) => {
    setSelectedOrder(order);
  };

  return (
    <div className="min-h-screen flex flex-col bg-black text-white selection:bg-white selection:text-black">
      <Navbar />

      <main className="flex-1 py-24 md:py-32">
        <div className="section-container">
          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-baseline gap-6 mb-16">
            <div>
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#666] mb-4 block">
                Garment Archives
              </span>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight">Purchase History.</h1>
            </div>
            <a href="/drop" className="text-xs font-bold uppercase tracking-widest text-[#888] hover:text-white transition-colors underline underline-offset-8">
              See all drops ➔
            </a>
          </div>

          {!isSignedIn ? (
            <div className="card-glass p-12 text-center max-w-xl mx-auto border-white/10 py-16">
              <div className="w-16 h-16 rounded-[1.5rem] bg-white/[0.03] border border-white/10 flex items-center justify-center mx-auto mb-8">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              </div>
              <h2 className="text-2xl font-bold mb-4">Authentication Required</h2>
              <p className="text-[#666] text-sm leading-relaxed mb-10 max-w-sm mx-auto">
                Sign in with your email account to unlock, query, and verify your customized fashion production run logs.
              </p>
              <button 
                onClick={() => setIsSignInOpen(true)}
                className="btn-circuit mx-auto px-10 py-4 text-xs"
              >
                <span>Access Ledger Portal</span>
              </button>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-12 h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
              <span className="text-xs font-mono text-[#555]">Querying Order Vault...</span>
            </div>
          ) : orders.length === 0 ? (
            <div className="card-glass p-12 text-center max-w-xl mx-auto border-white/10 py-16">
              <div className="w-16 h-16 rounded-[1.5rem] bg-white/[0.03] border border-white/10 flex items-center justify-center mx-auto mb-8">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>
                </svg>
              </div>
              <h2 className="text-2xl font-bold mb-4">No Registered Orders</h2>
              <p className="text-[#666] text-sm leading-relaxed mb-10 max-w-sm mx-auto">
                We did not locate any active on-chain production purchases linked to the logged email address: <strong className="text-white">{user?.email}</strong>.
              </p>
              <a href="/drop" className="btn-circuit mx-auto px-10 py-4 text-xs">
                <span>Browse Drops Shop</span>
              </a>
            </div>
          ) : (
            /* Historical Orders Grid with dynamic card animation lists */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {orders.map((order, index) => {
                const ed = editionsMap[order.drop_id];
                const activeEdition = ed || {
                  name: '3 Piece Agbada',
                  images: [{ url: '/satin.png', tag: 'Front' }],
                  fabric: 'Duchess satin'
                };
                const status = order.status || 'pending';

                return (
                  <div 
                    key={order.id} 
                    className="card-glass flex flex-col justify-between overflow-hidden border-white/10 group cursor-pointer hover:translate-y-[-4px] duration-500 animate-slide-up"
                    style={{ animationDelay: `${index * 80}ms` }}
                    onClick={() => handleOrderClick(order)}
                  >
                    {/* Top image wrapper */}
                    <div className="aspect-[16/10] relative overflow-hidden bg-[#0a0a0a]">
                      <Image 
                        src={activeEdition.images?.[0]?.url || '/satin.png'} 
                        alt={activeEdition.name}
                        fill
                        className="object-cover opacity-60 group-hover:scale-105 group-hover:opacity-85 transition-all duration-1000"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                      
                      {/* Floating status pill */}
                      <button 
                        className={`absolute bottom-4 left-4 flex items-center gap-2 bg-black/75 backdrop-blur-md rounded-full px-4 py-2 text-[0.6rem] font-bold uppercase tracking-[0.1em] border transition-all ${
                          status === 'pending' ? 'border-amber-500/30 text-amber-400' :
                          status === 'in_production' ? 'border-blue-500/30 text-blue-400' :
                          status === 'cancelled' ? 'border-red-500/30 text-red-400' :
                          'border-emerald-500/30 text-emerald-400'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          status === 'pending' ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse' :
                          status === 'in_production' ? 'bg-blue-400 shadow-[0_0_8px_#60a5fa] animate-pulse' :
                          status === 'cancelled' ? 'bg-red-400' :
                          'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                        }`} />
                        {status.replace('_', ' ')}
                      </button>
                    </div>

                    {/* Meta Specs */}
                    <div className="p-6 flex flex-col gap-6 flex-1 justify-between">
                      <div className="space-y-3">
                        <div className="flex justify-between items-baseline">
                          <span className="text-[0.6rem] font-bold text-[#666] uppercase tracking-[0.15em] font-mono">
                            {new Date(order.created_at).toLocaleDateString()}
                          </span>
                          <span className="text-xs text-[#888] font-mono">Size: {order.size || 'M'}</span>
                        </div>
                        <h3 className="text-xl font-bold tracking-tight text-white group-hover:text-white/95 transition-colors">
                          {activeEdition.name}
                        </h3>
                        <div className="flex flex-col gap-1.5 font-mono text-[0.68rem] text-[#666]">
                          <div className="flex justify-between">
                            <span>Edition:</span>
                            <span className="text-[#aaa] font-semibold">
                              {order.garment_serial ? formatSerialNumber(order.garment_serial, activeEdition.max_supply) : 'Pending Tailoring'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-white/5 flex justify-between items-center">
                        <div>
                          <span className="block text-[0.6rem] text-[#444] uppercase font-mono mb-0.5">Amount held</span>
                          <strong className="text-sm font-semibold">${order.amount_usd} USD</strong>
                        </div>
                        <span className="text-xs text-white/50 group-hover:text-white group-hover:translate-x-1 transition-all duration-300">
                          View details ➔
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Shipment Modal overlay */}
      {selectedOrder && (
        <ShipmentModal 
          order={selectedOrder}
          edition={editionsMap[selectedOrder.drop_id]}
          onClose={() => setSelectedOrder(null)}
        />
      )}

      <SignInModal isOpen={isSignInOpen} onClose={() => setIsSignInOpen(false)} />
    </div>
  );
}
