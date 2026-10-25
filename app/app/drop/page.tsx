'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAuth } from '@/lib/auth-context';
import * as backendApi from '@/lib/backendApi';
import {
  parseError,
  executeVerifiedPurchase,
} from '@/lib/solana-service';
import {
  solscanTxUrl,
  solanaExplorerTxUrl,
  solanaExplorerAccountUrl,
  formatUsd,
  formatSol,
  resolvePricing,
} from '@/lib/utils';
import { getLiveSolPrice } from '@/lib/price-service';
import { showToast } from '@/components/Toast';
import SignInModal from '@/components/SignInModal';
import Selector from '@/components/Selector';
import { saveOrder, getEditionById, getEditions } from '@/lib/db';
import { CLUSTER } from '@/lib/constants';

type TxState = 'idle' | 'signing' | 'success' | 'error' | 'soldout';
type TxStep = 'idle' | 'prepare' | 'sign' | 'submit' | 'confirm';

interface TxResult {
  txSignature?: string;
  solscanUrl?: string;
  escrowPDA?: string;
  orderNumber?: number;
  orderId?: string;
  vaultAddress?: string;
  orderAddress?: string;
  amountSol?: number;
  amountUsd?: number;
  quantity?: number;
  size?: string;
  editionName?: string;
  batchName?: string;
  releaseAt?: string;
  pickupLocation?: string;
  message?: string;
}

function DropPageContent() {
  const { user, isSignedIn } = useAuth();
  const { signTransaction } = useWallet();
  const searchParams = useSearchParams();
  const requestedEditionId = searchParams.get('edition');

  const [allEditions, setAllEditions] = useState<any[]>([]);
  const [edition, setEdition] = useState<any>(null);
  const [batches, setBatches] = useState<backendApi.Batch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<backendApi.Batch | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [mintedCount, setMintedCount] = useState(0);
  const [txState, setTxState] = useState<TxState>('idle');
  const [txStep, setTxStep] = useState<TxStep>('idle');
  const [txResult, setTxResult] = useState<TxResult>({});
  const [loading, setLoading] = useState(true);
  const [isVerifyingStock, setIsVerifyingStock] = useState(false);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [selectedSize, setSelectedSize] = useState('Medium');
  const [quantity, setQuantity] = useState(1);
  const [computedPrice, setComputedPrice] = useState(0);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<'fiat' | 'crypto'>('crypto');
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [showFiatModal, setShowFiatModal] = useState(false);
  const [fiatWaitlistEmail, setFiatWaitlistEmail] = useState('');
  const [fiatWaitlistJoined, setFiatWaitlistJoined] = useState(false);
  const [fulfillmentType, setFulfillmentType] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [copiedTx, setCopiedTx] = useState(false);
  const processingRef = useRef(false);
  const router = useRouter();

  // Fetch Drop, Supply Details, and Batches
  useEffect(() => {
    let isMounted = true;

    async function loadDropData() {
      try {
        setLoading(true);

        // Fetch Live SOL Price early for both catalog and detail views
        try {
          const { price: liveRate } = await getLiveSolPrice();
          if (liveRate > 0 && isMounted) {
            setSolPrice(liveRate);
          }
        } catch (e) {
          console.warn('Unable to fetch live SOL price, using fallback:', e);
        }

        // Fetch all editions for catalog grid and switcher
        const availableEditions = await getEditions();
        if (isMounted && availableEditions) {
          setAllEditions(availableEditions);
        }

        // If no edition is requested, we are in Catalog Mode: display all pieces!
        if (!requestedEditionId) {
          if (!isMounted) return;
          setEdition(null);
          setBatches([]);
          setSelectedBatch(null);
          setSelectedLocationId('');
          setLoading(false);
          return;
        }

        let activeEdition = null;
        if (requestedEditionId) {
          activeEdition = await getEditionById(requestedEditionId);
          if (!activeEdition) {
            try {
              const myEditions = await getEditions(false);
              const matched = myEditions.find((e: any) => e.id === requestedEditionId);
              if (matched) activeEdition = matched;
            } catch {
              // fallback
            }
          }
          if (!activeEdition && availableEditions) {
            const matched = availableEditions.find((e: any) => e.id === requestedEditionId);
            if (matched) activeEdition = matched;
          }
        }

        if (!isMounted) return;

        if (!activeEdition) {
          setEdition(null);
          setBatches([]);
          setSelectedBatch(null);
          setSelectedLocationId('');
          setLoading(false);
          return;
        }

        setEdition(activeEdition);

        // Calculate dynamic price based on size
        if (activeEdition.has_variable_prices && activeEdition.prices_by_size) {
          const priceMap = activeEdition.prices_by_size;
          setComputedPrice(Number((priceMap as Record<string, number>)[selectedSize] || activeEdition.price_usd));
        } else {
          setComputedPrice(Number(activeEdition.price_usd || 0));
        }

        // Helper to resolve accurate booked count across on-chain escrow, local cache, and API
        async function resolveMintedCount(edId: string, b: backendApi.Batch | null) {
          let count = 0;

          // 0. Query public batch stats from API (authoritative DB claimed units & max supply)
          if (b?.id) {
            try {
              const res = await backendApi.getBatchStats(b.id);
              if (typeof res?.stats?.edition?.claimed_units === 'number') {
                return res.stats.edition.claimed_units;
              }
            } catch (_) {}
          }

          // 1. Check on-chain batch escrow vault directly
          if (b?.id && b.chain_status === 'initialized') {
            try {
              const escRes = await backendApi.getBatchEscrow(b.id);
              if (escRes?.escrow?.total_deposited) {
                const netDeposited = BigInt(escRes.escrow.total_deposited) - BigInt(escRes.escrow.total_cancelled || 0);
                const unitLamports = b.pricing?.unit_price_lamports ? BigInt(b.pricing.unit_price_lamports) : BigInt(0);
                if (unitLamports > BigInt(0)) {
                  const chainUnits = Number(netDeposited / unitLamports);
                  if (chainUnits > count) count = chainUnits;
                }
              }
            } catch (_) {}
          }

          // 2. Aggregate local cache orders
          if (typeof window !== 'undefined') {
            try {
              const localOrders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
              const matchedLocal = localOrders.filter((o: any) =>
                (o.drop_id === edId || o.batch_id === b?.id) && !o.cancelled
              );
              const localUnits = matchedLocal.reduce((acc: number, curr: any) => acc + (curr.quantity || 1), 0);
              if (localUnits > count) count = localUnits;
            } catch (_) {}
          }

          // 3. Fallback to API endpoint if available
          try {
            const BASE = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
            const countRes = await fetch(`${BASE}/api/db/orders/count/${encodeURIComponent(edId)}`);
            if (countRes.ok) {
              const { count: apiCount } = await countRes.json();
              if (apiCount > count) count = apiCount;
            }
          } catch (_) {}

          return count;
        }

        // Fetch Live SOL Price via resilient multi-source oracle cascade
        try {
          const { price: liveRate } = await getLiveSolPrice();
          if (liveRate > 0 && isMounted) {
            setSolPrice(liveRate);
          }
        } catch (e) {
          console.warn('Unable to fetch live SOL price, using cached/offline fallback:', e);
        }

        // Fetch batches for this edition
        let resolvedBatch: backendApi.Batch | null = null;
        try {
          const batchRes = await backendApi.getPublicBatches(activeEdition.id);
          if (!isMounted) return;
          if (batchRes?.batches && batchRes.batches.length > 0) {
            setBatches(batchRes.batches);
            resolvedBatch = batchRes.batches[0];
            setSelectedBatch(batchRes.batches[0]);
            if (batchRes.batches[0].pickup_locations?.length > 0) {
              setSelectedLocationId(batchRes.batches[0].pickup_locations[0].id || 'loc-1');
            }
          } else {
            // Check seller batches
            try {
              const myBatchRes = await backendApi.getMyBatches({ editionId: activeEdition.id });
              if (!isMounted) return;
              if (myBatchRes?.batches && myBatchRes.batches.length > 0) {
                setBatches(myBatchRes.batches);
                resolvedBatch = myBatchRes.batches[0];
                setSelectedBatch(myBatchRes.batches[0]);
                if (myBatchRes.batches[0].pickup_locations?.length > 0) {
                  setSelectedLocationId(myBatchRes.batches[0].pickup_locations[0].id || 'loc-1');
                }
              } else {
                setBatches([]);
                resolvedBatch = null;
                setSelectedBatch(null);
                setSelectedLocationId('');
              }
            } catch {
              setBatches([]);
              resolvedBatch = null;
              setSelectedBatch(null);
              setSelectedLocationId('');
            }
          }
        } catch (e) {
          console.warn('Could not fetch batches for edition:', e);
          setBatches([]);
          resolvedBatch = null;
          setSelectedBatch(null);
          setSelectedLocationId('');
        }

        // Now resolve supply count using the batch and local orders
        const initialCount = await resolveMintedCount(activeEdition.id, resolvedBatch);
        if (isMounted) setMintedCount(initialCount);
      } catch (err) {
        console.error('Error fetching dynamic drop details:', err);
        setEdition(null);
        setBatches([]);
        setSelectedBatch(null);
        setSelectedLocationId('');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadDropData();

    // ── Silent background stock sync: polls count only, NEVER reloads page ──
    const interval = setInterval(async () => {
      const currentId = requestedEditionId || edition?.id;
      if (!currentId) return;
      try {
        let count = 0;
        if (selectedBatch?.id && selectedBatch.chain_status === 'initialized') {
          try {
            const escRes = await backendApi.getBatchEscrow(selectedBatch.id);
            if (escRes?.escrow?.total_deposited) {
              const netDeposited = BigInt(escRes.escrow.total_deposited) - BigInt(escRes.escrow.total_cancelled || 0);
              const unitLamports = selectedBatch.pricing?.unit_price_lamports ? BigInt(selectedBatch.pricing.unit_price_lamports) : BigInt(0);
              if (unitLamports > BigInt(0)) {
                count = Math.max(count, Number(netDeposited / unitLamports));
              }
            }
          } catch (_) {}
        }
        if (typeof window !== 'undefined') {
          try {
            const localOrders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
            const matchedLocal = localOrders.filter((o: any) =>
              (o.drop_id === currentId || o.batch_id === selectedBatch?.id) && !o.cancelled
            );
            const localUnits = matchedLocal.reduce((acc: number, curr: any) => acc + (curr.quantity || 1), 0);
            count = Math.max(count, localUnits);
          } catch (_) {}
        }
        if (isMounted && count > 0) {
          setMintedCount(prev => Math.max(prev, count));
        }
      } catch {
        // Silent error
      }
    }, 15000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [requestedEditionId]);

  // Recalculate price when size updates
  useEffect(() => {
    if (edition) {
      if (edition.has_variable_prices && edition.prices_by_size) {
        const priceMap = edition.prices_by_size;
        setComputedPrice(Number(priceMap[selectedSize] || edition.price_usd));
      } else {
        setComputedPrice(Number(edition.price_usd));
      }
    }
  }, [selectedSize, edition]);

  const activeEdition = edition;
  const maxSupply = activeEdition?.max_supply || 0;
  const isSoldOut = activeEdition ? mintedCount >= maxSupply : false;
  const fillPercent = maxSupply > 0 ? Math.min(100, (mintedCount / maxSupply) * 100) : 0;

  // Delivery Options Configuration
  const allowsDelivery = Boolean(activeEdition?.allows_delivery);
  const deliveryFeeUsd = allowsDelivery && fulfillmentType === 'delivery' ? Number(activeEdition?.delivery_fee_usd) || 0 : 0;

  // Authoritative Unified Pricing across entire app
  const batchLamports = (selectedBatch?.pricing?.prices_by_size_lamports && selectedSize && selectedBatch.pricing.prices_by_size_lamports[selectedSize])
    || selectedBatch?.pricing?.unit_price_lamports;

  const pricing = resolvePricing({
    editionPriceUsd: computedPrice || activeEdition?.price_usd || 0,
    batchLamports,
    quantity,
    selectedSize,
    pricesBySize: activeEdition?.prices_by_size,
    solRateUsd: solPrice,
    extraUsd: deliveryFeeUsd,
  });

  const unitSol = pricing.unitSol;
  const totalSol = pricing.totalSol;
  const totalUsd = pricing.totalUsd;

  const handleOrder = async () => {
    if (processingRef.current) return;

    if (!isSignedIn) {
      setIsSignInOpen(true);
      return;
    }

    if (!user?.email) {
      showToast('Email Required', 'Please provide an email to receive your order receipt and tracking updates.');
      setIsSignInOpen(true);
      return;
    }

    if (paymentMethod === 'fiat') {
      setShowFiatModal(true);
      return;
    }

    // Doorstep delivery address validation
    if (fulfillmentType === 'delivery') {
      if (!deliveryAddress.trim()) {
        showToast('Delivery Address Required', 'Please enter your street address for bonded courier delivery.');
        return;
      }
      if (!deliveryCity.trim()) {
        showToast('City / Region Required', 'Please enter your city and state for delivery.');
        return;
      }
    }

    processingRef.current = true;
    setIsVerifyingStock(true);
    setTxState('signing');
    setTxStep('prepare');
    setTxResult({});

    try {
      // 0. JIT Stock Availability Check right when buyer clicks Preorder
      try {
        if (selectedBatch?.id) {
          const res = await backendApi.getBatchStats(selectedBatch.id);
          if (typeof res?.stats?.edition?.claimed_units === 'number') {
            const currentClaimed = res.stats.edition.claimed_units;
            setMintedCount(currentClaimed);
            const totalMax = res.stats.max_supply || activeEdition.max_supply || 0;
            if (totalMax > 0 && currentClaimed + quantity > totalMax) {
              showToast('Sold Out', 'Sorry! This drop has insufficient capacity remaining.');
              setTxState('soldout');
              setIsVerifyingStock(false);
              processingRef.current = false;
              return;
            }
          }
        } else {
          const BASE = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
          const countRes = await fetch(`${BASE}/api/db/orders/count/${encodeURIComponent(activeEdition.id)}`);
          if (countRes.ok) {
            const { count } = await countRes.json();
            setMintedCount(count);
            if (count >= activeEdition.max_supply) {
              showToast('Sold Out', 'Sorry! This drop reached maximum capacity a moment ago.');
              setTxState('soldout');
              setIsVerifyingStock(false);
              processingRef.current = false;
              return;
            }
          }
        }
      } catch {
        // Non-blocking fallback
      }
      setIsVerifyingStock(false);

      // 1. If wallet is connected and signTransaction is available, execute verified 4-step chain flow
      if (selectedBatch && signTransaction) {
        // Pre-flight check: ensure batch is open
        if (selectedBatch.opens_at && new Date(selectedBatch.opens_at).getTime() > Date.now()) {
          const openTimeStr = new Date(selectedBatch.opens_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          showToast('Preorder Not Open Yet', `This drop is scheduled to open at ${openTimeStr}. Please check back then!`);
          setTxState('idle');
          return;
        }

        const pickupLocId = selectedLocationId || selectedBatch.pickup_locations?.[0]?.id || 'c4b12345-6789-4abc-def0-123456789ab1';
        try {
          showToast('Preparing Order', 'Generating verified intent on Solana Devnet...');
          const verified = await executeVerifiedPurchase({
            batchId: selectedBatch.id,
            quantity,
            size: selectedSize,
            pickupLocationId: pickupLocId,
            signTransaction,
            onStepChange: (step) => {
              setTxStep(step);
              if (step === 'sign') showToast('Signature Required', 'Please approve transaction in Phantom wallet.');
              if (step === 'submit') showToast('Submitting', 'Broadcasting transaction to Solana Devnet...');
              if (step === 'confirm') showToast('Confirming', 'Verifying on-chain state and escrow deposit...');
            },
          });

          // Persist order in database for order lookup and supply counter
          const assignedPieceNum = (mintedCount || 0) + 1;
          try {
            await saveOrder({
              email: user.email,
              drop_id: activeEdition.id,
              tx_signature: verified.signature,
              escrow_pda: verified.order?.vault_address || verified.order?.order_address || verified.signature,
              amount_usd: totalUsd,
              size: selectedSize,
              quantity: quantity,
              garment_serial: String(assignedPieceNum),
              order_number: assignedPieceNum,
            });
          } catch (dbErr) {
            console.warn('DB order save notice:', dbErr);
          }

          // Cache order info for passport
          if (typeof window !== 'undefined') {
            localStorage.setItem('circuit_last_order_tx', verified.signature);
            localStorage.setItem('circuit_last_order_id', verified.orderId);
            const richOrder = {
              id: verified.orderId,
              drop_id: activeEdition.id,
              batch_id: selectedBatch.id,
              tx_signature: verified.signature,
              vault_address: verified.order?.vault_address,
              order_address: verified.order?.order_address,
              amount_usd: totalUsd,
              amount_sol: totalSol,
              quantity,
              size: selectedSize,
              created_at: new Date().toISOString(),
              edition_name: activeEdition.name,
              email: (user?.email || '').trim().toLowerCase(),
              buyer_wallet: (user?.walletAddress || '').trim().toLowerCase(),
              wallet_address: (user?.walletAddress || '').trim().toLowerCase(),
              release_at: selectedBatch.release_at,
              pickup_location_id: pickupLocId,
              order_number: assignedPieceNum,
              garment_serial: String(assignedPieceNum),
              fulfillment_type: fulfillmentType,
              delivery_address: fulfillmentType === 'delivery' ? deliveryAddress.trim() : undefined,
              delivery_city: fulfillmentType === 'delivery' ? deliveryCity.trim() : undefined,
              delivery_phone: fulfillmentType === 'delivery' ? deliveryPhone.trim() : undefined,
              delivery_fee_usd: deliveryFeeUsd,
            };
            const existing = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
            localStorage.setItem('circuit_orders', JSON.stringify([richOrder, ...existing]));
          }

          setMintedCount((prev) => prev + quantity);
          setTxState('success');
          setTxStep('idle');
          setTxResult({
            txSignature: verified.signature,
            solscanUrl: verified.solscanUrl,
            orderId: verified.orderId,
            vaultAddress: verified.order?.vault_address,
            orderAddress: verified.order?.order_address,
            orderNumber: (mintedCount || 0) + 1,
            amountSol: totalSol,
            amountUsd: totalUsd,
            quantity,
            size: selectedSize,
            editionName: activeEdition.name,
            batchName: selectedBatch.name,
            releaseAt: selectedBatch.release_at,
            pickupLocation: fulfillmentType === 'delivery'
              ? `Doorstep Courier (${deliveryAddress.trim()}, ${deliveryCity.trim()})`
              : selectedBatch.pickup_locations?.find((l) => (l.id || '') === pickupLocId)?.name || 'Official Atelier Station',
          });
          showToast('✓ Confirmed', `Order #${(mintedCount || 0) + 1} confirmed on Solana Devnet!`);
          setTimeout(() => {
            document.getElementById('drop-tx')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 100);
          return;
        } catch (chainErr: any) {
          console.warn('Verified chain intent encountered issue:', chainErr);
          const errMsg = chainErr?.message || chainErr?.error || '';
          if (errMsg.includes('BATCH_NOT_OPEN')) {
            const openTimeStr = selectedBatch?.opens_at ? new Date(selectedBatch.opens_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'the scheduled time';
            showToast('Preorder Not Open', `This drop opens at ${openTimeStr}. Please check back when it opens!`);
            setTxState('idle');
            return;
          }
          if (errMsg.includes('BATCH_CLOSED')) {
            showToast('Preorder Closed', 'This preorder batch has concluded.');
            setTxState('idle');
            return;
          }
          if (errMsg.includes('INSUFFICIENT_FUNDS')) {
            showToast('Insufficient SOL', 'Your wallet does not have enough SOL for this purchase.');
            setTxState('idle');
            return;
          }

          showToast('Order Failed', errMsg || 'Could not complete on-chain purchase.');
          setTxState('idle');
          return;
        }
      } else {
        if (!selectedBatch) {
          showToast('Batch Required', 'A production batch must be scheduled before ordering.');
        } else if (!signTransaction) {
          showToast('Wallet Required', 'Please connect a Solana wallet supporting transaction signing.');
        }
        setTxState('idle');
        return;
      }
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e?.code === 'DropSoldOut') {
        setTxState('soldout');
        setTxResult({ message: parseError(err) });
        showToast('Scarcity Enforced', 'Drop sold out!');
      } else {
        setTxState('error');
        setTxResult({ message: parseError(err) });
        showToast('✗', 'Order failed');
      }
    } finally {
      processingRef.current = false;
      setTxStep('idle');
    }
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-72px)] flex flex-col items-center justify-center pt-[72px] bg-black text-white">
        <div className="w-12 h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
        <span className="text-xs font-mono text-[#555] mt-4">Loading drop details...</span>
      </div>
    );
  }

  if (!activeEdition) {
    if (allEditions.length === 0) {
      return (
        <div className="min-h-[calc(100vh-72px)] flex flex-col items-center justify-center pt-[72px] px-6 bg-black text-white selection:bg-white selection:text-black">
          <div className="card-glass max-w-lg w-full p-10 md:p-12 border border-white/10 rounded-3xl text-center flex flex-col items-center gap-6 animate-fade-in shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-2xl">
              ✨
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.25em] text-amber-400 font-mono">
                Atelier Vault Empty
              </span>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">No Active Drops Scheduled</h2>
              <p className="text-xs text-[#888] leading-relaxed max-w-sm mx-auto">
                There are currently no active runway drops accepting preorders. New collections are published directly by verified ateliers.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full justify-center pt-2">
              <Link href="/" className="btn-circuit py-3 px-6 text-xs justify-center">
                <span>Return Home</span>
              </Link>
              <Link href="/creator" className="btn-outline-circuit py-3 px-6 text-xs justify-center border-white/15 hover:border-white/30 text-white/80 hover:text-white">
                <span>Creator Studio ↗</span>
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return (
      <section className="min-h-[calc(100vh-72px)] flex flex-col pt-8 md:pt-14 pb-24 overflow-x-hidden bg-black text-white selection:bg-white selection:text-black">
        {/* Ambient Glow */}
        <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
          <div className="ambient-orb orb-white" />
          <div className="ambient-orb orb-grey" />
        </div>

        <div className="section-container relative z-10">
          {/* Catalog Editorial Header */}
          <div className="text-center max-w-3xl mx-auto mb-16 animate-fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[#A3A3A3] font-mono">
                Solana Escrow Vaults · Made to Order
              </span>
            </div>
            <h1 className="text-4xl md:text-7xl font-bold tracking-tight mb-4">
              Active Drops.
            </h1>
            <p className="text-sm md:text-base text-[#888] leading-relaxed max-w-xl mx-auto">
              Reserve limited atelier pieces directly from the designer. Payments remain locked in smart contract escrow vaults until delivery.
            </p>
          </div>

          {/* Drops Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {allEditions.map((ed) => {
              const solEquivalent = solPrice && solPrice > 0 ? (Number(ed.price_usd || 0) / solPrice).toFixed(3) : null;
              const coverImg = ed.images?.[0]?.url || ed.image_url || '/satin.png';

              return (
                <div
                  key={ed.id}
                  className="card-glass rounded-3xl border border-white/10 hover:border-white/25 transition-all duration-300 group overflow-hidden flex flex-col justify-between shadow-[0_15px_40px_rgba(0,0,0,0.5)]"
                >
                  <div>
                    {/* Lookbook Photography */}
                    <div className="relative aspect-[4/5] overflow-hidden bg-[#0D0D0D] border-b border-white/[0.08]">
                      <Image
                        src={coverImg}
                        alt={ed.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                      />
                      <div className="absolute top-4 left-4 z-10">
                        <span className="px-3 py-1 rounded-full text-[0.65rem] font-bold uppercase font-mono tracking-wider bg-black/60 backdrop-blur-md border border-white/20 text-white flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Preorder Open
                        </span>
                      </div>
                      <div className="absolute bottom-4 right-4 z-10">
                        <span className="px-3 py-1 rounded-full text-[0.65rem] font-mono font-bold bg-black/80 backdrop-blur-md border border-white/10 text-emerald-400">
                          {ed.max_supply || 50} Pieces Run
                        </span>
                      </div>
                    </div>

                    {/* Piece Details */}
                    <div className="p-6 flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[0.65rem] uppercase tracking-widest font-mono text-[#888]">
                          {ed.fabric || 'Atelier Collection'}
                        </span>
                        {ed.embroidery && (
                          <span className="text-[0.65rem] font-mono text-white/40 truncate max-w-[120px]">
                            {ed.embroidery}
                          </span>
                        )}
                      </div>

                      <h3 className="text-xl md:text-2xl font-bold tracking-tight text-white group-hover:text-white/90 transition-colors">
                        {ed.name}
                      </h3>

                      <p className="text-xs text-[#888] line-clamp-2 leading-relaxed">
                        {ed.description || 'Made-to-order runway design backed by Solana smart contract escrow.'}
                      </p>
                    </div>
                  </div>

                  {/* Pricing and Action */}
                  <div className="p-6 pt-0 border-t border-white/[0.06] mt-4 flex items-center justify-between">
                    <div className="flex flex-col pt-3">
                      <span className="text-base font-bold font-mono text-white">${ed.price_usd} USD</span>
                      {solEquivalent && (
                        <span className="text-[0.65rem] font-mono text-[#777]">≈ {solEquivalent} SOL</span>
                      )}
                    </div>

                    <Link
                      href={`/drop?edition=${ed.id}`}
                      className="btn-circuit py-2.5 px-5 text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 mt-3"
                    >
                      <span>Preorder ➔</span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-[calc(100vh-72px)] flex flex-col pt-[72px] overflow-x-hidden" aria-label={activeEdition.name}>
      {/* Ambient Orbs */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="ambient-orb orb-white" />
        <div className="ambient-orb orb-grey" />
      </div>

      {/* Hero */}
      <div className="flex-1 section-container py-10 md:py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center relative z-10">
        
        {/* Left: Checkout Specifications */}
        <div className="flex flex-col gap-8 order-2 lg:order-1" style={{ animation: 'fadeIn 0.6s ease-out' }}>
          {/* Tags */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="px-3 py-1 rounded-full text-[0.65rem] font-bold uppercase tracking-[0.08em] border border-white/20 text-[#A3A3A3]">
              Limited Drop
            </span>
            <span className="px-3 py-1 rounded-full text-[0.65rem] font-bold uppercase tracking-[0.08em] bg-white/[0.04] border border-white/[0.08] text-[#666]">
              Protected Payment
            </span>
            {!activeEdition.published && (
              <span className="px-3 py-1 rounded-full text-[0.65rem] font-bold uppercase tracking-[0.08em] bg-amber-500/10 border border-amber-500/25 text-amber-300 font-mono flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Atelier Preview Mode
              </span>
            )}
          </div>

          {/* Quick Breadcrumbs & Switcher */}
          <div className="w-full flex flex-wrap justify-between items-center gap-3 z-10 pt-2">
            <Link
              href="/drop"
              className="inline-flex items-center gap-2 text-[#888] hover:text-white transition-colors text-xs font-bold uppercase tracking-widest px-4 py-2 border border-white/10 rounded-full bg-white/[0.03] hover:bg-white/[0.06]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              All Drops Catalog
            </Link>

            {allEditions.length > 1 && (
              <div className="relative group">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-emerald-400 px-3.5 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all"
                >
                  <span>Other Drops</span>
                  <span className="text-[10px]">▾</span>
                </button>
                <div className="absolute right-0 top-full pt-2 w-64 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all duration-200 z-50">
                  <div className="p-2 border border-white/[0.12] rounded-2xl shadow-2xl backdrop-blur-2xl bg-black/95 flex flex-col gap-1 max-h-72 overflow-y-auto no-scrollbar">
                    {allEditions.map(ed => (
                      <Link
                        key={ed.id}
                        href={`/drop?edition=${ed.id}`}
                        className={`flex items-center gap-2.5 px-3 py-2 text-xs font-bold rounded-xl transition-colors ${
                          ed.id === activeEdition.id
                            ? 'bg-white/10 text-white border border-white/15'
                            : 'text-white/70 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <div className="w-7 h-7 rounded-lg overflow-hidden bg-white/5 relative shrink-0">
                          <Image src={ed.images?.[0]?.url || ed.image_url || '/satin.png'} alt={ed.name} fill className="object-cover" />
                        </div>
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="truncate">{ed.name}</span>
                          <span className="text-[10px] font-mono text-[#888]">${ed.price_usd}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Title & Brand */}
          <div className="flex flex-col">
            <h1 className="text-[3.5rem] md:text-[5.5rem] leading-[0.85] font-bold tracking-[-0.04em] mb-4">
              <span className="block">Proceed</span>
              <span className="block bg-gradient-to-b from-white to-[#666] bg-clip-text text-transparent">With Order</span>
            </h1>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2.5 flex-wrap">
                  {(activeEdition.brand_logo || activeEdition.brand?.logo_url) && (
                    <div className="w-5 h-5 rounded-full overflow-hidden border border-white/20 relative shrink-0">
                      <Image
                        src={activeEdition.brand_logo || activeEdition.brand?.logo_url}
                        alt={activeEdition.brand_name || 'Brand Logo'}
                        fill
                        className="object-cover"
                      />
                    </div>
                  )}
                  <span className="text-[0.68rem] uppercase tracking-[0.22em] font-mono text-emerald-400 font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    {activeEdition.brand_name || activeEdition.brand?.name || 'Verified Atelier'}
                  </span>
                  <span className="text-[0.68rem] font-mono font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                    ★ 4.9 Verified Craft
                  </span>
                </div>
                <h2 className="text-[1.8rem] md:text-[2.2rem] font-light text-white/90 tracking-[-0.02em]">{activeEdition.name}</h2>
              </div>
              {/* Brand Social & Support Links */}
              {activeEdition.social_links && (
                <div className="flex items-center gap-2">
                  {activeEdition.social_links.instagram && (
                    <a
                      href={activeEdition.social_links.instagram.startsWith('http') ? activeEdition.social_links.instagram : `https://instagram.com/${activeEdition.social_links.instagram.replace(/^@/, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Brand Instagram"
                      className="w-7 h-7 rounded-full bg-white/[0.04] hover:bg-white/10 border border-white/10 flex items-center justify-center text-xs text-[#A3A3A3] hover:text-white transition-all"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                    </a>
                  )}
                  {activeEdition.social_links.twitter && (
                    <a
                      href={activeEdition.social_links.twitter.startsWith('http') ? activeEdition.social_links.twitter : `https://x.com/${activeEdition.social_links.twitter.replace(/^@/, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Brand X / Twitter"
                      className="w-7 h-7 rounded-full bg-white/[0.04] hover:bg-white/10 border border-white/10 flex items-center justify-center text-xs text-[#A3A3A3] hover:text-white transition-all font-bold font-mono"
                    >
                      𝕏
                    </a>
                  )}
                  {activeEdition.social_links.whatsapp && (
                    <a
                      href={activeEdition.social_links.whatsapp.startsWith('http') ? activeEdition.social_links.whatsapp : `https://wa.me/${activeEdition.social_links.whatsapp.replace(/[^0-9]/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Customer Care / WhatsApp"
                      className="w-7 h-7 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-[10px] text-emerald-400 hover:text-emerald-300 transition-all font-bold"
                    >
                      💬
                    </a>
                  )}
                  {activeEdition.social_links.support_email && (
                    <a
                      href={activeEdition.social_links.support_email.startsWith('mailto:') ? activeEdition.social_links.support_email : `mailto:${activeEdition.social_links.support_email}`}
                      title="Support Email"
                      className="w-7 h-7 rounded-full bg-white/[0.04] hover:bg-white/10 border border-white/10 flex items-center justify-center text-xs text-[#A3A3A3] hover:text-white transition-all"
                    >
                      ✉️
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>

          {activeEdition.description && (
            <p className="text-[0.95rem] text-[#A3A3A3] leading-[1.8] max-w-[540px]">
              {activeEdition.description.replace(/^limited\s+edition\s+/i, '')}
            </p>
          )}

          {/* Atelier Specifications Matrix */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-md overflow-hidden transition-all duration-300 hover:border-white/15 shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
            {/* Primary Metrics: Availability & Unit Price */}
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.08] border-b border-white/[0.08] bg-white/[0.015]">
              {/* Availability Metric */}
              <div className="p-4 sm:p-5 flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-[#888]">
                      Availability
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-base sm:text-lg font-bold text-white tracking-tight">
                      {maxSupply - mintedCount} Left
                    </span>
                    <span className="text-[0.65rem] font-mono text-[#666]">
                      / {maxSupply} Units
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[0.6rem] font-mono font-semibold uppercase tracking-wider whitespace-nowrap">
                  {isSoldOut ? 'Sold Out' : 'Open Drop'}
                </span>
              </div>

              {/* Unit Price Metric */}
              <div className="p-4 sm:p-5 flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-[#888]">
                      Unit Price
                    </span>
                    <span className="text-[0.6rem] font-mono text-white/40">• per piece</span>
                  </div>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-base sm:text-lg font-bold font-mono text-emerald-400 tracking-tight">
                      {pricing.unitSolFormatted} SOL
                    </span>
                    <span className="text-[0.68rem] font-mono text-[#888]">
                      (~{pricing.unitUsdFormatted})
                    </span>
                  </div>
                </div>
                <span
                  className="px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 text-white/70 text-[0.6rem] font-mono font-semibold uppercase tracking-wider whitespace-nowrap cursor-help"
                  title={`Live Oracle Conversion: 1 SOL ≈ $${(solPrice || 111.20).toFixed(2)} USD`}
                >
                  {solPrice ? `1 SOL ≈ $${solPrice.toFixed(0)}` : 'Escrow Rate'}
                </span>
              </div>
            </div>

            {/* Artisanal Specifications: Main Fabric, Headpiece, Embroidery */}
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.08] p-3.5 sm:p-4 bg-black/30">
              <div className="px-3 py-2 sm:py-1">
                <span className="block text-[0.58rem] font-bold uppercase tracking-[0.14em] text-[#666] mb-1">
                  Main Fabric
                </span>
                <span className="text-xs sm:text-sm font-semibold text-white/90 block truncate" title={activeEdition.fabric || 'Duchess satin'}>
                  {activeEdition.fabric || 'Duchess satin'}
                </span>
              </div>

              <div className="px-3 py-2 sm:py-1">
                <span className="block text-[0.58rem] font-bold uppercase tracking-[0.14em] text-[#666] mb-1">
                  Headpiece
                </span>
                <span className="text-xs sm:text-sm font-semibold text-white/90 block truncate" title={activeEdition.headpiece || 'Velvet'}>
                  {activeEdition.headpiece || 'Velvet'}
                </span>
              </div>

              <div className="px-3 py-2 sm:py-1">
                <span className="block text-[0.58rem] font-bold uppercase tracking-[0.14em] text-[#666] mb-1">
                  Embroidery
                </span>
                <span className="text-xs sm:text-sm font-semibold text-white/90 block truncate" title={activeEdition.embroidery || 'Metallic thread'}>
                  {activeEdition.embroidery || 'Metallic thread'}
                </span>
              </div>
            </div>
          </div>

          {/* Preorder Batch Selector */}
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-baseline">
              <span className="text-[0.65rem] text-[#666] uppercase tracking-[0.12em] font-bold">Select Drop</span>
              {selectedBatch?.closes_at && (
                <span className="text-[0.65rem] font-mono text-[#888]">
                  Closes: {new Date(selectedBatch.closes_at).toLocaleDateString()}
                </span>
              )}
            </div>
            {batches.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {batches.map((b) => {
                  const isSelected = selectedBatch?.id === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setSelectedBatch(b);
                        if (b.pickup_locations?.length > 0) {
                          setSelectedLocationId(b.pickup_locations[0].id || 'loc-1');
                        }
                      }}
                      className={`p-4 rounded-2xl text-left border transition-all ${
                        isSelected
                          ? 'border-white bg-white/[0.06] shadow-[0_0_20px_rgba(255,255,255,0.05)]'
                          : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-white tracking-wide">{b.name}</span>
                        <span className={`text-[0.6rem] font-bold uppercase px-2 py-0.5 rounded-full border ${
                          b.opens_at && new Date(b.opens_at).getTime() > Date.now()
                            ? 'border-amber-400/30 text-amber-400 bg-amber-400/10'
                            : 'border-emerald-400/30 text-emerald-400 bg-emerald-400/10'
                        }`}>
                          {b.opens_at && new Date(b.opens_at).getTime() > Date.now() ? 'Opens Soon' : (b.sales_window_status || 'Open Drop')}
                        </span>
                      </div>
                      <div className="text-[0.65rem] text-[#888] font-mono space-y-0.5">
                        <div>Estimated Arrival: {new Date(b.release_at).toLocaleDateString()}</div>
                        <div>Collection Point: {b.pickup_locations?.[0]?.name ? `${b.pickup_locations[0].name} (${b.pickup_locations[0].city})` : 'Designated Atelier Point'}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-5 rounded-2xl border border-white/[0.08] bg-white/[0.02] text-center flex flex-col items-center gap-1.5">
                <span className="text-[0.6rem] font-bold uppercase tracking-widest text-amber-400 font-mono">
                  Drop Schedule Pending
                </span>
                <p className="text-xs text-[#888] leading-relaxed max-w-sm">
                  The atelier is finalizing production window dates and collection points for this piece. Preorders will open once the schedule is confirmed.
                </p>
              </div>
            )}
          </div>

          {/* Fulfillment & Delivery Method */}
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-baseline">
              <span className="text-[0.65rem] text-[#666] uppercase tracking-[0.12em] font-bold">
                Fulfillment Method
              </span>
              <span className="text-[0.6rem] font-mono text-[#888]">
                Escrow-Protected Handover
              </span>
            </div>

            {/* Method Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Option 1: In-Person Collection Point */}
              <button
                type="button"
                onClick={() => setFulfillmentType('pickup')}
                className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between relative overflow-hidden ${
                  fulfillmentType === 'pickup'
                    ? 'border-white bg-white/[0.08] shadow-[0_0_20px_rgba(255,255,255,0.06)]'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/30'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <span className="text-xs font-bold text-white tracking-wide">Collection Point</span>
                  </div>
                  <span className={`text-[0.6rem] font-bold uppercase px-2 py-0.5 rounded-full border ${
                    fulfillmentType === 'pickup'
                      ? 'border-emerald-400/40 text-emerald-400 bg-emerald-400/10'
                      : 'border-white/10 text-[#888] bg-transparent'
                  }`}>
                    {fulfillmentType === 'pickup' ? 'Selected' : 'Collection Point'}
                  </span>
                </div>
                <p className="text-[0.68rem] text-[#aaa] leading-relaxed">
                  Collect your order at the designated location. Scan your unique QR code to verify collection and securely complete your order.
                </p>
              </button>

              {/* Option 2: Delivery (Controlled by Brand Edition Settings) */}
              {allowsDelivery ? (
                <button
                  type="button"
                  onClick={() => setFulfillmentType('delivery')}
                  className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between relative overflow-hidden ${
                    fulfillmentType === 'delivery'
                      ? 'border-emerald-500/60 bg-emerald-500/[0.08] shadow-[0_0_20px_rgba(16,185,129,0.1)]'
                      : 'border-white/10 bg-white/[0.02] hover:border-white/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-white">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400">
                        <rect x="1" y="3" width="15" height="13" />
                        <polygon points="16 8 20 8 23 11 23 16 16 16 8" />
                        <circle cx="5.5" cy="18.5" r="2.5" />
                        <circle cx="18.5" cy="18.5" r="2.5" />
                      </svg>
                      <span className="text-xs font-bold tracking-wide">Delivery</span>
                    </div>
                    <span className={`text-[0.6rem] font-bold uppercase px-2 py-0.5 rounded-full border ${
                      fulfillmentType === 'delivery'
                        ? 'border-emerald-400/40 text-emerald-400 bg-emerald-400/10'
                        : 'border-white/10 text-emerald-400/80 bg-white/[0.02]'
                    }`}>
                      {Number(activeEdition?.delivery_fee_usd) > 0 ? `+$${Number(activeEdition.delivery_fee_usd).toFixed(2)}` : 'Free Delivery'}
                    </span>
                  </div>
                  <p className="text-[0.68rem] text-[#aaa] leading-relaxed">
                    Insured bonded courier dispatched directly to your home or office address.
                  </p>
                </button>
              ) : (
                <div
                  className="p-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.015] opacity-60 cursor-not-allowed select-none flex flex-col justify-between relative overflow-hidden"
                  title="Delivery has been deactivated by the brand for this drop"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-[#777]">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#666]">
                        <rect x="1" y="3" width="15" height="13" />
                        <polygon points="16 8 20 8 23 11 23 16 16 16 8" />
                        <circle cx="5.5" cy="18.5" r="2.5" />
                        <circle cx="18.5" cy="18.5" r="2.5" />
                      </svg>
                      <span className="text-xs font-bold tracking-wide text-[#888]">Delivery</span>
                    </div>
                    <span className="text-[0.55rem] font-bold font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border border-white/10 text-[#777] bg-white/[0.02]">
                      Deactivated by Brand
                    </span>
                  </div>
                  <p className="text-[0.65rem] text-[#666] leading-relaxed">
                    Atelier has designated this drop exclusively for in-person Collection Point pickup & QR verification.
                  </p>
                </div>
              )}
            </div>

            {/* Dynamic Collection Point vs Courier Delivery Address */}
            {fulfillmentType === 'pickup' ? (
              <div className="flex flex-col gap-2 mt-1 animate-fade-in">
                <span className="text-[0.62rem] text-[#666] uppercase tracking-[0.1em] font-semibold">
                  Select Collection Point
                </span>
                {selectedBatch && selectedBatch.pickup_locations?.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <select
                      value={selectedLocationId}
                      onChange={(e) => setSelectedLocationId(e.target.value)}
                      className="w-full bg-[#0d0d0d] border border-white/[0.12] rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-white/40"
                    >
                      {selectedBatch.pickup_locations.map((loc, idx) => (
                        <option key={loc.id || idx} value={loc.id || `loc-${idx}`}>
                          {loc.name} — {loc.address}, {loc.city}, {loc.country}
                        </option>
                      ))}
                    </select>

                    {(() => {
                      const activeLoc = selectedBatch.pickup_locations.find((l) => (l.id || '') === selectedLocationId) || selectedBatch.pickup_locations[0];
                      return activeLoc?.instructions ? (
                        <p className="text-[0.65rem] text-[#777] font-mono italic px-1">
                          ℹ Instructions: {activeLoc.instructions}
                        </p>
                      ) : null;
                    })()}
                  </div>
                ) : (
                  <div className="p-3 text-xs text-[#888] border border-white/[0.08] rounded-xl bg-white/[0.02]">
                    Official Brand Studio Collection Station
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3 mt-1 p-4 rounded-2xl bg-white/[0.03] border border-white/10 animate-fade-in">
                <div className="flex items-center justify-between">
                  <span className="text-[0.62rem] text-white uppercase tracking-[0.1em] font-bold font-mono flex items-center gap-1.5">
                    <span>📍</span> Bonded Courier Delivery Address
                  </span>
                  <span className="text-[0.55rem] font-mono text-emerald-400">
                    {Number(activeEdition?.delivery_fee_usd) > 0 ? `Fee: +$${Number(activeEdition.delivery_fee_usd).toFixed(2)} USD` : 'Free Delivery'}
                  </span>
                </div>

                <div className="flex flex-col gap-2.5 text-xs">
                  <div className="flex flex-col gap-1">
                    <label className="text-[0.6rem] uppercase tracking-wider text-[#888] font-mono">
                      Street Address & Apt/Suite <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 14 Victoria Island Boulevard, Apt 4B"
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      className="bg-[#0D0D0D] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-white/30 placeholder:text-white/20"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1">
                      <label className="text-[0.6rem] uppercase tracking-wider text-[#888] font-mono">
                        City & State / Region <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Lagos, Nigeria"
                        value={deliveryCity}
                        onChange={(e) => setDeliveryCity(e.target.value)}
                        className="bg-[#0D0D0D] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-white/30 placeholder:text-white/20"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[0.6rem] uppercase tracking-wider text-[#888] font-mono">
                        Courier Contact Phone
                      </label>
                      <input
                        type="tel"
                        placeholder="e.g. +234 800 000 0000"
                        value={deliveryPhone}
                        onChange={(e) => setDeliveryPhone(e.target.value)}
                        className="bg-[#0D0D0D] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-white/30 placeholder:text-white/20 font-mono"
                      />
                    </div>
                  </div>

                  {activeEdition?.delivery_notes && (
                    <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 text-[0.65rem] text-[#aaa] font-mono">
                      <strong className="text-white">Brand Note:</strong> {activeEdition.delivery_notes}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sizing & Quantity */}
          <div className="flex flex-col gap-6">
            <Selector 
              label="Select Size" 
              options={['Small', 'Medium', 'Large', 'Extra Large']} 
              selected={selectedSize} 
              onChange={setSelectedSize} 
            />
            
            {/* Quantity Selector */}
            <div className="flex flex-col gap-3">
              <span className="text-[0.65rem] text-[#666] uppercase tracking-[0.12em] font-bold">Quantity</span>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center hover:bg-white/5 transition-colors"
                  type="button"
                >
                  <span className="text-white text-lg">−</span>
                </button>
                <span className="text-lg font-bold min-w-[20px] text-center">{quantity}</span>
                <button 
                  onClick={() => setQuantity(quantity + 1)}
                  className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center hover:bg-white/5 transition-colors"
                  type="button"
                >
                  <span className="text-white text-lg">+</span>
                </button>
              </div>
            </div>
          </div>

          {/* Supply Status Fill Bar */}
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-baseline">
              <span className="text-[0.65rem] text-[#666] uppercase tracking-[0.12em] font-bold">Drop Progress</span>
              <span className="text-sm font-mono">
                <strong>{mintedCount}</strong>
                <span className="text-[#444]"> of {maxSupply} confirmed</span>
              </span>
            </div>
            <div className="mp-track">
              <div className="mp-fill" style={{ width: `${fillPercent}%` }} />
            </div>
          </div>

          {/* Transaction CTA */}
          <div className="flex flex-col gap-6">
            
            {/* Payment Method Selector */}
            <div className="flex flex-col gap-3">
              <span className="text-[0.65rem] text-[#666] uppercase tracking-[0.12em] font-bold">Payment Method</span>
              <div className="flex bg-white/[0.02] border border-white/5 rounded-xl p-1 gap-1">
                <button 
                  onClick={() => setPaymentMethod('crypto')}
                  className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-1.5 ${paymentMethod === 'crypto' ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.1)]' : 'text-[#666] hover:text-white hover:bg-white/[0.02]'}`}
                >
                  <span>Solana Crypto ({pricing.totalSolFormatted} SOL)</span>
                </button>
                <button 
                  onClick={() => {
                    setPaymentMethod('fiat');
                    setShowFiatModal(true);
                  }}
                  className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-2 relative ${paymentMethod === 'fiat' ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.1)]' : 'text-[#888] hover:text-white hover:bg-white/[0.02]'}`}
                >
                  <span>Card / Fiat</span>
                  <span className="text-[0.55rem] font-mono font-bold tracking-tight px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-400 border border-amber-400/30 uppercase">
                    Coming Soon
                  </span>
                </button>
              </div>
            </div>

            {/* Escrow Protocol & Cancellation Guarantee Notice */}
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] text-[0.68rem] text-[#999] leading-relaxed space-y-2">
              <div className="flex items-center gap-2 text-white font-bold uppercase tracking-wider text-[0.65rem]">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Protected by Circuit Escrow</span>
              </div>
              <ul className="space-y-1.5 list-disc list-inside text-[#888] font-mono text-[0.65rem]">
                <li>
                  <strong className="text-white">Protected Payment:</strong> Your money stays safe until you receive and confirm your order.
                </li>
                <li>
                  <strong className="text-white">Customer Support:</strong> Get direct support from the brand, with Circuit ready to help resolve any issues.
                </li>
              </ul>
            </div>

            <div className="flex flex-col gap-3">
              {txState === 'signing' && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-[0.65rem] font-mono text-emerald-400">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M12 2a10 10 0 010 20 10 10 0 010-20"/></svg>
                  <span>
                    {txStep === 'prepare' && 'Step 1/4: Preparing on-chain purchase intent...'}
                    {txStep === 'sign' && 'Step 2/4: Requesting Phantom wallet signature...'}
                    {txStep === 'submit' && 'Step 3/4: Broadcasting transaction to Solana devnet...'}
                    {txStep === 'confirm' && 'Step 4/4: Confirming finality and recording escrow order...'}
                  </span>
                </div>
              )}

              <button
                className={`btn-circuit w-full ${txState === 'signing' || isVerifyingStock ? 'signing' : ''} ${isSoldOut || activeEdition.published === false || batches.length === 0 ? '!bg-[#111] !text-[#555] !border-white/10' : ''}`}
                onClick={activeEdition.published !== false && batches.length > 0 ? handleOrder : undefined}
                disabled={txState === 'signing' || isVerifyingStock || isSoldOut || activeEdition.published === false || batches.length === 0}
              >
                <span>
                  {isVerifyingStock ? 'Checking stock...' :
                   txState === 'signing' ? 'Processing on Solana...' : 
                   txState === 'success' ? '✓ Order Confirmed' :
                   activeEdition.published === false ? 'Preview Mode (Unpublished)' :
                   isSoldOut ? 'Sold Out' :
                   batches.length === 0 ? 'Batch Scheduling In Progress' :
                   selectedBatch?.opens_at && new Date(selectedBatch.opens_at).getTime() > Date.now() ?
                     `Opens at ${new Date(selectedBatch.opens_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` :
                   paymentMethod === 'fiat' ?
                     `Card Checkout (Coming Soon — ${pricing.totalUsdFormatted})` :
                     `Pre-Order (${pricing.totalSolFormatted} SOL)`}
                </span>
                <span className="btn-arrow">
                  {txState === 'signing' || isVerifyingStock ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M12 2a10 10 0 010 20 10 10 0 010-20"/></svg>
                  ) : isSoldOut || activeEdition.published === false || batches.length === 0 ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-20"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  )}
                </span>
              </button>
            </div>
          </div>

          {/* Transaction Outputs */}
          <div id="drop-tx" role="status" aria-live="polite" className="min-h-[60px]">
            {txState === 'success' && txResult.txSignature && (
              <div className="card-glass p-6 md:p-7 border border-emerald-500/30 bg-emerald-500/[0.04] rounded-3xl flex flex-col gap-4 animate-scale-in shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_#34d399]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-white">Payment Secured in Escrow</span>
                  </div>
                  <span className="text-[0.65rem] font-mono text-emerald-400 px-2.5 py-0.5 rounded-full bg-emerald-400/10 border border-emerald-400/20">
                    {CLUSTER === 'mainnet-beta' ? 'Solana Mainnet' : 'Solana Devnet'}
                  </span>
                </div>

                {/* Subtitle Reassurance */}
                <p className="text-[0.72rem] text-[#aaa] leading-relaxed">
                  Your funds are secured in on-chain escrow. Review your transaction proof below or open your Digital Product Passport whenever you are ready.
                </p>

                {/* Garment & Edition stats */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <span className="text-[0.6rem] uppercase tracking-wider text-[#777] block mb-1">Edition Reserved</span>
                    <span className="font-bold text-white text-sm">
                      #{txResult.orderNumber || 1} of {maxSupply} Units
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <span className="text-[0.6rem] uppercase tracking-wider text-[#777] block mb-1">Escrow Amount</span>
                    <span className="font-bold text-emerald-400 text-sm">
                      {txResult.amountSol ? formatSol(txResult.amountSol) : pricing.totalSolFormatted} SOL <span className="text-[0.65rem] text-[#888] font-normal">(~{formatUsd(txResult.amountUsd ?? pricing.totalUsd, { includeCode: true })})</span>
                    </span>
                  </div>
                </div>

                {/* Drop Timeline */}
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] flex flex-col gap-1.5 text-xs font-mono">
                  <div className="flex justify-between items-center">
                    <span className="text-[#888]">Estimated Atelier Delivery:</span>
                    <span className="text-white font-bold">
                      {txResult.releaseAt ? new Date(txResult.releaseAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Scheduled post-production'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[0.7rem]">
                    <span className="text-[#666]">Collection Station:</span>
                    <span className="text-[#bbb] truncate max-w-[200px]">{txResult.pickupLocation || 'Official Atelier'}</span>
                  </div>
                </div>

                {/* Verifications & Receipts */}
                <div className="flex flex-col gap-2 pt-1 border-t border-white/[0.08]">
                  <span className="text-[0.6rem] font-bold uppercase tracking-wider text-[#666]">
                    On-Chain Blockchain Verifications
                  </span>
                  <div className="flex flex-wrap gap-2 text-[0.7rem] font-mono">
                    <a
                      href={solanaExplorerTxUrl(txResult.txSignature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/12 border border-white/15 text-white font-medium transition-all flex items-center gap-1.5 hover:border-emerald-500/40"
                    >
                      <span>View on Solana Explorer ↗</span>
                    </a>
                    {txResult.vaultAddress && (
                      <a
                        href={solanaExplorerAccountUrl(txResult.vaultAddress)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/10 border border-white/10 text-[#aaa] hover:text-white transition-all flex items-center gap-1.5"
                      >
                        <span>Escrow Vault PDA ↗</span>
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (txResult.txSignature) {
                          navigator.clipboard.writeText(txResult.txSignature);
                          setCopiedTx(true);
                          setTimeout(() => setCopiedTx(false), 2000);
                          showToast('Copied', 'Transaction signature copied to clipboard');
                        }
                      }}
                      className="px-3 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 text-[#888] hover:text-white transition-colors flex items-center gap-1.5"
                    >
                      <span>{copiedTx ? '✓ Copied' : 'Copy Tx Hash'}</span>
                    </button>
                  </div>
                </div>

                {/* Primary Passport CTA */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <Link
                    href={`/passport?order=${txResult.orderId || txResult.txSignature}`}
                    className="btn-circuit flex-1 justify-center py-3.5 text-xs font-bold"
                  >
                    <span>View Digital Product Passport ➔</span>
                  </Link>
                  <Link
                    href="/passport/history"
                    className="btn-outline-circuit justify-center py-3.5 text-xs border-white/10 hover:border-white/20 text-[#aaa] hover:text-white font-semibold"
                  >
                    <span>My Wardrobe / History</span>
                  </Link>
                </div>
              </div>
            )}

            {txState === 'error' && (
              <div className="tx-msg err">
                <span>✗</span>
                <span>{txResult.message}</span>
              </div>
            )}

            {isSoldOut && txState !== 'success' && (
              <div className="tx-msg err flex flex-col gap-2 !border-white/10 !bg-white/[0.02]">
                <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-white">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  <span>Drop Selection Closed</span>
                </div>
                <p className="text-[0.65rem] text-[#666] leading-relaxed uppercase tracking-tight">
                  All {maxSupply} pieces have been fully reserved. The manufacturing protocol for this edition is locked.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Premium Visual Gallery */}
        <div className="order-1 lg:order-2 flex flex-col justify-start lg:justify-start pt-8 lg:pt-0 items-center lg:items-end w-full" style={{ animation: 'fadeIn 0.8s ease-out 0.2s both' }}>
          <div className="relative w-full max-w-[480px]">
            {/* Ambient Background Radial */}
            <div className="absolute inset-0 md:inset-[-15%] bg-[radial-gradient(circle,rgba(255,255,255,.05)_0%,transparent_70%)] blur-[40px] pointer-events-none" />

            {/* Main Frame */}
            <div className="relative rounded-[32px] overflow-hidden border border-white/[0.12] bg-[#0D0D0D] shadow-[0_30px_100px_rgba(0,0,0,.6)] aspect-[4/5]">
              <Image
                src={activeEdition.images?.[activeImageIndex]?.url || activeEdition.image_url || '/satin.png'}
                alt={`${activeEdition.name} - ${activeEdition.images?.[activeImageIndex]?.tag || 'View'}`}
                fill
                className="w-full h-full object-cover scale-[1.01] transition-all duration-700 ease-in-out"
                priority
              />
              
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

              <div className="absolute bottom-6 left-6 flex items-center gap-2 bg-black/60 backdrop-blur-[20px] rounded-full px-4 py-2 text-[0.65rem] font-bold uppercase tracking-[0.1em] border border-white/[0.12]">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse shadow-[0_0_8px_white]" />
                {activeEdition.name}
              </div>

              {activeEdition.images?.[activeImageIndex]?.tag && (
                <div className="absolute top-6 right-6 bg-black/40 backdrop-blur-md rounded-full px-3 py-1.5 text-[0.6rem] font-bold text-white/80 uppercase tracking-widest border border-white/10 animate-fade-in">
                  {activeEdition.images[activeImageIndex].tag}
                </div>
              )}
            </div>

            {/* Thumbnail Gallery Grid */}
            {activeEdition.images && activeEdition.images.length > 1 && (
              <div className="flex gap-3 sm:gap-4 mt-4 w-full overflow-x-auto py-4 px-2 justify-start sm:justify-center lg:justify-start [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {activeEdition.images.map((img: any, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImageIndex(idx)}
                    className={`relative w-16 h-20 sm:w-20 sm:h-24 rounded-xl overflow-hidden border-2 transition-all duration-300 shrink-0 ${
                      activeImageIndex === idx 
                        ? 'border-white shadow-[0_0_20px_rgba(255,255,255,0.4)] scale-110 z-10' 
                        : 'border-white/10 opacity-50 hover:opacity-100 hover:border-white/40 z-0'
                    }`}
                  >
                    <Image
                      src={img.url}
                      alt={img.tag || `View ${idx + 1}`}
                      fill
                      className="object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Escrow Process Highlights */}
      <div className="border-t border-white/[0.06] py-16 md:py-24 relative z-10 bg-white/[0.01]">
        <div className="section-container">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-0">
            {[
              { num: '01', title: 'Payment in Escrow', desc: 'Your payment is held until your garment arrives.', icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="6" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>
              )},
              { num: '02', title: 'Dynamic Production', desc: 'Your garment is made after your order is confirmed.', icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              )},
              { num: '03', title: 'Verifiable Digital Tag', desc: 'Every garment gets a permanent record when it is made.', icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
              )},
            ].map((step, i) => (
              <div key={step.num} className="flex flex-col items-center text-center px-4 group">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center mb-6 group-hover:bg-white group-hover:text-black transition-all duration-500">
                  {step.icon}
                </div>
                <span className="text-[0.6rem] font-bold text-[#444] uppercase tracking-[0.2em] mb-2">{step.num}</span>
                <strong className="text-sm font-bold uppercase tracking-wider mb-2">{step.title}</strong>
                <p className="text-xs text-[#666] max-w-[200px]">{step.desc}</p>
                {i < 2 && <div className="hidden md:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-12 bg-white/[0.06]" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <SignInModal isOpen={isSignInOpen} onClose={() => setIsSignInOpen(false)} />

      {/* Fiat Checkout Legit Pending State Modal */}
      {showFiatModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/85 backdrop-blur-md px-4 animate-fade-in">
          <div className="card-glass w-full max-w-md p-7 md:p-9 border border-white/15 rounded-3xl shadow-[0_50px_100px_rgba(0,0,0,0.9)] relative animate-scale-in">
            <button 
              onClick={() => setShowFiatModal(false)}
              className="absolute top-5 right-5 text-[#666] hover:text-white transition-colors p-2 text-sm"
              aria-label="Close"
            >
              ✕
            </button>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-xl mb-3 shadow-[0_0_20px_rgba(245,158,11,0.15)]">
                  💳
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[0.6rem] font-bold font-mono tracking-widest uppercase text-amber-400 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30">
                    Card Rails Coming Soon
                  </span>
                </div>
                <h3 className="text-xl font-bold tracking-tight text-white">Fiat & Apple Pay Processing</h3>
                <p className="text-xs text-[#888] mt-1.5 max-w-xs leading-relaxed">
                  Direct debit card, credit card, and Apple Pay checkouts are finalizing banking compliance with our payment rails partner.
                </p>
              </div>

              {/* Order Value Overview */}
              <div className="p-4 bg-white/[0.03] rounded-2xl border border-white/10 flex flex-col gap-2.5 text-xs font-mono">
                <div className="flex justify-between items-center text-[#888]">
                  <span>Item Subtotal ({quantity} unit{quantity > 1 ? 's' : ''}):</span>
                  <span className="text-white font-bold">{pricing.unitUsdFormatted} × {quantity}</span>
                </div>
                {fulfillmentType === 'delivery' && (
                  <div className="flex justify-between items-center text-[#888]">
                    <span>Doorstep Courier Delivery:</span>
                    <span className="text-emerald-400 font-bold">
                      {deliveryFeeUsd > 0 ? `+$${deliveryFeeUsd.toFixed(2)} USD` : 'Free Delivery'}
                    </span>
                  </div>
                )}
                <div className="pt-2 border-t border-white/[0.06] flex justify-between items-center">
                  <span className="text-white font-bold">Total Order Value:</span>
                  <span className="text-sm font-bold text-white">{pricing.totalUsdFormatted}</span>
                </div>
                <div className="flex justify-between items-center text-[0.7rem] text-[#aaa]">
                  <span>Solana Equivalent:</span>
                  <span className="text-emerald-400 font-bold font-mono">{pricing.totalSolFormatted} SOL</span>
                </div>
              </div>

              {/* Waitlist Notification Signup */}
              <div className="p-3.5 rounded-2xl bg-amber-500/[0.04] border border-amber-500/20 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[0.62rem] font-bold uppercase tracking-wider text-amber-400 font-mono">
                    Early Access Notification
                  </span>
                  {fiatWaitlistJoined && (
                    <span className="text-[0.6rem] font-mono text-emerald-400 font-bold">✓ Joined Waitlist</span>
                  )}
                </div>

                {!fiatWaitlistJoined ? (
                  <div className="flex gap-2">
                    <input
                      type="email"
                      placeholder="Enter email for card launch alert..."
                      value={fiatWaitlistEmail || user?.email || ''}
                      onChange={(e) => setFiatWaitlistEmail(e.target.value)}
                      className="flex-1 bg-[#0D0D0D] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400/50 font-mono placeholder:text-white/30"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const targetEmail = (fiatWaitlistEmail || user?.email || '').trim();
                        if (!targetEmail || !targetEmail.includes('@')) {
                          showToast('Email Required', 'Please enter a valid email address.');
                          return;
                        }
                        if (typeof window !== 'undefined') {
                          try {
                            const list = JSON.parse(localStorage.getItem('circuit_fiat_waitlist') || '[]');
                            if (!list.includes(targetEmail)) {
                              localStorage.setItem('circuit_fiat_waitlist', JSON.stringify([...list, targetEmail]));
                            }
                          } catch (_) {}
                        }
                        setFiatWaitlistJoined(true);
                        showToast('✓ Notification Saved', `We will alert you at ${targetEmail} once Card rails go live!`);
                      }}
                      className="px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[0.68rem] font-bold uppercase tracking-wider transition-all whitespace-nowrap"
                    >
                      Alert Me
                    </button>
                  </div>
                ) : (
                  <p className="text-[0.68rem] text-[#aaa] font-mono leading-relaxed">
                    You are on the priority list. We will send you an invite as soon as Card checkout goes live.
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2.5 pt-1">
                <button
                  type="button"
                  className="btn-circuit w-full justify-center py-3.5 text-xs font-bold"
                  onClick={() => {
                    setPaymentMethod('crypto');
                    setShowFiatModal(false);
                    showToast('Switched to Solana', 'Ready to checkout instantly via your Solana wallet.');
                  }}
                >
                  <span>Pay with Solana Devnet Escrow (Instant)</span>
                  <span className="btn-arrow">→</span>
                </button>
                <button
                  type="button"
                  className="btn-outline-circuit w-full justify-center py-2.5 text-xs border-white/10 text-white/60 hover:text-white"
                  onClick={() => setShowFiatModal(false)}
                >
                  Continue Browsing Drop
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </section>
  );
}

export default function DropPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col bg-black text-white items-center justify-center">
        <div className="w-12 h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
        <span className="text-xs font-mono text-[#555] mt-4">Loading Drop Terminal...</span>
      </div>
    }>
      <DropPageContent />
    </Suspense>
  );
}
