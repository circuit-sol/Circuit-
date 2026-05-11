'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { QRCodeCanvas } from 'qrcode.react';
import { supabase, getUserOrders } from '@/lib/db';
import Navbar from '@/components/Navbar';
import { showToast } from '@/components/Toast';

interface Order {
  id: string;
  email: string;
  drop_id: string;
  status: string;
  tx_signature: string;
  created_at: string;
  garment_serial?: string;
}

export default function AdminDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedQR, setSelectedQR] = useState<Order | null>(null);

  useEffect(() => {
    fetchOrders();
  }, []);

  async function fetchOrders() {
    try {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setOrders(data || []);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }

  const stats = {
    totalRevenue: orders.length * 0.8,
    totalClaims: orders.length,
    inProduction: orders.filter(o => o.status === 'in_production').length,
    pending: orders.filter(o => o.status === 'pending').length,
  };

  const filteredOrders = orders.filter(o => 
    o.email.toLowerCase().includes(search.toLowerCase()) || 
    o.garment_serial?.toLowerCase().includes(search.toLowerCase())
  );

  async function startProduction(orderId: string) {
    setProcessingId(orderId);
    try {
      const serial = `CRCT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const { error } = await supabase!
        .from('orders')
        .update({ 
          status: 'in_production',
          garment_serial: serial 
        })
        .eq('id', orderId);

      if (error) throw error;
      showToast('Production Started', `Serial ${serial} assigned.`);
      fetchOrders();
    } catch (err) {
      showToast('Error', 'Failed to update production status.');
    } finally {
      setProcessingId(null);
    }
  }

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <Navbar />
      
      <main className="flex-1 section-container pt-32 pb-20 print:p-0 print:pt-0">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12 print:hidden">
          <header>
            <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#666] mb-3 block">
              Circuit Protocol Admin
            </span>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Drop Zero Hub</h1>
            <p className="text-[#666] mt-3 text-sm max-w-md leading-relaxed">
              Managing the first 40 units of the 3 Piece Agbada.
            </p>
          </header>

          <div className="relative group w-full md:w-80">
            <input 
              type="text"
              placeholder="Search by email or serial..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/10 px-6 py-3 rounded-full text-sm focus:outline-none focus:border-white/30 transition-all placeholder:text-[#333]"
            />
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12 print:hidden">
          {[
            { label: 'Total Revenue', value: `${stats.totalRevenue.toFixed(1)} SOL`, color: 'text-white' },
            { label: 'Units Claimed', value: `${stats.totalClaims} / 40`, color: 'text-white' },
            { label: 'In Production', value: stats.inProduction, color: 'text-blue-500' },
            { label: 'Pending Start', value: stats.pending, color: 'text-amber-500' },
          ].map((stat, i) => (
            <div key={i} className="card-glass p-6 border-white/[0.06]">
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#444] mb-2 block">{stat.label}</span>
              <span className={`text-2xl font-bold ${stat.color}`}>{stat.value}</span>
            </div>
          ))}
        </div>

        {/* Orders Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20 print:hidden">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="card-glass p-20 text-center border-dashed border-white/5 print:hidden">
            <p className="text-[#444] font-medium">No matching orders found.</p>
          </div>
        ) : (
          <div className="grid gap-4 print:hidden">
            {filteredOrders.map((order) => (
              <div key={order.id} className="card-glass p-5 flex flex-col md:flex-row items-center justify-between gap-6 hover:bg-white/[0.02]">
                <div className="flex items-center gap-6 flex-1 w-full">
                  {/* Thumbnail */}
                  <div className="hidden sm:block w-14 h-14 rounded-xl overflow-hidden bg-white/[0.05] border border-white/10 relative shrink-0">
                    <Image src="/satin.png" alt="3 Piece Agbada" fill className="object-cover opacity-60" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className={`px-2 py-0.5 rounded text-[0.55rem] font-bold uppercase tracking-wider ${
                        order.status === 'pending' ? 'bg-amber-500/10 text-amber-500' :
                        order.status === 'in_production' ? 'bg-blue-500/10 text-blue-500' :
                        'bg-emerald-500/10 text-emerald-500'
                      }`}>
                        {order.status.replace('_', ' ')}
                      </span>
                      <span className="text-[0.6rem] font-mono text-[#333] truncate">#{order.id.slice(0,10)}</span>
                    </div>
                    <h3 className="text-md font-bold truncate">{order.email}</h3>
                    <div className="flex gap-4 mt-2">
                      <div className="text-[0.6rem] text-[#666]">
                        <span className="uppercase tracking-widest opacity-50">Transaction</span>
                        <a href={`https://solscan.io/tx/${order.tx_signature}?cluster=devnet`} target="_blank" className="font-mono block hover:text-white truncate max-w-[120px]">
                          {order.tx_signature.slice(0, 10)}...
                        </a>
                      </div>
                      {order.garment_serial && (
                        <div className="text-[0.6rem] text-white">
                          <span className="uppercase tracking-widest opacity-50 text-[#666]">Serial</span>
                          <span className="font-mono block font-bold text-emerald-400">{order.garment_serial}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto shrink-0">
                  {order.status === 'pending' ? (
                    <button 
                      onClick={() => startProduction(order.id)}
                      disabled={processingId === order.id}
                      className="btn-circuit py-2.5 px-6 text-[0.7rem] w-full md:w-auto"
                    >
                      <span>{processingId === order.id ? 'Processing...' : 'Start Production'}</span>
                    </button>
                  ) : (
                    <div className="flex gap-2 w-full md:w-auto">
                      <a 
                        href={`/passport?order=${order.id}`}
                        target="_blank"
                        className="btn-outline-circuit py-2.5 px-6 text-[0.7rem] flex-1 text-center"
                      >
                        Passport
                      </a>
                      {order.status !== 'pending' && (
                        <button 
                          className="p-2.5 border border-white/10 rounded-full hover:bg-white/5 transition-colors"
                          title="Generate Tag QR"
                          onClick={() => setSelectedQR(order)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M7 7h.01M17 7h.01M17 17h.01M7 17h.01"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* QR MODAL */}
        {selectedQR && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 print:p-0 print:static print:inset-auto">
            <div className="absolute inset-0 bg-black/90 backdrop-blur-md print:hidden" onClick={() => setSelectedQR(null)} />
            
            <div className="relative w-full max-w-sm card-glass p-8 flex flex-col items-center animate-scale-in print:shadow-none print:border-none print:bg-white print:text-black print:p-0">
              <div className="print:hidden w-full flex justify-between items-center mb-8 text-[#666]">
                <span className="text-[0.6rem] font-bold tracking-[0.2em] uppercase">Garment Identity Tag</span>
                <button onClick={() => setSelectedQR(null)} className="hover:text-white text-xl">×</button>
              </div>

              {/* Printable Tag Area */}
              <div id="identity-tag" className="flex flex-col items-center bg-white p-10 rounded-3xl print:p-4 print:rounded-none">
                <div className="mb-6 opacity-80 scale-75 invert print:invert-0">
                   <Image src="/logo/logo_icon_white.svg" alt="Circuit" width={40} height={40} />
                </div>
                
                <div className="bg-white p-4 rounded-2xl border border-black/5 mb-6">
                  <QRCodeCanvas 
                    value={`${window.location.origin}/passport?order=${selectedQR.id}`}
                    size={160}
                    level="H"
                    includeMargin={false}
                  />
                </div>

                <div className="text-center">
                  <span className="text-[0.55rem] font-bold tracking-[0.2em] uppercase text-black/40 block mb-1">Serial Number</span>
                  <span className="text-xl font-mono font-bold text-black tracking-tighter">{selectedQR.garment_serial}</span>
                </div>

                <div className="mt-8 pt-6 border-t border-black/5 w-full text-center">
                   <span className="text-[0.5rem] font-bold tracking-[0.1em] uppercase text-black/60">Drop Zero — Series 1</span>
                </div>
              </div>

              <div className="mt-10 flex gap-4 w-full print:hidden">
                <button 
                  onClick={() => setSelectedQR(null)}
                  className="flex-1 py-4 text-xs font-bold uppercase tracking-widest border border-white/10 rounded-full hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handlePrint}
                  className="flex-1 btn-circuit py-4 text-xs justify-center"
                >
                  <span>Print Tag</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
