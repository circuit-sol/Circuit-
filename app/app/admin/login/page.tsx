'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { loginAdmin } from '@/lib/db';
import { useAuth } from '@/lib/auth-context';
import AdminNavbar from '@/components/AdminNavbar';

export default function AdminLoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { user, isSignedIn, triggerConnect, isAuthenticating } = useAuth();

  // If already signed in with wallet, redirect to admin dashboard
  useEffect(() => {
    if (isSignedIn && user?.walletAddress) {
      router.push('/admin');
    }
  }, [isSignedIn, user, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const admin = await loginAdmin(identifier, password);
      if (admin) {
        sessionStorage.setItem('circuit_admin_session', JSON.stringify(admin));
        router.push('/admin');
      } else {
        setError('Legacy password authentication is retired. Please connect with your authorized Solana admin wallet.');
      }
    } catch {
      setError('An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 selection:bg-white selection:text-black">
      <AdminNavbar />
      {/* Ambient Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-white/[0.03] rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/[0.03] rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-[420px] animate-fade-in relative z-10">
        <div className="flex flex-col items-center mb-10 text-center">
          <div className="mb-6 p-4 rounded-3xl bg-white/[0.03] border border-white/10 shadow-2xl">
            <Image src="/logo/logo_icon_white.svg" alt="Circuit" width={48} height={48} className="brightness-125" />
          </div>
          <h1 className="text-3xl font-bold tracking-tighter mb-2">Command Center</h1>
          <p className="text-xs text-[#888] uppercase tracking-[0.2em] font-bold">Authorized Admin Authority Only</p>
        </div>

        {/* Primary Option: Cryptographic Wallet Sign-In */}
        <div className="card-glass p-6 rounded-3xl border border-white/10 mb-6 flex flex-col gap-4">
          <span className="text-[0.65rem] font-bold uppercase tracking-widest text-emerald-400 font-mono">
            Secure Cryptographic Auth
          </span>
          <p className="text-xs text-[#888] leading-relaxed">
            Circuit V2 operates non-custodial treasury and escrow contracts. Admin commands require a signature from the designated admin authority keypair.
          </p>
          <button
            onClick={() => triggerConnect()}
            disabled={isAuthenticating}
            className="btn-circuit py-4 justify-center w-full text-xs"
          >
            <span>{isAuthenticating ? 'Verifying Keypair...' : 'Connect Admin Wallet'}</span>
          </button>
        </div>

        {/* Legacy Form Divider */}
        <div className="flex items-center gap-3 my-4">
          <div className="h-px bg-white/10 flex-1" />
          <span className="text-[0.6rem] uppercase tracking-widest text-[#444] font-bold">Staff Login</span>
          <div className="h-px bg-white/10 flex-1" />
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.65rem] font-bold uppercase tracking-widest text-[#555] px-2">Identifier</label>
            <input 
              type="text" 
              placeholder="admin@circuit.fashion"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              className="w-full bg-white/[0.03] border border-white/10 px-5 py-3.5 rounded-2xl text-sm focus:outline-none focus:border-white/30 transition-all placeholder:text-[#333]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[0.65rem] font-bold uppercase tracking-widest text-[#555] px-2">Passkey</label>
            <input 
              type="password" 
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-white/[0.03] border border-white/10 px-5 py-3.5 rounded-2xl text-sm focus:outline-none focus:border-white/30 transition-all placeholder:text-[#333]"
            />
          </div>

          {error && (
            <p className="text-red-400 text-[0.7rem] leading-normal text-center mt-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              {error}
            </p>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="btn-outline-circuit py-4 mt-2 justify-center w-full text-xs opacity-70 hover:opacity-100"
          >
            <span>{loading ? 'Authenticating...' : 'Sign In with Password'}</span>
          </button>
        </form>

        <p className="text-center mt-8 text-[0.6rem] text-[#444] uppercase tracking-[0.2em] font-bold">
          Circuit — Protocol Governance
        </p>
      </div>
    </div>
  );
}
