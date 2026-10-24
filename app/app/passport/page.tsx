'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { QRCodeCanvas } from 'qrcode.react';
import { useWallet } from '@solana/wallet-adapter-react';
import { getEditionById, getUserOrders, updateOrderStatusLifecycle } from '@/lib/db';
import { useAuth } from '@/lib/auth-context';
import * as backendApi from '@/lib/backendApi';
import { executeVerifiedCancel } from '@/lib/solana-service';
import { solscanTxUrl, solanaExplorerTxUrl, solanaExplorerAccountUrl, formatSerialNumber, resolveUniqueOrderSerials, truncateAddress } from '@/lib/utils';
import { showToast } from '@/components/Toast';
import Image from 'next/image';
import Link from 'next/link';
import SignInModal from '@/components/SignInModal';

export interface WardrobePiece {
  id: string;
  order: any;
  edition: any;
  batch: backendApi.Batch | null;
  displayTitle: string;
  thumbnail: string;
  size: string;
  quantity: number;
  status: string;
  garmentSerial?: string;
  createdAt: string;
}

function PassportContent() {
  const searchParams = useSearchParams();
  const orderIdParam = searchParams.get('order') || searchParams.get('orderId');
  const [orderId, setOrderId] = useState<string | null>(orderIdParam);
  const [wardrobe, setWardrobe] = useState<WardrobePiece[]>([]);
  const [order, setOrder] = useState<any>(null);
  const [edition, setEdition] = useState<any>(null);
  const [batch, setBatch] = useState<backendApi.Batch | null>(null);
  const [loading, setLoading] = useState(true);
  const [showQR, setShowQR] = useState(false);
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportCategory, setReportCategory] = useState<'Delayed delivery' | 'Wrong size' | 'Other'>('Delayed delivery');
  const [reportMessage, setReportMessage] = useState('');
  const [isReporting, setIsReporting] = useState(false);
  const [isReported, setIsReported] = useState(false);
  const [showComplimentModal, setShowComplimentModal] = useState(false);
  const [complimentMessage, setComplimentMessage] = useState('');
  const [isComplimented, setIsComplimented] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [ratingStars, setRatingStars] = useState(5);
  const [ratingTags, setRatingTags] = useState<string[]>(['Exceptional Craftsmanship', 'True to Size']);
  const [ratingComment, setRatingComment] = useState('');
  const [isRated, setIsRated] = useState(false);
  const [savedRating, setSavedRating] = useState<number | null>(null);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [cancelCountdown, setCancelCountdown] = useState<{ hours: number; minutes: number; seconds: number; isExpired: boolean } | null>(null);
  const { user, isSignedIn } = useAuth();
  const { signTransaction } = useWallet();

  // Load existing rating for active order
  useEffect(() => {
    if (order?.id && typeof window !== 'undefined') {
      try {
        const ratings = JSON.parse(localStorage.getItem('circuit_collector_ratings') || '[]');
        const existing = ratings.find((r: any) => r.order_id === order.id);
        if (existing) {
          setIsRated(true);
          setSavedRating(existing.stars || 5);
        } else {
          setIsRated(false);
          setSavedRating(null);
        }
      } catch (_) {}
    }
  }, [order?.id]);

  const handleSubmitRating = () => {
    if (!order) return;
    try {
      const ratings = JSON.parse(localStorage.getItem('circuit_collector_ratings') || '[]');
      const newRating = {
        order_id: order.id,
        user_email: user?.email || 'collector@circuit.sol',
        stars: ratingStars,
        tags: ratingTags,
        message: ratingComment.trim(),
        created_at: new Date().toISOString(),
      };
      ratings.push(newRating);
      localStorage.setItem('circuit_collector_ratings', JSON.stringify(ratings));

      if (ratingComment.trim()) {
        const compliments = JSON.parse(localStorage.getItem('circuit_compliments') || '[]');
        compliments.push({
          order_id: order.id,
          user_email: user?.email || 'collector@circuit.sol',
          message: `[★ ${ratingStars}/5] ${ratingComment.trim()} (Tags: ${ratingTags.join(', ')})`,
          created_at: new Date().toISOString(),
        });
        localStorage.setItem('circuit_compliments', JSON.stringify(compliments));
      }

      setIsRated(true);
      setSavedRating(ratingStars);
      setShowRatingModal(false);
      showToast('✓ Rating Submitted', `Thank you! You rated this atelier ★ ${ratingStars}.0.`);
    } catch {
      showToast('✓ Rating Submitted', 'Thank you for your feedback!');
    }
  };

  const handleDownloadQR = () => {
    const canvas = document.getElementById('garment-authenticity-qr') as HTMLCanvasElement;
    if (!canvas) return;
    const pngUrl = canvas.toDataURL('image/png');
    const downloadLink = document.createElement('a');
    downloadLink.href = pngUrl;
    const serialStr = order?.garment_serial ? `edition-${order.garment_serial}` : 'garment';
    downloadLink.download = `circuit-${edition?.id || 'piece'}-${serialStr}-qr.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    showToast('✓ QR Downloaded', 'Authenticity label image saved to your device.');
  };

  const passportUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/passport?order=${order?.id || ''}${order?.unit_index ? `&unit=${order.unit_index}` : ''}`
    : `https://circuit.fashion/passport?order=${order?.id || ''}`;

  const handleSelectPiece = (piece: WardrobePiece) => {
    setOrderId(piece.id);
    setOrder(piece.order);
    setBatch(piece.batch);
    setEdition(piece.edition);
    setIsComplimented(false);
    setIsReported(false);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('order', piece.id);
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleConfirmCollection = async () => {
    if (!order) return;
    setConfirmingReceipt(true);
    try {
      try {
        await backendApi.recordOrderCollected(order.id);
      } catch (e) {
        console.warn('Backend chain collection call notice:', e);
      }
      await updateOrderStatusLifecycle(order.id, 'collected');
      setOrder((prev: any) => ({ ...prev, status: 'collected', collected_at: new Date().toISOString() }));
      setWardrobe((prev) => prev.map((w) => w.id === order.id ? { ...w, status: 'delivered', order: { ...w.order, status: 'collected', collected_at: new Date().toISOString() } } : w));
      showToast('✓ Pickup Recorded', 'Item collection logged on-chain. Note: Seller 70% balance payout will release 7 days post-release date.');
    } catch (err) {
      console.error(err);
      showToast('✗ Error', 'Failed to record collection.');
    } finally {
      setConfirmingReceipt(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!order || !signTransaction) return;
    if (!confirm('Are you sure you want to cancel this order? 100% of your deposit will be refunded to your wallet.')) return;
    setIsCancelling(true);
    try {
      await executeVerifiedCancel(order.id, signTransaction);
      setOrder((prev: any) => ({ ...prev, cancelled: true, status: 'cancelled' }));
      setWardrobe((prev) => prev.map((w) => w.id === order.id ? { ...w, status: 'cancelled', order: { ...w.order, cancelled: true, status: 'cancelled' } } : w));
      showToast('✓ Order Cancelled', 'Refund returned to your wallet on Solana devnet.');
    } catch (err) {
      console.error(err);
      showToast('✗ Cancellation Failed', 'Unable to cancel. The 24-hour window may have expired.');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleSendReport = async () => {
    if (!order || !reportMessage.trim()) return;
    if (batch?.release_at && Date.now() < new Date(batch.release_at).getTime()) {
      showToast('Notice', `Dispute reporting opens on the batch release date (${new Date(batch.release_at).toLocaleDateString()}).`);
      return;
    }
    setIsReporting(true);
    try {
      const fullMessage = `[${reportCategory}] ${reportMessage.trim()}`;
      await backendApi.reportOrderIssue(order.id, fullMessage);
      setIsReported(true);
      setShowReportModal(false);
      showToast('✓ Report Submitted', 'Dispute logged with Circuit admin. Remaining payouts will be reviewed.');
    } catch (err: any) {
      console.error(err);
      const msg = err?.error === 'REPORTING_NOT_OPEN'
        ? `Dispute reporting only opens on the batch release date (${batch?.release_at ? new Date(batch.release_at).toLocaleDateString() : 'scheduled'}).`
        : (err?.message || 'Failed to submit report.');
      showToast('✗ Error', msg);
    } finally {
      setIsReporting(false);
    }
  };

  const handleSendCompliment = () => {
    if (!order || !complimentMessage.trim()) return;
    try {
      const compliments = JSON.parse(localStorage.getItem('circuit_compliments') || '[]');
      compliments.push({
        order_id: order.id,
        user_email: user?.email || 'buyer@circuit.sol',
        message: complimentMessage.trim(),
        created_at: new Date().toISOString(),
      });
      localStorage.setItem('circuit_compliments', JSON.stringify(compliments));
      setIsComplimented(true);
      setShowComplimentModal(false);
      showToast('✓ Compliment Sent', 'Thank you! Your feedback has been shared with the atelier.');
    } catch {
      showToast('✓ Compliment Sent', 'Thank you for your feedback!');
    }
  };

  // Unified Wardrobe Resolution: Resolves all purchases (chain, db, cache) into the digital wardrobe
  useEffect(() => {
    let isCancelled = false;

    async function loadWardrobe() {
      try {
        setLoading(true);

        // GATING: If user is neither signed in nor querying a specific orderId via URL parameter,
        // they have 0 accessible wardrobe items. Immediately present the authentication state.
        if (!isSignedIn && !orderIdParam) {
          setWardrobe([]);
          setOrder(null);
          setBatch(null);
          setEdition(null);
          setLoading(false);
          return;
        }

        const BASE = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
        const rawOrders: any[] = [];
        const seenSignatures = new Set<string>();
        const seenIds = new Set<string>();
        const seenEscrows = new Set<string>();

        const addOrMergeOrder = (ord: any) => {
          if (!ord) return;
          const sig = (ord.purchase_signature || ord.tx_signature || ord.signature || '').trim().toLowerCase();
          const id = (ord.id || '').trim().toLowerCase();
          const escrow = (ord.order_address || ord.vault_address || ord.escrow_pda || '').trim().toLowerCase();

          // Check if we already registered this order by signature, id, or escrow
          const isKnown = (sig && seenSignatures.has(sig)) ||
                          (id && seenIds.has(id)) ||
                          (escrow && seenEscrows.has(escrow));

          if (isKnown) {
            // Find existing record and enrich missing metadata without adding a duplicate wardrobe piece
            const existing = rawOrders.find((existingOrd) => {
              const eSig = (existingOrd.purchase_signature || existingOrd.tx_signature || existingOrd.signature || '').trim().toLowerCase();
              const eId = (existingOrd.id || '').trim().toLowerCase();
              const eEscrow = (existingOrd.order_address || existingOrd.vault_address || existingOrd.escrow_pda || '').trim().toLowerCase();
              return (sig && eSig && sig === eSig) ||
                     (id && eId && id === eId) ||
                     (escrow && eEscrow && escrow === eEscrow);
            });
            if (existing) {
              for (const [k, v] of Object.entries(ord)) {
                if (v !== undefined && v !== null && (existing[k] === undefined || existing[k] === null || existing[k] === '')) {
                  existing[k] = v;
                }
              }
            }
            if (sig) seenSignatures.add(sig);
            if (id) seenIds.add(id);
            if (escrow) seenEscrows.add(escrow);
            return;
          }

          // Register newly identified order
          if (sig) seenSignatures.add(sig);
          if (id) seenIds.add(id);
          if (escrow) seenEscrows.add(escrow);
          rawOrders.push({ ...ord });
        };

        // 1. If explicit orderIdParam in URL, attempt direct lookup first
        if (orderIdParam) {
          try {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            if (uuidRegex.test(orderIdParam)) {
              const chainRes = await backendApi.getChainOrderById(orderIdParam);
              if (chainRes?.order) addOrMergeOrder(chainRes.order);
            } else {
              const res = await fetch(`${BASE}/api/db/orders/by-tx/${encodeURIComponent(orderIdParam)}`);
              if (res.ok) {
                const dbOrd = await res.json();
                if (dbOrd) addOrMergeOrder(dbOrd);
              }
            }
          } catch (e) {
            console.warn('Direct orderIdParam lookup notice:', e);
          }
        }

        // 2. Fetch authenticated on-chain orders (Authoritative source)
        if (isSignedIn) {
          try {
            const chainRes = await backendApi.getMyChainOrders();
            if (chainRes?.orders && Array.isArray(chainRes.orders)) {
              chainRes.orders.forEach(addOrMergeOrder);
            }
          } catch (e) {
            console.warn('Chain orders query notice:', e);
          }
        }

        // 3. Fetch DB orders associated with the user's email
        if (isSignedIn && user?.email) {
          try {
            const dbOrders = await getUserOrders(user.email);
            if (Array.isArray(dbOrders)) {
              dbOrders.forEach(addOrMergeOrder);
            }
          } catch (e) {
            console.warn('User DB orders query notice:', e);
          }
        }

        // 4. Local storage fallback cache (Strictly scoped to active authenticated account)
        if (isSignedIn && typeof window !== 'undefined') {
          try {
            const localOrders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
            const currentWallet = (user?.walletAddress || '').trim().toLowerCase();
            const currentEmail = (user?.email || '').trim().toLowerCase();

            if (Array.isArray(localOrders)) {
              localOrders.forEach((loc) => {
                const locWallet = (loc.wallet_address || loc.buyer_wallet || '').trim().toLowerCase();
                const locEmail = (loc.email || '').trim().toLowerCase();

                // Strictly filter: MUST match active authenticated user's wallet or email
                const matchesWallet = Boolean(currentWallet && locWallet && locWallet === currentWallet);
                const matchesEmail = Boolean(currentEmail && locEmail && locEmail === currentEmail);

                if (!matchesWallet && !matchesEmail) return;

                addOrMergeOrder(loc);
              });
            }
          } catch {}
        }

        if (isCancelled) return;

        if (rawOrders.length === 0) {
          setWardrobe([]);
          setOrder(null);
          setBatch(null);
          setEdition(null);
          setLoading(false);
          return;
        }

        // Guarantee unique chronological serials for all orders across collections
        resolveUniqueOrderSerials(rawOrders);

        // Update local storage cache with resolved unique serials
        if (typeof window !== 'undefined') {
          try {
            const stored = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
            if (Array.isArray(stored) && stored.length > 0) {
              const updatedStored = stored.map((so: any) => {
                const match = rawOrders.find((ro: any) => 
                  (ro.id && ro.id === so.id) || 
                  (ro.tx_signature && ro.tx_signature === so.tx_signature)
                );
                if (match?.garment_serial) {
                  return { ...so, garment_serial: match.garment_serial, order_number: match.order_number };
                }
                return so;
              });
              localStorage.setItem('circuit_orders', JSON.stringify(updatedStored));
            }
          } catch {}
        }

        // 5. Build Wardrobe Pieces with cached batch & edition metadata resolution
        const batchCache = new Map<string, backendApi.Batch | null>();
        const editionCache = new Map<string, any>();

        const pieceArrays: WardrobePiece[][] = await Promise.all(
          rawOrders.map(async (ord: any) => {
            let batchData: backendApi.Batch | null = null;
            if (ord.batch_id) {
              if (batchCache.has(ord.batch_id)) {
                batchData = batchCache.get(ord.batch_id)!;
              } else {
                try {
                  const bRes = await backendApi.getPublicBatchById(ord.batch_id);
                  batchData = bRes?.batch || null;
                } catch {
                  batchData = null;
                }
                batchCache.set(ord.batch_id, batchData);
              }
            }

            const editionId = ord.drop_id || batchData?.edition_id;
            let editionData = null;
            if (editionId) {
              if (editionCache.has(editionId)) {
                editionData = editionCache.get(editionId);
              } else {
                try {
                  editionData = await getEditionById(editionId);
                } catch {
                  editionData = null;
                }
                editionCache.set(editionId, editionData);
              }
            }

            const finalEdition = editionData;
            const pieceId = ord.id || ord.purchase_signature || ord.tx_signature;

            // If order has individual garments array, return a piece for each unit
            if (Array.isArray(ord.garments) && ord.garments.length > 0) {
              const sortedGarments = [...ord.garments].sort((a: any, b: any) => (Number(a.unit_index) || 0) - (Number(b.unit_index) || 0));
              return sortedGarments.map((g: any, gIdx: number) => ({
                id: `${pieceId}-unit-${g.unit_index || gIdx + 1}`,
                order: { ...ord, unit_index: g.unit_index || gIdx + 1, garment_serial: g.garment_serial },
                edition: finalEdition,
                batch: batchData,
                displayTitle: finalEdition?.name || batchData?.name || ord.drop_name || 'Circuit Garment',
                thumbnail: finalEdition?.images?.[0]?.url || '/satin.png',
                size: ord.size || 'M',
                quantity: 1,
                status: ord.status || 'pending',
                garmentSerial: String(g.garment_serial),
                createdAt: ord.created_at || new Date().toISOString(),
              }));
            }

            return [{
              id: pieceId,
              order: ord,
              edition: finalEdition,
              batch: batchData,
              displayTitle: finalEdition?.name || batchData?.name || ord.drop_name || 'Circuit Garment',
              thumbnail: finalEdition?.images?.[0]?.url || '/satin.png',
              size: ord.size || 'M',
              quantity: ord.quantity || 1,
              status: ord.status || 'pending',
              garmentSerial: ord.garment_serial ? String(ord.garment_serial) : undefined,
              createdAt: ord.created_at || new Date().toISOString(),
            }];
          })
        );

        const pieces: WardrobePiece[] = pieceArrays.flat();

        if (isCancelled) return;

        // Sort by creation date descending (newest first)
        pieces.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Determine currently active piece
        let selectedPiece = pieces[0];
        const targetId = orderIdParam || orderId;
        if (targetId) {
          const match = pieces.find(
            (p) => p.id === targetId || p.order?.id === targetId || p.order?.purchase_signature === targetId || p.order?.tx_signature === targetId
          );
          if (match) selectedPiece = match;
        }

        setWardrobe(pieces);
        setOrderId(selectedPiece.id);
        setOrder(selectedPiece.order);
        setBatch(selectedPiece.batch);
        setEdition(selectedPiece.edition);
      } catch (err) {
        console.error('Error loading digital wardrobe:', err);
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadWardrobe();

    return () => {
      isCancelled = true;
    };
  }, [orderIdParam, isSignedIn, user?.walletAddress, user?.email]);

  const [serverSkewMs, setServerSkewMs] = useState(0);

  // Sync cluster time offset via HTTP response headers to eliminate client clock drift
  useEffect(() => {
    const BASE = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
    fetch(`${BASE}/api/batches?limit=1`, { method: 'HEAD' })
      .then((res) => {
        const dateHeader = res.headers.get('date');
        if (dateHeader) {
          const serverTime = Date.parse(dateHeader);
          if (!isNaN(serverTime)) {
            setServerSkewMs(serverTime - Date.now());
          }
        }
      })
      .catch(() => {});
  }, []);

  // Active 24-hour individual cancellation countdown ticker (cluster-synchronized)
  useEffect(() => {
    if (!order || order.cancelled) return;
    const calculateRemaining = () => {
      const nowCluster = Date.now() + serverSkewMs;
      const cancelUntil = order.cancel_until
        ? new Date(order.cancel_until).getTime()
        : new Date(order.created_at || nowCluster).getTime() + 86400000;
      
      // 30-second on-chain confirmation safety buffer to protect user from expired txs
      const diff = cancelUntil - nowCluster - 30000;
      if (diff <= 0) {
        setCancelCountdown({ hours: 0, minutes: 0, seconds: 0, isExpired: true });
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setCancelCountdown({ hours, minutes, seconds, isExpired: false });
    };

    calculateRemaining();
    const interval = setInterval(calculateRemaining, 1000);
    return () => clearInterval(interval);
  }, [order, serverSkewMs]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black">
        <div className="w-12 h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
        <span className="text-xs font-mono text-[#888] mt-4">Authenticating Garment Origin...</span>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-[calc(100vh-72px)] flex flex-col items-center justify-center p-6 bg-black text-white selection:bg-white selection:text-black">
        {!isSignedIn ? (
          <div className="card-glass max-w-lg w-full p-8 md:p-12 border border-white/10 rounded-3xl text-center flex flex-col items-center gap-6 animate-fade-in shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-2xl">
              🔐
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.25em] text-amber-400 font-mono">
                Authentication Required
              </span>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Sign In to View Wardrobe</h1>
              <p className="text-xs text-[#888] leading-relaxed max-w-sm mx-auto">
                Sign in with your email or connect your Solana wallet to decrypt and inspect your on-chain garment passports.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full justify-center pt-2">
              <button 
                onClick={() => setIsSignInOpen(true)}
                className="btn-circuit py-3.5 px-6 text-xs justify-center flex-1"
              >
                <span>Connect / Sign In</span>
              </button>
              <Link href="/drop" className="btn-outline-circuit py-3.5 px-6 text-xs justify-center flex-1 border-white/15 hover:border-white/30 text-white/80 hover:text-white">
                <span>Browse Active Drops</span>
              </Link>
            </div>
          </div>
        ) : orderIdParam && !wardrobe.some((w) => w.id === orderIdParam || w.order?.id === orderIdParam || w.order?.tx_signature === orderIdParam) ? (
          <div className="card-glass max-w-lg w-full p-8 md:p-12 border border-white/10 rounded-3xl text-center flex flex-col items-center gap-6 animate-fade-in shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-2xl">
              🔍
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.25em] text-red-400 font-mono">
                Passport Record Not Found
              </span>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Garment #{orderIdParam.slice(0, 8)}... Missing</h1>
              <p className="text-xs text-[#888] leading-relaxed max-w-sm mx-auto">
                No passport matching reference <code className="text-white font-mono bg-white/10 px-1 py-0.5 rounded">{orderIdParam.slice(0, 12)}...</code> was found in your connected wardrobe. It may belong to another wallet or is awaiting indexing.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full justify-center pt-2">
              {wardrobe.length > 0 ? (
                <button
                  onClick={() => handleSelectPiece(wardrobe[0])}
                  className="btn-circuit py-3.5 px-6 text-xs justify-center flex-1"
                >
                  <span>View My Wardrobe ({wardrobe.length})</span>
                </button>
              ) : (
                <Link href="/drop" className="btn-circuit py-3.5 px-6 text-xs justify-center flex-1">
                  <span>Browse Drops</span>
                </Link>
              )}
              <Link href="/passport/history" className="btn-outline-circuit py-3.5 px-6 text-xs justify-center flex-1 border-white/15 hover:border-white/30 text-white/80 hover:text-white">
                <span>Order Archive</span>
              </Link>
            </div>
          </div>
        ) : (
          <div className="card-glass max-w-lg w-full p-8 md:p-12 border border-white/10 rounded-3xl text-center flex flex-col items-center gap-6 animate-fade-in shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-2xl">
              📭
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.25em] text-white/50 font-mono">
                Digital Wardrobe Empty (0 Garments)
              </span>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">No Passports in Collection</h1>
              <p className="text-xs text-[#888] leading-relaxed max-w-sm mx-auto">
                No active garment passports found for <strong className="text-white">{user?.email || (user?.walletAddress ? truncateAddress(user.walletAddress) : 'your wallet')}</strong>. When you reserve a piece from an active runway drop, your cryptographic digital product passport will be minted here.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full justify-center pt-2">
              <Link href="/drop" className="btn-circuit py-3.5 px-6 text-xs justify-center flex-1">
                <span>Explore Active Drops</span>
              </Link>
              <Link href="/passport/history" className="btn-outline-circuit py-3.5 px-6 text-xs justify-center flex-1 border-white/15 hover:border-white/30 text-white/80 hover:text-white">
                <span>Order Archive</span>
              </Link>
            </div>
          </div>
        )}
        <SignInModal isOpen={isSignInOpen} onClose={() => setIsSignInOpen(false)} />
      </div>
    );
  }

  const status = order.status || 'pending';
  const isMinted = ['produced', 'shipped', 'delivered'].includes(status);
  const activeEdition = edition || null;

  return (
    <div className="min-h-screen flex flex-col bg-black text-white selection:bg-white selection:text-black overflow-x-hidden">
      <main className="flex-1 flex flex-col py-24 md:py-32">
        <div className="section-container">
          
          {/* Header & Digital Wardrobe Selector */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 relative z-10">
            <div className="flex items-center gap-3">
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/50 font-mono">Digital Wardrobe</span>
              <span className="text-[0.6rem] font-mono px-2.5 py-0.5 rounded-full bg-white/10 text-white/90 border border-white/10">
                {wardrobe.length} {wardrobe.length === 1 ? 'Piece' : 'Pieces'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <a href="/passport/history" className="btn-outline-circuit py-2 px-5 text-[0.65rem] border-white/10 hover:border-white/30 text-white/80 hover:text-white transition-all">
                Full Order Archive ➔
              </a>
            </div>
          </div>

          {/* Interactive Multi-Drop Digital Wardrobe Grid (No Horizontal Scrolling) */}
          {wardrobe.length > 1 && (
            <div className="mb-12 p-5 md:p-6 rounded-3xl bg-white/[0.02] border border-white/[0.08] backdrop-blur-2xl relative z-10 shadow-2xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 px-1 pb-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                  <span className="text-[0.65rem] font-mono uppercase tracking-[0.2em] text-white/70 font-semibold">
                    Digital Wardrobe Collection ({wardrobe.length} Pieces)
                  </span>
                </div>
                <span className="text-[0.6rem] font-mono text-white/40">
                  Select a garment passport below to inspect identity & verification
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {wardrobe.map((piece) => {
                  const activeKey = order?.id || orderId || order?.purchase_signature || order?.tx_signature;
                  const isSelected =
                    piece.id === activeKey ||
                    piece.order?.id === activeKey ||
                    piece.order?.purchase_signature === activeKey ||
                    piece.order?.tx_signature === activeKey;
                  const isPieceMinted = ['produced', 'shipped', 'delivered'].includes(piece.status);
                  const isPieceCancelled = piece.status === 'cancelled' || piece.order?.cancelled;

                  return (
                    <button
                      key={piece.id}
                      type="button"
                      onClick={() => handleSelectPiece(piece)}
                      className={`relative flex items-center gap-3.5 p-3.5 rounded-2xl border text-left transition-all duration-300 cursor-pointer group ${
                        isSelected
                          ? 'bg-white text-black border-white shadow-[0_10px_30px_rgba(255,255,255,0.15)] ring-1 ring-white/50 scale-[1.01]'
                          : 'bg-black/60 text-white/80 border-white/10 hover:border-white/30 hover:bg-white/[0.04] hover:text-white'
                      }`}
                    >
                      {/* Luxury thumbnail */}
                      <div className="relative w-14 h-14 rounded-xl overflow-hidden border border-white/15 shrink-0 bg-neutral-900 shadow-md">
                        <Image
                          src={piece.thumbnail}
                          alt={piece.displayTitle}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        {isSelected && (
                          <div className="absolute inset-0 bg-white/10 ring-1 ring-inset ring-black/20" />
                        )}
                      </div>

                      {/* Info & Badges */}
                      <div className="flex flex-col min-w-0 flex-1 pr-1">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-xs font-bold tracking-tight truncate">
                            {piece.displayTitle}
                          </span>
                          {isSelected && (
                            <span className="shrink-0 text-[0.55rem] font-mono uppercase font-bold px-2 py-0.5 rounded-full bg-black text-white">
                              Active
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 text-[0.65rem] font-mono">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${
                            isSelected ? 'bg-black/10 text-black/80 font-medium' : 'bg-white/5 text-white/70'
                          }`}>
                            Size {piece.size}
                          </span>
                          <span>•</span>
                          <span className={`inline-flex items-center gap-1 font-semibold uppercase ${
                            isPieceCancelled ? 'text-red-500' :
                            isPieceMinted ? (isSelected ? 'text-emerald-700' : 'text-emerald-400') :
                            (isSelected ? 'text-amber-700' : 'text-amber-400')
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              isPieceCancelled ? 'bg-red-500' :
                              isPieceMinted ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                            }`} />
                            {piece.status}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[0.62rem] font-mono mt-1 pt-1 border-t border-white/[0.06]">
                          <span className={isSelected ? 'text-black/80 font-bold' : 'text-amber-400 font-semibold'}>
                            Edition #{String(piece.garmentSerial || 1).padStart(2, '0')} of {piece.edition?.max_supply || 50}
                          </span>
                          {piece.quantity > 1 && (
                            <span className={isSelected ? 'text-black/50' : 'text-white/40'}>
                              {piece.quantity} Units
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 items-start">
            
            {/* Left Column: Premium Interactive Garment Frame */}
            <div className="lg:col-span-5 sticky top-32" style={{ animation: 'fadeIn 0.6s ease-out' }}>
              <div className="relative aspect-[4/5] md:aspect-square w-full rounded-[2.5rem] overflow-hidden border border-white/10 group shadow-2xl">
                <Image 
                  src={activeEdition?.images?.[0]?.url || "/satin.png"} 
                  alt={activeEdition?.name || order?.drop_name || "Circuit Garment"} 
                  fill 
                  className="object-cover group-hover:scale-105 transition-transform duration-1000"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80" />
                
                {/* Micro animation overlay */}
                <div className="absolute bottom-6 left-6 right-6 flex items-center justify-between z-10">
                  <div className="bg-black/60 backdrop-blur-[20px] rounded-full px-4 py-2 text-[0.6rem] font-bold uppercase tracking-[0.1em] border border-white/[0.12] flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${isMinted ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse'}`} />
                    {activeEdition?.name || order?.drop_name || 'Circuit Piece'}
                  </div>
                  {order?.garment_serial ? (
                    <span className="text-[0.6rem] font-mono text-white/90 bg-white/10 border border-white/20 px-3 py-1.5 rounded-full font-bold">
                      Edition: {formatSerialNumber(order.garment_serial, activeEdition?.max_supply || 50)}
                    </span>
                  ) : (
                    <span className="text-[0.6rem] font-mono text-white/50 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
                      Edition: #{String(order?.order_number || 1).padStart(2, '0')} of {activeEdition?.max_supply || 50}
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
                    {isMinted && 'Made. Your ownership record is ready.'}
                  </p>
                </div>

                {/* Share/Verify QR Code Button */}
                <button 
                  onClick={() => setShowQR(true)}
                  className="flex flex-col items-center gap-2 group shrink-0"
                  title="View Garment Verification QR Code & NFC Badge"
                >
                  <div className="w-14 h-14 md:w-16 md:h-16 rounded-[1.5rem] bg-white/[0.04] border border-white/10 flex items-center justify-center group-hover:bg-white/[0.08] transition-all group-hover:scale-105 shadow-2xl">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M7 7h.01M17 7h.01M17 17h.01M7 17h.01"/>
                    </svg>
                  </div>
                  <span className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#666] group-hover:text-white transition-colors">QR Badge</span>
                </button>
              </header>

              {/* Garment Authenticity QR Code Modal */}
              {showQR && (
                <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
                  <div className="card-glass p-8 md:p-12 flex flex-col items-center animate-scale-in border border-white/20 relative rounded-[2.5rem] max-w-sm w-full shadow-2xl">
                    <button 
                      onClick={() => setShowQR(false)}
                      className="absolute top-5 right-5 w-8 h-8 rounded-full border border-white/10 flex items-center justify-center hover:bg-white/10 text-white/70 hover:text-white transition-colors text-base"
                      title="Close"
                    >
                      ✕
                    </button>

                    <div className="flex flex-col items-center text-center mb-6">
                      <span className="text-[0.6rem] font-bold font-mono text-emerald-400 uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-2">
                        Authenticity Shield
                      </span>
                      <h4 className="text-base font-bold text-white tracking-tight">
                        {activeEdition?.name || order?.drop_name || 'Circuit Piece'}
                      </h4>
                      <p className="text-[0.65rem] font-mono text-[#888] mt-0.5">
                        {order?.garment_serial
                          ? `Edition ${formatSerialNumber(order.garment_serial, activeEdition?.max_supply || 50)}`
                          : `Unit Serial: #${String(order?.order_number || 1).padStart(2, '0')}`}
                      </p>
                    </div>

                    <div className="bg-white p-5 rounded-3xl mb-6 shadow-[0_0_50px_rgba(255,255,255,0.15)] flex items-center justify-center">
                      <QRCodeCanvas 
                        id="garment-authenticity-qr"
                        value={passportUrl}
                        size={190}
                        level="H"
                        includeMargin={true}
                      />
                    </div>

                    <p className="text-[0.65rem] text-[#888] text-center leading-relaxed mb-6 font-mono max-w-[260px]">
                      Permanent physical verification link on Solana. Scan with any camera or NFC smartphone to verify authentic provenance.
                    </p>

                    <div className="flex flex-col gap-2 w-full">
                      <button
                        onClick={handleDownloadQR}
                        className="btn-circuit py-3 px-4 justify-center text-xs font-mono font-bold"
                      >
                        <span>📥 Download QR Label (PNG)</span>
                        <span className="btn-arrow">↓</span>
                      </button>
                      <button
                        onClick={() => {
                          if (typeof navigator !== 'undefined' && navigator.clipboard) {
                            navigator.clipboard.writeText(passportUrl);
                            showToast('✓ Link Copied', 'Passport verification URL copied to clipboard.');
                          }
                        }}
                        className="btn-outline-circuit py-2.5 px-4 justify-center text-xs border-white/10 text-white/70 hover:text-white font-mono"
                      >
                        📋 Copy Verification Link
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Dynamic Gated Credentials Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  {
                    label: 'Edition',
                    value: formatSerialNumber(order?.garment_serial || order?.order_number, activeEdition?.max_supply || 50) + (status === 'pending' ? ' (Reserved)' : ''),
                  },
                  { label: 'Size', value: order?.size || 'Medium' },
                  { label: 'Collection Cap', value: `${activeEdition?.max_supply || 50} Units` },
                  { label: 'Origin', value: 'Nigeria' },
                ].map((stat, i) => (
                  <div key={i} className="p-6 rounded-3xl bg-white/[0.02] border border-white/10 flex flex-col justify-between min-h-[110px]">
                    <span className="block text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#444] mb-2">{stat.label}</span>
                    <span className="text-base md:text-lg font-bold tracking-tight text-white">
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Comprehensive Blockchain Escrow & Delivery Schedule Card (Always Visible) */}
              <div className="card-glass p-6 md:p-8 border border-white/10 flex flex-col gap-6 animate-fade-in rounded-3xl">
                <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_#34d399]" />
                    <span className="text-xs font-bold uppercase tracking-widest text-white">
                      Escrow Secured on Solana Devnet
                    </span>
                  </div>
                  <span className="text-[0.65rem] font-mono text-emerald-400 px-3 py-1 rounded-full bg-emerald-400/10 border border-emerald-400/20">
                    Non-Custodial Escrow
                  </span>
                </div>

                {/* Financial Summary */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                    <span className="text-[0.6rem] uppercase tracking-wider text-[#777] block mb-1">Total Deposit</span>
                    <span className="text-lg font-bold text-emerald-400">
                      {order.amount_lamports ? `${(Number(order.amount_lamports) / 1e9).toFixed(3)} SOL` : (order.amount_sol ? `${Number(order.amount_sol).toFixed(3)} SOL` : '—')}
                    </span>
                    <span className="block text-[0.65rem] text-[#666]">
                      {order.amount_usd ? `~$${Number(order.amount_usd).toFixed(2)} USD` : '—'}
                    </span>
                  </div>
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                    <span className="text-[0.6rem] uppercase tracking-wider text-[#777] block mb-1">Atelier Advance (30%)</span>
                    <span className="text-base font-bold text-white">
                      {order.amount_lamports 
                        ? `${((Number(order.amount_lamports) * 0.3) / 1e9).toFixed(3)} SOL` 
                        : (order.amount_sol ? `${(Number(order.amount_sol) * 0.3).toFixed(3)} SOL` : '—')}
                    </span>
                    <span className="block text-[0.65rem] text-[#666]">Materials procurement</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                    <span className="text-[0.6rem] uppercase tracking-wider text-[#777] block mb-1">Balance in Vault (70%)</span>
                    <span className="text-base font-bold text-emerald-400">
                      {order.amount_lamports 
                        ? `${((Number(order.amount_lamports) * 0.7) / 1e9).toFixed(3)} SOL` 
                        : (order.amount_sol ? `${(Number(order.amount_sol) * 0.7).toFixed(3)} SOL` : '—')}
                    </span>
                    <span className="block text-[0.65rem] text-[#666]">Locked until delivery</span>
                  </div>
                </div>

                {/* Drop Timeline: When it will drop exactly */}
                <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex flex-col gap-3">
                  <span className="text-[0.65rem] font-bold uppercase tracking-widest text-[#A3A3A3]">
                    Manufacturing & Drop Timeline
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
                    <div className="flex flex-col gap-1">
                      <span className="text-[#666] text-[0.65rem] uppercase">1. Preorder Window</span>
                      <span className="text-white font-semibold">
                        {batch?.closes_at ? `Closes ${new Date(batch.closes_at).toLocaleDateString()}` : 'Active'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[#666] text-[0.65rem] uppercase">2. Tailoring & Sizing</span>
                      <span className="text-white font-semibold">
                        {batch?.production_starts_at ? new Date(batch.production_starts_at).toLocaleDateString() : 'Within 48h of Close'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[#666] text-[0.65rem] uppercase">3. Drop & Pickup Date</span>
                      <span className="text-emerald-400 font-bold">
                        {batch?.release_at ? new Date(batch.release_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Scheduled post-tailoring'}
                      </span>
                    </div>
                  </div>
                  {batch?.pickup_locations?.[0] && (
                    <div className="pt-2 border-t border-white/[0.05] text-[0.7rem] font-mono text-[#888]">
                      📍 Collection Station: <span className="text-white">{batch.pickup_locations[0].name} — {batch.pickup_locations[0].address}, {batch.pickup_locations[0].city}</span>
                    </div>
                  )}
                </div>

                {/* Solana Explorer Verification Links */}
                <div className="space-y-3 text-xs font-mono pt-2 border-t border-white/[0.06]">
                  <span className="text-[0.65rem] font-bold uppercase tracking-widest text-[#666] block">
                    Solana Explorer Verifications
                  </span>
                  {(order.purchase_signature || order.tx_signature) && (
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-1 py-1.5 border-b border-white/5">
                      <span className="text-[#777]">Payment Transaction Signature</span>
                      <a
                        href={solanaExplorerTxUrl(order.purchase_signature || order.tx_signature)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white hover:text-emerald-300 underline truncate max-w-[280px]"
                      >
                        {order.purchase_signature || order.tx_signature} ↗
                      </a>
                    </div>
                  )}
                  {(order.vault_address || order.escrow_pda) && (
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-1 py-1.5 border-b border-white/5">
                      <span className="text-[#777]">Solana Batch Escrow Vault PDA</span>
                      <a
                        href={solanaExplorerAccountUrl(order.vault_address || order.escrow_pda)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:text-emerald-300 underline truncate max-w-[280px]"
                      >
                        {order.vault_address || order.escrow_pda} ↗
                      </a>
                    </div>
                  )}
                  {order.order_address && (
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-1 py-1.5 border-b border-white/5">
                      <span className="text-[#777]">On-Chain Order Receipt PDA</span>
                      <a
                        href={solanaExplorerAccountUrl(order.order_address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white/80 hover:text-white underline truncate max-w-[280px]"
                      >
                        {order.order_address} ↗
                      </a>
                    </div>
                  )}
                  {isMinted && order.mint_address && (
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-1 py-1.5">
                      <span className="text-[#777]">Digital Garment Mint Registry</span>
                      <a
                        href={solanaExplorerAccountUrl(order.mint_address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white hover:text-emerald-300 underline truncate max-w-[280px]"
                      >
                        {order.mint_address} ↗
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* 24-Hour Individual Cancellation Window */}
              {!order.cancelled && cancelCountdown && !cancelCountdown.isExpired && (
                <div className="card-glass p-5 border-amber-500/30 bg-amber-500/[0.04] rounded-2xl flex flex-col gap-3 animate-fade-in">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-amber-400 font-mono">24-Hour Cancellation Window</span>
                      <span className="text-[0.65rem] font-mono text-white/50 bg-white/5 border border-white/10 px-2 py-0.5 rounded">100% Refund</span>
                    </div>
                    {/* Live countdown pill */}
                    <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full font-mono text-amber-300 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      <span className="font-bold">
                        {String(cancelCountdown.hours).padStart(2, '0')}:{String(cancelCountdown.minutes).padStart(2, '0')}:{String(cancelCountdown.seconds).padStart(2, '0')}
                      </span>
                      <span className="text-[0.6rem] text-amber-400/70 uppercase tracking-wider">Remaining</span>
                    </div>
                  </div>
                  <p className="text-xs text-white/80 leading-relaxed">
                    You have an unconditional 24-hour window from purchase time to change your mind. Cancelling immediately returns 100% of your deposit from the Solana batch escrow vault to your wallet.
                  </p>
                  <button
                    onClick={handleCancelOrder}
                    disabled={isCancelling}
                    className="btn-outline-circuit py-2.5 text-xs uppercase tracking-wider text-amber-400 border-amber-500/40 hover:border-amber-400 hover:bg-amber-500/10 transition-all w-full mt-1"
                  >
                    <span>{isCancelling ? 'Processing Instant Solana Refund...' : 'Cancel Order (100% Refund)'}</span>
                  </button>
                </div>
              )}

              {/* Window Expired Indicator */}
              {!order.cancelled && cancelCountdown?.isExpired && status === 'pending' && (
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 flex items-center justify-between gap-3 animate-fade-in text-xs">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2 h-2 rounded-full bg-blue-400" />
                    <div>
                      <span className="font-bold text-white uppercase tracking-wider font-mono text-[0.7rem] block">Cancellation Period Concluded</span>
                      <span className="text-[0.65rem] text-[#888] font-mono">Order is now committed to the manufacturer's production sheet.</span>
                    </div>
                  </div>
                  <span className="text-[0.6rem] font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-full shrink-0">
                    Production Locked
                  </span>
                </div>
              )}

              {order.cancelled && (
                <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 animate-fade-in">
                  <span className="text-red-400 text-lg">✗</span>
                  <div>
                    <span className="text-xs font-bold text-red-400 uppercase tracking-wider font-mono block">Order Cancelled & Refunded</span>
                    <span className="text-[0.65rem] text-red-400/80 font-mono">100% deposit returned to your wallet from the batch escrow pool.</span>
                  </div>
                </div>
              )}

              {/* Buyer In-Person Pickup Collection Confirmation (Decoupled from Payout) */}
              {!order.cancelled && status !== 'delivered' && status !== 'collected' && (
                <div className="card-glass p-6 border-emerald-500/30 bg-emerald-500/[0.04] rounded-2xl flex flex-col gap-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 font-mono">In-Person Collection</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  </div>
                  <p className="text-xs text-white/80 leading-relaxed">
                    Have you collected your garment at the designated pickup station? Confirming logs your physical receipt on-chain.
                  </p>
                  <p className="text-[0.65rem] text-[#888] font-mono leading-relaxed">
                    * Policy: In accordance with the Circuit staged settlement agreement, seller balance payout unlocks 7 days after the batch release date.
                  </p>
                  <button
                    onClick={handleConfirmCollection}
                    disabled={confirmingReceipt}
                    className="btn-circuit py-3 text-xs uppercase tracking-wider justify-center w-full mt-1"
                  >
                    <span>{confirmingReceipt ? 'Logging Pickup On-Chain...' : 'Confirm Item Collected'}</span>
                  </button>
                </div>
              )}

              {(status === 'delivered' || status === 'collected') && (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 animate-fade-in">
                  <span className="text-emerald-400 text-lg">✓</span>
                  <div>
                    <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider font-mono block">Item Collected & Verified</span>
                    <span className="text-[0.65rem] text-emerald-400/80 font-mono">Physical receipt recorded on-chain. Staged balance payout scheduled 7 days post-release.</span>
                  </div>
                </div>
              )}

              {/* Staged Escrow Financial Schedule Breakdown */}
              <div className="flex flex-col gap-3 border border-white/[0.08] rounded-2xl p-5 bg-white/[0.02]">
                <div className="flex justify-between items-baseline">
                  <span className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[#666]">Staged Escrow Schedule</span>
                  <span className="text-[0.6rem] font-mono text-emerald-400">Solana Devnet Vault</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                    <span className="text-[0.6rem] text-[#666] uppercase block">30% Advance (Production)</span>
                    <span className="text-white font-semibold block">Batch Closing + 48h</span>
                    <span className="text-[0.62rem] text-[#888] block">Disbursed to fund initial manufacturing costs.</span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                    <span className="text-[0.6rem] text-[#666] uppercase block">70% Balance (Final Settlement)</span>
                    <span className="text-white font-semibold block">Release Date + 7 Days</span>
                    <span className="text-[0.62rem] text-[#888] block">Held in vault unless disputed or admin frozen.</span>
                  </div>
                </div>
              </div>

              {/* Buyer Rating & Atelier Feedback Section */}
              <div className="p-5 rounded-2xl border border-white/[0.08] bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white block">Atelier Review & Collector Rating</span>
                    {isRated && savedRating && (
                      <span className="text-[0.65rem] font-mono font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                        ★ {savedRating}.0 Verified
                      </span>
                    )}
                  </div>
                  <span className="text-[0.65rem] text-[#888] font-mono">
                    {isRated 
                      ? 'Your feedback is verified and attached to this collector piece.'
                      : 'Rate craftsmanship, garment fit, and dispatch quality.'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowRatingModal(true)}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 border border-amber-400/30 transition-all flex items-center gap-1.5 shadow-sm"
                  >
                    <span>★</span>
                    <span>{isRated ? `Rated (${savedRating || 5}★)` : 'Rate Atelier'}</span>
                  </button>

                  <button
                    onClick={() => setShowReportModal(true)}
                    disabled={isReported}
                    className="btn-outline-circuit py-2 px-3.5 text-xs border-white/20 text-[#aaa] hover:text-white flex items-center gap-1.5"
                  >
                    <span>⚠️</span>
                    <span>{isReported ? 'Report Logged' : 'Report Issue'}</span>
                  </button>
                </div>
              </div>

              {/* Rate Atelier & Review Modal */}
              {showRatingModal && (
                <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
                  <div className="bg-[#111] border border-white/10 rounded-3xl p-6 md:p-8 max-w-lg w-full flex flex-col gap-5 animate-scale-in shadow-2xl">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl">✨</span>
                        <div>
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Rate Atelier Craftsmanship</h3>
                          <span className="text-[0.65rem] text-[#666] font-mono">Order #{order.order_number || 1} • {activeEdition?.name || 'Garment'}</span>
                        </div>
                      </div>
                      <button onClick={() => setShowRatingModal(false)} className="text-[#666] hover:text-white text-lg">✕</button>
                    </div>

                    {/* Star Rating Selector */}
                    <div className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                      <div className="flex items-center gap-2">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setRatingStars(star)}
                            className={`text-3xl transition-transform hover:scale-125 focus:outline-none ${
                              star <= ratingStars ? 'text-amber-400 drop-shadow-[0_0_12px_rgba(251,191,36,0.5)]' : 'text-neutral-700'
                            }`}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                      <span className="text-xs font-mono font-bold text-amber-400">
                        {ratingStars === 5 && '★★★★★ Exceptional (5.0)'}
                        {ratingStars === 4 && '★★★★☆ Great Quality (4.0)'}
                        {ratingStars === 3 && '★★★☆☆ Satisfactory (3.0)'}
                        {ratingStars === 2 && '★★☆☆☆ Needs Improvement (2.0)'}
                        {ratingStars === 1 && '★☆☆☆☆ Unsatisfactory (1.0)'}
                      </span>
                    </div>

                    {/* Quality Tag Chips */}
                    <div className="flex flex-col gap-2">
                      <span className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888]">Craftsmanship Badges</span>
                      <div className="flex flex-wrap gap-2">
                        {[
                          'Exceptional Craftsmanship',
                          'True to Size',
                          'Fast Delivery',
                          'Premium Fabric',
                          'Flawless Finish',
                          'Museum Quality',
                        ].map((tag) => {
                          const isSelected = ratingTags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => {
                                setRatingTags((prev) =>
                                  isSelected ? prev.filter((t) => t !== tag) : [...prev, tag]
                                );
                              }}
                              className={`text-[0.68rem] px-3 py-1.5 rounded-full font-mono transition-all border ${
                                isSelected
                                  ? 'bg-amber-400/20 text-amber-300 border-amber-400/40 shadow-sm'
                                  : 'bg-white/[0.03] text-[#777] border-white/5 hover:border-white/20'
                              }`}
                            >
                              {isSelected ? '✓ ' : '+ '}{tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Feedback Comment */}
                    <div className="flex flex-col gap-2">
                      <span className="text-[0.65rem] font-bold uppercase tracking-wider text-[#888]">Collector Note (Optional)</span>
                      <textarea
                        value={ratingComment}
                        onChange={(e) => setRatingComment(e.target.value.slice(0, 500))}
                        placeholder="Detail your thoughts on fabric hand-feel, fit silhouette, and packaging..."
                        className="w-full bg-black border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-amber-400/40 min-h-[90px] font-mono leading-relaxed"
                      />
                      <span className="text-[0.62rem] text-[#666] font-mono text-right">{ratingComment.length}/500</span>
                    </div>

                    <div className="flex justify-end gap-3 pt-2 border-t border-white/5">
                      <button
                        onClick={() => setShowRatingModal(false)}
                        className="btn-outline-circuit py-2 px-4 text-xs border-white/10 text-[#888]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSubmitRating}
                        className="btn-circuit py-2.5 px-6 text-xs uppercase font-mono font-bold bg-amber-400 text-black hover:bg-amber-300"
                      >
                        <span>Submit Rating</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Report Issue Modal */}
              {showReportModal && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="bg-[#111] border border-white/10 rounded-3xl p-6 max-w-md w-full flex flex-col gap-4 animate-fade-in">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">Report Order Issue</h3>
                      <button onClick={() => setShowReportModal(false)} className="text-[#666] hover:text-white text-lg">✕</button>
                    </div>
                    <p className="text-xs text-[#888] leading-relaxed">
                      Reports are submitted directly to Circuit administration. An admin can freeze the batch payout to investigate and issue refunds or partial payments.
                    </p>
                    {batch?.release_at && Date.now() < new Date(batch.release_at).getTime() && (
                      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono">
                        Notice: Dispute reporting formally opens on the batch release date ({new Date(batch.release_at).toLocaleDateString()}).
                      </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[0.65rem] font-mono uppercase text-[#888]">Issue Type</label>
                      <select
                        value={reportCategory}
                        onChange={(e) => setReportCategory(e.target.value as any)}
                        className="bg-black border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none font-mono"
                      >
                        <option value="Delayed delivery">Delayed delivery</option>
                        <option value="Wrong size">Wrong size</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <textarea
                        value={reportMessage}
                        onChange={(e) => setReportMessage(e.target.value.slice(0, 500))}
                        placeholder="Please describe the issue (e.g. item missing from station, defect, etc.)..."
                        className="w-full bg-black border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30 min-h-[90px]"
                      />
                      <span className="text-[0.6rem] text-right text-[#666] font-mono">{reportMessage.length}/500 chars</span>
                    </div>

                    <div className="flex gap-3 justify-end pt-2">
                      <button
                        onClick={() => setShowReportModal(false)}
                        className="btn-outline-circuit py-2 px-4 text-xs border-white/10 text-[#888]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSendReport}
                        disabled={isReporting || !reportMessage.trim()}
                        className="btn-circuit py-2 px-5 text-xs uppercase"
                      >
                        <span>{isReporting ? 'Submitting...' : 'Submit to Circuit'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Dynamic Journey Timeline */}
              <div className="flex flex-col gap-8 mt-4">
                <h4 className="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-[#666]">Garment Lifecycle</h4>
                <div className="space-y-2">
                  <TimelineItem 
                    date={new Date(order.created_at || Date.now()).toLocaleDateString()} 
                    title="Order Confirmed & Escrowed" 
                    desc="Payment locked in decentralized Solana batch escrow vault."
                    active={true}
                  />
                  <TimelineItem 
                    date={status === 'in_production' || isMinted ? 'Active' : '—'} 
                    title="Production Started (30% Advance)" 
                    desc="Manufacturing begins once batch closes + 48h advance is eligible."
                    active={status !== 'pending' && status !== 'cancelled'}
                  />
                  <TimelineItem 
                    date={isMinted ? 'Minted' : '—'} 
                    title="Digital Passport Ready" 
                    desc="Made. Your digital authenticity certificate is registered."
                    active={isMinted}
                  />
                  <TimelineItem 
                    date={status === 'collected' || status === 'delivered' ? 'Collected' : '—'} 
                    title="In-Person Station Collection" 
                    desc={order.pickup_location_id ? `Station pickup logged. Receipt verified.` : (order.shipment_details || 'Ready for collection at designated brand station.')}
                    active={['collected', 'shipped', 'delivered'].includes(status)}
                  />
                  <TimelineItem 
                    date={status === 'delivered' || status === 'collected' ? 'Scheduled' : '—'} 
                    title="Final Settlement (70% Balance)" 
                    desc="Released to designer 7 days post-release date unless disputed."
                    active={status === 'delivered' || status === 'collected'}
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
