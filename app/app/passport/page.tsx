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
    <div className="min-h-screen flex flex-col bg-black text-white selection:bg-white selection:text-black overflow-x-hidden">
      <Navbar />
      
      <main className="flex-1 flex flex-col py-24 md:py-32">
        <div className="section-container">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 items-start">
            
            {/* Left Column: Garment Visual */}
            <div className="lg:col-span-5 sticky top-32" style={{ animation: 'fadeIn 0.6s ease-out' }}>
              <div className="relative aspect-[4/5] md:aspect-square w-full rounded-[2.5rem] overflow-hidden border border-white/10 group shadow-2xl">
                <Image 
                  src="/satin.png" 
                  alt="3 Piece Agbada" 
                  fill 
                  className="object-cover group-hover:scale-105 transition-transform duration-1000"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80" />
              </div>
            </div>

            {/* Right Column: Information */}
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
                      'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                    }`}>
                      {status === 'pending' ? 'Awaiting Production' : 
                       status === 'in_production' ? 'In production' : 
                       'Authenticated'}
                    </div>
                  </div>
                  <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">Garment Identity</h1>
                  <p className="text-[#888] leading-relaxed max-w-xl text-base md:text-lg font-light">
                    {status === 'pending' ? 'Your garment has been reserved.' :
                     status === 'in_production' ? 'Digital certificate ready. Production in progress.' :
                     'Your 3 Piece Agbada is complete. The physical garment and digital record are now permanently linked.'}
                  </p>
                </div>

                {/* Share/Verify Button */}
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
              </header>

              {/* Social Verify Modal */}
              {showQR && (
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
                      Present this code for scanning to verify ownership on Circuit.
                    </p>
                  </div>
                </div>
              )}

              {/* Specs Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Serial', value: order.garment_serial || '—' },
                  { label: 'Size', value: order.size || 'M' },
                  { label: 'Edition', value: `01/${MAX_SUPPLY}` },
                  { label: 'Made in', value: 'Nigeria' },
                ].map((stat, i) => (
                  <div key={i} className="p-6 rounded-3xl bg-white/[0.02] border border-white/10">
                    <span className="block text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#444] mb-2">{stat.label}</span>
                    <span className="text-lg font-bold tracking-tight">{stat.value}</span>
                  </div>
                ))}
              </div>

              {/* Garment Details Timeline */}
              <div className="flex flex-col gap-8 mt-4">
                <h4 className="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-[#666]">Garment Journey</h4>
                <div className="space-y-2">
                  <TimelineItem 
                    date={new Date(order.created_at).toLocaleDateString()} 
                    title="Payment Secured" 
                    desc="Your payment is held securely until your garment arrives."
                    active={true}
                  />
                  <TimelineItem 
                    date="—" 
                    title="In production" 
                    desc="Materials sourced. Production begins."
                    active={status !== 'pending'}
                  />
                  <TimelineItem 
                    date="—" 
                    title="Physical Transfer" 
                    desc="Quality checked and on its way to you."
                    active={status === 'delivered' || status === 'verified'}
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
