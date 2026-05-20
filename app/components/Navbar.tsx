'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';

import Image from 'next/image';
import { useAuth } from '@/lib/auth-context';
import SignInModal from './SignInModal';
import { truncateAddress } from '@/lib/utils';
import { showToast } from './Toast';

const NAV_LINKS = [
  { href: '/drop', label: 'Drop', page: 'drop' },
  { href: '/confirm', label: 'Confirm', page: 'confirm' },
  { href: '/passport', label: 'Passport', page: 'passport' },
];

export default function Navbar() {
  const pathname = usePathname();
  const { user, isSignedIn, signOut, getPrivateKey } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
    setIsProfileOpen(false);
  }, [pathname]);

  // Handle outside clicks and scroll
  useEffect(() => {
    const handleClose = () => setIsProfileOpen(false);
    
    if (isProfileOpen) {
      document.addEventListener('mousedown', (e) => {
        if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
          handleClose();
        }
      });
      window.addEventListener('scroll', handleClose, { passive: true });
    }

    return () => {
      document.removeEventListener('mousedown', handleClose);
      window.removeEventListener('scroll', handleClose);
    };
  }, [isProfileOpen]);

  // Lock scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
  }, [drawerOpen]);


  const activePage = pathname.startsWith('/passport') ? 'passport' :
    pathname.startsWith('/landing') ? 'landing' :
    pathname.startsWith('/confirm') ? 'confirm' : 'drop';

  const handleExportKey = () => {
    const key = getPrivateKey();
    if (key === 'SECURED_BY_INFRASTRUCTURE') {
      alert('🔒 Your key is secured by Circuit infrastructure.\n\nTo enable "Invisible Blockchain" UX, your keys are managed in an encrypted vault. You can use your email to access your account across any device.');
    } else if (key) {
      alert(`PRIVATE KEY (Demo): ${key}\n\nWARNING: Never share this key.`);
      showToast('🔑', 'Private key exported');
    }
  };

  return (
    <>
      <nav className="fixed top-0 left-0 w-full h-[72px] z-[1000] bg-black/60 backdrop-blur-[24px] border-b border-white/[0.08]" role="navigation">
        <div className="max-w-[1400px] mx-auto h-full flex items-center justify-between px-6 md:px-10">
          
          {/* Brand - Left */}
          <Link href="/landing" className="flex items-center gap-2.5 shrink-0 z-[1001]">
            <Image src="/logo/logo_icon_white.svg" alt="Circuit" width={28} height={28} className="brightness-110" />
            <span className="font-brand text-[1.2rem] font-bold tracking-[0.05em] bg-gradient-to-b from-white to-[#A3A3A3] bg-clip-text text-transparent">Circuit</span>
          </Link>

          {/* Desktop Nav - Center */}
          <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 gap-1 p-1 bg-white/[0.03] border border-white/[0.08] rounded-full">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.page}
                href={link.href}
                className={`px-6 py-2 rounded-full text-[0.8rem] font-semibold uppercase tracking-[0.06em] transition-all ${
                  activePage === link.page ? 'text-white bg-white/[0.1] shadow-[0_0_15px_rgba(255,255,255,0.05)]' : 'text-[#666] hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Actions - Right */}
          <div className="flex items-center gap-4 z-[1001]">
            {/* Devnet Badge (Desktop only) */}
            <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-[0.6rem] font-bold uppercase tracking-[0.1em] text-[#666]">
              <span className="w-1 h-1 bg-white rounded-full animate-pulse shadow-[0_0_5px_white]" />
              Devnet
            </div>

            {isSignedIn ? (
              <div className="relative hidden md:block" ref={profileRef}>
                <button 
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  className="flex items-center gap-3 pl-1.5 pr-5 py-1.5 rounded-full bg-white text-black hover:bg-[#D1D1D1] transition-all shadow-[0_8px_30px_rgba(255,255,255,0.1)] group"
                >
                  <div className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center text-[11px] font-bold shadow-inner">
                    {user?.email[0].toUpperCase()}
                  </div>
                  <span className="text-[0.75rem] font-bold max-w-[120px] truncate">{user?.email}</span>
                </button>

                {/* Desktop Dropdown - Fixed Contrast */}
                {isProfileOpen && (
                  <div className="absolute top-[calc(100%+12px)] right-0 w-64 card-glass p-2 border border-white/[0.15] shadow-[0_30px_60px_rgba(0,0,0,0.7)] animate-fade-in z-[1100]">
                    <div className="px-4 py-3.5 border-b border-white/[0.1] mb-1">
                      <p className="text-[0.6rem] font-bold text-[#A3A3A3] uppercase tracking-[0.15em] mb-1.5">Account Connected</p>
                      <p className="text-[0.7rem] font-mono text-white/70 break-all leading-relaxed">{user?.walletAddress}</p>
                    </div>
                    <div className="p-1 flex flex-col gap-1">
                      <button 
                        onClick={handleExportKey}
                        className="w-full text-left px-4 py-3 text-[0.75rem] font-semibold text-[#D1D1D1] hover:text-white hover:bg-white/[0.08] rounded-xl transition-all flex items-center gap-3.5 group"
                      >
                        <span className="text-base group-hover:scale-110 transition-transform">🔑</span>
                        Export Secure Key
                      </button>
                      <button 
                        onClick={() => { signOut(); setIsProfileOpen(false); }}
                        className="w-full text-left px-4 py-3 text-[0.75rem] font-bold text-[#ff5050] hover:bg-[#ff5050]/[0.1] rounded-xl transition-all flex items-center gap-3.5 group"
                      >
                        <span className="text-base group-hover:scale-110 transition-transform">🚪</span>
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}

              </div>

            ) : (
              <button 
                onClick={() => setIsSignInOpen(true)}
                className="hidden md:block bg-white text-black px-6 py-2 rounded-full text-[0.75rem] font-bold uppercase tracking-[0.06em] hover:shadow-[0_8px_30px_rgba(255,255,255,0.15)] transition-all"
              >
                Sign In
              </button>
            )}

            {/* Hamburger Toggle - Always on Right */}
            <button
              className="md:hidden w-10 h-10 flex flex-col items-center justify-center gap-1.5 rounded-full hover:bg-white/[0.05] transition-all"
              onClick={() => setDrawerOpen(!drawerOpen)}
              aria-label="Toggle menu"
            >
              <span className={`block w-5 h-0.5 bg-white transition-all duration-300 ${drawerOpen ? 'rotate-45 translate-y-2' : ''}`} />
              <span className={`block w-5 h-0.5 bg-white transition-all duration-300 ${drawerOpen ? 'opacity-0' : ''}`} />
              <span className={`block w-5 h-0.5 bg-white transition-all duration-300 ${drawerOpen ? '-rotate-45 -translate-y-2' : ''}`} />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Drawer - Full Polish */}
      <div
        className={`fixed inset-0 bg-black/95 backdrop-blur-[30px] z-[999] md:hidden transition-all duration-500 ${
          drawerOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full'
        }`}
      >
        <div className="h-full flex flex-col px-8 pt-32 pb-12">
          <div className="flex flex-col gap-8">
            {NAV_LINKS.map((link, i) => (
              <Link
                key={link.page}
                href={link.href}
                className="group flex items-baseline gap-4"
              >
                <span className="text-[0.7rem] font-mono text-[#444] group-hover:text-white transition-colors">
                  0{i + 1}
                </span>
                <span className={`text-[2.5rem] font-bold tracking-[-0.03em] ${
                  activePage === link.page ? 'text-white' : 'text-[#666] hover:text-white'
                }`}>
                  {link.label}
                </span>
              </Link>
            ))}
          </div>

          <div className="mt-auto pt-12 border-t border-white/[0.08] flex flex-col gap-8">
            {isSignedIn ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col">
                  <span className="text-[0.6rem] font-bold text-[#666] uppercase tracking-[0.1em]">Authenticated as</span>
                  <span className="text-lg font-bold text-white">{user?.email}</span>
                </div>
                <div className="flex gap-4">
                  <button onClick={handleExportKey} className="text-[0.75rem] font-bold text-[#A3A3A3] underline">Export Key</button>
                  <button onClick={() => { signOut(); setDrawerOpen(false); }} className="text-[0.75rem] font-bold text-[#ff5050] underline">Sign Out</button>
                </div>
              </div>
            ) : (
              <button 
                onClick={() => { setIsSignInOpen(true); setDrawerOpen(false); }}
                className="bg-white text-black w-full py-4 rounded-2xl text-[0.8rem] font-bold uppercase tracking-[0.1em]"
              >
                Sign In to Circuit
              </button>
            )}
            
            <div className="flex justify-between items-center text-[0.6rem] font-bold text-[#444] uppercase tracking-[0.2em]">
              <span>On-Chain Infrastructure</span>
              <span>v1.0.0</span>
            </div>
          </div>
        </div>
      </div>

      <SignInModal isOpen={isSignInOpen} onClose={() => setIsSignInOpen(false)} />
    </>
  );
}
