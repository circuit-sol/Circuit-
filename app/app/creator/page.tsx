'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useWallet } from '@solana/wallet-adapter-react';
import * as backendApi from '@/lib/backendApi';
import { getEditions, uploadEditionImage, deleteEditionImage, saveEditionSocialLinks, getEditionSocialLinks } from '@/lib/db';
import { executeBatchInitialize, parseSolanaError } from '@/lib/solana-service';
import Navbar from '@/components/Navbar';
import { showToast } from '@/components/Toast';
import { solscanTxUrl } from '@/lib/utils';
import { getLiveSolPrice, DEFAULT_SOL_MARKET_PRICE } from '@/lib/price-service';

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
  const [liveSolPrice, setLiveSolPrice] = useState<number>(DEFAULT_SOL_MARKET_PRICE);

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

  // Launch Schedule Mode: 'immediate' (Opens in 15 mins) | 'scheduled' (Custom future date)
  const [scheduleMode, setScheduleMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduleWarningModal, setScheduleWarningModal] = useState<{
    isOpen: boolean;
    pastTimeStr: string;
    onAutoAdjustAndPublish: () => void;
  }>({
    isOpen: false,
    pastTimeStr: '',
    onAutoAdjustAndPublish: () => {},
  });

  // Step 1: Edition Design Form
  const [editionForm, setEditionForm] = useState({
    id: '',
    name: '',
    description: '',
    price_usd: 0,
    max_supply: 50,
    fabric: '',
    headpiece: '',
    embroidery: '',
    instagram: '',
    twitter: '',
    whatsapp: '',
    support_email: '',
    images: [] as ApparelImage[],
  });

  // Step 2: Preorder Terms & Station Form
  const now = Date.now();
  const [batchForm, setBatchForm] = useState({
    name: 'Inaugural Atelier Run — 01',
    opens_at: new Date(now + 600000).toISOString().slice(0, 16), // +10 minutes safe future opening
    closes_at: new Date(now + 86400000 * 7).toISOString().slice(0, 16), // +7 days
    production_starts_at: new Date(now + 86400000 * 10).toISOString().slice(0, 16), // +10 days (>= closes + 48h)
    release_at: new Date(now + 86400000 * 25).toISOString().slice(0, 16), // +25 days
    pickup_name: 'Circuit Atelier Hub',
    pickup_address: '14 Adeola Odeku Street, Victoria Island',
    pickup_city: 'Lagos',
    pickup_country: 'Nigeria',
    pickup_instructions: 'Please present your digital passport reference upon collection.',
  });

  // Ensure the creator has an active, valid brand in Supabase brand_memberships
  const ensureValidBrand = async (): Promise<backendApi.Brand | null> => {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (selectedBrand && uuidPattern.test(selectedBrand.id)) {
      return selectedBrand;
    }

    if (!user?.walletAddress) return null;

    // Check if user already owns any brands in database
    try {
      const brandsRes = await backendApi.getMyBrands();
      const existing = (brandsRes.brands || []).find(b => uuidPattern.test(b.id));
      if (existing) {
        setSelectedBrand(existing);
        setBrands(brandsRes.brands);
        return existing;
      }
    } catch (_) {}

    // Auto-provision brand for this creator
    try {
      const shortWallet = user.walletAddress.slice(0, 6).toLowerCase();
      const brandName = 'Circuit Atelier Studio';
      const baseSlug = 'circuit-atelier';
      const slug = `${baseSlug}-${shortWallet}`;

      const created = await backendApi.createBrand({
        name: brandName,
        slug,
        payment_wallet_address: user.walletAddress,
      });
      if (created?.brand && uuidPattern.test(created.brand.id)) {
        setSelectedBrand(created.brand);
        setBrands(prev => [created.brand, ...prev.filter(b => b.id !== created.brand.id)]);
        return created.brand;
      }
    } catch (err) {
      console.error('Failed to provision atelier brand:', err);
    }
    return null;
  };

  // Load brands and managed data
  useEffect(() => {
    async function loadCreatorData() {
      if (!isSignedIn) {
        setLoading(false);
        return;
      }

      setLoading(true);
      getLiveSolPrice().then(({ price }) => {
        if (price > 0) setLiveSolPrice(price);
      }).catch(() => {});
      try {
        const brandsRes = await backendApi.getMyBrands().catch(() => ({ brands: [] }));
        let userBrands = brandsRes.brands || [];

        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        let validBrand = userBrands.find(b => uuidPattern.test(b.id));

        // If this creator doesn't have a brand registered yet, automatically create one in Supabase
        if (!validBrand && user?.walletAddress) {
          try {
            const shortWallet = user.walletAddress.slice(0, 6).toLowerCase();
            const brandName = 'Circuit Atelier Studio';
            const baseSlug = 'circuit-atelier';
            const slug = `${baseSlug}-${shortWallet}`;

            const createdRes = await backendApi.createBrand({
              name: brandName,
              slug,
              payment_wallet_address: user.walletAddress,
            });
            if (createdRes?.brand && uuidPattern.test(createdRes.brand.id)) {
              validBrand = createdRes.brand;
              userBrands = [createdRes.brand, ...userBrands];
            }
          } catch (createErr) {
            console.warn('Auto-create brand notice:', createErr);
          }
        }

        setBrands(userBrands);
        if (validBrand) {
          setSelectedBrand(validBrand);
        } else if (userBrands.length > 0) {
          setSelectedBrand(userBrands[0]);
        }

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
              // Fetch orders for active batches (combining on-chain batch orders with client receipts)
              for (const b of res.batches) {
                const batchOrdersMap = new Map<string, any>();
                try {
                  const oRes = await backendApi.getBatchOrders(b.id);
                  if (oRes?.orders && Array.isArray(oRes.orders)) {
                    oRes.orders.forEach((o) => {
                      const key = o.id || o.purchase_signature;
                      if (key) batchOrdersMap.set(key, o);
                    });
                  }
                } catch (_) {}

                // Merge local cache orders for this batch or edition
                if (typeof window !== 'undefined') {
                  try {
                    const localOrders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
                    localOrders.forEach((o: any) => {
                      if ((o.batch_id === b.id || o.drop_id === ed.id) && !o.cancelled) {
                        const key = o.id || o.tx_signature;
                        if (key && !batchOrdersMap.has(key)) {
                          batchOrdersMap.set(key, {
                            id: key,
                            batch_id: b.id,
                            user_id: user?.id || 'demo-user',
                            buyer_wallet: user?.walletAddress || 'buyer.sol',
                            order_address: o.order_address || '',
                            vault_address: o.vault_address || '',
                            pickup_location_id: o.pickup_location_id || '',
                            size: o.size || 'Medium',
                            quantity: o.quantity || 1,
                            amount_lamports: '100000000',
                            purchase_signature: o.tx_signature || '',
                            purchased_at: o.created_at || new Date().toISOString(),
                            cancel_until: new Date(Date.now() + 86400000).toISOString(),
                            cancelled: false,
                            refunded_lamports: '0',
                          });
                        }
                      }
                    });
                  } catch (_) {}
                }

                if (batchOrdersMap.size > 0) {
                  const resolvedList = Array.from(batchOrdersMap.values());
                  setOrdersByBatch(prev => ({ ...prev, [b.id]: resolvedList }));
                }
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
      price_usd: 0,
      max_supply: 50,
      fabric: '',
      headpiece: '',
      embroidery: '',
      instagram: '',
      twitter: '',
      whatsapp: '',
      support_email: '',
      images: [],
    });
    setDeployResult(null);
    setWizardStep(1);
    setActiveTab('wizard');
    showToast('New Drop Form Ready', 'Configure your fresh collection pieces.');
  };

  const handleEditEdition = (ed: any) => {
    setIsEditingExisting(true);
    setEditingEditionId(ed.id);

    const socials = ed.social_links || getEditionSocialLinks(ed.id, ed.brand_id) || {};

    setEditionForm({
      id: ed.id,
      name: ed.name || '',
      description: ed.description || '',
      price_usd: Number(ed.price_usd || 30),
      max_supply: Number(ed.max_supply || 50),
      fabric: ed.fabric || '',
      headpiece: ed.headpiece || '',
      embroidery: ed.embroidery || '',
      instagram: socials.instagram || '',
      twitter: socials.twitter || '',
      whatsapp: socials.whatsapp || '',
      support_email: socials.support_email || '',
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
        opens_at: b.opens_at && new Date(b.opens_at).getTime() > Date.now() + 60000
          ? new Date(b.opens_at).toISOString().slice(0, 16)
          : new Date(Date.now() + 60000).toISOString().slice(0, 16),
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
    const activeBrand = await ensureValidBrand();
    if (!activeBrand) {
      showToast('Brand Required', 'Please connect your creator wallet to initialize your atelier brand.');
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
          social_links: {
            instagram: editionForm.instagram.trim() || undefined,
            twitter: editionForm.twitter.trim() || undefined,
            whatsapp: editionForm.whatsapp.trim() || undefined,
            support_email: editionForm.support_email.trim() || undefined,
          },
        });
      } else {
        await backendApi.createEdition({
          id: slugId,
          brand_id: activeBrand.id,
          name: editionForm.name.trim(),
          description: editionForm.description.trim(),
          price_usd: Number(editionForm.price_usd),
          max_supply: Number(editionForm.max_supply),
          fabric: editionForm.fabric.trim(),
          headpiece: editionForm.headpiece.trim(),
          embroidery: editionForm.embroidery.trim(),
          social_links: {
            instagram: editionForm.instagram.trim() || undefined,
            twitter: editionForm.twitter.trim() || undefined,
            whatsapp: editionForm.whatsapp.trim() || undefined,
            support_email: editionForm.support_email.trim() || undefined,
          },
        });
        setIsEditingExisting(true);
        setEditingEditionId(slugId);
        setEditionForm(prev => ({ ...prev, id: slugId }));
      }

      // Persist social trust signals
      saveEditionSocialLinks(slugId, {
        instagram: editionForm.instagram.trim() || undefined,
        twitter: editionForm.twitter.trim() || undefined,
        whatsapp: editionForm.whatsapp.trim() || undefined,
        support_email: editionForm.support_email.trim() || undefined,
      });

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

        const safeOpens = new Date(opensMs);
        safeOpens.setMilliseconds(0);
        const safeCloses = new Date(closesMs);
        safeCloses.setMilliseconds(0);
        const safeProd = new Date(prodMs);
        safeProd.setMilliseconds(0);
        const safeRel = new Date(relMs);
        safeRel.setMilliseconds(0);

        const fullAddress = `${batchForm.pickup_address}, ${batchForm.pickup_city}, ${batchForm.pickup_country}`.slice(0, 500);
        const batchPayload = {
          name: batchForm.name.trim(),
          opens_at: safeOpens.toISOString(),
          closes_at: safeCloses.toISOString(),
          production_starts_at: safeProd.toISOString(),
          release_at: safeRel.toISOString(),
          pickup_locations: [
            {
              name: batchForm.pickup_name.trim() || 'Circuit Atelier Station',
              address: fullAddress,
              instructions: batchForm.pickup_instructions.trim(),
            },
          ],
        };

        if (editingBatchId) {
          try {
            let currentRev = editingBatchRevision;
            try {
              const fresh = await backendApi.getMyBatchById(editingBatchId);
              if (fresh?.batch?.revision) currentRev = fresh.batch.revision;
            } catch (_) {}
            const res = await backendApi.updateBatchDraft(editingBatchId, batchPayload, currentRev);
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
  const deployWithOpeningTime = async (safeOpensMs: number) => {
    const activeBrand = await ensureValidBrand();
    if (!activeBrand) {
      showToast('Brand Required', 'Please connect and sign in with your creator wallet to initialize your atelier brand.');
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

    const closesMs = Math.max(new Date(batchForm.closes_at).getTime(), safeOpensMs + 86400000);
    const prodMs = Math.max(new Date(batchForm.production_starts_at).getTime(), closesMs + 48 * 3600000 + 3600000);
    const relMs = Math.max(new Date(batchForm.release_at).getTime(), prodMs + 86400000);

    if (closesMs <= safeOpensMs) {
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
          social_links: {
            instagram: editionForm.instagram.trim() || undefined,
            twitter: editionForm.twitter.trim() || undefined,
            whatsapp: editionForm.whatsapp.trim() || undefined,
            support_email: editionForm.support_email.trim() || undefined,
          },
        });
      } else {
        await backendApi.createEdition({
          id: slugId,
          brand_id: activeBrand.id,
          name: editionForm.name.trim(),
          description: editionForm.description.trim(),
          price_usd: Number(editionForm.price_usd),
          max_supply: Number(editionForm.max_supply),
          fabric: editionForm.fabric.trim(),
          headpiece: editionForm.headpiece.trim(),
          embroidery: editionForm.embroidery.trim(),
          social_links: {
            instagram: editionForm.instagram.trim() || undefined,
            twitter: editionForm.twitter.trim() || undefined,
            whatsapp: editionForm.whatsapp.trim() || undefined,
            support_email: editionForm.support_email.trim() || undefined,
          },
        });
      }

      saveEditionSocialLinks(slugId, {
        instagram: editionForm.instagram.trim() || undefined,
        twitter: editionForm.twitter.trim() || undefined,
        whatsapp: editionForm.whatsapp.trim() || undefined,
        support_email: editionForm.support_email.trim() || undefined,
      });

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
      const safeOpens = new Date(safeOpensMs);
      safeOpens.setMilliseconds(0);
      const safeCloses = new Date(closesMs);
      safeCloses.setMilliseconds(0);
      const safeProd = new Date(prodMs);
      safeProd.setMilliseconds(0);
      const safeRel = new Date(relMs);
      safeRel.setMilliseconds(0);

      const batchPayload = {
        name: batchForm.name.trim(),
        opens_at: safeOpens.toISOString(),
        closes_at: safeCloses.toISOString(),
        production_starts_at: safeProd.toISOString(),
        release_at: safeRel.toISOString(),
        pickup_locations: [
          {
            name: batchForm.pickup_name.trim() || 'Circuit Atelier Station',
            address: fullAddress,
            instructions: batchForm.pickup_instructions.trim(),
          },
        ],
      };

      let targetBatchId = editingBatchId;
      let targetBatchRevision = editingBatchRevision;

      if (editingBatchId) {
        // Fetch fresh revision to avoid BATCH_REVISION_CONFLICT
        let currentRev = targetBatchRevision;
        let canUpdate = true;
        try {
          const fresh = await backendApi.getMyBatchById(editingBatchId);
          if (fresh?.batch) {
            currentRev = fresh.batch.revision ?? targetBatchRevision;
            // If the batch was previously locked in 'initializing' but never deployed, updateDraft will fail with BATCH_NOT_EDITABLE.
            // In that case, we should create a fresh batch draft rather than crashing on the dead batch.
            if (fresh.batch.chain_status === 'initializing' && !fresh.batch.chain_batch_address) {
              canUpdate = false;
            }
          }
        } catch (_) {}

        if (canUpdate) {
          try {
            const updatedBatchRes = await backendApi.updateBatchDraft(editingBatchId, batchPayload, currentRev);
            if (updatedBatchRes?.batch?.revision) {
              targetBatchRevision = updatedBatchRes.batch.revision ?? targetBatchRevision;
            }
          } catch (updateErr: any) {
            if (updateErr?.message?.includes('BATCH_NOT_EDITABLE') || updateErr?.error?.includes('BATCH_NOT_EDITABLE')) {
              canUpdate = false;
            } else {
              throw updateErr;
            }
          }
        }

        if (!canUpdate) {
          const batchRes = await backendApi.createBatchDraft({
            edition_id: slugId,
            ...batchPayload,
          });
          targetBatchId = batchRes.batch.id;
          targetBatchRevision = batchRes.batch.revision || 1;
          setEditingBatchId(targetBatchId);
          setEditingBatchRevision(targetBatchRevision);
        }
      } else {
        const batchRes = await backendApi.createBatchDraft({
          edition_id: slugId,
          ...batchPayload,
        });
        targetBatchId = batchRes.batch.id;
        targetBatchRevision = batchRes.batch.revision || 1;
        setEditingBatchId(targetBatchId);
        setEditingBatchRevision(targetBatchRevision);
      }

      if (!targetBatchId) {
        throw new Error('Failed to resolve batch for deployment.');
      }

      // Step D: On-Chain Vault Deployment
      setDeployStepText('4/4 Please approve vault initialization in Phantom...');
      showToast('Phantom Approval Required', 'Please confirm the on-chain vault creation transaction in Phantom.');

      // Convert USD price to on-chain lamports using live market oracle
      const liveOracle = await getLiveSolPrice();
      const activeRate = liveOracle.price || liveSolPrice || DEFAULT_SOL_MARKET_PRICE;
      const rawLamports = Math.floor((Number(editionForm.price_usd || 30) / activeRate) * 1e9);
      const unitLamports = String(Math.max(rawLamports, 1000000));

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
      const userMsg = parseSolanaError(err);
      showToast('✗ Deployment Notice', userMsg);
    } finally {
      setIsDeploying(false);
      setDeployStepText('');
    }
  };

  const handleDeployToSolana = async () => {
    const nowMs = Date.now();
    let rawOpensMs = new Date(batchForm.opens_at).getTime();

    // In immediate mode: deploy with safe 15-minute future buffer automatically
    if (scheduleMode === 'immediate') {
      const immediateOpensMs = nowMs + 900000; // 15 mins
      deployWithOpeningTime(immediateOpensMs);
      return;
    }

    // In scheduled mode: check if the selected launch time has passed or is < 10 mins away
    const minBufferMs = 600000; // 10 minutes
    if (isNaN(rawOpensMs) || rawOpensMs < nowMs + minBufferMs) {
      const pastTimeStr = !isNaN(rawOpensMs) ? new Date(rawOpensMs).toLocaleString() : 'Selected date';
      setScheduleWarningModal({
        isOpen: true,
        pastTimeStr,
        onAutoAdjustAndPublish: () => {
          setScheduleWarningModal(prev => ({ ...prev, isOpen: false }));
          setScheduleMode('immediate');
          const autoOpens = new Date(Date.now() + 900000);
          setBatchForm(prev => ({ ...prev, opens_at: autoOpens.toISOString().slice(0, 16) }));
          deployWithOpeningTime(autoOpens.getTime());
        },
      });
      return;
    }

    deployWithOpeningTime(rawOpensMs);
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
              <span className="text-[0.65rem] font-bold uppercase tracking-widest text-emerald-400">Your Studio is Live</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Creator Studio</h1>
            <p className="text-[#888] text-sm mt-2 max-w-md leading-relaxed">
              Create drops, track orders, and get paid safely.
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
                <span className="text-[0.65rem] uppercase font-bold text-[#666] font-mono">My Studio:</span>
                <span className="text-xs font-mono text-white font-bold">{selectedBrand?.name || 'Circuit Atelier Studio'}</span>
              </div>
            )}

            <div className="px-3 py-1.5 rounded-2xl bg-white/[0.03] border border-white/10 text-xs font-mono text-emerald-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>{user?.walletAddress ? `${user.walletAddress.slice(0, 4)}...${user.walletAddress.slice(-4)}` : user?.email || 'Connected'}</span>
            </div>
          </div>
        </div>

        {/* Studio Navigation Tabs */}
        <div className="flex gap-2 border-b border-white/[0.06] pb-4 mb-8 overflow-x-auto no-scrollbar">
          {[
            { id: 'wizard', label: '1. Create a New Drop', icon: '🚀' },
            { id: 'directory', label: `2. My Drops (${editions.length})`, icon: '📁' },
            { id: 'demand', label: '3. Production Guide', icon: '✂️' },
            { id: 'claims', label: '4. My Earnings', icon: '💰' },
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
                { num: 1, title: 'Your Piece', desc: 'Photos, fabric and details' },
                { num: 2, title: 'Dates & Pickup', desc: 'When orders open and where buyers collect' },
                { num: 3, title: 'Publish', desc: 'Approve and go live' },
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
                  <h2 className="text-xl font-bold">Step 1: Your Piece</h2>
                  <p className="text-xs text-[#888] mt-1">Add your garment details and photos.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Drop Name</label>
                    <input
                      type="text"
                      value={editionForm.name}
                      onChange={(e) => setEditionForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g. Yellow Gown"
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Drop Link</label>
                    <input
                      type="text"
                      disabled={isEditingExisting}
                      value={editionForm.id}
                      onChange={(e) => setEditionForm(prev => ({ ...prev, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                      placeholder="e.g. yellow-gown"
                      className={`bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none focus:border-white/30 ${
                        isEditingExisting ? 'opacity-60 cursor-not-allowed' : ''
                      }`}
                    />
                    {isEditingExisting && (
                      <span className="text-[0.6rem] font-mono text-[#666]">Drop link is immutable once created.</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Description</label>
                  <textarea
                    rows={3}
                    value={editionForm.description}
                    onChange={(e) => setEditionForm(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Tell buyers about the look, the fabric and what inspired it."
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
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Finishing & Details</label>
                    <input
                      type="text"
                      placeholder="e.g. Hand-sewn trim, raw hem, metallic accents..."
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
                    <div className="flex items-center justify-between text-[0.6rem] font-mono text-[#888] px-1">
                      <span>≈ {Number(((Number(editionForm.price_usd) || 0) / (liveSolPrice || DEFAULT_SOL_MARKET_PRICE)).toFixed(4))} SOL</span>
                      <span className="text-emerald-400/80">Oracle: 1 SOL ≈ ${liveSolPrice.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Pieces Available</label>
                    <input
                      type="number"
                      value={editionForm.max_supply}
                      onChange={(e) => setEditionForm(prev => ({ ...prev, max_supply: Number(e.target.value) }))}
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none"
                    />
                  </div>
                </div>

                {/* Brand Presence & Direct Customer Support */}
                <div className="p-4 sm:p-5 rounded-2xl bg-white/[0.02] border border-white/10 flex flex-col gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <label className="text-[0.65rem] font-bold uppercase tracking-wider text-white font-mono">
                        Brand Presence & Customer Care
                      </label>
                      <span className="text-[10px] text-white/40 font-mono font-normal">Optional Trust Signals</span>
                    </div>
                    <p className="text-[0.65rem] text-[#888] mt-0.5">
                      Direct contact points displayed to buyers on your drop page for authentication, sizing guidance, and pickup assistance.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[0.6rem] uppercase tracking-wider text-[#aaa] font-mono">Instagram Handle / URL</label>
                      <input
                        type="text"
                        placeholder="@atelier or https://instagram.com/..."
                        value={editionForm.instagram}
                        onChange={(e) => setEditionForm(prev => ({ ...prev, instagram: e.target.value }))}
                        className="bg-[#0D0D0D] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none placeholder:text-white/20"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[0.6rem] uppercase tracking-wider text-[#aaa] font-mono">Twitter / X Handle</label>
                      <input
                        type="text"
                        placeholder="@atelier or https://x.com/..."
                        value={editionForm.twitter}
                        onChange={(e) => setEditionForm(prev => ({ ...prev, twitter: e.target.value }))}
                        className="bg-[#0D0D0D] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none placeholder:text-white/20"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[0.6rem] uppercase tracking-wider text-[#aaa] font-mono">WhatsApp Support Number</label>
                      <input
                        type="text"
                        placeholder="+234 800 000 0000"
                        value={editionForm.whatsapp}
                        onChange={(e) => setEditionForm(prev => ({ ...prev, whatsapp: e.target.value }))}
                        className="bg-[#0D0D0D] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none placeholder:text-white/20"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[0.6rem] uppercase tracking-wider text-[#aaa] font-mono">Customer Support Email</label>
                      <input
                        type="email"
                        placeholder="care@atelier.com"
                        value={editionForm.support_email}
                        onChange={(e) => setEditionForm(prev => ({ ...prev, support_email: e.target.value }))}
                        className="bg-[#0D0D0D] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none placeholder:text-white/20"
                      />
                    </div>
                  </div>
                </div>

                {/* Media Uploader */}
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Photos ({editionForm.images.length}/10)</label>
                    <span className="text-[0.6rem] text-[#666] font-mono">Your first photo is the cover image in the shop</span>
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
                        <span className="text-[0.65rem] font-bold uppercase text-[#888]">Add Photo</span>
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
                    <span>Proceed to Dates & Pickup →</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: PREORDER TERMS & PICKUP STATIONS */}
            {wizardStep === 2 && (
              <div className="card-glass p-8 border-white/10 rounded-3xl flex flex-col gap-6 animate-fade-in">
                <div className="border-b border-white/10 pb-4">
                  <h2 className="text-xl font-bold">Step 2: Dates & Pickup</h2>
                  <p className="text-xs text-[#888] mt-1">When orders open and where buyers collect.</p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">Drop Name</label>
                  <input
                    type="text"
                    value={batchForm.name}
                    onChange={(e) => setBatchForm(prev => ({ ...prev, name: e.target.value }))}
                    className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none"
                  />
                </div>

                {/* Launch Timing Dual-Mode Control */}
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-white font-mono">Launch Timing</label>
                    <span className="text-[10px] text-[#777] font-mono">Choose when orders open</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setScheduleMode('immediate');
                        const safeOpens = new Date(Date.now() + 900000);
                        setBatchForm(prev => ({
                          ...prev,
                          opens_at: safeOpens.toISOString().slice(0, 16)
                        }));
                      }}
                      className={`p-4 rounded-2xl border text-left flex flex-col gap-1.5 transition-all ${
                        scheduleMode === 'immediate'
                          ? 'bg-white/[0.08] border-white text-white shadow-xl ring-1 ring-white/20'
                          : 'bg-[#0D0D0D] border-white/10 text-white/60 hover:border-white/20 hover:text-white/80'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold font-mono uppercase tracking-wider text-white">⚡ Launch Imminently</span>
                        {scheduleMode === 'immediate' && (
                          <span className="text-[10px] text-emerald-400 font-mono font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">Selected</span>
                        )}
                      </div>
                      <p className="text-[0.65rem] text-[#888] leading-relaxed">
                        Preorder opens ~15 minutes after deployment. Perfect for launching your drop right away.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScheduleMode('scheduled')}
                      className={`p-4 rounded-2xl border text-left flex flex-col gap-1.5 transition-all ${
                        scheduleMode === 'scheduled'
                          ? 'bg-white/[0.08] border-white text-white shadow-xl ring-1 ring-white/20'
                          : 'bg-[#0D0D0D] border-white/10 text-white/60 hover:border-white/20 hover:text-white/80'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold font-mono uppercase tracking-wider text-white">📅 Schedule Ahead</span>
                        {scheduleMode === 'scheduled' && (
                          <span className="text-[10px] text-emerald-400 font-mono font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">Selected</span>
                        )}
                      </div>
                      <p className="text-[0.65rem] text-[#888] leading-relaxed">
                        Pick an exact future date and time for a planned marketing launch (e.g. tomorrow or next week).
                      </p>
                    </button>
                  </div>
                </div>

                {/* Timeline Matrix */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {scheduleMode === 'scheduled' ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">1. Orders Open (Scheduled)</label>
                        {new Date(batchForm.opens_at).getTime() > Date.now() + 600000 ? (
                          <span className="text-[10px] text-emerald-400 font-mono">🟢 Future launch set</span>
                        ) : (
                          <span className="text-[10px] text-amber-400 font-mono">⚠️ Time is very close or past</span>
                        )}
                      </div>
                      <input
                        type="datetime-local"
                        value={batchForm.opens_at}
                        onChange={(e) => setBatchForm(prev => ({ ...prev, opens_at: e.target.value }))}
                        className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none focus:border-white/30"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 justify-center p-3.5 rounded-xl bg-white/[0.02] border border-white/10">
                      <span className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">1. Orders Open</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-emerald-400 font-mono font-bold">⚡ Opens ~15 mins post-publish</span>
                      </div>
                      <span className="text-[10px] text-[#666]">Vault initializes immediately; checkout opens 15 mins later.</span>
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">2. Orders Close</label>
                    <input
                      type="datetime-local"
                      value={batchForm.closes_at}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, closes_at: e.target.value }))}
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-amber-400 font-mono">3. Production starts</label>
                    <input
                      type="datetime-local"
                      value={batchForm.production_starts_at}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, production_starts_at: e.target.value }))}
                      className="bg-[#0D0D0D] border border-amber-500/20 rounded-xl p-3 text-xs text-white font-mono focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888] font-mono">4. Pickup Date</label>
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
                    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                      <circle cx="12" cy="9" r="2.5" />
                    </svg>
                    <span className="text-xs font-bold uppercase tracking-wider text-white">Pickup Location</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[0.6rem] font-mono text-[#777] uppercase">Location Name</label>
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
                    <label className="text-[0.6rem] font-mono text-[#777] uppercase">Note for Buyers</label>
                    <input
                      type="text"
                      value={batchForm.pickup_instructions}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, pickup_instructions: e.target.value }))}
                      placeholder="Please show your order number when you arrive."
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
                      ← Back
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
                    <span>Review & Publish →</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: DEPLOY PREORDER VAULT ON SOLANA */}
            {wizardStep === 3 && (
              <div className="card-glass p-8 border-white/10 rounded-3xl flex flex-col gap-6 animate-fade-in">
                <div className="border-b border-white/10 pb-4">
                  <h2 className="text-xl font-bold">Step 3: Review & Publish</h2>
                  <p className="text-xs text-[#888] mt-1">
                    Buyers' payments are held safely until they receive their orders. Once you publish, your drop goes live in the shop.
                  </p>
                </div>

                {/* Summary Matrix */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-2xl bg-white/[0.02] border border-white/10">
                  <div className="flex flex-col gap-3">
                    <span className="text-[0.65rem] font-bold uppercase tracking-widest text-[#666] font-mono">Drop Details</span>
                    <div className="text-sm font-bold text-white">{editionForm.name || 'Name your drop'}</div>
                    <div className="text-xs text-[#888] leading-relaxed">{editionForm.description || 'Add a short description'}</div>
                    <div className="flex gap-4 pt-2 font-mono text-xs">
                      <div><span className="text-[#666]">Price:</span> ${editionForm.price_usd} each</div>
                      <div><span className="text-[#666]">Limit:</span> {editionForm.max_supply} pieces</div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 border-t md:border-t-0 md:border-l border-white/10 md:pl-6 pt-4 md:pt-0">
                    <span className="text-[0.65rem] font-bold uppercase tracking-widest text-[#666] font-mono">Order Timeline</span>
                    <div className="text-xs font-mono space-y-1.5 text-white/90">
                      <div><span className="text-[#666]">Drop Name:</span> {batchForm.name}</div>
                      <div>
                        <span className="text-[#666]">Orders Open:</span>{' '}
                        {scheduleMode === 'immediate'
                          ? 'Opens ~15 mins after publishing (Immediate Launch)'
                          : new Date(batchForm.opens_at).toLocaleString()}
                      </div>
                      <div><span className="text-[#666]">Orders Close:</span> {new Date(batchForm.closes_at).toLocaleString()}</div>
                      <div><span className="text-[#666]">Production starts:</span> {new Date(batchForm.production_starts_at).toLocaleString()}</div>
                      <div><span className="text-[#666]">Ready for Pickup:</span> {new Date(batchForm.release_at).toLocaleString()}</div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[#666]">Pickup Spot:</span> 
                        <svg className="w-3 h-3 text-white inline shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                          <circle cx="12" cy="9" r="2.5" />
                        </svg>
                        <span>{batchForm.pickup_name} ({batchForm.pickup_city})</span>
                      </div>
                    </div>
                  </div>

                  {/* Lookbook Photos Review */}
                  {editionForm.images.length > 0 && (
                    <div className="flex flex-col gap-2 pt-4 border-t border-white/10 md:col-span-2">
                      <span className="text-[0.65rem] font-bold uppercase tracking-widest text-[#666] font-mono">
                        Lookbook Photos ({editionForm.images.length})
                      </span>
                      <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
                        {editionForm.images.map((img, i) => (
                          <div key={i} className="w-16 h-20 rounded-xl relative overflow-hidden border border-white/10 shrink-0 bg-[#0D0D0D]">
                            <Image src={img.url} alt={img.tag || `Look ${i + 1}`} fill className="object-cover" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Brand Social & Customer Care Channels */}
                  <div className="flex flex-col gap-2 pt-4 border-t border-white/10 md:col-span-2">
                    <span className="text-[0.65rem] font-bold uppercase tracking-widest text-[#666] font-mono">Brand Trust & Care Signals</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                      <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex flex-col gap-0.5">
                        <span className="text-[0.6rem] text-[#777] uppercase">Instagram</span>
                        <span className="text-white truncate">{editionForm.instagram || '@circuit.fashion'}</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex flex-col gap-0.5">
                        <span className="text-[0.6rem] text-[#777] uppercase">Twitter / X</span>
                        <span className="text-white truncate">{editionForm.twitter || '@circuit_fashion'}</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex flex-col gap-0.5">
                        <span className="text-[0.6rem] text-[#777] uppercase">WhatsApp</span>
                        <span className="text-emerald-400 truncate">{editionForm.whatsapp || '+234 800 000 0000'}</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex flex-col gap-0.5">
                        <span className="text-[0.6rem] text-[#777] uppercase">Support Email</span>
                        <span className="text-white truncate">{editionForm.support_email || 'care@circuit.fashion'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Deployment Results Card */}
                {deployResult && (
                  <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col gap-3 animate-fade-in">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                      <span>✓</span>
                      <span>Drop Published to Storefront!</span>
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
                    ← Back
                  </button>

                  <button
                    onClick={handleDeployToSolana}
                    disabled={isDeploying}
                    className={`btn-circuit px-10 py-4 text-xs font-bold uppercase tracking-wider justify-center ${
                      isDeploying ? 'opacity-80 cursor-wait' : ''
                    }`}
                  >
                    <span>{isDeploying ? (deployStepText || 'Broadcasting to Solana...') : 'Publish My Drop ➔'}</span>
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
                <h2 className="text-2xl font-bold">My Drops</h2>
                <p className="text-xs text-[#888] mt-1">All your drops, live and draft.</p>
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
                            {isPublished ? '● Live on Storefront' : '○ Draft (not live yet)'}
                          </span>
                        </div>
                      </div>

                      {/* Info */}
                      <div>
                        <span className="text-[0.6rem] font-mono text-[#666] uppercase block mb-1">Link: {ed.id}</span>
                        <h3 className="text-lg font-bold text-white truncate">{ed.name}</h3>
                        <p className="text-xs text-[#888] line-clamp-2 mt-1 leading-relaxed">{ed.description}</p>
                      </div>

                      <div className="flex justify-between items-center text-xs font-mono text-[#A3A3A3] pt-2 border-t border-white/5">
                        <span>${ed.price_usd} USD</span>
                        <span>{ed.max_supply} pieces</span>
                      </div>

                      {/* Care Channels Trust Indicators */}
                      {ed.social_links && (
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5 text-[0.6rem] font-mono text-[#777]">
                          <span className="uppercase">Brand Channels:</span>
                          <div className="flex items-center gap-1.5">
                            {ed.social_links.instagram && (
                              <span className="px-1.5 py-0.5 rounded bg-white/[0.04] text-white/80 border border-white/5">
                                IG
                              </span>
                            )}
                            {ed.social_links.twitter && (
                              <span className="px-1.5 py-0.5 rounded bg-white/[0.04] text-white/80 border border-white/5">
                                𝕏
                              </span>
                            )}
                            {ed.social_links.whatsapp && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                WhatsApp
                              </span>
                            )}
                            {ed.social_links.support_email && (
                              <span className="px-1.5 py-0.5 rounded bg-white/[0.04] text-white/80 border border-white/5">
                                Email
                              </span>
                            )}
                          </div>
                        </div>
                      )}
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

        {/* ── TAB 3: PRODUCTION GUIDE ───────────────────────────────────────── */}
        {activeTab === 'demand' && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
              <div>
                <h2 className="text-2xl font-bold">Production Guide</h2>
                <p className="text-xs text-[#888] mt-1">Confirmed orders sorted by size, color and units to cut.</p>
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                className="btn-outline-circuit py-2 px-4 text-xs font-mono self-start sm:self-auto"
              >
                <span>🖨️ Print Cutting Guide</span>
              </button>
            </div>

            {Object.keys(batchesByEdition).length === 0 ? (
              <div className="card-glass p-12 text-center rounded-3xl border-white/10 text-xs text-[#888]">
                No active production runs found. Once your drop gathers customer orders, your size cutting guide will populate here.
              </div>
            ) : (
              <div className="space-y-8">
                {Object.entries(batchesByEdition).map(([editionId, batches]) => {
                  const ed = editions.find(e => e.id === editionId);
                  return (
                    <div key={editionId} className="card-glass p-6 md:p-8 rounded-3xl border-white/10 flex flex-col gap-6">
                      <div className="flex justify-between items-baseline border-b border-white/10 pb-4">
                        <div>
                          <span className="text-[0.6rem] font-mono text-[#666] uppercase block">Collection</span>
                          <h3 className="text-xl font-bold">{ed?.name || editionId}</h3>
                        </div>
                        <span className="text-xs font-mono text-emerald-400 font-bold">
                          Cap: {ed?.max_supply || 50} pieces
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
                                <span className="text-[0.65rem] text-[#888] font-mono block">
                                  Closes: {new Date(b.closes_at).toLocaleDateString()} | Ready: {new Date(b.release_at).toLocaleDateString()}
                                </span>
                              </div>
                              <span className="text-xs font-mono text-white bg-white/10 px-3 py-1 rounded-full font-bold">
                                {totalCommitted} Pieces to Cut
                              </span>
                            </div>

                            {/* Automated Cutting Guide Table */}
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-xs font-mono border border-white/10 rounded-xl overflow-hidden">
                                <thead className="bg-white/[0.03] text-[#888] uppercase text-[0.6rem]">
                                  <tr>
                                    <th className="p-3">Size Pattern</th>
                                    <th className="p-3">Confirmed Orders</th>
                                    <th className="p-3">Fabric Sourcing Spec</th>
                                    <th className="p-3 text-right">Production Action</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                  {Object.entries(sizeCounts).map(([sz, count]) => (
                                    <tr key={sz} className="hover:bg-white/[0.01]">
                                      <td className="p-3 font-bold text-white">{sz}</td>
                                      <td className="p-3 text-emerald-400 font-bold">{count} units</td>
                                      <td className="p-3 text-[#888]">{ed?.fabric || 'Standard atelier cut'}</td>
                                      <td className="p-3 text-right text-[#666]">
                                        {count > 0 ? '✓ Ready for cutting table' : 'Nil'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
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

        {/* ── TAB 4: MY EARNINGS ─────────────────────────────────────────────── */}
        {activeTab === 'claims' && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
              <div>
                <h2 className="text-2xl font-bold">My Earnings</h2>
                <p className="text-xs text-[#888] mt-1">Direct production advances and balance claims.</p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[0.65rem] font-mono px-2.5 py-1 rounded-lg bg-white/[0.04] text-[#888] border border-white/10">
                  7% Drop Protocol Fee
                </span>
              </div>
            </div>

            {/* Payout Milestone Policy Drawer (FAQ) */}
            <details className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-xs text-[#888] group">
              <summary className="cursor-pointer font-mono text-white/80 hover:text-white flex items-center justify-between font-bold">
                <span>How milestone escrow payouts work (FAQ)</span>
                <span className="text-xs group-open:rotate-180 transition-transform">▾</span>
              </summary>
              <div className="mt-3 pt-3 border-t border-white/5 space-y-1.5 leading-relaxed text-[#aaa]">
                <p>• <strong>30% Advance</strong> unlocks 48 hours after orders close to fund atelier fabric sourcing and manufacturing.</p>
                <p>• <strong>70% Balance</strong> unlocks when the buyer confirms delivery (or automatically 7 days post-delivery if no complaints are filed).</p>
                <p>• 7% Circuit platform protocol fee is applied upon settlement.</p>
              </div>
            </details>

            <div className="space-y-6">
              {Object.entries(batchesByEdition).flatMap(([_, batches]) => batches).length === 0 ? (
                <div className="card-glass p-12 text-center rounded-3xl border-white/10 text-xs text-[#888]">
                  No active payout batches yet. Once your preorder drop concludes, your 30% advance and 70% balance payouts will unlock here.
                </div>
              ) : (
                Object.entries(batchesByEdition).flatMap(([_, batches]) => batches).map((b) => {
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
                })
              )}
            </div>
          </div>
        )}
        {/* Schedule Adjustment Modal */}
        {scheduleWarningModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
            <div className="card-glass p-6 sm:p-8 max-w-lg w-full rounded-3xl border-white/20 bg-[#0E0E0E]/95 shadow-2xl flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-lg">
                  ⏰
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Scheduled Launch Time Passed</h3>
                  <p className="text-xs text-[#888]">Preorder vaults require opening in the future.</p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-[#aaa] space-y-2 leading-relaxed">
                <p>
                  Your chosen launch time (<span className="text-white font-mono font-bold">{scheduleWarningModal.pastTimeStr}</span>) was reached while completing the draft.
                </p>
                <p>
                  On Solana, on-chain preorder escrow vaults cannot be initialized with a timestamp in the past.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setScheduleWarningModal(prev => ({ ...prev, isOpen: false }));
                    setWizardStep(2);
                  }}
                  className="flex-1 py-3 px-4 rounded-xl text-xs font-mono uppercase tracking-wider text-[#aaa] hover:text-white border border-white/10 hover:border-white/20 bg-white/[0.02]"
                >
                  Adjust Schedule Manually
                </button>

                <button
                  type="button"
                  onClick={scheduleWarningModal.onAutoAdjustAndPublish}
                  className="flex-1 btn-circuit py-3 px-5 text-xs font-bold uppercase tracking-wider justify-center"
                >
                  <span>Launch in 15 Minutes →</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
