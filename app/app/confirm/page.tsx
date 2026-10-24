'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { confirmDelivery, parseError } from '@/lib/solana-service';
import { showToast } from '@/components/Toast';
import SignInModal from '@/components/SignInModal';
import { updateOrderStatus, updateOrderDelivery, getUserOrders, getEditionById } from '@/lib/db';
import { formatSerialNumber, solscanTxUrl } from '@/lib/utils';
import { getLiveSolPrice, DEFAULT_SOL_MARKET_PRICE } from '@/lib/price-service';
import * as backendApi from '@/lib/backendApi';
import { QRCodeCanvas } from 'qrcode.react';

type TxState = 'idle' | 'loading' | 'signing' | 'success' | 'error';

interface TxResult {
  txSignature?: string;
  solscanUrl?: string;
  fundsReleased?: number;
  designerAddress?: string;
  message?: string;
}

export default function ConfirmPage() {
  const { user, isSignedIn } = useAuth();
  const [latestOrder, setLatestOrder] = useState<any>(null);
  const [activeEdition, setActiveEdition] = useState<any>(null);
  const [txState, setTxState] = useState<TxState>('idle');
  const [txResult, setTxResult] = useState<TxResult>({});
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [deliveryLocation, setDeliveryLocation] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const processingRef = useRef(false);
  const router = useRouter();

  const passportUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/passport?order=${latestOrder?.id || ''}`
    : `https://circuit.fashion/passport?order=${latestOrder?.id || ''}`;

  const handleDownloadQR = () => {
    const canvas = document.getElementById('confirm-garment-qr') as HTMLCanvasElement;
    if (!canvas) return;
    const pngUrl = canvas.toDataURL('image/png');
    const downloadLink = document.createElement('a');
    downloadLink.href = pngUrl;
    downloadLink.download = `circuit-${latestOrder?.id || 'garment'}-qr.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    showToast('✓ QR Downloaded', 'Authenticity label image saved to your device.');
  };

  // Auto-redirect to digital passport after successful confirmation
  useEffect(() => {
    if (txState === 'success' && latestOrder?.id) {
      const timer = setTimeout(() => {
        router.push(`/passport?order=${latestOrder.id}`);
      }, 2000); // 2s delay to read success message
      return () => clearTimeout(timer);
    }
  }, [txState, latestOrder, router]);

  useEffect(() => {
    if (isSignedIn) {
      loadLatestOrder();
    } else {
      setLatestOrder(null);
      setActiveEdition(null);
    }
  }, [isSignedIn, user?.email]);

  async function loadLatestOrder() {
    try {
      setTxState('loading');
      let latest: any = null;

      // 1. Check verified chain orders if authenticated with active wallet
      if (isSignedIn) {
        try {
          const chainRes = await backendApi.getMyChainOrders();
          if (chainRes?.orders && chainRes.orders.length > 0) {
            const c = chainRes.orders[0];
            const { price: livePrice } = await getLiveSolPrice().catch(() => ({ price: DEFAULT_SOL_MARKET_PRICE }));
            const rate = livePrice > 0 ? livePrice : DEFAULT_SOL_MARKET_PRICE;
            latest = {
              id: c.id,
              drop_id: c.batch_id,
              batch_id: c.batch_id,
              tx_signature: c.purchase_signature,
              escrow_pda: c.vault_address || c.order_address,
              amount_usd: c.amount_lamports ? (Number(c.amount_lamports) / 1e9 * rate).toFixed(2) : ((c as any).amount_usd ? Number((c as any).amount_usd).toFixed(2) : '0.00'),
              size: c.size || 'M',
              quantity: c.quantity || 1,
              status: c.cancelled ? 'cancelled' : (c.collected_at ? 'delivered' : 'pending'),
              garment_serial: c.garment_serial,
            };
          }
        } catch {}
      }

      // 2. Check DB orders by user email
      if (!latest && user?.email) {
        try {
          const orders = await getUserOrders(user.email);
          if (orders && orders.length > 0) {
            latest = orders[0];
          }
        } catch {}
      }

      // 3. Check local storage cache (Strictly scoped to current authenticated user)
      if (!latest && isSignedIn && typeof window !== 'undefined') {
        try {
          const localOrders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
          const currentWallet = (user?.walletAddress || '').trim().toLowerCase();
          const currentEmail = (user?.email || '').trim().toLowerCase();

          if (Array.isArray(localOrders)) {
            const matched = localOrders.find((loc: any) => {
              const locWallet = (loc.wallet_address || loc.buyer_wallet || '').trim().toLowerCase();
              const locEmail = (loc.email || '').trim().toLowerCase();
              return (currentWallet && locWallet && locWallet === currentWallet) ||
                     (currentEmail && locEmail && locEmail === currentEmail);
            });
            if (matched) latest = matched;
          }
        } catch {}
      }

      if (latest) {
        setLatestOrder(latest);
        if (latest.delivery_location) setDeliveryLocation(latest.delivery_location);
        if (latest.delivery_address) setDeliveryAddress(latest.delivery_address);

        // Resolve edition
        let editionId = latest.drop_id;
        if (latest.batch_id) {
          try {
            const bRes = await backendApi.getPublicBatchById(latest.batch_id);
            if (bRes?.batch?.edition_id) {
              editionId = bRes.batch.edition_id;
            }
          } catch {}
        }
        if (editionId) {
          const ed = await getEditionById(editionId);
          setActiveEdition(ed);
        }
      }
    } catch (err) {
      console.error('Error fetching latest order details:', err);
    } finally {
      setTxState('idle');
    }
  }

  const handleDeliver = async () => {
    if (processingRef.current) return;

    if (!isSignedIn) {
      setIsSignInOpen(true);
      return;
    }

    if (!user?.email) {
      showToast('Email Required', 'Please provide an email to confirm physical garment delivery.');
      setIsSignInOpen(true);
      return;
    }

    if (!latestOrder) {
      showToast('No Order', 'You do not have any active order to finalize.');
      return;
    }

    processingRef.current = true;
    setTxState('signing');
    setTxResult({});

    try {
      if (!deliveryLocation || !deliveryAddress) {
        showToast('Info Required', 'Please fill in your delivery location and address.');
        processingRef.current = false;
        setTxState('idle');
        return;
      }

      // 1. Save delivery details while state is active
      await updateOrderDelivery(user.email, deliveryLocation, deliveryAddress);

      // 2. Process Solana Escrow confirm release
      await confirmDelivery(latestOrder.id || latestOrder.drop_id);

      // 3. Complete order delivery state update
      await updateOrderStatus(latestOrder.tx_signature || latestOrder.id, 'delivered');

      setTxState('success');
      setTxResult({
        txSignature: latestOrder.tx_signature || undefined,
        solscanUrl: latestOrder.tx_signature ? solscanTxUrl(latestOrder.tx_signature) : undefined,
        fundsReleased: 0,
        designerAddress: '',
      });
      showToast('✓', 'Delivery confirmed');
    } catch (err) {
      setTxState('error');
      setTxResult({ message: parseError(err) });
      showToast('✗', 'Confirmation failed');
    } finally {
      processingRef.current = false;
    }
  };

  const ed = activeEdition;

  return (
    <section className="min-h-screen flex items-center justify-center px-6 pt-[72px] pb-12" aria-label="Confirm Delivery">

      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="ambient-orb orb-white" />
        <div className="ambient-orb orb-grey" />
      </div>

      <div className="card-glass max-w-[500px] w-full p-8 md:p-12 flex flex-col items-center text-center gap-8 relative z-10" style={{ animation: 'fadeIn 0.6s ease-out' }}>
        {/* Shield Icon */}
        <div className="relative">
          <div className="absolute inset-0 md:inset-[-40%] bg-white/[0.05] blur-[30px] rounded-full animate-pulse" />

          <svg className="w-20 h-20 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Did Your Piece Arrive?</h1>
          <p className="text-sm text-[#A3A3A3] leading-relaxed max-w-[360px]">
            Confirm it arrived and we'll unlock your order Passport.
          </p>
        </div>

        {txState === 'loading' ? (
          <div className="flex flex-col items-center py-6 gap-2">
            <div className="w-8 h-8 border-2 border-white/10 border-t-white rounded-full animate-spin" />
            <span className="text-xs font-mono text-[#555]">Querying active orders...</span>
          </div>
        ) : !isSignedIn ? (
          <div className="w-full py-6">
            <button 
              onClick={() => setIsSignInOpen(true)}
              className="btn-circuit w-full justify-center text-xs py-4"
            >
              <span>Sign in to find your order</span>
            </button>
          </div>
        ) : !latestOrder ? (
          <div className="w-full py-6 text-center text-[#888] text-xs">
            {!user?.email ? (
              <div className="flex flex-col items-center gap-3 max-w-xs mx-auto py-2">
                <p>Your wallet is connected, but no email is linked to load your active orders.</p>
                <button
                  onClick={() => setIsSignInOpen(true)}
                  className="btn-circuit px-6 py-2.5 text-xs justify-center"
                >
                  <span>Link Notification Email</span>
                </button>
              </div>
            ) : (
              <>
                <p>We couldn&apos;t find any orders for your email ({user.email}).</p>
                <a href="/drop" className="btn-outline-circuit mt-6 justify-center">Visit Shop</a>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Item Preview */}
            <div className="w-full flex items-center gap-4 bg-white/[0.03] border border-white/[0.08] p-4 rounded-2xl">
              <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-white/10 relative">
                <Image src={ed?.images?.[0]?.url || '/satin.png'} alt={ed?.name || latestOrder.drop_name || 'Circuit Garment'} fill className="object-cover" />
              </div>
              <div className="flex flex-col text-left">
                <span className="text-[0.6rem] font-bold text-[#666] uppercase tracking-wider">Active Order</span>
                <span className="text-sm font-bold truncate max-w-[240px]">{ed?.name || latestOrder.drop_name || 'Circuit Garment'}</span>
                <span className="text-[0.6rem] font-mono text-[#555]">
                  Size: {latestOrder.size || 'M'} | Status: {latestOrder.status}
                  {latestOrder.garment_serial && ` | Edition Run: ${formatSerialNumber(latestOrder.garment_serial, ed?.max_supply || 50)}`}
                </span>
              </div>
            </div>

            {/* Delivery Options */}
            <div className="w-full flex flex-col gap-4 text-left">
              <div className="flex flex-col gap-2">
                <span className="text-[0.65rem] text-[#666] uppercase tracking-[0.12em] font-bold">Preferred Delivery Location</span>
                <select 
                  value={deliveryLocation}
                  onChange={(e) => setDeliveryLocation(e.target.value)}
                  className="bg-[#0D0D0D] border border-white/[0.08] rounded-xl p-3 text-sm text-white focus:outline-none focus:border-white/20"
                >
                  <option value="">Select Location</option>
                  <option value="Lagos">Lagos</option>
                  <option value="Ibadan">Ibadan</option>
                  <option value="Ilorin">Ilorin</option>
                  <option value="Abuja" disabled className="text-[#444]">Abuja (Coming Soon)</option>
                  <option value="Port Harcourt" disabled className="text-[#444]">Port Harcourt (Coming Soon)</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[0.65rem] text-[#666] uppercase tracking-[0.12em] font-bold">Delivery Address</span>
                <textarea 
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="Enter your full doorstep details"
                  className="bg-[#0D0D0D] border border-white/[0.08] rounded-xl p-3 text-sm text-white focus:outline-none focus:border-white/20 h-20 resize-none"
                />
                <p className="text-[0.65rem] text-[#666] italic mt-1 leading-relaxed">
                  *Address submission doesn't guarantee doorstep delivery. Pickup details will be emailed once your order is ready
                </p>
              </div>
            </div>

            {/* Action Button */}
            <button
              className={`btn-circuit w-full justify-center ${txState === 'signing' ? 'signing' : ''}`}
              onClick={handleDeliver}
              disabled={txState === 'signing' || txState === 'success'}
            >
              <span>
                {txState === 'signing' ? 'Processing...' :
                 txState === 'success' ? '✓ Receipt Recorded' :
                 'Confirm it arrived'}
              </span>
              {txState !== 'success' && txState !== 'signing' && (
                <span className="btn-arrow">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </span>
              )}
            </button>

            {/* Garment Authenticity QR Code Card */}
            <div className="w-full flex flex-col items-center p-5 rounded-2xl bg-white/[0.02] border border-white/[0.08] gap-3">
              <div className="flex items-center justify-between w-full">
                <span className="text-[0.62rem] font-bold uppercase tracking-wider text-emerald-400 font-mono">
                  Garment Authenticity Label
                </span>
                <span className="text-[0.6rem] font-mono text-[#888]">
                  {latestOrder.garment_serial
                    ? `Serial #${latestOrder.garment_serial}`
                    : 'NFC / QR Sync'}
                </span>
              </div>
              <div className="bg-white p-3.5 rounded-2xl shadow-lg my-1">
                <QRCodeCanvas
                  id="confirm-garment-qr"
                  value={passportUrl}
                  size={140}
                  level="H"
                  includeMargin={true}
                />
              </div>
              <p className="text-[0.62rem] text-[#888] font-mono leading-relaxed max-w-[280px]">
                Scan with any smartphone camera to verify permanent on-chain provenance and escrow status.
              </p>
              <div className="flex gap-2 w-full pt-1">
                <button
                  type="button"
                  onClick={handleDownloadQR}
                  className="btn-outline-circuit flex-1 py-2 text-xs border-white/10 text-white/80 hover:text-white font-mono justify-center"
                >
                  📥 Save QR
                </button>
                <Link
                  href={`/passport?order=${latestOrder.id}`}
                  className="btn-circuit flex-1 py-2 text-xs font-mono justify-center"
                >
                  Passport →
                </Link>
              </div>
            </div>
          </>
        )}

        {/* Results */}
        {txState === 'success' && latestOrder && (
          <div className="tx-msg ok flex flex-col gap-3 w-full animate-fade-in">
            <p className="font-bold text-xs uppercase tracking-wider text-emerald-400">✓ Garment Receipt Recorded & Passport Activated</p>
            <p className="text-[0.65rem] text-[#888] font-mono leading-relaxed">
              Your collection has been verified. Atelier balance settlement unlocks per the batch schedule.
            </p>
            <div className="flex gap-6 justify-center text-[0.65rem] font-bold uppercase tracking-widest font-mono pt-1">
              {txResult.solscanUrl && (
                <a href={txResult.solscanUrl} target="_blank" rel="noopener" className="text-[#666] hover:text-white transition-colors">Explorer Proof ↗</a>
              )}
              <Link href={`/passport?order=${latestOrder.id}`} className="text-white underline underline-offset-4">Digital Passport →</Link>
            </div>
          </div>
        )}

        {txState === 'error' && (
          <div className="tx-msg err w-full animate-fade-in">
            <span>✗</span>
            <span>{txResult.message}</span>
          </div>
        )}

        <div className="flex items-center gap-2 text-[0.6rem] font-bold text-[#444] uppercase tracking-widest">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Your payment is protected until you confirm
        </div>
      </div>

      <SignInModal isOpen={isSignInOpen} onClose={() => setIsSignInOpen(false)} />
    </section>
  );
}
