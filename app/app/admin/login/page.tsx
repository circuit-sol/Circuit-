'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { loginAdmin } from '@/lib/db';

export default function AdminLoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // In a real production app, we would hash the password here 
      // and use a proper JWT session. For the MVP, we use the helper.
      const admin = await loginAdmin(identifier, password);

      if (admin) {
        // Save to simple session storage for the demo duration
        sessionStorage.setItem('circuit_admin_session', JSON.stringify(admin));
        router.push('/admin');
      } else {
        setError('Invalid credentials or unauthorized access.');
      }
    } catch (err) {
      setError('An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 selection:bg-white selection:text-black">
      {/* Ambient Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-white/[0.03] rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/[0.03] rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-[400px] animate-fade-in relative z-10">
        <div className="flex flex-col items-center mb-12">
          <div className="mb-8 p-4 rounded-3xl bg-white/[0.03] border border-white/10 shadow-2xl">
            <Image src="/logo/logo_icon_white.svg" alt="Circuit" width={48} height={48} className="brightness-125" />
          </div>
          <h1 className="text-3xl font-bold tracking-tighter mb-2">Command Center</h1>
          <p className="text-xs text-[#666] uppercase tracking-[0.2em] font-bold">Authorized Personnel Only</p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="text-[0.65rem] font-bold uppercase tracking-widest text-[#444] px-4">Identifier</label>
            <input 
              type="text" 
              placeholder="Email or Username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              className="w-full bg-white/[0.03] border border-white/10 px-6 py-4 rounded-2xl text-sm focus:outline-none focus:border-white/30 transition-all placeholder:text-[#333]"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[0.65rem] font-bold uppercase tracking-widest text-[#444] px-4">Passkey</label>
            <input 
              type="password" 
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-white/[0.03] border border-white/10 px-6 py-4 rounded-2xl text-sm focus:outline-none focus:border-white/30 transition-all placeholder:text-[#333]"
            />
          </div>

          {error && (
            <p className="text-red-500 text-[0.7rem] font-bold uppercase tracking-wider text-center mt-2 animate-pulse">
              {error}
            </p>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="btn-circuit py-5 mt-4 justify-center w-full"
          >
            <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
          </button>
        </form>

        <p className="text-center mt-12 text-[0.6rem] text-[#333] uppercase tracking-[0.2em] font-bold">
          Circuit — Identity Management
        </p>
      </div>
    </div>
  );
}
