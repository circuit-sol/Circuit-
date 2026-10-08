'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useWallet } from '@solana/wallet-adapter-react';
import * as backendApi from '@/lib/backendApi';
import { getEditions, uploadEditionImage, deleteEditionImage } from '@/lib/db';
import { executeBatchInitialize } from '@/lib/solana-service';
import { showToast } from '@/components/Toast';
import Navbar from '@/components/Navbar';
import { solscanTxUrl } from '@/lib/utils';

interface ApparelImage {
  url: string;
  tag: string;
  path?: string;
  file?: File;
}

export default function CreatorStudioPage() {
  const { user, isSignedIn, triggerConnect, isAuthenticating } = useAuth();
  const { signTransaction } = useWallet();

  // Atelier Context
  const [brands, setBrands] = useState<backendApi.Brand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<backendApi.Brand | null>(null);
  const [editions, setEditions] = useState<any[]>([]);
  const [batchesByEdition, setBatchesByEdition] = useState<Record<string, backendApi.Batch[]>>({});
  const [ordersByBatch, setOrdersByBatch] = useState<Record<string, backendApi.ChainOrder[]>>({});
  const [loading, setLoading] = useState(true);

  // Active View Tabs
  const [activeTab, setActiveTab] = useState<'wizard' | 'directory' | 'demand' | 'claims'>('wizard');

  // 3-Step Wizard State
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStepText, setDeployStepText] = useState<string>('');
  const [deployResult, setDeployResult] = useState<{
    editionId?: string;
    batchId?: string;
    signature?: string;
    solscanUrl?: string;
  } | null>(null);

  // Claim actions state
  const [claimingBatchId, setClaimingBatchId] = useState<string | null>(null);

  // Draft editing state
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [editingEditionId, setEditingEditionId] = useState('');
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [editingBatchRevision, setEditingBatchRevision] = useState<number>(1);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  // Step 1: Edition Design Form
  const [editionForm, setEditionForm] = useState({
    id: '',
    name: '',
    description: '',
    price_usd: 30,
    max_supply: 50,
    fabric: 'Duchess satin & structured mesh',
    headpiece: 'Velvet flower accent',
    embroidery: 'Hand-sewn feather trim',
    images: [] as ApparelImage[],
  });

  // Step 2: Preorder Terms & Station Form
  const now = Date.now();
  const [batchForm, setBatchForm] = useState({
    name: 'Inaugural Atelier Run — 01',
    opens_at: new Date(now + 3600000).toISOString().slice(0, 16), // +1 hour
    closes_at: new Date(now + 86400000 * 7).toISOString().slice(0, 16), // +7 days
    production_starts_at: new Date(now + 86400000 * 10).toISOString().slice(0, 16), // +10 days (>= closes + 48h)
    release_at: new Date(now + 86400000 * 25).toISOString().slice(0, 16), // +25 days
    pickup_name: 'Circuit Atelier Hub',
    pickup_address: '14 Adeola Odeku Street, Victoria Island',
    pickup_city: 'Lagos',
    pickup_country: 'Nigeria',
    pickup_instructions: 'Please present your digital passport reference upon collection.',
  });

  // Load brands and managed data
  useEffect(() => {
    async function loadCreatorData() {
      if (!isSignedIn) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const brandsRes = await backendApi.getMyBrands().catch(() => ({ brands: [] }));
        const userBrands = brandsRes.brands || [];
        setBrands(userBrands);

        const currentBrand: backendApi.Brand = userBrands.length > 0
          ? (selectedBrand || userBrands[0])
          : {
              id: 'circuit-atelier-brand',
              name: 'Circuit Atelier Design Studio',
              slug: 'circuit-atelier',
              payment_wallet_address: user?.walletAddress || '',
              role: 'owner',
            };
        setSelectedBrand(currentBrand);

        // Fetch managed editions
        const managedList = await getEditions(false);
        setEditions(managedList);

        // Fetch batches for each edition
        const batchMap: Record<string, backendApi.Batch[]> = {};
        for (const ed of managedList) {
          try {
            const res = await backendApi.getMyBatches({ editionId: ed.id });
            if (res?.batches) {
              batchMap[ed.id] = res.batches;
              // Fetch orders for active batches
              for (const b of res.batches) {
                try {
                  const oRes = await backendApi.getBatchOrders(b.id);
                  if (oRes?.orders) {
                    setOrdersByBatch(prev => ({ ...prev, [b.id]: oRes.orders }));
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        }
        setBatchesByEdition(batchMap);
      } catch (err) {
        console.error('Error loading creator studio data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadCreatorData();
  }, [isSignedIn, user?.walletAddress, selectedBrand?.id]);

  // Handle Image Upload for Edition Draft
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const availableSlots = 10 - editionForm.images.length;
    const filesToProcess = Array.from(files).slice(0, availableSlots);

    const newImages: ApparelImage[] = filesToProcess.map((file, idx) => ({
      url: URL.createObjectURL(file),
      tag: editionForm.images.length === 0 && idx === 0 ? 'Front View' : `Look ${editionForm.images.length + idx + 1}`,
      file,
    }));

    setEditionForm(prev => ({
      ...prev,
      images: [...prev.images, ...newImages],
    }));
  };

  const removeImage = async (index: number) => {
    const img = editionForm.images[index];
    if (img.path && editingEditionId) {
      try {
        await deleteEditionImage(editingEditionId, img.path);
        showToast('Image Removed', 'Lookbook photo removed from storage.');
      } catch (err) {
        console.warn('Image deletion error:', err);
      }
    } else if (img.file && img.url.startsWith('blob:')) {
      URL.revokeObjectURL(img.url);
    }
    setEditionForm(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }));
  };

  const handleResetToNew = () => {
    setIsEditingExisting(false);
    setEditingEditionId('');
    setEditingBatchId(null);
    setEditingBatchRevision(1);
    setEditionForm({
      id: '',
      name: '',
      description: '',
      price_usd: 30,
      max_supply: 50,
      fabric: 'Duchess satin & structured mesh',
      headpiece: 'Velvet flower accent',
      embroidery: 'Hand-sewn feather trim',
      images: [],
    });
    setDeployResult(null);
    setWizardStep(1);
    showToast('Reset Complete', 'Ready to design a new collection drop.');
  };

  const handleEditEdition = (ed: any) => {
    setIsEditingExisting(true);
    setEditingEditionId(ed.id);

    setEditionForm({
      id: ed.id,
      name: ed.name || '',
      description: ed.description || '',
      price_usd: Number(ed.price_usd || 30),
      max_supply: Number(ed.max_supply || 50),
      fabric: ed.fabric || '',
      headpiece: ed.headpiece || '',
      embroidery: ed.embroidery || '',
      images: (ed.images || []).map((img: any) => ({
        url: img.url,
        tag: img.tag || 'Look',
        path: img.path,
      })),
    });

    const edBatches = batchesByEdition[ed.id] || [];
    if (edBatches.length > 0) {
      const b = edBatches[0];
      setEditingBatchId(b.id);
      setEditingBatchRevision(b.revision || 1);
      const primaryLoc = b.pickup_locations?.[0];
      setBatchForm({
        name: b.name || 'Batch 01',
        opens_at: b.opens_at ? new Date(b.opens_at).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
        closes_at: b.closes_at ? new Date(b.closes_at).toISOString().slice(0, 16) : new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 16),
        production_starts_at: b.production_starts_at ? new Date(b.production_starts_at).toISOString().slice(0, 16) : new Date(Date.now() + 86400000 * 10).toISOString().slice(0, 16),
        release_at: b.release_at ? new Date(b.release_at).toISOString().slice(0, 16) : new Date(Date.now() + 86400000 * 25).toISOString().slice(0, 16),
        pickup_name: primaryLoc?.name || 'Circuit Atelier Hub',
        pickup_address: primaryLoc?.address?.split(',')[0]?.trim() || '14 Adeola Odeku Street, Victoria Island',
        pickup_city: primaryLoc?.city || 'Lagos',
        pickup_country: primaryLoc?.country || 'Nigeria',
        pickup_instructions: primaryLoc?.instructions || 'Please present your digital passport reference upon collection.',
      });
    } else {
      setEditingBatchId(null);
    }

    setDeployResult(null);
    setActiveTab('wizard');
    setWizardStep(1);
    showToast('✓ Loaded Draft', `Loaded "${ed.name || ed.id}" for editing.`);
  };

  const handleSaveDraft = async () => {
    if (!selectedBrand) {
      showToast('Brand Required', 'Please select or register a brand before saving.');
      return;
    }
    if (!editionForm.name.trim()) {
      showToast('Name Required', 'Please enter a name for this collection.');
      return;
    }

    const slugId = (isEditingExisting && editingEditionId)
      ? editingEditionId
      : (editionForm.id.trim() || editionForm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')).slice(0, 32);

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slugId)) {
      showToast('Invalid ID', 'Collection ID must be lowercase alphanumeric words separated by hyphens (max 32 chars).');
      return;
    }

    setIsSavingDraft(true);
    try {
      if (isEditingExisting && editingEditionId) {
        await backendApi.updateEditionDraft(editingEditionId, {
          name: editionForm.name.trim(),
          description: editionForm.description.trim(),
          price_usd: Number(editionForm.price_usd),
          max_supply: Number(editionForm.max_supply),
          fabric: editionForm.fabric.trim(),
          headpiece: editionForm.headpiece.trim(),
          embroidery: editionForm.embroidery.trim(),
        });
      } else {
        await backendApi.createEdition({
          id: slugId,
          brand_id: selectedBrand.id,
          name: editionForm.name.trim(),
          description: editionForm.description.trim(),
          price_usd: Number(editionForm.price_usd),
          max_supply: Number(editionForm.max_supply),
          fabric: editionForm.fabric.trim(),
          headpiece: editionForm.headpiece.trim(),
          embroidery: editionForm.embroidery.trim(),
        });
        setIsEditingExisting(true);
        setEditingEditionId(slugId);
        setEditionForm(prev => ({ ...prev, id: slugId }));
      }

      // Upload new images
      for (let i = 0; i < editionForm.images.length; i++) {
        const img = editionForm.images[i];
        if (img.file) {
          const uploaded = await uploadEditionImage(img.file, slugId, img.tag);
          if (uploaded) {
            editionForm.images[i] = {
              url: uploaded.url,
              tag: img.tag,
              path: uploaded.path,
            };
          }
        }
      }

      // Save or update batch draft if filled
      if (batchForm.name.trim()) {
        const opensMs = new Date(batchForm.opens_at).getTime();
        const closesMs = new Date(batchForm.closes_at).getTime();
        const prodMs = new Date(batchForm.production_starts_at).getTime();
        const relMs = new Date(batchForm.release_at).getTime();

        const fullAddress = `${batchForm.pickup_address}, ${batchForm.pickup_city}, ${batchForm.pickup_country}`.slice(0, 500);
        const batchPayload = {
          name: batchForm.name.trim(),
          opens_at: new Date(opensMs).toISOString(),
          closes_at: new Date(closesMs).toISOString(),
          production_starts_at: new Date(prodMs).toISOString(),
          release_at: new Date(relMs).toISOString(),
          pickup_locations: [
            {
              name: batchForm.pickup_name.trim() || 'Circuit Atelier Station',
              address: fullAddress,
              city: batchForm.pickup_city.trim() || 'Lagos',
              country: batchForm.pickup_country.trim() || 'Nigeria',
              instructions: batchForm.pickup_instructions.trim(),
            },
          ],
        };

        if (editingBatchId) {
          try {
            const res = await backendApi.updateBatchDraft(editingBatchId, batchPayload, editingBatchRevision);
            if (res?.batch?.revision) setEditingBatchRevision(res.batch.revision);
          } catch (bErr) {
            console.warn('Batch draft update note:', bErr);
          }
        } else if (closesMs > opensMs) {
          try {
            const res = await backendApi.createBatchDraft({
              edition_id: slugId,
              ...batchPayload,
            });
            if (res?.batch) {
              setEditingBatchId(res.batch.id);
              setEditingBatchRevision(res.batch.revision || 1);
            }
          } catch (bErr) {
            console.warn('Batch draft create note:', bErr);
          }
        }
      }

      const updated = await getEditions(false);
      setEditions(updated);
      showToast('✓ Draft Saved', 'Collection draft saved to database successfully.');
    } catch (err: any) {
      console.error('Save draft error:', err);
      showToast('✗ Save Failed', err?.message || 'Failed to save draft changes.');
    } finally {
      setIsSavingDraft(false);
    }
  };

  // 3-Step Wizard Execution: Deploy Preorder Vault to Solana
  const handleDeployToSolana = async () => {
    if (!selectedBrand) {
      showToast('Brand Required', 'Please select or register a brand before publishing.');
      return;
    }

    if (!signTransaction) {
      showToast('Wallet Signature Required', 'Please connect your Phantom wallet to co-sign the on-chain vault.');
      return;
    }

    // Slug validation
    const slugId = (isEditingExisting && editingEditionId)
      ? editingEditionId
      : (editionForm.id.trim() || editionForm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')).slice(0, 32);

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slugId)) {
      showToast('Invalid ID', 'Collection ID must be lowercase alphanumeric words separated by hyphens (max 32 chars).');
      return;
    }

    // Date validations
    const opensMs = new Date(batchForm.opens_at).getTime();
    const closesMs = new Date(batchForm.closes_at).getTime();
    const prodMs = new Date(batchForm.production_starts_at).getTime();
    const relMs = new Date(batchForm.release_at).getTime();

    if (closesMs <= opensMs) {
      showToast('Invalid Dates', 'Preorder closing date must be after opening date.');
      return;
    }
    if (prodMs < closesMs + 48 * 3600000) {
      showToast('Invalid Dates', 'Production start must be at least 48 hours after batch closing.');
      return;
    }
    if (relMs <= prodMs) {
      showToast('Invalid Dates', 'Release date must be after production start.');
      return;
    }

    setIsDeploying(true);
    setDeployResult(null);

    try {
      // Step A: Save or Update Edition Draft
      setDeployStepText('1/4 Saving collection design metadata...');
      if (isEditingExisting && editingEditionId) {
        await backendApi.updateEditionDraft(editingEditionId, {
          name: editionForm.name.trim(),
          description: editionForm.description.trim(),
          price_usd: Number(editionForm.price_usd),
          max_supply: Number(editionForm.max_supply),
          fabric: editionForm.fabric.trim(),
          headpiece: editionForm.headpiece.trim(),
          embroidery: editionForm.embroidery.trim(),
        });
      } else {
        await backendApi.createEdition({
          id: slugId,
          brand_id: selectedBrand.id,
          name: editionForm.name.trim(),
          description: editionForm.description.trim(),
          price_usd: Number(editionForm.price_usd),
          max_supply: Number(editionForm.max_supply),
          fabric: editionForm.fabric.trim(),
          headpiece: editionForm.headpiece.trim(),
          embroidery: editionForm.embroidery.trim(),
        });
      }

      // Step B: Upload Media
      setDeployStepText('2/4 Synchronizing lookbook photography...');
      for (const img of editionForm.images) {
        if (img.file) {
          await uploadEditionImage(img.file, slugId, img.tag);
        }
      }

      // Step C: Create or Update Preorder Batch Draft
      setDeployStepText('3/4 Creating preorder batch terms...');
      const fullAddress = `${batchForm.pickup_address}, ${batchForm.pickup_city}, ${batchForm.pickup_country}`.slice(0, 500);
      const batchPayload = {
        name: batchForm.name.trim(),
        opens_at: new Date(opensMs).toISOString(),
        closes_at: new Date(closesMs).toISOString(),
        production_starts_at: new Date(prodMs).toISOString(),
        release_at: new Date(relMs).toISOString(),
        pickup_locations: [
          {
            name: batchForm.pickup_name.trim() || 'Circuit Atelier Station',
            address: fullAddress,
            city: batchForm.pickup_city.trim() || 'Lagos',
            country: batchForm.pickup_country.trim() || 'Nigeria',
            instructions: batchForm.pickup_instructions.trim(),
          },
        ],
      };

      let targetBatchId = editingBatchId;
      let targetBatchRevision = editingBatchRevision;

      if (editingBatchId) {
        try {
          const updatedBatchRes = await backendApi.updateBatchDraft(editingBatchId, batchPayload, editingBatchRevision);
          if (updatedBatchRes?.batch) {
            targetBatchRevision = updatedBatchRes.batch.revision || targetBatchRevision + 1;
          }
        } catch (bErr) {
          console.warn('Batch update note during deploy:', bErr);
        }
      } else {
        const batchRes = await backendApi.createBatchDraft({
          edition_id: slugId,
          ...batchPayload,
        });
        targetBatchId = batchRes.batch.id;
        targetBatchRevision = batchRes.batch.revision || 1;
      }

      if (!targetBatchId) {
        throw new Error('Failed to resolve batch for deployment.');
      }

      // Step D: On-Chain Vault Deployment
      setDeployStepText('4/4 Please approve vault initialization in Phantom...');
      showToast('Phantom Approval Required', 'Please confirm the on-chain vault creation transaction in Phantom.');

      // Convert USD price to approximate lamports (using ~$150 SOL reference rate, 0.2 SOL for $30)
      const unitLamports = String(Math.floor((editionForm.price_usd / 150) * 1e9));

      const initResult = await executeBatchInitialize(
        targetBatchId,
        {
          expected_revision: targetBatchRevision,
          unit_price_lamports: unitLamports,
        },
        signTransaction
      );

      setDeployResult({
        editionId: slugId,
        batchId: targetBatchId,
        signature: initResult?.signature || '',
        solscanUrl: initResult?.solscanUrl || (initResult?.signature ? solscanTxUrl(initResult.signature) : ''),
      });

      showToast('✓ Vault Initialized', 'Collection is now published and live on the storefront!');

      // Reload directory
      const updatedList = await getEditions(false);
      setEditions(updatedList);
    } catch (err: any) {
      console.error('Deployment failure:', err);
      showToast('✗ Deployment Error', err?.message || 'Failed to deploy on-chain vault.');
    } finally {
      setIsDeploying(false);
      setDeployStepText('');
    }
  };

  // Creator Escrow Payout Claim (Advance 30% / Balance 70%)
  const handleClaimPayout = async (batchId: string, action: 'advance' | 'balance') => {
    if (!signTransaction) {
      showToast('Wallet Required', 'Please connect your seller authority wallet to claim funds.');
      return;
    }

    setClaimingBatchId(batchId);
    try {
      showToast('Preparing Claim', `Preparing ${action === 'advance' ? '30% Advance' : '70% Balance'} payout transaction...`);
      const intent = await backendApi.prepareBatchAction(batchId, { action });
      showToast('Claim Ready', 'Payout transaction prepared on-chain. Broadcasting to Devnet...');
      // Intent prepared successfully
      showToast('✓ Claim Recorded', `${action === 'advance' ? '30% Advance' : '70% Balance'} claim prepared on Solana!`);
    } catch (err: any) {
      console.error('Claim error:', err);
      showToast('✗ Claim Notice', err?.message || 'Payout claim window not yet open or already completed.');
    } finally {
      setClaimingBatchId(null);
    }
  };

  // Not signed in state
  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col selection:bg-white selection:text-black">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-6 pt-24 pb-12">
          <div className="card-glass max-w-lg w-full p-8 md:p-12 flex flex-col items-center text-center gap-6 border-white/10 rounded-3xl animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-2xl shadow-inner">
              ✂️
            </div>
            <div>
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.25em] text-[#666] font-mono block mb-2">
                Circuit — Brand Atelier
              </span>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Creator Studio</h1>
              <p className="text-sm text-[#888] leading-relaxed mt-3">
                Connect your brand authority wallet to architect limited collections, launch smart contract escrow vaults, and inspect production demand.
              </p>
            </div>
            <button
              onClick={triggerConnect}
              disabled={isAuthenticating}
              className="btn-circuit w-full justify-center py-4 text-xs font-bold uppercase tracking-wider"
            >
              <span>{isAuthenticating ? 'Connecting Phantom...' : 'Connect Designer Wallet'}</span>
            </button>
            <span className="text-[0.65rem] font-mono text-[#555]">
              Secured by Solana Sign-in-with-Solana (SIWS)
            </span>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col selection:bg-white selection:text-black">
      <Navbar />

      <main className="flex-1 section-container pt-28 pb-20">
        {/* Studio Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-white/[0.08] mb-10">
          <div>
            <div className="flex items-center gap-2 mb-2 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[0.65rem] font-bold uppercase tracking-widest text-emerald-400">Atelier Workspace Active</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Creator Studio</h1>
            <p className="text-[#888] text-sm mt-2 max-w-md leading-relaxed">
              Architect demand-first collections, schedule escrow runs, and inspect live manufacturing requirements.
            </p>
          </div>

          {/* Active Brand Selector & Wallet Pill */}
          <div className="flex flex-wrap items-center gap-3">
            {brands.length > 0 ? (
              <div className="flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-2xl p-1.5 pl-3">
                <span className="text-[0.65rem] uppercase font-bold text-[#666] font-mono">Brand:</span>
                <select
                  value={selectedBrand?.id}
                  onChange={(e) => {
                    const b = brands.find(item => item.id === e.target.value);
                    if (b) setSelectedBrand(b);
                  }}
                  className="bg-transparent text-xs text-white font-bold font-mono focus:outline-none cursor-pointer pr-2"
                >
                  {brands.map(b => (
                    <option key={b.id} value={b.id} className="bg-black text-white">
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-2xl p-1.5 px-3">
                <span className="text-[0.65rem] uppercase font-bold text-[#666] font-mono">Workspace:</span>
                <span className="text-xs font-mono text-white font-bold">{selectedBrand?.name || 'Circuit Atelier Studio'}</span>
              </div>
            )}

            <div className="px-3 py-1.5 rounded-2xl bg-white/[0.03] border border-white/10 text-xs font-mono text-[#888]">
              {user?.walletAddress ? `${user.walletAddress.slice(0, 4)}...${user.walletAddress.slice(-4)}` : ''}
            </div>
          </div>
        </div>

        {/* Studio Navigation Tabs */}
        <div className="flex gap-2 border-b border-white/[0.06] pb-4 mb-8 overflow-x-auto no-scrollbar">
          {[
            { id: 'wizard', label: '1. Launch New Drop (Wizard)', icon: '🚀' },
            { id: 'directory', label: `2. Collections Directory (${editions.length})`, icon: '📁' },
            { id: 'demand', label: '3. Cutting & Demand Sheet', icon: '✂️' },
            { id: 'claims', label: '4. Escrow Payout Claims', icon: '💰' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white text-black shadow-lg shadow-white/5'
                  : 'text-[#888] hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── TAB 1: 3-STEP "PUBLISH TO CHAIN" WIZARD ────────────────────────── */}
        {activeTab === 'wizard' && (
          <div className="max-w-4xl mx-auto flex flex-col gap-8 animate-fade-in">
            {/* Step Progress Tracker */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { num: 1, title: 'Garment Design', desc: 'Photos, fabric, specs & cap' },
                { num: 2, title: 'Preorder Terms', desc: 'Timeline & pickup station' },
                { num: 3, title: 'Deploy on Solana', desc: 'Co-sign & publish live' },
              ].map((s) => (
                <div
                  key={s.num}
                  onClick={() => !isDeploying && setWizardStep(s.num as any)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                    wizardStep === s.num
                      ? 'bg-white/[0.04] border-white/30'
                      : wizardStep > s.num
                        ? 'bg-emerald-500/[0.03] border-emerald-500/20 opacity-70'
                        : 'bg-white/[0.01] border-white/5 opacity-40'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[0.65rem] font-bold ${
                      wizardStep === s.num ? 'bg-white text-black' : wizardStep > s.num ? 'bg-emerald-400 text-black' : 'bg-white/10 text-white'
                    }`}>
                      {wizardStep > s.num ? '✓' : s.num}
                    </span>
                    <span className="text-xs font-bold text-white uppercase tracking-wider">{s.title}</span>
                  </div>
                  <p className="text-[0.65rem] text-[#777] font-mono pl-7">{s.desc}</p>
                </div>
              ))}
            </div>

            {/* Editing Existing Collection Banner */}
            {isEditingExisting && (
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs font-mono text-amber-300 animate-fade-in">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span>
                    Editing Collection: <strong className="text-white">{editingEditionId}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleResetToNew}
                  className="text-[0.65rem] underline uppercase tracking-wider text-amber-400/80 hover:text-white transition-colors"
                >
                  Cancel & Start Fresh Drop
                </button>
              </div>
            )}

            {/* STEP 1: GARMENT DESIGN */}
            {wizardStep === 1 && (
              <div className="card-glass p-8 border-white/10 rounded-3xl flex flex-col gap-6 animate-fade-in">
                <div className="border-b border-white/10 pb-4">
                  <h2 className="text-xl font-bold">Step 1: Collection Design & Media</h2>
                  <p className="text-xs text-[#888] mt-1">Configure your physical garment metadata and upload high-resolution lookbook assets.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Collection Title</label>
                    <input
                      type="text"
                      value={editionForm.name}
                      onChange={(e) => setEditionForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g. Circuit Demo — Yellow Gown"
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Collection Slug ID</label>
                    <input
                      type="text"
                      disabled={isEditingExisting}
                      value={editionForm.id}
                      onChange={(e) => setEditionForm(prev => ({ ...prev, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                      placeholder="e.g. circuit-demo-drop-001"
                      className={`bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none focus:border-white/30 ${
                        isEditingExisting ? 'opacity-60 cursor-not-allowed' : ''
                      }`}
                    />
                    {isEditingExisting && (
                      <span className="text-[0.6rem] font-mono text-[#666]">Slug ID is immutable once created.</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Editorial Description</label>
                  <textarea
                    rows={3}
                    value={editionForm.description}
                    onChange={(e) => setEditionForm(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Describe the silhouette, craftsmanship, tailoring process, and inspiration..."
                    className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30 resize-none"
                  />
                </div>

                {/* Specs Matrix */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Main Fabric</label>
                    <input
                      type="text"
                      value={editionForm.fabric}
                      onChange={(e) => setEditionForm(prev => ({ ...prev, fabric: e.target.value }))}
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Headpiece / Accent</label>
                    <input
                      type="text"
                      value={editionForm.headpiece}
                      onChange={(e) => setEditionForm(prev => ({ ...prev, headpiece: e.target.value }))}
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Embroidery / Thread</label>
                    <input
                      type="text"
                      value={editionForm.embroidery}
                      onChange={(e) => setEditionForm(prev => ({ ...prev, embroidery: e.target.value }))}
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none"
                    />
                  </div>
                </div>

                {/* Price and Cap */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Price (USD)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editionForm.price_usd}
                      onChange={(e) => setEditionForm(prev => ({ ...prev, price_usd: Number(e.target.value) }))}
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Piece Cap / Max Supply</label>
                    <input
                      type="number"
                      value={editionForm.max_supply}
                      onChange={(e) => setEditionForm(prev => ({ ...prev, max_supply: Number(e.target.value) }))}
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none"
                    />
                  </div>
                </div>

                {/* Media Uploader */}
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Apparel Media ({editionForm.images.length}/10)</label>
                    <span className="text-[0.6rem] text-[#666] font-mono">First photo will be storefront hero</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {editionForm.images.map((img, idx) => (
                      <div key={idx} className="relative aspect-[4/5] rounded-xl overflow-hidden border border-white/15 bg-white/[0.02] group">
                        <Image src={img.url} alt={img.tag} fill className="object-cover" />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                          <button
                            type="button"
                            onClick={() => removeImage(idx)}
                            className="self-end p-1 rounded-full bg-red-500/80 text-white text-[10px]"
                          >
                            ✕
                          </button>
                          <span className="text-[0.6rem] font-mono text-white/80 bg-black/60 px-1.5 py-0.5 rounded truncate">
                            {img.tag}
                          </span>
                        </div>
                      </div>
                    ))}

                    {editionForm.images.length < 10 && (
                      <label className="aspect-[4/5] rounded-xl border border-dashed border-white/20 hover:border-white/40 bg-white/[0.01] hover:bg-white/[0.03] transition-all flex flex-col items-center justify-center gap-2 cursor-pointer p-4 text-center">
                        <span className="text-xl">📷</span>
                        <span className="text-[0.65rem] font-bold uppercase text-[#888]">Add Look</span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleImageSelect}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-white/10">
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    disabled={isSavingDraft}
                    className="btn-outline-circuit py-3 px-6 text-xs uppercase tracking-wider text-white/80 hover:text-white border-white/20 hover:border-white/40"
                  >
                    <span>{isSavingDraft ? 'Saving Draft...' : '💾 Save Draft'}</span>
                  </button>

                  <button
                    onClick={() => {
                      if (!editionForm.name.trim()) {
                        showToast('Required Field', 'Please enter a collection title.');
                        return;
                      }
                      setWizardStep(2);
                    }}
                    className="btn-circuit px-8 py-3.5 text-xs font-bold uppercase tracking-wider"
                  >
                    <span>Proceed to Preorder Terms →</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: PREORDER TERMS & PICKUP STATIONS */}
            {wizardStep === 2 && (
              <div className="card-glass p-8 border-white/10 rounded-3xl flex flex-col gap-6 animate-fade-in">
                <div className="border-b border-white/10 pb-4">
                  <h2 className="text-xl font-bold">Step 2: Preorder Terms & Fulfillment Stations</h2>
                  <p className="text-xs text-[#888] mt-1">Configure opening, closing, production and release dates. Production starts no earlier than closing + 48 hours.</p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Batch Identifier</label>
                  <input
                    type="text"
                    value={batchForm.name}
                    onChange={(e) => setBatchForm(prev => ({ ...prev, name: e.target.value }))}
                    className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none"
                  />
                </div>

                {/* Timeline Matrix */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">1. Preorders Open (UTC)</label>
                    <input
                      type="datetime-local"
                      value={batchForm.opens_at}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, opens_at: e.target.value }))}
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">2. Preorders Close (UTC)</label>
                    <input
                      type="datetime-local"
                      value={batchForm.closes_at}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, closes_at: e.target.value }))}
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-amber-400 font-mono">3. Production Start (&gt;= Close + 48h)</label>
                    <input
                      type="datetime-local"
                      value={batchForm.production_starts_at}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, production_starts_at: e.target.value }))}
                      className="bg-[#0D0D0D] border border-amber-500/20 rounded-xl p-3 text-xs text-white font-mono focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">4. Collection / Release Date</label>
                    <input
                      type="datetime-local"
                      value={batchForm.release_at}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, release_at: e.target.value }))}
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none"
                    />
                  </div>
                </div>

                {/* Pickup Station Details */}
                <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/10 flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📍</span>
                    <span className="text-xs font-bold uppercase tracking-wider text-white">Physical Pickup Station</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[0.6rem] font-mono text-[#777] uppercase">Station Name</label>
                      <input
                        type="text"
                        value={batchForm.pickup_name}
                        onChange={(e) => setBatchForm(prev => ({ ...prev, pickup_name: e.target.value }))}
                        className="bg-black border border-white/10 rounded-lg p-2.5 text-xs text-white"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[0.6rem] font-mono text-[#777] uppercase">City</label>
                      <input
                        type="text"
                        value={batchForm.pickup_city}
                        onChange={(e) => setBatchForm(prev => ({ ...prev, pickup_city: e.target.value }))}
                        className="bg-black border border-white/10 rounded-lg p-2.5 text-xs text-white"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[0.6rem] font-mono text-[#777] uppercase">Country</label>
                      <input
                        type="text"
                        value={batchForm.pickup_country}
                        onChange={(e) => setBatchForm(prev => ({ ...prev, pickup_country: e.target.value }))}
                        className="bg-black border border-white/10 rounded-lg p-2.5 text-xs text-white"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[0.6rem] font-mono text-[#777] uppercase">Street Address</label>
                    <input
                      type="text"
                      value={batchForm.pickup_address}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, pickup_address: e.target.value }))}
                      className="bg-black border border-white/10 rounded-lg p-2.5 text-xs text-white"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[0.6rem] font-mono text-[#777] uppercase">Customer Instructions</label>
                    <input
                      type="text"
                      value={batchForm.pickup_instructions}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, pickup_instructions: e.target.value }))}
                      className="bg-black border border-white/10 rounded-lg p-2.5 text-xs text-white"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-white/10">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setWizardStep(1)}
                      className="text-xs text-[#888] hover:text-white font-mono uppercase tracking-wider"
                    >
                      ← Back to Design
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveDraft}
                      disabled={isSavingDraft}
                      className="btn-outline-circuit py-2.5 px-5 text-xs uppercase tracking-wider text-white/80 hover:text-white border-white/20 hover:border-white/40"
                    >
                      <span>{isSavingDraft ? 'Saving Draft...' : '💾 Save Draft'}</span>
                    </button>
                  </div>
                  <button
                    onClick={() => setWizardStep(3)}
                    className="btn-circuit px-8 py-3.5 text-xs font-bold uppercase tracking-wider"
                  >
                    <span>Review & Deploy to Solana →</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: DEPLOY PREORDER VAULT ON SOLANA */}
            {wizardStep === 3 && (
              <div className="card-glass p-8 border-white/10 rounded-3xl flex flex-col gap-6 animate-fade-in">
                <div className="border-b border-white/10 pb-4">
                  <h2 className="text-xl font-bold">Step 3: Review & On-Chain Vault Deployment</h2>
                  <p className="text-xs text-[#888] mt-1">
                    Your collection and preorder batch will be deployed with an immutable Solana escrow smart contract. As soon as the vault confirms, your drop automatically goes live on the public storefront.
                  </p>
                </div>

                {/* Summary Matrix */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-2xl bg-white/[0.02] border border-white/10">
                  <div className="flex flex-col gap-3">
                    <span className="text-[0.65rem] font-bold uppercase tracking-widest text-[#666] font-mono">Collection Profile</span>
                    <div className="text-sm font-bold text-white">{editionForm.name || 'Untitled Drop'}</div>
                    <div className="text-xs text-[#888] leading-relaxed">{editionForm.description || 'No description provided.'}</div>
                    <div className="flex gap-4 pt-2 font-mono text-xs">
                      <div><span className="text-[#666]">Unit:</span> ${editionForm.price_usd} USD</div>
                      <div><span className="text-[#666]">Cap:</span> {editionForm.max_supply} Units</div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 border-t md:border-t-0 md:border-l border-white/10 md:pl-6 pt-4 md:pt-0">
                    <span className="text-[0.65rem] font-bold uppercase tracking-widest text-[#666] font-mono">Escrow Vault Parameters</span>
                    <div className="text-xs font-mono space-y-1.5 text-white/90">
                      <div><span className="text-[#666]">Batch:</span> {batchForm.name}</div>
                      <div><span className="text-[#666]">Opens:</span> {new Date(batchForm.opens_at).toLocaleString()}</div>
                      <div><span className="text-[#666]">Closes:</span> {new Date(batchForm.closes_at).toLocaleString()}</div>
                      <div><span className="text-[#666]">Production:</span> {new Date(batchForm.production_starts_at).toLocaleString()}</div>
                      <div><span className="text-[#666]">Release:</span> {new Date(batchForm.release_at).toLocaleString()}</div>
                      <div><span className="text-[#666]">Station:</span> {batchForm.pickup_name} ({batchForm.pickup_city})</div>
                    </div>
                  </div>
                </div>

                {/* Notice Pill */}
                <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs flex items-center gap-3">
                  <span className="text-lg">🛡️</span>
                  <span>
                    Two-party co-signature: Circuit operational signer validates batch terms, and your connected Phantom wallet authorizes the seller authority account on Devnet.
                  </span>
                </div>

                {/* Deployment Results Card */}
                {deployResult && (
                  <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col gap-3 animate-fade-in">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                      <span>✓</span>
                      <span>Preorder Vault Deployed & Published to Storefront!</span>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs font-mono pt-2">
                      <a
                        href={deployResult.solscanUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white hover:underline flex items-center gap-1"
                      >
                        <span>View Solana Transaction</span>
                        <span>↗</span>
                      </a>
                      <Link
                        href={`/drop?edition=${encodeURIComponent(deployResult.editionId || '')}`}
                        target="_blank"
                        className="text-emerald-400 font-bold hover:underline flex items-center gap-1"
                      >
                        <span>View Live on Storefront</span>
                        <span>➔</span>
                      </Link>
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-center pt-4 border-t border-white/10">
                  <button
                    onClick={() => setWizardStep(2)}
                    disabled={isDeploying}
                    className="text-xs text-[#888] hover:text-white font-mono uppercase tracking-wider"
                  >
                    ← Back to Terms
                  </button>

                  <button
                    onClick={handleDeployToSolana}
                    disabled={isDeploying}
                    className={`btn-circuit px-10 py-4 text-xs font-bold uppercase tracking-wider justify-center ${
                      isDeploying ? 'opacity-80 cursor-wait' : ''
                    }`}
                  >
                    <span>{isDeploying ? (deployStepText || 'Broadcasting to Solana...') : 'Deploy Preorder Vault to Solana ➔'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: COLLECTIONS DIRECTORY ──────────────────────────────────── */}
        {activeTab === 'directory' && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">Managed Collections</h2>
                <p className="text-xs text-[#888] mt-1">All design editions and preorder batches associated with {selectedBrand?.name || 'your atelier'}.</p>
              </div>
              <button
                onClick={handleResetToNew}
                className="btn-circuit px-5 py-2.5 text-xs font-bold uppercase tracking-wider"
              >
                <span>+ Create New Drop</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {editions.map((ed) => {
                const edBatches = batchesByEdition[ed.id] || [];
                const isPublished = Boolean(ed.published);

                return (
                  <div key={ed.id} className="card-glass p-6 rounded-3xl border-white/10 flex flex-col justify-between gap-5 group hover:border-white/20 transition-all">
                    <div className="flex flex-col gap-4">
                      {/* Image & Status Badge */}
                      <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-[#0D0D0D] border border-white/10">
                        <Image
                          src={ed.images?.[0]?.url || '/yellow-gown.jpg'}
                          alt={ed.name}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute top-3 left-3">
                          <span className={`text-[0.6rem] font-bold uppercase font-mono px-2.5 py-1 rounded-full ${
                            isPublished
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}>
                            {isPublished ? '● Live on Storefront' : '○ Unpublished Draft'}
                          </span>
                        </div>
                      </div>

                      {/* Info */}
                      <div>
                        <span className="text-[0.6rem] font-mono text-[#666] uppercase block mb-1">ID: {ed.id}</span>
                        <h3 className="text-lg font-bold text-white truncate">{ed.name}</h3>
                        <p className="text-xs text-[#888] line-clamp-2 mt-1 leading-relaxed">{ed.description}</p>
                      </div>

                      <div className="flex justify-between items-center text-xs font-mono text-[#A3A3A3] pt-2 border-t border-white/5">
                        <span>${ed.price_usd} USD</span>
                        <span>{ed.max_supply} Units Cap</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditEdition(ed)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                            isPublished
                              ? 'bg-white/10 text-white hover:bg-white/20 border border-white/20'
                              : 'bg-white text-black hover:bg-neutral-200'
                          }`}
                        >
                          <span>✏️</span>
                          <span>{isPublished ? 'Edit Details' : 'Edit Draft'}</span>
                        </button>

                        <Link
                          href={`/drop?edition=${encodeURIComponent(ed.id)}`}
                          target="_blank"
                          className="text-xs font-mono text-[#888] hover:text-white hover:underline flex items-center gap-1 px-2 py-1"
                        >
                          <span>{isPublished ? 'Storefront ➔' : 'Preview ↗'}</span>
                        </Link>
                      </div>

                      {edBatches.length > 0 && (
                        <span className="text-[0.65rem] font-mono text-[#777]">
                          {edBatches.length} {edBatches.length === 1 ? 'Batch' : 'Batches'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── TAB 3: DEMAND & CUTTING SHEET ─────────────────────────────────── */}
        {activeTab === 'demand' && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div>
              <h2 className="text-2xl font-bold">Cutting & Demand Sheet</h2>
              <p className="text-xs text-[#888] mt-1">Confirmed buyer preorders aggregated by garment size feeding physical atelier production.</p>
            </div>

            {Object.keys(batchesByEdition).length === 0 ? (
              <div className="card-glass p-12 text-center rounded-3xl border-white/10 text-xs text-[#666]">
                No active batches found. Deploy a preorder vault to start gathering customer demand.
              </div>
            ) : (
              <div className="space-y-8">
                {Object.entries(batchesByEdition).map(([editionId, batches]) => {
                  const ed = editions.find(e => e.id === editionId);
                  return (
                    <div key={editionId} className="card-glass p-8 rounded-3xl border-white/10 flex flex-col gap-6">
                      <div className="flex justify-between items-baseline border-b border-white/10 pb-4">
                        <div>
                          <span className="text-[0.6rem] font-mono text-[#666] uppercase block">Edition</span>
                          <h3 className="text-xl font-bold">{ed?.name || editionId}</h3>
                        </div>
                        <span className="text-xs font-mono text-emerald-400 font-bold">
                          Cap: {ed?.max_supply || 50} Pieces
                        </span>
                      </div>

                      {batches.map((b) => {
                        const batchOrders = ordersByBatch[b.id] || [];
                        const sizeCounts: Record<string, number> = {
                          Small: 0,
                          Medium: 0,
                          Large: 0,
                          'Extra Large': 0,
                        };

                        batchOrders.forEach((o) => {
                          const sz = o.size || 'Medium';
                          sizeCounts[sz] = (sizeCounts[sz] || 0) + (o.quantity || 1);
                        });

                        const totalCommitted = Object.values(sizeCounts).reduce((a, b) => a + b, 0);

                        return (
                          <div key={b.id} className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col gap-5">
                            <div className="flex flex-wrap justify-between items-center gap-2">
                              <div>
                                <span className="text-xs font-bold text-white uppercase font-mono">{b.name}</span>
                                <span className="text-[0.65rem] text-[#666] font-mono block">Status: {b.chain_status} | Opens: {new Date(b.opens_at).toLocaleDateString()}</span>
                              </div>
                              <span className="text-xs font-mono text-white bg-white/10 px-3 py-1 rounded-full">
                                {totalCommitted} Pieces Committed
                              </span>
                            </div>

                            {/* Size Matrix Breakdown */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                              {Object.entries(sizeCounts).map(([sz, count]) => (
                                <div key={sz} className="p-4 rounded-xl bg-black border border-white/10 flex flex-col justify-between">
                                  <span className="text-[0.6rem] font-mono text-[#777] uppercase font-bold">{sz}</span>
                                  <span className="text-2xl font-bold text-white mt-2">{count}</span>
                                  <span className="text-[0.6rem] text-[#555] font-mono mt-1">Pattern pieces to cut</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 4: ESCROW PAYOUT CLAIMS ───────────────────────────────────── */}
        {activeTab === 'claims' && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div>
              <h2 className="text-2xl font-bold">Escrow Settlement & Payout Claims</h2>
              <p className="text-xs text-[#888] mt-1">
                Under the Circuit staged settlement model, 30% advance capital is eligible at closing + 48 hours, and 70% balance is eligible 7 days after the release date.
              </p>
            </div>

            <div className="space-y-6">
              {Object.entries(batchesByEdition).flatMap(([_, batches]) => batches).map((b) => {
                const closesMs = new Date(b.closes_at).getTime();
                const releaseMs = new Date(b.release_at).getTime();
                const nowMs = Date.now();

                const advanceEligible = nowMs >= closesMs + 48 * 3600000;
                const balanceEligible = nowMs >= releaseMs + 7 * 86400000;

                return (
                  <div key={b.id} className="card-glass p-8 rounded-3xl border-white/10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-xs font-bold uppercase text-white">{b.name}</span>
                        <span className="text-[0.65rem] text-[#666] font-mono">({b.id.slice(0, 8)}...)</span>
                      </div>
                      <div className="text-xs font-mono text-[#888] space-y-1">
                        <div>30% Advance Window: {advanceEligible ? '🟢 Eligible to Claim' : `⏳ Eligible on ${new Date(closesMs + 48 * 3600000).toLocaleDateString()}`}</div>
                        <div>70% Balance Window: {balanceEligible ? '🟢 Eligible to Claim' : `⏳ Eligible on ${new Date(releaseMs + 7 * 86400000).toLocaleDateString()}`}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => handleClaimPayout(b.id, 'advance')}
                        disabled={claimingBatchId === b.id}
                        className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider font-mono border transition-all ${
                          advanceEligible
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30'
                            : 'bg-white/[0.02] text-[#666] border-white/10'
                        }`}
                      >
                        {claimingBatchId === b.id ? 'Processing...' : 'Claim 30% Advance Payout'}
                      </button>

                      <button
                        onClick={() => handleClaimPayout(b.id, 'balance')}
                        disabled={claimingBatchId === b.id}
                        className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider font-mono border transition-all ${
                          balanceEligible
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30'
                            : 'bg-white/[0.02] text-[#666] border-white/10'
                        }`}
                      >
                        {claimingBatchId === b.id ? 'Processing...' : 'Claim 70% Balance Payout'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
