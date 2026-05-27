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
import { formatSerialNumber } from '@/lib/utils';

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
    if (isSignedIn && user?.email) {
      loadLatestOrder();
    } else {
      setLatestOrder(null);
      setActiveEdition(null);
    }
  }, [isSignedIn, user]);

  async function loadLatestOrder() {
    try {
      setTxState('loading');
      if (!user?.email) return;

      const orders = await getUserOrders(user.email);
      if (orders && orders.length > 0) {
        // Find the latest order (sorted descending by default)
        const latest = orders[0];
        setLatestOrder(latest);

        if (latest.delivery_location) setDeliveryLocation(latest.delivery_location);
        if (latest.delivery_address) setDeliveryAddress(latest.delivery_address);

        // Fetch edition
        const ed = await getEditionById(latest.drop_id);
        setActiveEdition(ed);
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
      showToast('Sign in required', 'Please sign in to confirm delivery.');
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
      const result = await confirmDelivery(user.email, latestOrder.drop_id);

      // 3. Complete order delivery state update
      await updateOrderStatus(result.txSignature, 'delivered');

      setTxState('success');
      setTxResult({
        txSignature: result.txSignature,
        solscanUrl: result.solscanUrl,
        fundsReleased: result.fundsReleased,
        designerAddress: result.designerAddress,
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

  const ed = activeEdition || {
    name: '3 Piece Agbada',
    images: [{ url: '/satin.png', tag: 'Front' }],
  };

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
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Finalize Delivery</h1>
          <p className="text-sm text-[#A3A3A3] leading-relaxed max-w-[340px]">
            Your payment will be released to the designer once you confirm receipt of your customized piece.
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
              <span>Sign In to Load Order</span>
            </button>
          </div>
        ) : !latestOrder ? (
          <div className="w-full py-6 text-center text-[#666] text-xs">
            No pending or active orders located for your email address.
            <a href="/drop" className="btn-outline-circuit mt-6 justify-center">Visit Shop</a>
          </div>
        ) : (
          <>
            {/* Item Preview */}
            <div className="w-full flex items-center gap-4 bg-white/[0.03] border border-white/[0.08] p-4 rounded-2xl">
              <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-white/10 relative">
                <Image src={ed.images?.[0]?.url || '/satin.png'} alt={ed.name} fill className="object-cover" />
              </div>
              <div className="flex flex-col text-left">
                <span className="text-[0.6rem] font-bold text-[#666] uppercase tracking-wider">Active Order</span>
                <span className="text-sm font-bold truncate max-w-[240px]">{ed.name}</span>
                <span className="text-[0.6rem] font-mono text-[#555]">
                  Size: {latestOrder.size || 'M'} | Status: {latestOrder.status}
                  {latestOrder.garment_serial && ` | Edition Run: ${formatSerialNumber(latestOrder.garment_serial, (activeEdition || ed).max_supply)}`}
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
                 txState === 'success' ? '✓ Payment Released' :
                 'Confirm Receipt'}
              </span>
              {txState !== 'success' && txState !== 'signing' && (
                <span className="btn-arrow">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </span>
              )}
            </button>
          </>
        )}

        {/* Results */}
        {txState === 'success' && latestOrder && (
          <div className="tx-msg ok flex flex-col gap-3 w-full animate-fade-in">
            <p className="font-bold text-xs uppercase tracking-wider">✓ Escrow Released Successfully</p>
            <div className="flex gap-6 justify-center text-[0.65rem] font-bold uppercase tracking-widest font-mono">
              <a href={txResult.solscanUrl} target="_blank" rel="noopener" className="text-[#666] hover:text-white transition-colors">Explorer Proof ↗</a>
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
          Secured by Solana Escrow
        </div>
      </div>

      <SignInModal isOpen={isSignInOpen} onClose={() => setIsSignInOpen(false)} />
    </section>
  );
}
