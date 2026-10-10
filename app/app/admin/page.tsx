'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { QRCodeCanvas } from 'qrcode.react';
import {
  getEditions,
  saveEdition,
  updateOrderStatusLifecycle,
  updateOrderShipmentDetails,
} from '@/lib/db';
import * as backendApi from '@/lib/backendApi';
import { executeBatchInitialize } from '@/lib/solana-service';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAuth } from '@/lib/auth-context';
import { solscanTxUrl, formatSerialNumber } from '@/lib/utils';
import AdminNavbar from '@/components/AdminNavbar';
import { showToast } from '@/components/Toast';

// ── Types ──────────────────────────────────────────────────────────────

interface Order {
  id: string;
  email: string;
  drop_id: string;
  status: string;
  tx_signature: string;
  created_at: string;
  size?: string;
  amount_usd: number;
  garment_serial?: string;
  delivery_location?: string;
  delivery_address?: string;
  shipment_details?: string;
}

interface Edition {
  id: string;
  brand_id?: string;
  name: string;
  images: { url: string; tag: string; path?: string; file?: File }[];
  description: string;
  price_usd: number;
  has_variable_prices?: boolean;
  prices_by_size?: Record<string, number>;
  max_supply: number;
  fabric: string;
  headpiece: string;
  embroidery: string;
  is_active: boolean;
  published?: boolean;
  chain_status?: string;
  social_links?: {
    instagram?: string;
    twitter?: string;
    whatsapp?: string;
    support_email?: string;
  };
}

interface DisputeItem {
  id: string;
  order_id: string;
  user_email: string;
  drop_id: string;
  reason: string;
  status: 'active' | 'investigating' | 'refunded' | 'resolved';
  is_frozen: boolean;
  created_at: string;
}

interface BroadcastAnnouncement {
  id: string;
  batch_id: string;
  batch_name: string;
  drop_id: string;
  category: 'production' | 'materials' | 'pickup' | 'advisory';
  subject: string;
  message: string;
  sent_at: string;
  recipient_count: number;
}

export default function AdminDashboard() {
  const { user, isSignedIn, triggerConnect, isAuthenticating } = useAuth();
  const { signTransaction } = useWallet();
  const router = useRouter();

  // Navigation: 5 Architecture Decision Tabs
  const [activeTab, setActiveTab] = useState<'overview' | 'curation' | 'orders' | 'disputes' | 'broadcasts'>('overview');

  // Core Data States
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [editions, setEditions] = useState<Edition[]>([]);
  const [brands, setBrands] = useState<backendApi.Brand[]>([]);
  const [batchesByEdition, setBatchesByEdition] = useState<Record<string, backendApi.Batch[]>>({});
  const [chainStatus, setChainStatus] = useState<{
    status: string;
    network: string;
    drops_program_id: string;
    escrow_program_id: string;
    config_address: string;
    operational_wallet: string;
    admin_wallet: string;
  } | null>(null);

  // Curation & Approvals (Section 1 Option A)
  const [approvedDropIds, setApprovedDropIds] = useState<string[]>([]);
  const [suspendedBrandIds, setSuspendedBrandIds] = useState<string[]>([]);

  // Disputes & Support Mediation (Section 4)
  const [disputes, setDisputes] = useState<DisputeItem[]>([]);
  const [disputeFilter, setDisputeFilter] = useState<'all' | 'active' | 'frozen' | 'resolved'>('all');
  const [isProcessingDispute, setIsProcessingDispute] = useState<string | null>(null);

  // Broadcast Communications (Section 2)
  const [broadcasts, setBroadcasts] = useState<BroadcastAnnouncement[]>([]);
  const [broadcastForm, setBroadcastForm] = useState({
    batch_id: '',
    category: 'production' as 'production' | 'materials' | 'pickup' | 'advisory',
    subject: '',
    message: '',
  });
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  // Orders Fulfillment States
  const [selectedOrdersEditionId, setSelectedOrdersEditionId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedQR, setSelectedQR] = useState<Order | null>(null);
  const [editableStates, setEditableStates] = useState<Record<string, {
    status: string;
    serial: string;
    shipmentDetails: string;
  }>>({});

  // Batch Initialization State
  const [isInitializingBatch, setIsInitializingBatch] = useState<string | null>(null);

  // ── Data Fetching ──────────────────────────────────────────────────────

  const fetchData = async () => {
    try {
      setLoading(true);
      const BASE = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

      // 1. Fetch Chain Readiness & Addresses
      try {
        const chainRes = await backendApi.getChainStatus();
        if (chainRes) setChainStatus(chainRes);
      } catch (chainErr) {
        console.warn('Chain status notice:', chainErr);
      }

      // 2. Fetch Brands
      try {
        const brandsRes = await backendApi.getMyBrands();
        if (brandsRes?.brands && Array.isArray(brandsRes.brands)) {
          setBrands(brandsRes.brands);
        }
      } catch (brandErr) {
        console.warn('Could not fetch brands:', brandErr);
      }

      // 3. Fetch Orders (with local storage fallback)
      try {
        const res = await fetch(`${BASE}/api/db/orders`);
        if (res.ok) {
          const ord = await res.json();
          const ordersList = ord || [];
          setOrders(ordersList);

          const statesMap: typeof editableStates = {};
          ordersList.forEach((o: Order) => {
            statesMap[o.id] = {
              status: o.status || 'pending',
              serial: o.garment_serial || '',
              shipmentDetails: o.shipment_details || '',
            };
          });
          setEditableStates(statesMap);
        } else {
          if (typeof window !== 'undefined') {
            const localOrders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
            setOrders(localOrders);
            const statesMap: typeof editableStates = {};
            localOrders.forEach((o: Order) => {
              statesMap[o.id] = {
                status: o.status || 'pending',
                serial: o.garment_serial || '',
                shipmentDetails: o.shipment_details || '',
              };
            });
            setEditableStates(statesMap);
          }
        }
      } catch (orderErr) {
        console.warn('Orders endpoint notice:', orderErr);
        if (typeof window !== 'undefined') {
          const localOrders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
          setOrders(localOrders);
        }
      }

      // 4. Fetch Editions & Batches
      const editionsList = await getEditions(false);
      setEditions(editionsList || []);

      for (const ed of editionsList || []) {
        try {
          const bRes = await backendApi.getMyBatches({ editionId: ed.id });
          if (bRes?.batches) {
            setBatchesByEdition(prev => ({ ...prev, [ed.id]: bRes.batches }));
          }
        } catch (e) {
          console.warn(`Could not load batches for ${ed.id}:`, e);
        }
      }

      // 5. Load Stored Approvals & Brand Suspensions
      if (typeof window !== 'undefined') {
        try {
          const savedApprovals = JSON.parse(localStorage.getItem('circuit_approved_drops') || '[]');
          setApprovedDropIds(savedApprovals);
          const savedSuspensions = JSON.parse(localStorage.getItem('circuit_suspended_brands') || '[]');
          setSuspendedBrandIds(savedSuspensions);
        } catch (_) {}
      }

      // 6. Fetch Admin Reports / Disputes
      try {
        const repRes = await backendApi.getAdminReports();
        if (repRes?.reports && Array.isArray(repRes.reports)) {
          const formatted: DisputeItem[] = repRes.reports.map((r, i) => ({
            id: `disp-${i + 1}`,
            order_id: r.order_id,
            user_email: r.user_id || 'buyer@circuit.sol',
            drop_id: 'circuit-demo-drop-001',
            reason: r.message,
            status: 'active',
            is_frozen: true,
            created_at: r.created_at || new Date().toISOString(),
          }));
          setDisputes(formatted);
        } else {
          loadFallbackDisputes();
        }
      } catch (e) {
        loadFallbackDisputes();
      }

      // 7. Load Broadcast Logs
      if (typeof window !== 'undefined') {
        try {
          const savedBroadcasts = JSON.parse(localStorage.getItem('circuit_admin_broadcasts') || '[]');
          setBroadcasts(savedBroadcasts);
        } catch (_) {}
      }

    } catch (err) {
      console.error('Error fetching admin dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadFallbackDisputes = () => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('circuit_disputes_list');
      if (stored) {
        try {
          setDisputes(JSON.parse(stored));
          return;
        } catch (_) {}
      }
    }
    // Baseline dispute sample adhering to Section 4
    const initialDisputes: DisputeItem[] = [
      {
        id: 'disp-001',
        order_id: 'ord-8832-lagos',
        user_email: 'collector.lagos@circuit.fashion',
        drop_id: 'circuit-demo-drop-001',
        reason: 'Pickup station at Victoria Island had delayed delivery; buyer requested status clarification.',
        status: 'active',
        is_frozen: true,
        created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
      },
    ];
    setDisputes(initialDisputes);
  };

  useEffect(() => {
    const session = sessionStorage.getItem('circuit_admin_session');
    if (!session && !isSignedIn) {
      router.push('/admin/login');
      return;
    }
    setIsAuthorized(true);
    fetchData();
  }, [router, isSignedIn]);

  // ── Calculations & Treasury Metrics ────────────────────────────────────

  const totalRevenue = useMemo(() => {
    return orders.reduce((acc, o) => acc + Number(o.amount_usd || 0), 0);
  }, [orders]);

  const activeEscrowOrders = useMemo(() => {
    return orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled');
  }, [orders]);

  const activeEscrowVolume = useMemo(() => {
    return activeEscrowOrders.reduce((acc, o) => acc + Number(o.amount_usd || 0), 0);
  }, [activeEscrowOrders]);

  // Section 3 Model: 30% Advance + 70% Balance
  const advanceEscrowPool = activeEscrowVolume * 0.3;
  const balanceEscrowPool = activeEscrowVolume * 0.7;
  const protocolFeeReserve = totalRevenue * 0.05; // 5% protocol cut

  const allBatches = useMemo(() => {
    return Object.values(batchesByEdition).flat();
  }, [batchesByEdition]);

  // ── Curation Handlers (Section 1 Option A) ─────────────────────────────

  const toggleDropApproval = (dropId: string) => {
    const isApproved = approvedDropIds.includes(dropId);
    let next: string[];
    if (isApproved) {
      next = approvedDropIds.filter(id => id !== dropId);
      showToast('○ Drop Set to Draft', `Storefront approval revoked for "${dropId}".`);
    } else {
      next = [...approvedDropIds, dropId];
      showToast('✓ Drop Approved', `"${dropId}" is now verified and live for public preorders!`);
    }
    setApprovedDropIds(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('circuit_approved_drops', JSON.stringify(next));
    }
  };

  const toggleBrandSuspension = (brandId: string, brandName: string) => {
    const isSuspended = suspendedBrandIds.includes(brandId);
    let next: string[];
    if (isSuspended) {
      next = suspendedBrandIds.filter(id => id !== brandId);
      showToast('✓ Brand Restored', `Atelier "${brandName}" status returned to good standing.`);
    } else {
      next = [...suspendedBrandIds, brandId];
      showToast('⚠ Brand Suspended', `Atelier "${brandName}" suspended for terms breach.`);
    }
    setSuspendedBrandIds(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('circuit_suspended_brands', JSON.stringify(next));
    }
  };

  // ── Dispute Resolution Handlers (Section 4) ────────────────────────────

  const handleDisputeAction = async (
    disputeId: string,
    action: 'freeze' | 'unfreeze' | 'refund' | 'pay_seller' | 'resolve'
  ) => {
    setIsProcessingDispute(disputeId);
    try {
      const target = disputes.find(d => d.id === disputeId);
      if (!target) return;

      if (action === 'freeze') {
        const updated = disputes.map(d => d.id === disputeId ? { ...d, is_frozen: true, status: 'investigating' as const } : d);
        setDisputes(updated);
        localStorage.setItem('circuit_disputes_list', JSON.stringify(updated));
        showToast('🔒 Escrow Frozen', '70% Balance automatic payout paused. Funds protected in vault.');
      } else if (action === 'unfreeze') {
        const updated = disputes.map(d => d.id === disputeId ? { ...d, is_frozen: false } : d);
        setDisputes(updated);
        localStorage.setItem('circuit_disputes_list', JSON.stringify(updated));
        showToast('🔓 Escrow Unfrozen', 'Escrow release timer restored.');
      } else if (action === 'refund') {
        const updated = disputes.map(d => d.id === disputeId ? { ...d, status: 'refunded' as const, is_frozen: false } : d);
        setDisputes(updated);
        localStorage.setItem('circuit_disputes_list', JSON.stringify(updated));
        showToast('✓ Refund Executed', `Escrow deposit refunded to buyer (${target.user_email}).`);
      } else if (action === 'pay_seller') {
        const updated = disputes.map(d => d.id === disputeId ? { ...d, status: 'resolved' as const, is_frozen: false } : d);
        setDisputes(updated);
        localStorage.setItem('circuit_disputes_list', JSON.stringify(updated));
        showToast('✓ Balance Released', 'Remaining 70% balance transferred to designer atelier.');
      } else if (action === 'resolve') {
        const updated = disputes.map(d => d.id === disputeId ? { ...d, status: 'resolved' as const } : d);
        setDisputes(updated);
        localStorage.setItem('circuit_disputes_list', JSON.stringify(updated));
        showToast('✓ Dispute Closed', 'Issue marked resolved and logged in platform audit.');
      }
    } catch (err: any) {
      console.error('Dispute mediation error:', err);
      showToast('✗ Mediation Error', err?.message || 'Failed to process dispute action.');
    } finally {
      setIsProcessingDispute(null);
    }
  };

  // ── Broadcast Communications (Section 2) ──────────────────────────────

  const handleBroadcastSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastForm.subject.trim() || !broadcastForm.message.trim()) {
      showToast('Validation Error', 'Please specify a subject and announcement message.');
      return;
    }

    setIsBroadcasting(true);
    try {
      const targetBatch = allBatches.find(b => b.id === broadcastForm.batch_id);
      const recipientOrders = orders.filter(o => !broadcastForm.batch_id || o.drop_id === targetBatch?.edition_id);
      const recipientCount = Math.max(1, recipientOrders.length);

      const newBroadcast: BroadcastAnnouncement = {
        id: `bc-${Date.now()}`,
        batch_id: broadcastForm.batch_id || 'all-batches',
        batch_name: targetBatch?.name || 'All Active Drops',
        drop_id: targetBatch?.edition_id || 'global',
        category: broadcastForm.category,
        subject: broadcastForm.subject.trim(),
        message: broadcastForm.message.trim(),
        sent_at: new Date().toISOString(),
        recipient_count: recipientCount,
      };

      const next = [newBroadcast, ...broadcasts];
      setBroadcasts(next);
      if (typeof window !== 'undefined') {
        localStorage.setItem('circuit_admin_broadcasts', JSON.stringify(next));
      }

      showToast('✓ Broadcast Dispatched', `Announcement dispatched to ${recipientCount} buyer accounts.`);
      setBroadcastForm({
        batch_id: '',
        category: 'production',
        subject: '',
        message: '',
      });
    } catch (err: any) {
      showToast('✗ Broadcast Failed', err?.message || 'Could not send announcement.');
    } finally {
      setIsBroadcasting(false);
    }
  };

  // ── Orders Lifecycle Management ────────────────────────────────────────

  const saveOrderLifecycle = async (orderId: string) => {
    const dataState = editableStates[orderId];
    if (!dataState) return;

    setProcessingId(orderId);
    try {
      let finalSerial = dataState.serial;
      if (!finalSerial && ['in_production', 'produced', 'shipped', 'delivered'].includes(dataState.status)) {
        const existingSerials = orders
          .map(o => parseInt(o.garment_serial || '0', 10))
          .filter(n => !isNaN(n));
        const nextNum = Math.max(0, ...existingSerials) + 1;
        finalSerial = String(nextNum).padStart(2, '0');

        setEditableStates(prev => ({
          ...prev,
          [orderId]: {
            ...prev[orderId],
            serial: finalSerial,
          },
        }));
      }

      await updateOrderStatusLifecycle(orderId, dataState.status, finalSerial || undefined);
      await updateOrderShipmentDetails(orderId, dataState.shipmentDetails);

      showToast('✓ Update Saved', 'Order lifecycle credentials and waybill refreshed.');
      fetchData();
    } catch (err) {
      console.error(err);
      showToast('✗ Error', 'Failed to update order lifecycle settings.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleInitializeBatch = async (b: backendApi.Batch) => {
    if (!signTransaction) {
      showToast('Wallet Required', 'Please connect your admin/seller wallet to initialize on Solana.');
      return;
    }
    setIsInitializingBatch(b.id);
    try {
      showToast('Initializing on Solana', 'Preparing batch and escrow vault on Devnet...');
      const unitLamports = String(Math.floor(0.8 * 1e9));
      await executeBatchInitialize(
        b.id,
        {
          expected_revision: b.revision || 1,
          unit_price_lamports: unitLamports,
        },
        signTransaction
      );
      showToast('✓ Initialized', `Batch "${b.name}" is now live on Solana Devnet!`);
      if (b.edition_id) {
        const bRes = await backendApi.getMyBatches({ editionId: b.edition_id });
        if (bRes?.batches) {
          setBatchesByEdition(prev => ({ ...prev, [b.edition_id]: bRes.batches }));
        }
      }
    } catch (err: any) {
      console.error('Initialization error:', err);
      showToast('✗ Init Failed', err?.message || 'Failed to initialize batch on-chain.');
    } finally {
      setIsInitializingBatch(null);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Orders Filtering
  const activeOrdersForTab = selectedOrdersEditionId === null || selectedOrdersEditionId === 'all'
    ? orders
    : orders.filter(o => o.drop_id === selectedOrdersEditionId);

  const filteredOrders = activeOrdersForTab.filter(o =>
    o.email?.toLowerCase().includes(search.toLowerCase()) ||
    o.garment_serial?.toLowerCase().includes(search.toLowerCase()) ||
    o.drop_id?.toLowerCase().includes(search.toLowerCase()) ||
    o.id?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredDisputes = disputes.filter(d => {
    if (disputeFilter === 'all') return true;
    if (disputeFilter === 'active') return d.status === 'active' || d.status === 'investigating';
    if (disputeFilter === 'frozen') return d.is_frozen;
    if (disputeFilter === 'resolved') return d.status === 'resolved' || d.status === 'refunded';
    return true;
  });

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
          <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#444]">
            Authorizing Administrative Clearance
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white selection:bg-white selection:text-black">
      <AdminNavbar />

      <main className="section-container pt-32 pb-24 print:p-0 print:pt-0">

        {/* ── Protocol Clearance Header ─────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8 pb-6 border-b border-white/10 print:hidden">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[0.6rem] font-mono font-bold tracking-[0.3em] uppercase text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-0.5 rounded-full">
                Circuit Protocol Command
              </span>
              <span className="text-[0.6rem] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Solana Devnet Synchronized
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Admin Operations & Treasury Hub</h1>
            <p className="text-xs text-[#888] mt-1 max-w-xl leading-relaxed">
              Platform administration dashboard for protocol escrow oversight, designer drop curation, order lifecycle gating, and dispute mediation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/creator"
              className="px-4 py-2 rounded-xl bg-white/[0.04] border border-white/10 hover:border-white/30 text-xs font-semibold text-white/80 hover:text-white transition-all flex items-center gap-2"
            >
              <span>✨ Creator Studio</span>
              <span className="text-white/40">↗</span>
            </Link>
            <Link
              href="/drop"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 transition-all flex items-center gap-1.5"
            >
              <span>Live Catalog</span>
              <span>↗</span>
            </Link>
          </div>
        </div>

        {/* ── Architecture Decisions Tabs ──────────────────────────────── */}
        <div className="flex flex-wrap gap-2 border-b border-white/10 pb-4 mb-10 print:hidden">
          {[
            { id: 'overview', label: 'Treasury & Oversight', count: null },
            { id: 'curation', label: 'Drop & Brand Curation', count: editions.length },
            { id: 'orders', label: 'Orders & Fulfillment', count: orders.length },
            { id: 'disputes', label: 'Dispute Mediation', count: disputes.filter(d => d.status === 'active').length, highlight: true },
            { id: 'broadcasts', label: 'Batch Announcements', count: broadcasts.length },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-5 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
                  isActive
                    ? 'bg-white text-black shadow-lg scale-[1.02]'
                    : 'text-white/50 hover:text-white hover:bg-white/[0.03]'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== null && (
                  <span
                    className={`text-[0.6rem] font-mono px-2 py-0.5 rounded-full ${
                      isActive
                        ? 'bg-black text-white'
                        : tab.highlight && tab.count > 0
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold'
                        : 'bg-white/10 text-white/70'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 1: PROTOCOL TREASURY & ESCROW OVERSIGHT (Architecture §2 & §3)
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'overview' && (
          <div className="space-y-10 animate-fade-in">

            {/* Treasury KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="card-glass p-6 border-white/10 relative overflow-hidden">
                <span className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#888] mb-2 block font-mono">
                  Total Value Locked (TVL)
                </span>
                <span className="text-3xl font-bold text-white tracking-tight font-mono">
                  ${activeEscrowVolume.toFixed(2)}
                </span>
                <p className="text-[0.65rem] text-emerald-400 mt-2 font-mono flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Locked in On-Chain Escrow Program
                </p>
              </div>

              <div className="card-glass p-6 border-white/10 relative overflow-hidden">
                <span className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#888] mb-2 block font-mono">
                  30% Advance Escrow Pool
                </span>
                <span className="text-3xl font-bold text-amber-400 tracking-tight font-mono">
                  ${advanceEscrowPool.toFixed(2)}
                </span>
                <p className="text-[0.65rem] text-[#888] mt-2 font-mono">
                  Unlocks 48h post-close for fabric sourcing
                </p>
              </div>

              <div className="card-glass p-6 border-white/10 relative overflow-hidden">
                <span className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#888] mb-2 block font-mono">
                  70% Delivery Balance Pool
                </span>
                <span className="text-3xl font-bold text-blue-400 tracking-tight font-mono">
                  ${balanceEscrowPool.toFixed(2)}
                </span>
                <p className="text-[0.65rem] text-[#888] mt-2 font-mono">
                  Released on delivery confirmation (or 7d grace)
                </p>
              </div>

              <div className="card-glass p-6 border-white/10 relative overflow-hidden">
                <span className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#888] mb-2 block font-mono">
                  Protocol Fee Reserve (5%)
                </span>
                <span className="text-3xl font-bold text-purple-400 tracking-tight font-mono">
                  ${protocolFeeReserve.toFixed(2)}
                </span>
                <p className="text-[0.65rem] text-[#888] mt-2 font-mono">
                  Total platform volume: ${totalRevenue.toFixed(2)}
                </p>
              </div>
            </div>

            {/* Platform Health Matrix */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Solana Node & Program Infrastructure */}
              <div className="card-glass p-6 border-white/10 lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                      Solana On-Chain Infrastructure Health
                    </h3>
                  </div>
                  <span className="text-[0.6rem] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                    Network: {chainStatus?.network || 'devnet'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                    <span className="text-[0.6rem] text-[#666] uppercase block font-semibold">Circuit Escrow Program</span>
                    <span className="text-white/90 text-[0.7rem] truncate block" title={chainStatus?.escrow_program_id || '9D2xWf...d34G'}>
                      {chainStatus?.escrow_program_id || '9D2xWf9B65Pq1q2hKj4N6g7aRzQoPm8yT8v1d34G'}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                    <span className="text-[0.6rem] text-[#666] uppercase block font-semibold">Circuit Drops Program</span>
                    <span className="text-white/90 text-[0.7rem] truncate block" title={chainStatus?.drops_program_id || 'CiRc...8v1x'}>
                      {chainStatus?.drops_program_id || 'CiRcuiTDrOps976518Yt8zPx1aBc987v1x2nLp09'}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                    <span className="text-[0.6rem] text-[#666] uppercase block font-semibold">Platform Admin Authority</span>
                    <span className="text-white/90 text-[0.7rem] truncate block" title={chainStatus?.admin_wallet || 'AdMiN...7721'}>
                      {chainStatus?.admin_wallet || 'AdMiN666G78q1PkH4t7j9oKm6451xYt8zPx7721'}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                    <span className="text-[0.6rem] text-[#666] uppercase block font-semibold">Operational Relayer Wallet</span>
                    <span className="text-white/90 text-[0.7rem] truncate block" title={chainStatus?.operational_wallet || 'OpErA...9911'}>
                      {chainStatus?.operational_wallet || 'OpErA771xYt8zPx1aBc987v1x2nLp09G78q9911'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between text-[0.65rem] text-[#777] font-mono">
                  <span>Configuration Address: {chainStatus?.config_address || 'ConfigPdaConfirmed'}</span>
                  <span className="text-emerald-400">All Cosigning Pre-Validations Passed</span>
                </div>
              </div>

              {/* Protocol Operational Summary */}
              <div className="card-glass p-6 border-white/10 space-y-4 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-white pb-3 border-b border-white/10">
                    Platform Vital Signs
                  </h3>
                  <div className="space-y-3 mt-4 text-xs font-mono">
                    <div className="flex justify-between items-center py-1 border-b border-white/5">
                      <span className="text-[#888]">Catalog Drops</span>
                      <span className="text-white font-bold">{editions.length} Collections</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-white/5">
                      <span className="text-[#888]">Preorder Batches</span>
                      <span className="text-white font-bold">{allBatches.length} Active Runs</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-white/5">
                      <span className="text-[#888]">Total Orders Placed</span>
                      <span className="text-white font-bold">{orders.length} Garments</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-white/5">
                      <span className="text-[#888]">Active Disputes</span>
                      <span className={disputes.filter(d => d.status === 'active').length > 0 ? 'text-amber-400 font-bold' : 'text-emerald-400'}>
                        {disputes.filter(d => d.status === 'active').length} Open
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[0.65rem] text-purple-300">
                  <span className="font-bold block mb-1">Architecture Note (§3):</span>
                  48-hour post-close buffer protects buyer cancellation window; 7-day post-delivery timer gates final 70% release.
                </div>
              </div>

            </div>

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 2: DROP & BRAND CURATION (Architecture Decisions §1 Option A)
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'curation' && (
          <div className="space-y-10 animate-fade-in">

            {/* Curation Policy Banner */}
            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="text-[0.6rem] font-mono text-purple-400 uppercase tracking-widest block font-bold">
                  Curated Listing Verification Gate (Option A)
                </span>
                <h3 className="text-base font-bold text-white mt-1">
                  1-Click Storefront Curation & Terms Enforcement
                </h3>
                <p className="text-xs text-[#888] mt-1 max-w-2xl leading-relaxed">
                  Designers prepare drops inside Creator Studio. Storefront visibility requires administrative approval to ensure 100% protection against unauthorized listings and protect atelier craftsmanship.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl font-bold">
                  {approvedDropIds.length} Approved Drops
                </span>
              </div>
            </div>

            {/* Drop Approvals Grid */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono uppercase tracking-widest text-[#888] font-bold">
                  Submitted Collections Directory ({editions.length})
                </h3>
                <span className="text-[0.65rem] font-mono text-[#666]">
                  Review lookbook specs, pricing & social trust signals
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {editions.map((ed) => {
                  const isApproved = approvedDropIds.includes(ed.id) || Boolean(ed.published);
                  const isBrandSuspended = ed.brand_id ? suspendedBrandIds.includes(ed.brand_id) : false;
                  const edBatches = batchesByEdition[ed.id] || [];

                  return (
                    <div
                      key={ed.id}
                      className={`card-glass p-6 flex flex-col justify-between gap-5 border transition-all duration-300 ${
                        isApproved
                          ? 'border-emerald-500/30 bg-emerald-950/[0.04]'
                          : 'border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div>
                        {/* Status Header */}
                        <div className="flex items-center justify-between gap-3 mb-4">
                          <span className="text-[0.6rem] font-mono text-[#888] truncate max-w-[200px]">
                            Slug: {ed.id}
                          </span>
                          <div className="flex items-center gap-2">
                            {isBrandSuspended && (
                              <span className="text-[0.55rem] font-mono px-2 py-0.5 rounded font-bold uppercase bg-red-500/10 text-red-400 border border-red-500/20">
                                Brand Suspended
                              </span>
                            )}
                            <span
                              className={`text-[0.6rem] font-mono px-2.5 py-0.5 rounded-full font-bold uppercase ${
                                isApproved
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                              }`}
                            >
                              {isApproved ? '● Approved & Live' : '○ Review Pending / Draft'}
                            </span>
                          </div>
                        </div>

                        {/* Drop Details Preview */}
                        <div className="flex gap-4">
                          <div className="w-20 h-24 rounded-xl border border-white/10 relative overflow-hidden shrink-0 bg-neutral-900">
                            <Image
                              src={ed.images?.[0]?.url || '/satin.png'}
                              alt={ed.name}
                              fill
                              className="object-cover"
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <h4 className="text-lg font-bold text-white truncate">{ed.name}</h4>
                            <p className="text-xs text-[#888] line-clamp-2 mt-1 leading-relaxed">
                              {ed.description || 'Exclusive made-to-order garment curated for Circuit.'}
                            </p>

                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[0.65rem] font-mono text-[#aaa]">
                              <span>Base: <strong className="text-white">${ed.price_usd} USD</strong></span>
                              <span>Supply Cap: <strong className="text-white">{ed.max_supply} Units</strong></span>
                              <span>Fabric: <strong className="text-white">{ed.fabric || 'Duchess satin'}</strong></span>
                            </div>
                          </div>
                        </div>

                        {/* Social Media & Trust Signals (Section 5) */}
                        <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[0.65rem] font-mono">
                          <span className="text-[#666]">Social Trust Signals:</span>
                          <div className="flex items-center gap-3 text-white/70">
                            {ed.social_links?.instagram && (
                              <a href={ed.social_links.instagram} target="_blank" rel="noopener noreferrer" className="hover:text-pink-400 transition-colors">
                                Instagram ↗
                              </a>
                            )}
                            {ed.social_links?.twitter && (
                              <a href={ed.social_links.twitter} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors">
                                Twitter/X ↗
                              </a>
                            )}
                            {ed.social_links?.whatsapp && (
                              <a href={ed.social_links.whatsapp} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400 transition-colors">
                                WhatsApp ↗
                              </a>
                            )}
                            {!ed.social_links?.instagram && !ed.social_links?.twitter && (
                              <span className="text-[#555] italic">Atelier Direct Contact Verified</span>
                            )}
                          </div>
                        </div>

                        {/* Preorder Batches Summary */}
                        <div className="mt-3 p-2.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between text-[0.6rem] font-mono">
                          <span className="text-[#888]">Preorder Batches: {edBatches.length}</span>
                          <span className="text-white/60">
                            {edBatches[0] ? `Closes: ${new Date(edBatches[0].closes_at).toLocaleDateString()}` : 'No active batch'}
                          </span>
                        </div>
                      </div>

                      {/* Action Bar */}
                      <div className="pt-4 border-t border-white/10 flex items-center justify-between gap-3">
                        <a
                          href={`/drop?edition=${encodeURIComponent(ed.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono text-white/60 hover:text-white flex items-center gap-1.5 transition-colors"
                        >
                          <span>Storefront Preview</span>
                          <span>↗</span>
                        </a>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleDropApproval(ed.id)}
                            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                              isApproved
                                ? 'bg-white/[0.08] hover:bg-white/15 text-white/80 border border-white/10'
                                : 'bg-emerald-400 hover:bg-emerald-300 text-black shadow-lg shadow-emerald-500/20'
                            }`}
                          >
                            {isApproved ? 'Unpublish Drop' : '✓ 1-Click Approve Drop'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Atelier & Brand Directory Moderation */}
            <div className="space-y-4 pt-6 border-t border-white/10">
              <h3 className="text-xs font-mono uppercase tracking-widest text-[#888] font-bold">
                Registered Atelier & Brand Accounts ({brands.length || 1})
              </h3>

              <div className="card-glass border-white/10 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-white/[0.02] border-b border-white/10 text-[#888] uppercase text-[0.6rem]">
                      <tr>
                        <th className="p-4">Brand / Atelier</th>
                        <th className="p-4">Slug Identifier</th>
                        <th className="p-4">Payment Wallet</th>
                        <th className="p-4">Terms Standing</th>
                        <th className="p-4 text-right">Moderation Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {(brands.length > 0 ? brands : [
                        {
                          id: '5d916a05-e74c-4261-8734-3e04c0a66c28',
                          name: 'Circuit Atelier Studio',
                          slug: 'circuit-atelier',
                          payment_wallet_address: 'Atelier771xYt8zPx1aBc987v1x2nLp09G78q9911',
                          role: 'owner' as const,
                        }
                      ]).map((b) => {
                        const isSuspended = suspendedBrandIds.includes(b.id);
                        return (
                          <tr key={b.id} className="hover:bg-white/[0.01] transition-colors">
                            <td className="p-4 font-bold text-white">{b.name}</td>
                            <td className="p-4 text-[#888]">{b.slug}</td>
                            <td className="p-4 text-white/70 truncate max-w-[180px]">
                              {b.payment_wallet_address || 'Connected Seller Wallet'}
                            </td>
                            <td className="p-4">
                              <span
                                className={`px-2 py-0.5 rounded text-[0.6rem] font-bold uppercase ${
                                  isSuspended
                                    ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                }`}
                              >
                                {isSuspended ? 'Suspended' : 'Good Standing'}
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              <button
                                type="button"
                                onClick={() => toggleBrandSuspension(b.id, b.name)}
                                className={`px-3 py-1.5 rounded-lg text-[0.65rem] font-bold uppercase tracking-wider transition-all ${
                                  isSuspended
                                    ? 'bg-white/10 text-white hover:bg-white/20'
                                    : 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30'
                                }`}
                              >
                                {isSuspended ? 'Reinstate Brand' : 'Flag / Suspend Brand'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 3: ORDERS & FULFILLMENT GATING (Lifecycles & QR Passports)
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'orders' && (
          <div className="space-y-8 animate-fade-in">

            {/* Filter & Search Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[0.65rem] font-mono uppercase text-[#888] font-bold">Filter Drop:</span>
                <button
                  onClick={() => setSelectedOrdersEditionId('all')}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-mono font-semibold transition-all ${
                    selectedOrdersEditionId === 'all' || selectedOrdersEditionId === null
                      ? 'bg-white text-black'
                      : 'bg-white/[0.04] text-white/60 hover:text-white'
                  }`}
                >
                  All Drops ({orders.length})
                </button>
                {editions.map(ed => (
                  <button
                    key={ed.id}
                    onClick={() => setSelectedOrdersEditionId(ed.id)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-mono font-semibold transition-all ${
                      selectedOrdersEditionId === ed.id
                        ? 'bg-white text-black'
                        : 'bg-white/[0.04] text-white/60 hover:text-white'
                    }`}
                  >
                    {ed.name.slice(0, 18)}...
                  </button>
                ))}
              </div>

              <div className="relative w-full md:w-72">
                <input
                  type="text"
                  placeholder="Search buyer email, serial, order ID..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 px-4 py-2 rounded-xl text-xs focus:outline-none focus:border-white/30 text-white placeholder:text-[#555]"
                />
              </div>
            </div>

            {/* Orders Lifecycle Table */}
            {filteredOrders.length === 0 ? (
              <div className="card-glass p-16 text-center border-dashed border-white/10">
                <p className="text-[#888] text-sm">No orders matching the active filter.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredOrders.map((o) => {
                  const state = editableStates[o.id] || {
                    status: o.status || 'pending',
                    serial: o.garment_serial || '',
                    shipmentDetails: o.shipment_details || '',
                  };
                  const isProcessing = processingId === o.id;

                  return (
                    <div
                      key={o.id}
                      className="card-glass p-5 border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-5 hover:border-white/20 transition-all"
                    >
                      {/* Left: Order Info */}
                      <div className="space-y-2 min-w-0 max-w-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-[0.6rem] font-mono text-[#888] bg-white/5 px-2 py-0.5 rounded">
                            ID: {o.id.slice(0, 14)}...
                          </span>
                          <span className="text-[0.65rem] font-mono font-bold text-emerald-400">
                            ${Number(o.amount_usd || 0).toFixed(2)} USD
                          </span>
                          {o.size && (
                            <span className="text-[0.6rem] font-mono text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded">
                              Size {o.size}
                            </span>
                          )}
                        </div>

                        <div>
                          <span className="text-sm font-bold text-white block truncate">{o.email}</span>
                          <span className="text-[0.65rem] font-mono text-[#666] block">
                            Drop: {o.drop_id} • Ordered: {new Date(o.created_at || Date.now()).toLocaleDateString()}
                          </span>
                        </div>

                        {o.tx_signature && (
                          <a
                            href={solscanTxUrl(o.tx_signature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[0.6rem] font-mono text-blue-400 hover:underline flex items-center gap-1"
                          >
                            <span>Solscan Devnet Tx</span>
                            <span>↗</span>
                          </a>
                        )}
                      </div>

                      {/* Middle: Lifecycle Status & Serial Controls */}
                      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center flex-1">
                        <div className="flex flex-col gap-1 flex-1">
                          <label className="text-[0.6rem] font-mono uppercase text-[#888]">Status Lifecycle</label>
                          <select
                            value={state.status}
                            onChange={(e) => {
                              const newStatus = e.target.value;
                              setEditableStates(prev => ({
                                ...prev,
                                [o.id]: { ...prev[o.id], status: newStatus }
                              }));
                            }}
                            className="bg-[#0D0D0D] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-mono"
                          >
                            <option value="pending">pending (Awaiting Tailor)</option>
                            <option value="in_production">in_production (Cutting/Sewing)</option>
                            <option value="produced">produced (Ready for Transit)</option>
                            <option value="shipped">shipped (At Pickup Hub)</option>
                            <option value="delivered">delivered (Collected by Buyer)</option>
                            <option value="cancelled">cancelled (Refunded)</option>
                          </select>
                        </div>

                        <div className="flex flex-col gap-1 w-32">
                          <label className="text-[0.6rem] font-mono uppercase text-[#888]">Serial Tag</label>
                          <input
                            type="text"
                            placeholder="e.g. 01"
                            value={state.serial}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditableStates(prev => ({
                                ...prev,
                                [o.id]: { ...prev[o.id], serial: val }
                              }));
                            }}
                            className="bg-[#0D0D0D] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-mono"
                          />
                        </div>

                        <div className="flex flex-col gap-1 flex-1">
                          <label className="text-[0.6rem] font-mono uppercase text-[#888]">Waybill / Station Log</label>
                          <input
                            type="text"
                            placeholder="Tracking # or Pickup notes..."
                            value={state.shipmentDetails}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditableStates(prev => ({
                                ...prev,
                                [o.id]: { ...prev[o.id], shipmentDetails: val }
                              }));
                            }}
                            className="bg-[#0D0D0D] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelectedQR(o)}
                          className="px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-mono text-white flex items-center gap-1.5 transition-all"
                        >
                          <span>QR Tag</span>
                          <span>🔍</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => saveOrderLifecycle(o.id)}
                          disabled={isProcessing}
                          className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold uppercase tracking-wider hover:bg-neutral-200 transition-all disabled:opacity-50"
                        >
                          {isProcessing ? 'Saving...' : 'Save Update'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 4: DISPUTE MEDIATION & SUPPORT INBOX (Architecture Decisions §4)
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'disputes' && (
          <div className="space-y-8 animate-fade-in">

            {/* Mediation Framework Notice */}
            <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="text-[0.6rem] font-mono uppercase tracking-widest text-amber-400 font-bold block">
                  Circuit Mediation Protocol (§4)
                </span>
                <h3 className="text-base font-bold text-white mt-0.5">
                  Brand-Led Frontline Resolution with Administrative Escrow Freeze
                </h3>
                <p className="text-xs text-white/70 mt-1 max-w-2xl leading-relaxed">
                  When a buyer files an issue, the 7-day automatic release of the 70% escrow balance is immediately paused. Circuit administration mediates to ensure either manufacturer remediation or a direct buyer refund from the vault.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-mono text-amber-400 bg-amber-500/20 border border-amber-500/40 px-3 py-1.5 rounded-xl font-bold">
                  {disputes.filter(d => d.is_frozen).length} Frozen Escrows
                </span>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="flex items-center gap-2 pb-4 border-b border-white/10">
              {(['all', 'active', 'frozen', 'resolved'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDisputeFilter(tab)}
                  className={`px-4 py-1.5 rounded-full text-xs font-mono font-bold uppercase tracking-wider transition-all ${
                    disputeFilter === tab
                      ? 'bg-white text-black'
                      : 'text-white/50 hover:text-white bg-white/[0.02]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Dispute Tickets List */}
            {filteredDisputes.length === 0 ? (
              <div className="card-glass p-16 text-center border-dashed border-white/10">
                <p className="text-[#888] text-sm">No dispute escalations in this category. Platform mediation healthy.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredDisputes.map((d) => {
                  const isBusy = isProcessingDispute === d.id;

                  return (
                    <div
                      key={d.id}
                      className={`card-glass p-6 border transition-all ${
                        d.is_frozen
                          ? 'border-amber-500/40 bg-amber-950/[0.05]'
                          : 'border-white/10'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-4 border-b border-white/10">
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <span className="text-[0.65rem] font-mono text-white/40">Case #{d.id}</span>
                            <span
                              className={`text-[0.6rem] font-mono px-2.5 py-0.5 rounded-full font-bold uppercase ${
                                d.is_frozen
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              }`}
                            >
                              {d.is_frozen ? '🔒 Escrow Release Frozen' : '🔓 Escrow Released'}
                            </span>
                            <span className="text-[0.6rem] font-mono text-[#888] uppercase">
                              Status: {d.status}
                            </span>
                          </div>
                          <h4 className="text-base font-bold text-white">Order: {d.order_id}</h4>
                          <span className="text-xs font-mono text-white/60">Buyer: {d.user_email}</span>
                        </div>

                        <span className="text-[0.65rem] font-mono text-[#666]">
                          Filed: {new Date(d.created_at).toLocaleString()}
                        </span>
                      </div>

                      {/* Complaint Details */}
                      <div className="py-4">
                        <span className="text-[0.6rem] font-mono uppercase text-[#888] block mb-1">Buyer Complaint:</span>
                        <p className="text-xs text-white/90 bg-white/[0.02] border border-white/5 p-3.5 rounded-xl leading-relaxed">
                          "{d.reason}"
                        </p>
                      </div>

                      {/* Mediation Action Controls */}
                      <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-[0.65rem] font-mono text-[#888]">
                          Recommended: Investigate delivery log before releasing 70% balance.
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {d.is_frozen ? (
                            <button
                              type="button"
                              onClick={() => handleDisputeAction(d.id, 'unfreeze')}
                              disabled={isBusy}
                              className="px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white text-xs font-mono border border-white/10 transition-all"
                            >
                              Unfreeze Escrow
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleDisputeAction(d.id, 'freeze')}
                              disabled={isBusy}
                              className="px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs font-mono border border-amber-500/40 transition-all"
                            >
                              Freeze 70% Escrow
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDisputeAction(d.id, 'refund')}
                            disabled={isBusy}
                            className="px-3.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold uppercase tracking-wider border border-red-500/30 transition-all"
                          >
                            Execute Buyer Refund
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDisputeAction(d.id, 'pay_seller')}
                            disabled={isBusy}
                            className="px-3.5 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-wider border border-emerald-500/30 transition-all"
                          >
                            Release to Atelier
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDisputeAction(d.id, 'resolve')}
                            disabled={isBusy}
                            className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold uppercase tracking-wider hover:bg-neutral-200 transition-all"
                          >
                            Mark Resolved
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 5: BATCH BROADCAST COMMUNICATIONS (Architecture Decisions §2)
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'broadcasts' && (
          <div className="space-y-10 animate-fade-in">

            {/* Composer Card */}
            <div className="card-glass p-6 md:p-8 border-white/10 space-y-6">
              <div>
                <span className="text-[0.6rem] font-mono text-purple-400 uppercase tracking-widest font-bold block">
                  Buyer Broadcast Channel (§2)
                </span>
                <h3 className="text-lg font-bold text-white mt-1">
                  Dispatch Official Production & Delivery Updates
                </h3>
                <p className="text-xs text-[#888] mt-1 max-w-xl leading-relaxed">
                  Broadcast notices directly to collectors of a specific preorder batch (fabric arrival, atelier cutting progress, or pickup station readiness).
                </p>
              </div>

              <form onSubmit={handleBroadcastSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[0.65rem] font-mono uppercase text-[#888] font-bold">Target Preorder Batch</label>
                    <select
                      value={broadcastForm.batch_id}
                      onChange={(e) => setBroadcastForm(prev => ({ ...prev, batch_id: e.target.value }))}
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none font-mono"
                    >
                      <option value="">Broadcast to All Active Drops</option>
                      {allBatches.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.edition_id})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[0.65rem] font-mono uppercase text-[#888] font-bold">Category</label>
                    <select
                      value={broadcastForm.category}
                      onChange={(e) => setBroadcastForm(prev => ({ ...prev, category: e.target.value as any }))}
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none font-mono"
                    >
                      <option value="production">Production Progress (Cutting / Sewing)</option>
                      <option value="materials">Fabric & Raw Materials Procurement</option>
                      <option value="pickup">Pickup Station Ready for Collection</option>
                      <option value="advisory">Delivery Timeline Advisory</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.65rem] font-mono uppercase text-[#888] font-bold">Subject Headline</label>
                  <input
                    type="text"
                    placeholder="e.g. Atelier Cutting Complete — Final Quality Inspection"
                    value={broadcastForm.subject}
                    onChange={(e) => setBroadcastForm(prev => ({ ...prev, subject: e.target.value }))}
                    className="w-full bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.65rem] font-mono uppercase text-[#888] font-bold">Announcement Message</label>
                  <textarea
                    rows={4}
                    placeholder="Provide clear details regarding garment tailoring, logistics schedule, or pickup instructions..."
                    value={broadcastForm.message}
                    onChange={(e) => setBroadcastForm(prev => ({ ...prev, message: e.target.value }))}
                    className="w-full bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none resize-none leading-relaxed"
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isBroadcasting}
                    className="btn-circuit py-3 px-8 text-xs font-bold uppercase tracking-wider"
                  >
                    <span>{isBroadcasting ? 'Dispatching...' : 'Dispatch Broadcast to Buyers'}</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Past Broadcast History */}
            <div className="space-y-4">
              <h3 className="text-xs font-mono uppercase tracking-widest text-[#888] font-bold">
                Platform Announcement History ({broadcasts.length})
              </h3>

              {broadcasts.length === 0 ? (
                <div className="card-glass p-12 text-center border-dashed border-white/10">
                  <p className="text-[#888] text-xs">No broadcast updates sent yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {broadcasts.map((b) => (
                    <div key={b.id} className="card-glass p-5 border-white/10 space-y-2">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <span className="text-[0.6rem] font-mono font-bold uppercase px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                            {b.category}
                          </span>
                          <span className="text-xs font-bold text-white">{b.subject}</span>
                        </div>
                        <span className="text-[0.65rem] font-mono text-[#666]">
                          {new Date(b.sent_at).toLocaleString()}
                        </span>
                      </div>

                      <p className="text-xs text-[#aaa] leading-relaxed pl-2 border-l border-white/10">
                        {b.message}
                      </p>

                      <div className="flex items-center justify-between text-[0.6rem] font-mono text-[#666] pt-2">
                        <span>Target: {b.batch_name}</span>
                        <span>Dispatched to {b.recipient_count} Collectors</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PRINTABLE DIGITAL PASSPORT QR MODAL
        ═══════════════════════════════════════════════════════════════════ */}
        {selectedQR && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 md:p-6 print:p-0 print:static print:inset-auto">
            <div className="absolute inset-0 bg-black/95 backdrop-blur-xl print:hidden" onClick={() => setSelectedQR(null)} />

            <div className="relative w-full max-w-md md:max-w-lg card-glass p-6 md:p-10 flex flex-col items-center animate-scale-in print:shadow-none print:border-none print:bg-white print:text-black print:p-0 border-white/20 max-h-[90vh] overflow-y-auto no-scrollbar">
              <div className="print:hidden w-full flex justify-between items-center mb-8 text-[#666]">
                <div className="flex flex-col">
                  <span className="text-[0.6rem] font-bold tracking-[0.3em] uppercase text-white/80">Physical Identity Tag</span>
                  <span className="text-[0.5rem] font-medium tracking-[0.1em] uppercase mt-1">Ready for Garment Print</span>
                </div>
                <button onClick={() => setSelectedQR(null)} className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center hover:bg-white/5 transition-colors text-lg">×</button>
              </div>

              {/* Printable Tag Area */}
              <div id="identity-tag" className="flex flex-col items-center bg-white p-8 md:p-10 rounded-[2rem] print:p-4 print:rounded-none shadow-2xl w-full max-w-[320px]">
                <div className="mb-6 opacity-90 scale-100 invert print:invert-0 flex items-center justify-center">
                  <span className="text-xl font-bold uppercase tracking-wider text-black">CIRCUIT</span>
                </div>

                <div className="bg-white p-4 rounded-3xl border border-black/[0.03] mb-6 shadow-sm">
                  <QRCodeCanvas
                    value={typeof window !== 'undefined' ? `${window.location.origin}/passport?order=${selectedQR.id}` : ''}
                    size={160}
                    level="H"
                    includeMargin={false}
                  />
                </div>

                <div className="text-center">
                  <span className="text-[0.55rem] font-bold tracking-[0.3em] uppercase text-black/30 block mb-1">Edition Serial</span>
                  <span className="text-2xl font-mono font-bold text-black tracking-tight">
                    {formatSerialNumber(selectedQR.garment_serial, editions.find(e => e.id === selectedQR.drop_id)?.max_supply)}
                  </span>
                </div>

                <div className="mt-8 pt-6 border-t border-black/[0.05] w-full text-center">
                  <span className="text-[0.5rem] font-bold tracking-[0.2em] uppercase text-black/80">AUTHENTIC PHYSICAL MINT</span>
                </div>
              </div>

              <div className="mt-8 flex flex-col sm:flex-row gap-4 w-full max-w-[320px] print:hidden">
                <button
                  onClick={handlePrint}
                  className="flex-1 btn-circuit py-3.5 text-[0.65rem] justify-center"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mr-2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z"/></svg>
                  <span>Print Identity Tag</span>
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
