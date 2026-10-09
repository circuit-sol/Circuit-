'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { QRCodeCanvas } from 'qrcode.react';
import { getEditions, saveEdition, updateOrderStatusLifecycle, updateOrderShipmentDetails, uploadEditionImage, deleteEditionImage } from '@/lib/db';
import * as backendApi from '@/lib/backendApi';
import { updateEditionDraft, type Brand } from '@/lib/backendApi';
import { executeBatchInitialize } from '@/lib/solana-service';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAuth } from '@/lib/auth-context';
import { solscanTxUrl, formatSerialNumber } from '@/lib/utils';
import AdminNavbar from '@/components/AdminNavbar';
import { showToast } from '@/components/Toast';

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
}

export default function AdminDashboard() {
  const { user, isSignedIn, triggerConnect, isAuthenticating } = useAuth();
  const [activeTab, setActiveTab] = useState<'orders' | 'collections'>('orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [editions, setEditions] = useState<Edition[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedQR, setSelectedQR] = useState<Order | null>(null);
  const [selectedOrdersEditionId, setSelectedOrdersEditionId] = useState<string | null>(null);
  const router = useRouter();

  // Lifecycle modifications states per order
  const [editableStates, setEditableStates] = useState<Record<string, {
    status: string;
    serial: string;
    shipmentDetails: string;
  }>>({});

  // Collection creation/editing states
  const [selectedEdition, setSelectedEdition] = useState<Edition | null>(null);
  const [editionForm, setEditionForm] = useState<{
    id: string;
    brand_id?: string;
    name: string;
    images: { url: string; tag: string; path?: string; file?: File }[];
    description: string;
    price_usd: number;
    has_variable_prices: boolean;
    prices_by_size: Record<string, number>;
    max_supply: number;
    fabric: string;
    headpiece: string;
    embroidery: string;
    is_active: boolean;
  }>({
    id: '',
    brand_id: '',
    name: '',
    images: [{ url: '/satin.png', tag: 'Front View' }],
    description: '',
    price_usd: 0.8,
    has_variable_prices: false,
    prices_by_size: {
      Small: 0.8,
      Medium: 0.8,
      Large: 0.8,
      'Extra Large': 0.8
    },
    max_supply: 40,
    fabric: 'Duchess satin',
    headpiece: 'Velvet',
    embroidery: 'Metallic thread',
    is_active: true
  });

  const [uploading, setUploading] = useState(false);
  const [showManualImageInput, setShowManualImageInput] = useState(false);
  const [isFormActive, setIsFormActive] = useState(false);
  const [deletedRemoteImages, setDeletedRemoteImages] = useState<string[]>([]);

  // ── Preorder Batch Management ──────────────────────────────────────────
  const { signTransaction } = useWallet();
  const [batchesByEdition, setBatchesByEdition] = useState<Record<string, backendApi.Batch[]>>({});
  const [isCreateBatchModalOpen, setIsCreateBatchModalOpen] = useState(false);
  const [batchForEditionId, setBatchForEditionId] = useState<string | null>(null);
  const [isCreatingBatch, setIsCreatingBatch] = useState(false);
  const [isInitializingBatch, setIsInitializingBatch] = useState<string | null>(null);

  const [batchForm, setBatchForm] = useState({
    name: '',
    opens_at: new Date().toISOString().slice(0, 16),
    closes_at: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
    production_starts_at: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 16),
    release_at: new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 16),
    pickup_name: 'Circuit Atelier HQ',
    pickup_address: '14 Victoria Island',
    pickup_city: 'Lagos',
    pickup_country: 'Nigeria',
    pickup_instructions: 'Show digital passport QR code at the desk.',
  });

  const fetchBatchesForEdition = async (editionId: string) => {
    try {
      const res = await backendApi.getMyBatches({ editionId });
      if (res?.batches) {
        setBatchesByEdition(prev => ({ ...prev, [editionId]: res.batches }));
      }
    } catch (e) {
      console.warn(`Could not load batches for edition ${editionId}:`, e);
    }
  };

  const handleOpenCreateBatch = (editionId: string) => {
    setBatchForEditionId(editionId);
    const now = Date.now();
    setBatchForm({
      name: `Batch ${(batchesByEdition[editionId]?.length || 0) + 1}`,
      opens_at: new Date(now + 15 * 60 * 1000).toISOString().slice(0, 16),
      closes_at: new Date(now + 7 * 86400000).toISOString().slice(0, 16),
      production_starts_at: new Date(now + 10 * 86400000).toISOString().slice(0, 16),
      release_at: new Date(now + 25 * 86400000).toISOString().slice(0, 16),
      pickup_name: 'Circuit Atelier HQ',
      pickup_address: '14 Victoria Island',
      pickup_city: 'Lagos',
      pickup_country: 'Nigeria',
      pickup_instructions: 'Show digital passport QR code at the concierge desk.',
    });
    setIsCreateBatchModalOpen(true);
  };

  const handleCreateBatch = async () => {
    if (!batchForEditionId) return;
    if (!batchForm.name.trim()) {
      showToast('Validation Error', 'Please enter a batch name.');
      return;
    }
    const opensMs = Date.parse(batchForm.opens_at);
    const closesMs = Date.parse(batchForm.closes_at);
    const prodMs = Date.parse(batchForm.production_starts_at);
    const relMs = Date.parse(batchForm.release_at);

    if (isNaN(opensMs) || isNaN(closesMs) || isNaN(prodMs) || isNaN(relMs)) {
      showToast('Validation Error', 'Please provide valid dates.');
      return;
    }
    if (opensMs <= Date.now()) {
      showToast('Validation Error', 'Batch opening date must be in the future.');
      return;
    }
    if (closesMs <= opensMs) {
      showToast('Validation Error', 'Closing date must be after opening date.');
      return;
    }
    // Production starts at must be >= closing date + 48 hours
    if (prodMs < closesMs + 48 * 3600000) {
      showToast('Validation Error', 'Production start must be at least 48 hours after batch closing.');
      return;
    }
    if (relMs <= prodMs) {
      showToast('Validation Error', 'Release date must be after production start.');
      return;
    }

    setIsCreatingBatch(true);
    try {
      const fullAddress = `${batchForm.pickup_address.trim() || '14 Victoria Island'}, ${batchForm.pickup_city.trim() || 'Lagos'}, ${batchForm.pickup_country.trim() || 'Nigeria'}`.slice(0, 1000);
      await backendApi.createBatchDraft({
        edition_id: batchForEditionId,
        name: batchForm.name.trim(),
        opens_at: new Date(opensMs).toISOString(),
        closes_at: new Date(closesMs).toISOString(),
        production_starts_at: new Date(prodMs).toISOString(),
        release_at: new Date(relMs).toISOString(),
        pickup_locations: [
          {
            name: batchForm.pickup_name.trim() || 'Circuit Atelier HQ',
            address: fullAddress,
            city: batchForm.pickup_city.trim() || 'Lagos',
            country: batchForm.pickup_country.trim() || 'Nigeria',
            instructions: batchForm.pickup_instructions.trim(),
          }
        ],
      });
      showToast('✓ Batch Created', `Batch "${batchForm.name}" draft created.`);
      setIsCreateBatchModalOpen(false);
      fetchBatchesForEdition(batchForEditionId);
    } catch (err: any) {
      console.error('Batch creation error:', err);
      showToast('✗ Error', err?.message || 'Failed to create batch.');
    } finally {
      setIsCreatingBatch(false);
    }
  };

  const handleInitializeBatch = async (b: backendApi.Batch) => {
    if (!signTransaction) {
      showToast('Wallet Required', 'Please connect your seller wallet to initialize the batch on Solana.');
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
      if (b.edition_id) fetchBatchesForEdition(b.edition_id);
    } catch (err: any) {
      console.error('Initialization error:', err);
      showToast('✗ Init Failed', err?.message || 'Failed to initialize batch on-chain.');
    } finally {
      setIsInitializingBatch(null);
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const BASE = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

      // 1. Fetch Brands for Drop creation
      try {
        const brandsRes = await backendApi.getMyBrands();
        if (brandsRes?.brands && Array.isArray(brandsRes.brands)) {
          setBrands(brandsRes.brands);
          if (brandsRes.brands.length > 0) {
            setSelectedBrandId(prev => prev || brandsRes.brands[0].id);
          }
        }
      } catch (brandErr) {
        console.warn('Could not fetch brands:', brandErr);
      }

      // 2. Fetch Orders (gracefully handle 410 retirement of legacy public route)
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
              shipmentDetails: o.shipment_details || ''
            };
          });
          setEditableStates(statesMap);
        } else {
          // If 410 USE_VERIFIED_CHAIN_ORDER_ROUTES, load local orders
          if (typeof window !== 'undefined') {
            const localOrders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
            setOrders(localOrders);
          }
        }
      } catch (orderErr) {
        console.warn('Orders endpoint notice:', orderErr);
        if (typeof window !== 'undefined') {
          const localOrders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
          setOrders(localOrders);
        }
      }

      // 3. Fetch Editions (Fetch managed drafts and active editions)
      const editionsList = await getEditions(false);
      setEditions(editionsList || []);

      // 4. Fetch Batches for each edition
      for (const ed of editionsList || []) {
        fetchBatchesForEdition(ed.id);
      }
    } catch (err) {
      console.error('Error querying dynamic dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const session = sessionStorage.getItem('circuit_admin_session');
    if (!session) {
      router.push('/admin/login');
      return;
    }
    setIsAuthorized(true);
    fetchData();
  }, [router, isSignedIn]);

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
          <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#444]">Authorizing Security Clearance</span>
        </div>
      </div>
    );
  }

  // Filter active orders based on selected edition for tab
  const activeOrdersForTab = selectedOrdersEditionId === null
    ? orders
    : selectedOrdersEditionId === 'all'
      ? orders
      : orders.filter(o => o.drop_id === selectedOrdersEditionId);

  // Calculate dynamic stats
  const totalRevenue = activeOrdersForTab.reduce((acc, o) => acc + Number(o.amount_usd || 0), 0);
  const stats = {
    totalRevenue,
    totalClaims: activeOrdersForTab.length,
    inProduction: activeOrdersForTab.filter(o => o.status === 'in_production').length,
    produced: activeOrdersForTab.filter(o => ['produced', 'shipped', 'delivered'].includes(o.status)).length,
    pending: activeOrdersForTab.filter(o => o.status === 'pending').length,
  };

  const filteredOrders = activeOrdersForTab.filter(o => 
    o.email.toLowerCase().includes(search.toLowerCase()) || 
    o.garment_serial?.toLowerCase().includes(search.toLowerCase()) ||
    o.drop_id.toLowerCase().includes(search.toLowerCase())
  );

  // Trigger Order Lifecycle & Shipment update
  const saveOrderLifecycle = async (orderId: string) => {
    const dataState = editableStates[orderId];
    if (!dataState) return;

    setProcessingId(orderId);
    try {
      // 1. If transitioning to production or produced, automatically generate serial if none exists
      let finalSerial = dataState.serial;
      if (!finalSerial && ['in_production', 'produced', 'shipped', 'delivered'].includes(dataState.status)) {
        const existingSerials = orders
          .map(o => parseInt(o.garment_serial || '0'))
          .filter(n => !isNaN(n));
        const nextNum = Math.max(0, ...existingSerials) + 1;
        finalSerial = String(nextNum).padStart(2, '0');
        
        setEditableStates(prev => ({
          ...prev,
          [orderId]: {
            ...prev[orderId],
            serial: finalSerial
          }
        }));
      }

      // 2. Call DB lifecycle state and shipment comments updates
      await updateOrderStatusLifecycle(orderId, dataState.status, finalSerial || undefined);
      await updateOrderShipmentDetails(orderId, dataState.shipmentDetails);

      showToast('✓ Update Complete', 'Order lifecycle credentials and logistic logs refreshed successfully.');
      fetchData();
    } catch (err) {
      console.error(err);
      showToast('✗ Error', 'Failed to update order lifecycle settings.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleEditionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSignedIn) {
      showToast('Wallet Required', 'Please connect your brand manager wallet first to authorize drop creation.');
      triggerConnect();
      return;
    }

    const rawSlug = editionForm.id.trim();
    const slugId = rawSlug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 32)
      .replace(/^-+|-+$/g, '');

    if (!slugId || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slugId)) {
      showToast('ID Required', 'Please specify a valid slug ID (lowercase alphanumeric words separated by single hyphens, max 32 chars).');
      return;
    }

    setUploading(true);
    try {

      if (selectedEdition) {
        // 1. Updating an existing draft edition
        await updateEditionDraft(slugId, {
          name: editionForm.name,
          description: editionForm.description,
          price_usd: Number(editionForm.price_usd),
          max_supply: Number(editionForm.max_supply),
          fabric: editionForm.fabric,
          headpiece: editionForm.headpiece,
          embroidery: editionForm.embroidery,
        });

        // 2. Delete removed remote images using path
        for (const path of deletedRemoteImages) {
          await deleteEditionImage(slugId, path);
        }

        // 3. Upload new images for this draft
        for (const img of editionForm.images) {
          if (img.file) {
            await uploadEditionImage(img.file, slugId, img.tag);
            URL.revokeObjectURL(img.url);
          }
        }
      } else {
        // 1. Creating a brand new draft edition
        const brandIdToUse = selectedBrandId || (brands[0]?.id ?? '');
        if (!brandIdToUse) {
          showToast('Brand Required', 'No managed brand found. Ensure your connected wallet is registered as a brand owner or editor.');
          return;
        }

        await saveEdition({
          id: slugId,
          brand_id: brandIdToUse,
          name: editionForm.name,
          description: editionForm.description,
          price_usd: Number(editionForm.price_usd),
          max_supply: Number(editionForm.max_supply),
          fabric: editionForm.fabric,
          headpiece: editionForm.headpiece,
          embroidery: editionForm.embroidery,
        });

        // 2. Upload images for newly created draft
        for (const img of editionForm.images) {
          if (img.file) {
            await uploadEditionImage(img.file, slugId, img.tag);
            URL.revokeObjectURL(img.url);
          }
        }
      }

      showToast('✓ Success', 'Drop collection synchronized perfectly.');
      fetchData();

      // Clear tracking states
      setDeletedRemoteImages([]);
      setSelectedEdition(null);
      setIsFormActive(false);
      setEditionForm({
        id: '', brand_id: '', name: '', images: [], description: '', price_usd: 0.8,
        has_variable_prices: false, prices_by_size: { Small: 0.8, Medium: 0.8, Large: 0.8, 'Extra Large': 0.8 },
        max_supply: 40, fabric: 'Duchess satin', headpiece: 'Velvet', embroidery: 'Metallic thread', is_active: true
      });
    } catch (err: any) {
      console.error(err);
      showToast('✗ Error', err?.message || 'Failed to synchronize drop collection.');
    } finally {
      setUploading(false);
    }
  };

  const editEdition = (ed: Edition) => {
    setSelectedEdition(ed);
    setIsFormActive(true);
    if (ed.brand_id) setSelectedBrandId(ed.brand_id);
    setEditionForm({
      id: ed.id,
      brand_id: ed.brand_id || '',
      name: ed.name,
      images: ed.images || [],
      description: ed.description,
      price_usd: ed.price_usd,
      has_variable_prices: ed.has_variable_prices ?? false,
      prices_by_size: ed.prices_by_size || { Small: 0.8, Medium: 0.8, Large: 0.8, 'Extra Large': 0.8 },
      max_supply: ed.max_supply,
      fabric: ed.fabric,
      headpiece: ed.headpiece,
      embroidery: ed.embroidery,
      is_active: ed.is_active
    });
  };

  const resetEditionForm = () => {
    // Revoke any pending object URLs to prevent memory leaks
    editionForm.images.forEach(img => {
      if (img.file) URL.revokeObjectURL(img.url);
    });

    setDeletedRemoteImages([]);
    setSelectedEdition(null);
    setIsFormActive(false);
    setEditionForm({
      id: '',
      brand_id: '',
      name: '',
      images: [],
      description: '',
      price_usd: 0.8,
      has_variable_prices: false,
      prices_by_size: { Small: 0.8, Medium: 0.8, Large: 0.8, 'Extra Large': 0.8 },
      max_supply: 40,
      fabric: 'Duchess satin',
      headpiece: 'Velvet',
      embroidery: 'Metallic thread',
      is_active: true
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (editionForm.images.length >= 10) {
      showToast('✗ Limit Reached', 'Maximum 10 images allowed per collection.');
      e.target.value = '';
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      showToast('✗ Invalid File', 'Please select a valid image (PNG, JPG, WEBP).');
      e.target.value = '';
      return;
    }

    // Validate file size (5MB Limit)
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      showToast('✗ File Too Large', 'Image size must be less than 5MB.');
      e.target.value = '';
      return;
    }

    // Deferred Upload: Create local blob URL for immediate preview
    const localUrl = URL.createObjectURL(file);
    
    setEditionForm(prev => ({ 
      ...prev, 
      images: [...prev.images, { url: localUrl, tag: 'View', file }] 
    }));
    
    e.target.value = ''; // Reset file input
  };

  const handleImageDelete = (index: number) => {
    const imageToDelete = editionForm.images[index];
    if (!imageToDelete) return;

    // If it's a pending local file, just revoke the URL to free memory
    if (imageToDelete.file) {
      URL.revokeObjectURL(imageToDelete.url);
    } else if (imageToDelete.path) {
      // If it's a remote file with a storage path, queue it for deletion on submit
      setDeletedRemoteImages(prev => [...prev, imageToDelete.path!]);
    }

    // Remove from state immediately
    setEditionForm(prev => ({ 
      ...prev, 
      images: prev.images.filter((_, i) => i !== index) 
    }));
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-white selection:text-black">
      <AdminNavbar />
      
      <main className="section-container pt-32 pb-20 print:p-0 print:pt-0">
        
        {/* Creator Studio Cross-Link Banner */}
        <div className="mb-8 p-4 rounded-2xl bg-gradient-to-r from-purple-950/40 via-neutral-900 to-black border border-purple-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-lg shrink-0">
              ✨
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white tracking-wide">Brand & Designer Studio</span>
                <span className="text-[0.6rem] font-mono uppercase px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-semibold">Dedicated Workspace</span>
              </div>
              <p className="text-xs text-white/60 mt-0.5">
                Designers and brands can use the dedicated Creator Studio to publish drops to Solana, view size cutting sheets, and claim milestone escrow payouts.
              </p>
            </div>
          </div>
          <Link
            href="/creator"
            className="shrink-0 px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 transition-all text-center self-start sm:self-auto"
          >
            Open Creator Studio &rarr;
          </Link>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-4 border-b border-white/10 pb-4 mb-10 print:hidden">
          <button 
            onClick={() => setActiveTab('orders')}
            className={`px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${
              activeTab === 'orders' ? 'bg-white text-black shadow-lg' : 'text-white/40 hover:text-white'
            }`}
          >
            Orders Gating Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('collections')}
            className={`px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${
              activeTab === 'collections' ? 'bg-white text-black shadow-lg' : 'text-white/40 hover:text-white'
            }`}
          >
            Manage Collections
          </button>
        </div>

        {/* Tab 1: Orders Lifecycle */}
        {activeTab === 'orders' && (
          <div>
            {/* Edition Selection Screen */}
            {selectedOrdersEditionId === null ? (
              <div>
                <header className="mb-12">
                  <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#666] mb-3 block font-mono">
                    Circuit — Identity Management
                  </span>
                  <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Active Drops Control Hub</h1>
                  <p className="text-[#666] mt-3 text-sm max-w-md leading-relaxed">
                    Select a drop collection below to manage status lifecycles, log waybills, and print digital-passport identity tags.
                  </p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Global Overview Card */}
                  <div 
                    onClick={() => setSelectedOrdersEditionId('all')}
                    className="card-glass p-6 flex flex-col justify-between min-h-[220px] border border-white/10 hover:border-white/40 cursor-pointer transition-all duration-300 hover:bg-white/[0.02] group"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-4">
                        <span className="text-[0.55rem] font-mono font-bold tracking-widest text-[#888] bg-white/5 border border-white/10 px-2 py-0.5 rounded uppercase">Global Overview</span>
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      </div>
                      <h3 className="text-xl font-bold text-white group-hover:text-white transition-colors">All Collection Runs</h3>
                      <p className="text-[#666] mt-2 text-xs leading-relaxed">
                        Access all orders, global logistics logs, and comprehensive platform statistics.
                      </p>
                    </div>

                    <div className="flex justify-between items-center text-[0.6rem] font-mono text-white/50 pt-4 border-t border-white/5">
                      <span>Total Claims: {orders.length}</span>
                      <span>Total Revenue: {orders.reduce((acc, o) => acc + Number(o.amount_usd || 0), 0).toFixed(2)} USD</span>
                    </div>
                  </div>

                  {/* Individual Editions */}
                  {editions.map((ed) => {
                    const edOrders = orders.filter(o => o.drop_id === ed.id);
                    const edRevenue = edOrders.reduce((acc, o) => acc + Number(o.amount_usd || 0), 0);
                    const edPending = edOrders.filter(o => o.status === 'pending').length;
                    const edInProduction = edOrders.filter(o => o.status === 'in_production').length;

                    return (
                      <div 
                        key={ed.id}
                        onClick={() => setSelectedOrdersEditionId(ed.id)}
                        className="card-glass p-6 flex flex-col justify-between min-h-[220px] border border-white/[0.06] hover:border-white/30 cursor-pointer transition-all duration-300 hover:bg-white/[0.02] group"
                      >
                        <div>
                          <div className="flex justify-between items-start gap-4 mb-4">
                            <span className="text-[0.55rem] font-mono text-white/40 block truncate max-w-[150px]">
                              Slug: {ed.id}
                            </span>
                            <span className={`text-[0.55rem] font-mono px-2 py-0.5 rounded font-bold uppercase ${
                              ed.is_active 
                                ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' 
                                : 'text-white/30 bg-white/5 border border-white/5'
                            }`}>
                              {ed.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>

                          <div className="flex gap-4">
                            <div className="w-12 h-16 rounded-lg border border-white/10 relative overflow-hidden shrink-0">
                              <Image src={ed.images?.[0]?.url || '/satin.png'} alt={ed.name} fill className="object-cover" />
                            </div>
                            <div className="min-w-0">
                              <h3 className="text-lg font-bold text-white group-hover:text-white transition-colors truncate">
                                {ed.name}
                              </h3>
                              <p className="text-[0.65rem] text-[#666] font-mono mt-1">
                                Max Supply: {ed.max_supply} Units
                              </p>
                              <p className="text-[0.65rem] text-emerald-400 font-mono mt-0.5">
                                Base:  USD
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-between items-center text-[0.6rem] font-mono text-white/50 pt-4 border-t border-white/5">
                          <span>Orders: {edOrders.length}</span>
                          <span className="text-[#888]">
                            Awaiting: {edPending} | In Prod: {edInProduction}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div>
                {/* Active Selection Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-12 pb-6 border-b border-white/10 print:hidden">
                  <div className="flex items-center gap-6">
                    {selectedOrdersEditionId !== 'all' ? (
                      <>
                        {(() => {
                          const ed = editions.find(e => e.id === selectedOrdersEditionId);
                          return (
                            <>
                              <div className="w-16 h-20 rounded-xl border border-white/10 relative overflow-hidden shrink-0">
                                <Image src={ed?.images?.[0]?.url || '/satin.png'} alt={ed?.name || ''} fill className="object-cover" />
                              </div>
                              <div>
                                <div className="flex items-center gap-3 mb-1">
                                  <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#666] font-mono">
                                    Circuit — Gated Controls
                                  </span>
                                  <span className={`text-[0.55rem] font-mono px-2 py-0.2 rounded uppercase ${
                                    ed?.is_active 
                                      ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' 
                                      : 'text-white/30 bg-white/5 border border-white/5'
                                  }`}>
                                    {ed?.is_active ? 'Active' : 'Inactive'}
                                  </span>
                                </div>
                                <h1 className="text-3xl font-bold tracking-tight">{ed?.name || 'Drop Collection'}</h1>
                                <p className="text-[#666] mt-1.5 text-xs font-mono">
                                  Slug: {selectedOrdersEditionId} | Supply: {ed?.max_supply} Cap | Fabric: {ed?.fabric}
                                </p>
                              </div>
                            </>
                          );
                        })()}
                      </>
                    ) : (
                      <div>
                        <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#666] mb-1 block font-mono">
                          Circuit — Identity Management
                        </span>
                        <h1 className="text-3xl font-bold tracking-tight">All Collection Runs</h1>
                        <p className="text-[#666] mt-1.5 text-xs font-mono">
                          Combined overview of active database order registries.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
                    <div className="relative group w-full sm:w-64">
                      <input 
                        type="text"
                        placeholder="Search email, serial..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-white/[0.03] border border-white/10 px-5 py-2.5 rounded-full text-xs focus:outline-none focus:border-white/30 transition-all placeholder:text-[#333]"
                      />
                    </div>
                    
                    <button 
                      onClick={() => {
                        setSelectedOrdersEditionId(null);
                        setSearch('');
                      }}
                      className="px-5 py-2.5 rounded-full border border-white/10 hover:border-white text-xs font-bold uppercase tracking-wider transition-all text-white/60 hover:text-white"
                    >
                      ← Select Another Drop
                    </button>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-12 print:hidden">
                  {[
                    { label: 'Total Revenue', value: `${stats.totalRevenue.toFixed(2)} USD`, color: 'text-white' },
                    { label: 'Total Claims', value: `${stats.totalClaims} Runs`, color: 'text-white' },
                    { label: 'Awaiting Tailor', value: stats.pending, color: 'text-amber-500' },
                    { label: 'In Production', value: stats.inProduction, color: 'text-blue-500' },
                    { label: 'Produced / Minted', value: stats.produced, color: 'text-emerald-500' },
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
                    <p className="text-[#444] font-medium">No matching orders found in active database.</p>
                  </div>
                ) : (
                  <div className="grid gap-6 print:hidden">
                    {filteredOrders.map((order) => {
                      const stateVal = editableStates[order.id] || { status: 'pending', serial: '', shipmentDetails: '' };
                      const isMinted = ['produced', 'shipped', 'delivered'].includes(stateVal.status);

                      return (
                        <div key={order.id} className="card-glass p-6 md:p-8 flex flex-col gap-6 border-white/[0.06] hover:border-white/10">
                          {/* Top Summary */}
                          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-4 border-b border-white/5">
                            <div>
                              <div className="flex items-center gap-3 mb-1">
                                <span className="text-xs font-mono text-[#555]">Order Reference: #{order.id.slice(0, 12)}</span>
                                <span className="text-xs font-mono text-white/40 bg-white/5 px-2 py-0.5 rounded uppercase">{order.drop_id}</span>
                                {order.garment_serial && (
                                  <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded uppercase font-semibold">
                                    Serial: {formatSerialNumber(order.garment_serial, editions.find(e => e.id === order.drop_id)?.max_supply)}
                                  </span>
                                )}
                              </div>
                              <h3 className="text-lg font-bold text-white">{order.email}</h3>
                            </div>
                            <div className="text-right">
                              <span className="block text-[0.6rem] text-[#444] uppercase font-mono">Amount Paid</span>
                              <span className="text-md font-bold text-white">${order.amount_usd} USD | Size: {order.size || 'M'}</span>
                            </div>
                          </div>

                          {/* Interactive Configuration Layout */}
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            
                            {/* Column 1: Status Dropdown & Serial */}
                            <div className="space-y-4">
                              <div className="flex flex-col gap-2">
                                <label className="text-[0.65rem] text-[#666] uppercase tracking-wider font-bold">Lifecycle Status</label>
                                <select
                                  value={stateVal.status}
                                  onChange={(e) => setEditableStates(prev => ({
                                    ...prev,
                                    [order.id]: { ...stateVal, status: e.target.value }
                                  }))}
                                  className="w-full bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30 font-mono"
                                >
                                  <option value="pending">Pending (Escrow Locked)</option>
                                  <option value="in_production">In Production</option>
                                  <option value="produced">Produced (Generates Passport Mint)</option>
                                  <option value="shipped">Shipped</option>
                                  <option value="delivered">Delivered</option>
                                  <option value="cancelled">Cancelled</option>
                                </select>
                              </div>

                              <div className="flex flex-col gap-2">
                                <label className="text-[0.65rem] text-[#666] uppercase tracking-wider font-bold">Garment Serial</label>
                                <input
                                  type="text"
                                  value={stateVal.serial}
                                  onChange={(e) => setEditableStates(prev => ({
                                    ...prev,
                                    [order.id]: { ...stateVal, serial: e.target.value }
                                  }))}
                                  placeholder="Auto-assigned if left blank"
                                  className="w-full bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30 font-mono"
                                />
                              </div>
                            </div>

                            {/* Column 2: Logistics shipment Notes */}
                            <div className="flex flex-col gap-2">
                              <label className="text-[0.65rem] text-[#666] uppercase tracking-wider font-bold">Shipment Logistics Details</label>
                              <textarea
                                value={stateVal.shipmentDetails}
                                onChange={(e) => setEditableStates(prev => ({
                                  ...prev,
                                  [order.id]: { ...stateVal, shipmentDetails: e.target.value }
                                }))}
                                placeholder="Courier waybill notes, tracking details, delivery comments..."
                                className="w-full h-full min-h-[100px] bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30 resize-none"
                              />
                            </div>

                            {/* Column 3: Prints & Actions */}
                            <div className="flex flex-col justify-between items-end min-h-[120px]">
                              <div className="w-full flex gap-3">
                                <a
                                  href={solscanTxUrl(order.tx_signature)}
                                  target="_blank"
                                  rel="noopener"
                                  className="btn-outline-circuit py-2.5 px-4 text-[0.65rem] text-center flex-1 font-mono uppercase"
                                >
                                  Registry Proof
                                </a>
                                
                                {/* Printable gated strictly to Produced status or higher */}
                                <button
                                  disabled={!isMinted}
                                  onClick={() => setSelectedQR(order)}
                                  className={`p-2.5 border rounded-full flex items-center justify-center shrink-0 transition-all ${
                                    isMinted 
                                      ? 'border-white/20 hover:bg-white/5 text-white cursor-pointer' 
                                      : 'border-white/5 text-white/10 cursor-not-allowed'
                                  }`}
                                  title={isMinted ? 'Generate Physical Identity QR Tag' : 'Printing locked (Garment must be Produced first)'}
                                >
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M7 7h.01M17 7h.01M17 17h.01M7 17h.01"/>
                                  </svg>
                                </button>
                              </div>

                              <button
                                onClick={() => saveOrderLifecycle(order.id)}
                                disabled={processingId === order.id}
                                className="btn-circuit w-full py-3.5 text-[0.7rem] justify-center mt-4"
                              >
                                <span>{processingId === order.id ? 'Saving Changes...' : 'Update Order Lifecycle'}</span>
                              </button>
                            </div>
                          </div>

                          {/* Display delivery details if loaded */}
                          {order.delivery_location && (
                            <div className="mt-2 p-4 rounded-xl bg-amber-500/[0.02] border border-amber-500/10 text-xs flex flex-col gap-1">
                              <span className="font-bold text-amber-500 uppercase tracking-widest text-[0.55rem]">Preferred Drop Destination</span>
                              <span className="text-[#A3A3A3]">Location: {order.delivery_location} | Address: {order.delivery_address}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Collections Manager */}
        {activeTab === 'collections' && (
          <div>
            <header className="mb-8">
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#666] mb-3 block font-mono">
                Circuit — Collection Architect
              </span>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Drop Collections Manager</h1>
              <p className="text-[#666] mt-3 text-sm max-w-md leading-relaxed">
                Add multiple editions dynamically, enable size variable prices overrides, toggle storefront visibility, and configure spec fields.
              </p>
            </header>

            {!isSignedIn && (
              <div className="mb-10 p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold text-amber-200 uppercase tracking-wider font-mono">
                      Seller Wallet Required for Brand Drops
                    </h4>
                    <p className="text-[0.65rem] text-amber-400/80 font-mono mt-0.5">
                      Connect your brand owner or editor wallet to load managed brand collections and authorize drop draft creation.
                    </p>
                  </div>
                </div>
                <button
                  onClick={triggerConnect}
                  disabled={isAuthenticating}
                  className="px-4 py-2 rounded-full bg-white text-black text-xs font-bold uppercase tracking-wider hover:bg-white/90 transition-all shrink-0"
                >
                  {isAuthenticating ? 'Connecting...' : 'Connect Wallet'}
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
              {/* Left Column: Form Editor */}
              <div className="lg:col-span-5 card-glass p-8 border-white/10 order-2 lg:order-1">
                {!isFormActive ? (
                  <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center opacity-40 border border-dashed border-white/10 rounded-2xl p-8">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-4 text-white/50">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    <h3 className="text-sm font-bold uppercase tracking-wider mb-2">Editor Locked</h3>
                    <p className="text-[0.65rem] text-[#888] font-mono leading-relaxed max-w-[200px]">
                      Select an existing collection from the directory to edit, or initialize a new drop specification to unlock the editor.
                    </p>
                  </div>
                ) : (
                <form onSubmit={handleEditionSubmit} className="space-y-6">
                  <div>
                    <div className="flex justify-between items-baseline mb-2">
                      <h3 className="text-xl font-bold">
                        {selectedEdition ? 'Modify Drop specs' : 'Architect Drop specs'}
                      </h3>
                      {selectedEdition && (
                        <button 
                          type="button" 
                          onClick={resetEditionForm} 
                          className="text-[0.65rem] text-white/40 hover:text-white transition-all uppercase tracking-wider font-mono font-bold"
                        >
                          Cancel / Reset
                        </button>
                      )}
                    </div>
                    {selectedEdition ? (
                      <p className="text-[0.6rem] text-amber-500/80 font-medium tracking-wide uppercase mt-1 mb-6 leading-relaxed font-mono">
                        ⚠️ Slug ID "{selectedEdition.id}" is immutable to protect active order databases.
                      </p>
                    ) : (
                      <p className="text-[0.6rem] text-[#666] tracking-wide uppercase mt-1 mb-6 leading-relaxed font-mono">
                        Register a new physical/digital garment run to Supabase.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] text-[#666] uppercase tracking-wider font-bold">Brand / Label</label>
                    {brands.length > 0 ? (
                      <select
                        value={selectedBrandId}
                        disabled={!!selectedEdition}
                        onChange={(e) => setSelectedBrandId(e.target.value)}
                        className="w-full bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30 font-mono disabled:opacity-50"
                      >
                        {brands.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.slug}) — {b.role}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-[0.65rem] text-amber-400/80 font-mono bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl">
                        No managed brands found. Verify wallet login with brand ownership.
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] text-[#666] uppercase tracking-wider font-bold">Unique Slug ID</label>
                    <input
                      type="text"
                      value={editionForm.id}
                      disabled={!!selectedEdition}
                      onChange={(e) => setEditionForm(prev => ({ ...prev, id: e.target.value }))}
                      placeholder="e.g. drop-one"
                      className="w-full bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed font-mono"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] text-[#666] uppercase tracking-wider font-bold">Edition Name</label>
                    <input
                      type="text"
                      value={editionForm.name}
                      onChange={(e) => setEditionForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g. Circuit Demo — Yellow Gown"
                      className="w-full bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] text-[#666] uppercase tracking-wider font-bold">Apparel Images (Max 10)</label>
                    
                    <div className="grid grid-cols-2 gap-4">
                      {editionForm.images.map((img, idx) => (
                        <div key={idx} className="relative w-full h-40 bg-[#0D0D0D] border border-white/10 rounded-xl overflow-hidden group flex flex-col">
                          <div className="relative flex-1">
                            <Image
                              src={img.url}
                              alt={`Apparel Preview ${idx + 1}`}
                              fill
                              className="object-cover opacity-80"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                            
                            {/* Overlay delete button */}
                            <button
                              type="button"
                              onClick={() => handleImageDelete(idx)}
                              className="absolute top-2 right-2 bg-red-500/80 hover:bg-red-600 text-white rounded-lg p-1.5 transition-all hover:scale-105 shadow-xl flex items-center justify-center gap-1.5 text-[0.55rem] font-bold uppercase tracking-wider font-mono z-10"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6m4-6v6"/>
                              </svg>
                            </button>
                            
                            {/* Custom Tag Input overlaying the bottom of the image */}
                            <div className="absolute bottom-2 left-2 right-2 z-10">
                              <input
                                type="text"
                                value={img.tag}
                                onChange={(e) => {
                                  const newImages = [...editionForm.images];
                                  newImages[idx].tag = e.target.value;
                                  setEditionForm(prev => ({ ...prev, images: newImages }));
                                }}
                                placeholder="e.g. Front View"
                                className="w-full bg-black/60 backdrop-blur-md border border-white/20 rounded-lg px-2 py-1.5 text-[0.65rem] text-white focus:outline-none focus:border-white/50 font-mono transition-all"
                              />
                            </div>
                          </div>
                        </div>
                      ))}

                      {editionForm.images.length < 10 && (
                        <div className="relative w-full h-40 border-2 border-dashed border-white/10 hover:border-white/20 hover:bg-white/[0.01] bg-[#0D0D0D] rounded-xl p-4 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group">
                          {uploading ? (
                            <div className="flex flex-col items-center justify-center gap-3">
                              <div className="w-6 h-6 border-2 border-white/10 border-t-white rounded-full animate-spin" />
                              <span className="text-[0.6rem] font-mono text-[#555]">Processing...</span>
                            </div>
                          ) : (
                            <>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={handleImageUpload}
                                className="absolute inset-0 opacity-0 cursor-pointer z-10"
                              />
                              <div className="w-8 h-8 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-center group-hover:scale-105 duration-300">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/40 group-hover:text-white/70 transition-colors">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                                </svg>
                              </div>
                              <span className="text-[0.65rem] font-bold text-white/70 group-hover:text-white transition-colors">Add Image</span>
                              <span className="text-[0.55rem] text-[#444] uppercase tracking-wider font-mono">Max 5MB</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Toggle link for manual typing fallback */}
                    <div className="flex justify-end mt-1">
                      <button
                        type="button"
                        onClick={() => setShowManualImageInput(!showManualImageInput)}
                        className="text-[0.6rem] text-[#555] hover:text-[#888] font-mono transition-colors"
                      >
                        {showManualImageInput ? '← Hide Manual URL Input' : 'Toggle Manual URL Input ➔'}
                      </button>
                    </div>

                    {showManualImageInput && editionForm.images.length < 4 && (
                      <div className="mt-2 animate-fade-in flex gap-2">
                        <input
                          type="text"
                          placeholder="e.g. /satin.png or absolute URL"
                          id="manual-url-input"
                          className="flex-1 bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const input = document.getElementById('manual-url-input') as HTMLInputElement;
                            if (input && input.value) {
                              setEditionForm(prev => ({ 
                                ...prev, 
                                images: [...prev.images, { url: input.value, tag: 'View' }] 
                              }));
                              input.value = '';
                            }
                          }}
                          className="bg-white text-black px-4 rounded-xl text-xs font-bold uppercase"
                        >
                          Add
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] text-[#666] uppercase tracking-wider font-bold">Description</label>
                    <textarea
                      value={editionForm.description}
                      onChange={(e) => setEditionForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Garment collection concept outline..."
                      className="w-full h-24 bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30 resize-none text-[#888]"
                    />
                  </div>

                  {/* Fabrics specifications */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="flex flex-col gap-2">
                      <label className="text-[0.55rem] text-[#666] uppercase font-bold">Main Fabric</label>
                      <input
                        type="text"
                        value={editionForm.fabric}
                        onChange={(e) => setEditionForm(prev => ({ ...prev, fabric: e.target.value }))}
                        className="w-full bg-[#0D0D0D] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-white/30"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[0.55rem] text-[#666] uppercase font-bold">Headpiece</label>
                      <input
                        type="text"
                        value={editionForm.headpiece}
                        onChange={(e) => setEditionForm(prev => ({ ...prev, headpiece: e.target.value }))}
                        className="w-full bg-[#0D0D0D] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-white/30"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[0.55rem] text-[#666] uppercase font-bold">Embroidery</label>
                      <input
                        type="text"
                        value={editionForm.embroidery}
                        onChange={(e) => setEditionForm(prev => ({ ...prev, embroidery: e.target.value }))}
                        className="w-full bg-[#0D0D0D] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-white/30"
                      />
                    </div>
                  </div>

                  {/* Quantity & Base Price */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                      <label className="text-[0.65rem] text-[#666] uppercase tracking-wider font-bold">Max Supply</label>
                      <input
                        type="number"
                        value={editionForm.max_supply}
                        onChange={(e) => setEditionForm(prev => ({ ...prev, max_supply: Number(e.target.value) }))}
                        className="w-full bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30 font-mono"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[0.65rem] text-[#666] uppercase tracking-wider font-bold">Base Price (USD)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editionForm.price_usd}
                        onChange={(e) => setEditionForm(prev => ({ ...prev, price_usd: Number(e.target.value) }))}
                        className="w-full bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30 font-mono"
                      />
                    </div>
                  </div>

                  {/* Storefront Publishing Status Info */}
                  <div className="py-3 px-4 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[0.65rem] text-[#888] font-bold uppercase tracking-wider font-mono">Storefront Status</span>
                      <span className={`text-[0.6rem] font-bold uppercase font-mono px-2 py-0.5 rounded ${
                        selectedEdition?.published
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}>
                        {selectedEdition?.published ? '● Live on Storefront' : '○ Draft (not live yet)'}
                      </span>
                    </div>
                    <p className="text-[0.65rem] text-[#666] leading-relaxed">
                      {selectedEdition?.published
                        ? 'This collection is published and visible on the public storefront catalog.'
                        : 'Storefront visibility is gated by on-chain escrow. To publish, create a preorder batch with future dates and click "Init on Solana" in the directory.'}
                    </p>
                    {selectedEdition && (
                      <div className="pt-1 border-t border-white/5 flex items-center justify-between">
                        <a
                          href={`/drop?edition=${encodeURIComponent(selectedEdition.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[0.65rem] font-bold text-white/90 hover:text-white font-mono flex items-center gap-1.5 hover:underline"
                        >
                          <span>Preview on Storefront</span>
                          <span>↗</span>
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Toggle size pricing */}
                  <div className="flex items-center gap-3 py-2 border-b border-white/5">
                    <input
                      type="checkbox"
                      id="has_variable_prices"
                      checked={editionForm.has_variable_prices}
                      onChange={(e) => setEditionForm(prev => ({ ...prev, has_variable_prices: e.target.checked }))}
                      className="w-4 h-4 accent-white cursor-pointer bg-black border border-white/15 rounded focus:ring-0 focus:ring-offset-0"
                    />
                    <label htmlFor="has_variable_prices" className="text-xs text-[#A3A3A3] font-bold select-none cursor-pointer">
                      Enable size-based variable prices override
                    </label>
                  </div>

                  {/* Pricing Matrix per size */}
                  {editionForm.has_variable_prices && (
                    <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 gap-4 grid grid-cols-2">
                      {['Small', 'Medium', 'Large', 'Extra Large'].map((sz) => (
                        <div key={sz} className="flex flex-col gap-1">
                          <span className="text-[0.55rem] font-bold text-[#666] uppercase font-mono">{sz}</span>
                          <input
                            type="number"
                            step="0.01"
                            value={(editionForm.prices_by_size as any)[sz] || editionForm.price_usd}
                            onChange={(e) => setEditionForm(prev => ({
                              ...prev,
                              prices_by_size: {
                                ...prev.prices_by_size,
                                [sz]: Number(e.target.value)
                              }
                            }))}
                            className="bg-[#0D0D0D] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-white/30 font-mono"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Submit Button */}
                  <button type="submit" className="btn-circuit w-full justify-center py-4 text-xs font-bold uppercase tracking-wider">
                    <span>{selectedEdition ? 'Sync Drop Collection' : 'Architect Drop Collection'}</span>
                  </button>
                </form>
                )}
              </div>

              {/* Right Column: Grid List of collections */}
              <div className="lg:col-span-7 space-y-6 order-1 lg:order-2">
                <span className="text-[0.65rem] font-bold uppercase tracking-widest text-[#666] block font-mono">
                  Collections Directory ({editions.length})
                </span>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Dashed "+ Architect New Drop" Card */}
                  <div 
                    onClick={() => {
                      resetEditionForm();
                      setIsFormActive(true);
                    }}
                    className={`card-glass p-5 flex flex-col justify-center items-center gap-3 overflow-hidden border border-dashed cursor-pointer hover:bg-white/[0.02] transition-all duration-300 min-h-[160px] group ${
                      !selectedEdition 
                        ? 'border-white bg-white/[0.04]' 
                        : 'border-white/20 hover:border-white/40'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center text-lg font-bold text-white/40 group-hover:text-white group-hover:border-white/40 transition-colors">
                      +
                    </div>
                    <div className="text-center">
                      <h4 className="font-bold text-white text-sm">Architect New Drop</h4>
                      <span className="text-[0.6rem] font-mono text-white/40 block mt-1">Configure & launch a new collection</span>
                    </div>
                  </div>

                  {editions.map((ed) => {
                    const editionBatches = batchesByEdition[ed.id] || [];
                    return (
                      <div 
                        key={ed.id} 
                        onClick={() => editEdition(ed)}
                        className={`card-glass p-5 flex flex-col justify-between gap-4 overflow-hidden border cursor-pointer hover:border-white/30 hover:bg-white/[0.02] transition-all duration-300 ${
                          selectedEdition?.id === ed.id ? 'border-white bg-white/[0.04]' : 'border-white/[0.06]'
                        }`}
                      >
                        <div className="flex gap-4">
                          <div className="w-16 h-20 rounded-xl border border-white/10 relative overflow-hidden shrink-0">
                            <Image src={ed.images?.[0]?.url || '/satin.png'} alt={ed.name} fill className="object-cover" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="font-bold text-white truncate text-md">{ed.name}</h4>
                              <span className={`text-[0.55rem] font-mono px-2 py-0.5 rounded font-bold uppercase shrink-0 ${
                                ed.published 
                                  ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' 
                                  : 'text-amber-400/90 bg-amber-500/10 border border-amber-500/20'
                              }`}>
                                {ed.published ? 'Live' : 'Draft'}
                              </span>
                            </div>
                            <span className="text-[0.6rem] font-mono text-white/40 block mt-0.5">Slug ID: {ed.id}</span>
                            <span className="text-xs text-emerald-400 font-bold block mt-2 font-mono">
                              {ed.has_variable_prices ? 'Variable Sizing' : `${ed.price_usd} USD`}
                            </span>
                          </div>
                        </div>

                        {/* Batches Preview */}
                        <div className="space-y-2 pt-2 border-t border-white/5">
                          <div className="flex items-center justify-between">
                            <span className="text-[0.6rem] font-bold uppercase tracking-wider text-[#888] font-mono">
                              Preorder Batches ({editionBatches.length})
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenCreateBatch(ed.id);
                              }}
                              className="text-[0.6rem] font-bold text-emerald-400 hover:text-emerald-300 uppercase font-mono px-2 py-0.5 rounded border border-emerald-500/20 hover:border-emerald-500/40"
                            >
                              + New Batch
                            </button>
                          </div>

                          {editionBatches.length > 0 ? (
                            <div className="space-y-1.5 max-h-36 overflow-y-auto no-scrollbar">
                              {editionBatches.map((b) => (
                                <div key={b.id} className="p-2 rounded-xl bg-white/[0.02] border border-white/5 text-[0.6rem] font-mono flex items-center justify-between">
                                  <div className="truncate mr-2">
                                    <span className="text-white font-semibold block truncate">{b.name}</span>
                                    <span className="text-[#666] block">
                                      Closes: {new Date(b.closes_at).toLocaleDateString()}
                                    </span>
                                  </div>
                                  <div className="shrink-0 flex items-center gap-2">
                                    {b.chain_status === 'initialized' ? (
                                      <span className="px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                        Live on Chain
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleInitializeBatch(b);
                                        }}
                                        disabled={isInitializingBatch === b.id}
                                        className="px-2 py-0.5 rounded text-[0.55rem] font-bold uppercase bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 transition-colors"
                                      >
                                        {isInitializingBatch === b.id ? 'Initializing...' : 'Init on Solana'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[0.6rem] text-[#555] font-mono italic block">
                              No batches yet. Create a batch to open preorders.
                            </span>
                          )}
                        </div>

                        <div className="flex justify-between items-center text-[0.6rem] text-[#666] pt-3 border-t border-white/5 font-mono">
                          <span className="text-[#555]">
                            {ed.max_supply} Units Cap
                          </span>
                          <a
                            href={`/drop?edition=${encodeURIComponent(ed.id)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-white hover:text-white/80 font-bold uppercase tracking-wider hover:underline transition-colors"
                          >
                            View Storefront ➔
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CREATE PREORDER BATCH MODAL */}
        {isCreateBatchModalOpen && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="card-glass p-6 md:p-8 border border-white/10 rounded-3xl max-w-lg w-full flex flex-col gap-5 max-h-[90vh] overflow-y-auto no-scrollbar">
              <div className="flex justify-between items-center pb-3 border-b border-white/10">
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider">Create Preorder Batch</h3>
                  <span className="text-[0.65rem] text-[#777] font-mono">For Edition: {batchForEditionId}</span>
                </div>
                <button onClick={() => setIsCreateBatchModalOpen(false)} className="text-[#666] hover:text-white text-lg">✕</button>
              </div>

              <div className="space-y-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.65rem] text-[#777] uppercase font-bold tracking-wider">Batch Name</label>
                  <input
                    type="text"
                    value={batchForm.name}
                    onChange={(e) => setBatchForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Batch 01 — October Run"
                    className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-white/30"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[0.6rem] text-[#777] uppercase font-bold">Opens At</label>
                    <input
                      type="datetime-local"
                      value={batchForm.opens_at}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, opens_at: e.target.value }))}
                      className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-white/30 font-mono"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[0.6rem] text-[#777] uppercase font-bold">Closes At</label>
                    <input
                      type="datetime-local"
                      value={batchForm.closes_at}
                      onChange={(e) => {
                        const newClose = e.target.value;
                        const closeMs = Date.parse(newClose);
                        setBatchForm(prev => ({
                          ...prev,
                          closes_at: newClose,
                          production_starts_at: !isNaN(closeMs) ? new Date(closeMs + 48 * 3600000).toISOString().slice(0, 16) : prev.production_starts_at,
                        }));
                      }}
                      className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-white/30 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[0.6rem] text-[#777] uppercase font-bold">
                      Production Start (≥ Close + 48h)
                    </label>
                    <input
                      type="datetime-local"
                      value={batchForm.production_starts_at}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, production_starts_at: e.target.value }))}
                      className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-white/30 font-mono"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[0.6rem] text-[#777] uppercase font-bold">Release / Pickup Date</label>
                    <input
                      type="datetime-local"
                      value={batchForm.release_at}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, release_at: e.target.value }))}
                      className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-white/30 font-mono"
                    />
                  </div>
                </div>

                {/* Pickup Location fields */}
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <span className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888]">Primary Pickup Station</span>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Station Name (e.g. Atelier HQ)"
                      value={batchForm.pickup_name}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, pickup_name: e.target.value }))}
                      className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-white/30"
                    />
                    <input
                      type="text"
                      placeholder="Address"
                      value={batchForm.pickup_address}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, pickup_address: e.target.value }))}
                      className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-white/30"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="City (e.g. Lagos)"
                      value={batchForm.pickup_city}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, pickup_city: e.target.value }))}
                      className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-white/30"
                    />
                    <input
                      type="text"
                      placeholder="Country (e.g. Nigeria)"
                      value={batchForm.pickup_country}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, pickup_country: e.target.value }))}
                      className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-white/30"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Pickup instructions for buyers..."
                    value={batchForm.pickup_instructions}
                    onChange={(e) => setBatchForm(prev => ({ ...prev, pickup_instructions: e.target.value }))}
                    className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-white/30 text-[#888]"
                  />
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsCreateBatchModalOpen(false)}
                  className="btn-outline-circuit py-2.5 px-5 text-xs border-white/10 text-[#888]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateBatch}
                  disabled={isCreatingBatch}
                  className="btn-circuit py-2.5 px-6 text-xs font-bold uppercase tracking-wider"
                >
                  <span>{isCreatingBatch ? 'Creating Draft...' : 'Create Batch Draft'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PRINT QR CODE SHIELD MODAL */}
        {selectedQR && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 md:p-6 print:p-0 print:static print:inset-auto">
            <div className="absolute inset-0 bg-black/95 backdrop-blur-xl print:hidden" onClick={() => setSelectedQR(null)} />
            
            <div className="relative w-full max-w-md md:max-w-lg card-glass p-6 md:p-10 flex flex-col items-center animate-scale-in print:shadow-none print:border-none print:bg-white print:text-black print:p-0 border-white/20 max-h-[90vh] overflow-y-auto no-scrollbar">
              <div className="print:hidden w-full flex justify-between items-center mb-8 text-[#666]">
                <div className="flex flex-col">
                  <span className="text-[0.6rem] font-bold tracking-[0.3em] uppercase text-white/80">Physical Identity Tag</span>
                  <span className="text-[0.5rem] font-medium tracking-[0.1em] uppercase mt-1">Ready for Print</span>
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
                    value={`${window.location.origin}/passport?order=${selectedQR.id}`}
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
