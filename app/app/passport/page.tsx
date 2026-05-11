'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { QRCodeCanvas } from 'qrcode.react';
import { supabase } from '@/lib/db';
import Navbar from '@/components/Navbar';
import Image from 'next/image';
import { FABRIC, HEADPIECE, EMBROIDERY, MAX_SUPPLY } from '@/lib/constants';

function PassportContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('order');
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    if (orderId) fetchOrder();
  }, [orderId]);

  async function fetchOrder() {
    try {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();
      
      if (error) throw error;
      setOrder(data);
    } catch (err) {
      console.error('Error fetching order:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black p-6 text-center">
        <h1 className="text-2xl font-bold mb-4">Passport Not Found</h1>
        <p className="text-[#666] max-w-xs">This QR code or link may be invalid or the order record has not been initialized yet.</p>
        <a href="/drop" className="mt-8 btn-outline-circuit">Return to Shop</a>
      </div>
    );
  }

  const status = order.status || 'pending';
  const passportUrl = typeof window !== 'undefined' ? `${window.location.origin}/passport?order=${order.id}` : '';

  return (
    <div className="min-h-screen flex flex-col bg-black text-white overflow-x-hidden">
      <Navbar />
      
      <main className="flex-1 section-container pt-32 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-24 items-start">
          
          {/* Left Column: Image & Status Badge */}
          <div className="relative group" style={{ animation: 'fadeIn 0.5s ease-out' }}>
            <div className="card-glass overflow-hidden aspect-[4/5] relative">
              <Image 
                src="/satin.png" 
                alt="3 Piece Agbada"
                fill
                className="object-cover transition-transform duration-700 group-hover:scale-105"
              />
              
              {/* Status Overlay */}
              <div className="absolute top-6 left-6 flex flex-col gap-2">
                <div className={`px-4 py-1.5 rounded-full text-[0.6rem] font-bold uppercase tracking-widest border backdrop-blur-xl ${
                  status === 'pending' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' :
                  status === 'in_production' ? 'bg-blue-500/10 border-blue-500/20 text-blue-500' :
                  'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                }`}>
                  {status === 'pending' ? 'Awaiting Production' : 
                   status === 'in_production' ? 'Production in Progress' : 
                   'Authenticity Verified'}
                </div>
              </div>

              {order.garment_serial && (
                <div className="absolute bottom-6 left-6 bg-black/60 backdrop-blur-xl border border-white/10 px-4 py-2 rounded-full font-mono text-[0.65rem] font-bold tracking-wider">
                  SERIAL: {order.garment_serial}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Information */}
          <div className="flex flex-col gap-10" style={{ animation: 'fadeIn 0.6s ease-out 0.2s both' }}>
            <header className="flex justify-between items-center md:items-start gap-4">
              <div>
                <span className="text-[0.65rem] font-bold text-[#666] uppercase tracking-[0.2em] mb-3 block">
                  Digital Product Passport
                </span>
                <h1 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">Garment Identity</h1>
                <p className="text-[#666] leading-relaxed max-w-md text-sm md:text-base">
                  {status === 'pending' ? 'Your garment has been reserved. The designer is currently preparing materials for Drop Zero.' :
                   status === 'in_production' ? 'The fabric has been cut. Your digital birth certificate is active and your garment is being hand-crafted.' :
                   'Your 3 Piece Agbada is complete. The physical garment and digital record are now permanently linked.'}
                </p>
              </div>

              {/* Share/Verify Button - Now Visible on Mobile */}
              <button 
                onClick={() => setShowQR(!showQR)}
                className="flex flex-col items-center gap-2 group shrink-0"
              >
                <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-center group-hover:bg-white/[0.06] transition-colors shadow-2xl">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M7 7h.01M17 7h.01M17 17h.01M7 17h.01"/>
                  </svg>
                </div>
                <span className="text-[0.55rem] font-bold uppercase tracking-widest text-[#666] group-hover:text-white transition-colors">Verify</span>
              </button>
            </header>

            {/* Expanded QR Section - Mobile Optimized */}
            {showQR && (
              <div className="card-glass p-8 md:p-12 flex flex-col items-center animate-scale-in border-white/20 relative">
                <button 
                  onClick={() => setShowQR(false)}
                  className="absolute top-4 right-4 text-[#444] hover:text-white transition-colors text-xl"
                >
                  ×
                </button>
                <div className="bg-white p-4 rounded-3xl mb-8 shadow-[0_0_50px_rgba(255,255,255,0.1)]">
                  <QRCodeCanvas 
                    value={passportUrl}
                    size={200}
                    level="H"
                  />
                </div>
                <div className="text-center">
                  <h4 className="text-sm font-bold uppercase tracking-[0.2em] mb-2">Authenticity Shield</h4>
                  <p className="text-[0.65rem] text-[#666] max-w-[220px] leading-relaxed mx-auto uppercase tracking-wide">
                    Present this code for scanning to verify ownership on Circuit.
                  </p>
                </div>
              </div>
            )}

            {/* Specs Grid */}
            <div className="grid grid-cols-2 gap-px bg-white/[0.08] border border-white/[0.08] rounded-2xl overflow-hidden">
              {[
                { label: 'Garment', value: '3 Piece Agbada' },
                { label: 'Fabric', value: FABRIC },
                { label: 'Headpiece', value: HEADPIECE },
                { label: 'Embroidery', value: EMBROIDERY },
                { label: 'Origin', value: 'Made in Nigeria' },
                { label: 'Edition', value: `Series Zero / ${MAX_SUPPLY}` },
              ].map((spec, i) => (
                <div key={i} className="p-5 bg-black">
                  <span className="block text-[0.6rem] font-bold uppercase tracking-[0.15em] text-[#444] mb-1">
                    {spec.label}
                  </span>
                  <span className="text-sm font-medium">{spec.value}</span>
                </div>
              ))}
            </div>

            {/* Action Area */}
            <div className="p-6 md:p-8 card-glass">
              {status === 'pending' || status === 'in_production' ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-4 text-sm font-medium">
                    <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse shadow-[0_0_8px_white]" />
                    <span>Transaction Secured</span>
                  </div>
                  <p className="text-[0.7rem] text-[#666] leading-normal">
                    Payment is currently secured in a trustless escrow. Funds will only be released to the designer once you scan the physical QR tag and confirm delivery.
                  </p>
                  <a href={`https://solscan.io/tx/${order.tx_signature}?cluster=devnet`} target="_blank" className="text-[0.65rem] font-mono text-[#444] hover:text-white transition-colors">
                    View Escrow Transaction →
                  </a>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <h4 className="text-emerald-500 font-bold text-sm uppercase tracking-widest">Ownership Verified</h4>
                  <p className="text-xs text-[#666]">
                    The NFT representing this garment has been transferred to your wallet. You are the verified owner of this 3 Piece Agbada.
                  </p>
                  <button className="btn-circuit py-3 justify-center">View NFT on Wallet</button>
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
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
