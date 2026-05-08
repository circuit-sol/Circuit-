'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useState } from 'react';
import Image from 'next/image';

const NAV_LINKS = [
  { href: '/drop', label: 'Drop', page: 'drop' },
  { href: '/confirm', label: 'Confirm', page: 'confirm' },
  { href: '/garment/G17eNpsCn4S2Xtr4f9t9fmgyf6ZVFEpdXnpqJBiBCFEo', label: 'Passport', page: 'garment' },
];

export default function Navbar() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activePage = pathname.startsWith('/garment') ? 'garment' :
    pathname.startsWith('/confirm') ? 'confirm' : 'drop';

  return (
    <>
      <nav className="fixed top-0 left-0 w-full h-[72px] z-[1000] bg-black/60 backdrop-blur-[24px] border-b border-white/[0.12] transition-all duration-400" role="navigation" aria-label="Main navigation">
        <div className="max-w-[1400px] mx-auto h-full flex items-center px-8 gap-6">
          {/* Brand */}
          <Link href="/drop" className="flex items-center gap-2.5 shrink-0" aria-label="Circuit home">
            <Image src="/logo/logo_icon_white.svg" alt="Circuit" width={32} height={32} className="drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]" />
            <span className="font-brand text-[1.35rem] font-semibold tracking-[0.05em] bg-gradient-to-b from-white to-[#bbb] bg-clip-text text-transparent">Circuit</span>
          </Link>

          {/* Center Nav */}
          <div className="hidden md:flex gap-1 mx-auto relative p-1 bg-white/[0.03] rounded-full border border-white/[0.12]">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.page}
                href={link.href}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-colors relative z-[1] ${
                  activePage === link.page ? 'text-white bg-white/[0.08] border border-white/[0.2]' : 'text-[#A3A3A3] hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right */}
          <div className="hidden md:flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.12] text-[0.7rem] font-semibold uppercase tracking-[0.06em]" aria-label="Network: Devnet">
              <span className="w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.4)] animate-pulse" aria-hidden="true" />
              <span>Devnet</span>
            </div>
            <WalletMultiButton className="!bg-white !text-black !rounded-full !text-sm !font-semibold !px-5 !py-2 hover:!shadow-[0_8px_25px_rgba(255,255,255,0.15)] hover:!-translate-y-0.5 !transition-all !duration-300" />
          </div>

          {/* Hamburger */}
          <button
            className="md:hidden w-9 h-9 relative shrink-0 rounded-lg hover:bg-white/[0.04]"
            onClick={() => setDrawerOpen(!drawerOpen)}
            aria-label="Toggle menu"
            aria-expanded={drawerOpen}
          >
            <span className={`block w-5 h-[1.5px] bg-white rounded-sm absolute left-2 transition-all duration-400 ${drawerOpen ? 'rotate-45 top-[17px]' : 'top-3'}`} aria-hidden="true" />
            <span className={`block w-5 h-[1.5px] bg-white rounded-sm absolute left-2 transition-all duration-400 ${drawerOpen ? 'opacity-0' : 'top-[17px]'}`} aria-hidden="true" />
            <span className={`block w-5 h-[1.5px] bg-white rounded-sm absolute left-2 transition-all duration-400 ${drawerOpen ? '-rotate-45 top-[17px]' : 'top-[22px]'}`} aria-hidden="true" />
          </button>
        </div>
      </nav>

      {/* Mobile Drawer */}
      <div
        className={`fixed top-[72px] left-0 w-full bottom-0 bg-[rgba(5,5,5,0.97)] backdrop-blur-[30px] z-[999] flex flex-col p-8 transition-all duration-350 md:hidden ${
          drawerOpen ? 'opacity-100 pointer-events-auto translate-y-0' : 'opacity-0 pointer-events-none -translate-y-2'
        }`}
        role="dialog"
        aria-label="Mobile navigation"
      >
        <div className="flex-1 flex flex-col gap-2 pt-4">
          {NAV_LINKS.map((link, i) => (
            <Link
              key={link.page}
              href={link.href}
              onClick={() => setDrawerOpen(false)}
              className={`text-[1.6rem] font-semibold py-5 border-b border-white/[0.12] flex items-center gap-4 transition-all duration-400 ${
                activePage === link.page ? 'text-white' : 'text-[#A3A3A3] hover:text-white'
              }`}
            >
              <span className="text-[0.7rem] font-bold text-[#D1D1D1] tracking-[0.06em] w-7">{String(i + 1).padStart(2, '0')}</span>
              {link.label}
            </Link>
          ))}
        </div>
        <div className="pt-8 flex flex-col gap-4">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.12] text-[0.7rem] font-semibold uppercase tracking-[0.06em] w-fit">
            <span className="w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.4)] animate-pulse" aria-hidden="true" />
            <span>Devnet</span>
          </div>
          <WalletMultiButton className="!bg-white !text-black !rounded-full !text-sm !font-semibold !px-5 !py-2 !w-fit" />
          <p className="text-xs text-[#A3A3A3] font-semibold tracking-[0.06em]">...with the edge</p>
        </div>
      </div>
    </>
  );
}
