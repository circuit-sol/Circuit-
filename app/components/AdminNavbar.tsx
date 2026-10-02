'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/lib/auth-context';

export default function AdminNavbar() {
  const pathname = usePathname();
  const { user, isSignedIn, triggerConnect, isAuthenticating, signOut } = useAuth();

  return (
    <nav className="fixed top-0 left-0 right-0 z-[100] border-b border-white/[0.06] bg-black/60 backdrop-blur-[20px]">
      <div className="section-container h-[72px] flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group transition-transform hover:scale-[1.02]">
          <div className="p-2 rounded-xl bg-white/[0.03] border border-white/10 group-hover:border-white/20 transition-all">
            <Image src="/logo/logo_icon_white.svg" alt="Circuit" width={24} height={24} />
          </div>
          <span className="text-xl font-bold tracking-tighter uppercase">Circuit</span>
        </Link>

        {/* Admin Badge */}
        <div className="hidden md:flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/10">
          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
          <span className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#666]">Admin Access</span>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-4">
          {isSignedIn && user ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/10 font-mono text-[0.65rem] text-emerald-400">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
              <span>{user.walletAddress.slice(0, 4)}...{user.walletAddress.slice(-4)}</span>
            </div>
          ) : (
            <button
              onClick={triggerConnect}
              disabled={isAuthenticating}
              className="px-3.5 py-1.5 rounded-full bg-white text-black text-[0.65rem] font-bold uppercase tracking-wider hover:bg-white/90 transition-all shadow-sm"
            >
              {isAuthenticating ? 'Connecting...' : 'Connect Wallet'}
            </button>
          )}

          <button 
            onClick={() => {
              sessionStorage.removeItem('circuit_admin_session');
              signOut();
              window.location.href = '/admin/login';
            }}
            className="text-[0.65rem] font-bold uppercase tracking-widest text-[#444] hover:text-white transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  );
}
