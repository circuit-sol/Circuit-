'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import * as backendApi from '@/lib/backendApi';
import { useAuth } from '@/lib/auth-context';
import AdminNavbar from '@/components/AdminNavbar';

export default function AdminLoginPage() {
  const [adminWallet, setAdminWallet] = useState<string | null>(null);
  const [loadingChain, setLoadingChain] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();
  const { user, isSignedIn, triggerConnect, isAuthenticating } = useAuth();

  // Load configured protocol admin authority on mount
  useEffect(() => {
    let isMounted = true;
    async function loadAuthority() {
      try {
        const chainRes = await backendApi.getChainStatus();
        if (chainRes?.admin_wallet && isMounted) {
          setAdminWallet(chainRes.admin_wallet);
        }
      } catch (err) {
        console.warn('Could not fetch chain status on login:', err);
      } finally {
        if (isMounted) setLoadingChain(false);
      }
    }
    loadAuthority();
    return () => {
      isMounted = false;
    };
  }, []);

  // When signed in with wallet, verify authority
  useEffect(() => {
    if (isSignedIn && user?.walletAddress) {
      if (adminWallet) {
        if (user.walletAddress === adminWallet) {
          router.push('/admin');
        } else {
          setError(
            `Connected keypair (${user.walletAddress.slice(0, 4)}...${user.walletAddress.slice(-4)}) is not the authorized Circuit Admin Authority (${adminWallet.slice(0, 4)}...${adminWallet.slice(-4)}). Please connect using the designated admin keypair.`
          );
        }
      } else {
        // If chain status was unreachable, attempt route transition
        router.push('/admin');
      }
    }
  }, [isSignedIn, user, adminWallet, router]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 selection:bg-white selection:text-black">
      <AdminNavbar />
      {/* Ambient Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-white/[0.03] rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/[0.03] rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-[460px] animate-fade-in relative z-10">
        <div className="flex flex-col items-center mb-10 text-center">
          <div className="mb-6 p-4 rounded-3xl bg-white/[0.03] border border-white/10 shadow-2xl">
            <Image src="/logo/logo_icon_white.svg" alt="Circuit" width={48} height={48} className="brightness-125" />
          </div>
          <h1 className="text-3xl font-bold tracking-tighter mb-2">Command Center</h1>
          <p className="text-xs text-[#888] uppercase tracking-[0.2em] font-bold">Protocol Governance & Escrow Oversight</p>
        </div>

        {/* Cryptographic Wallet Sign-In Card */}
        <div className="card-glass p-8 rounded-3xl border border-white/10 mb-6 flex flex-col gap-6 shadow-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
              <span className="text-xs font-bold uppercase tracking-wider text-white">Cryptographic Clearance</span>
            </div>
            <span className="text-[0.6rem] font-mono text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-400/10 border border-emerald-400/20">
              SIWS Protected
            </span>
          </div>

          <p className="text-xs text-[#888] leading-relaxed">
            Circuit operates non-custodial Anchor treasury contracts on Solana. Administrative commands, dispute resolutions, and drop curations require cryptographic signatures matching the designated admin authority keypair.
          </p>

          {/* Admin Authority Address Card */}
          <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex flex-col gap-1.5 font-mono text-xs">
            <span className="text-[#666] text-[0.6rem] uppercase tracking-wider font-semibold">
              Designated Admin Authority
            </span>
            {loadingChain ? (
              <span className="text-[#555] text-xs">Querying on-chain config...</span>
            ) : adminWallet ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-white font-mono text-[0.7rem] truncate select-all">
                  {adminWallet}
                </span>
                <span className="text-[0.55rem] uppercase px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 whitespace-nowrap">
                  Verified PDA
                </span>
              </div>
            ) : (
              <span className="text-[#888] text-xs">Dynamic RPC Authority</span>
            )}
          </div>

          {error && (
            <div className="p-3.5 bg-red-500/10 border border-red-500/25 rounded-2xl text-red-400 text-xs leading-relaxed">
              {error}
            </div>
          )}

          <button
            onClick={() => {
              setError('');
              triggerConnect();
            }}
            disabled={isAuthenticating}
            className="btn-circuit py-4 justify-center w-full text-xs"
          >
            <span>{isAuthenticating ? 'Awaiting Keypair Signature...' : 'Connect Admin Authority Wallet'}</span>
            <span className="btn-arrow">→</span>
          </button>
        </div>

        <div className="text-center">
          <Link href="/" className="text-xs text-[#666] hover:text-white transition-colors">
            ← Return to Storefront
          </Link>
        </div>

        <p className="text-center mt-8 text-[0.6rem] text-[#444] uppercase tracking-[0.2em] font-bold">
          Circuit — Non-Custodial Protocol Governance
        </p>
      </div>
    </div>
  );
}
