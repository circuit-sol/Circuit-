'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { fetchPassportData, type PassportData } from '@/lib/solana-service';
import { truncateAddress, solscanTokenUrl } from '@/lib/utils';
import { GARMENT_MINT, MAX_SUPPLY } from '@/lib/constants';

export default function GarmentPassportPage() {
  const params = useParams();
  const mint = (params.mint as string) || GARMENT_MINT;
  const [passport, setPassport] = useState<PassportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchPassportData(mint)
      .then((data) => {
        setPassport(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [mint]);

  if (loading) {
    return (
      <section className="min-h-screen flex items-center justify-center pt-[72px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-white/10 border-t-white rounded-full animate-spin" />
          <p className="text-[0.65rem] font-bold text-[#666] uppercase tracking-widest">Retrieving On-Chain Data...</p>
        </div>
      </section>
    );
  }

  if (error || !passport) {
    return (
      <section className="min-h-screen flex items-center justify-center px-6 pt-[72px]">
        <div className="card-glass max-w-[480px] w-full p-10 flex flex-col items-center text-center gap-6">
          <div className="text-4xl opacity-40">🔍</div>
          <h1 className="text-xl font-bold uppercase tracking-tight">No Passport Found</h1>
          <p className="text-sm text-[#A3A3A3] leading-relaxed">
            The decentralized record for this garment could not be retrieved. 
            Check the mint address or ensure you are on the correct network.
          </p>
          <code className="block w-full bg-black/40 p-3 rounded-xl font-mono text-[0.65rem] text-[#666] break-all">{mint}</code>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen flex flex-col pt-[72px] pb-16" aria-label="Digital Passport">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="ambient-orb orb-white opacity-10" />
        <div className="ambient-orb orb-grey opacity-20" />
      </div>

      {/* Header */}
      <header className="section-container pt-12 md:pt-20 text-center relative z-10" style={{ animation: 'fadeIn 0.5s ease-out' }}>
        <span className="inline-block px-4 py-1.5 rounded-full text-[0.6rem] font-bold uppercase tracking-[0.12em] border border-white/10 bg-white/[0.03] text-[#A3A3A3] mb-6">
          Garment passport
        </span>
        <h1 className="text-4xl md:text-6xl font-bold tracking-[-0.04em] mb-6">Authentic Record</h1>
        <p className="text-sm md:text-base text-[#666] max-w-[540px] mx-auto leading-relaxed">
          Permanent proof of ownership, origin, and provenance secured by the Solana network.
        </p>
      </header>

      {/* Content Grid */}
      <div className="section-container py-12 md:py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-24 relative z-10 items-start">
        
        {/* Left Column: Image & ID */}
        <div className="flex flex-col gap-8 items-center lg:sticky lg:top-[120px]" style={{ animation: 'fadeIn 0.6s ease-out 0.1s both' }}>
          <div className="relative w-full max-w-[500px] rounded-[32px] overflow-hidden border border-white/[0.12] bg-[#0D0D0D] shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
            <Image
              src="/satin.png"


              alt={`${passport.garmentName} — Digital Product Passport`}
              width={600}
              height={720}
              className="w-full h-auto object-cover scale-[1.02]"
              priority
            />
          </div>
          
          <div className="flex flex-col items-center gap-2">
            <span className="text-[0.65rem] font-bold text-[#444] uppercase tracking-[0.2em]">Garment Edition</span>
            <span className="text-xl font-bold text-white">{passport.edition} of {MAX_SUPPLY}</span>
          </div>
        </div>

        {/* Right Column: Data & Verification */}
        <div className="flex flex-col gap-10" style={{ animation: 'fadeIn 0.6s ease-out 0.2s both' }}>
          
          {/* Garment Details */}
          <div>
            <h3 className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#444] mb-4">Garment Specifications</h3>
            <div className="card-glass overflow-hidden">
              {[
                { k: 'Collection', v: 'Drop Zero' },
                { k: 'Main Fabric', v: passport.fabric },
                { k: 'Headpiece', v: passport.cap },
                { k: 'Embroidery', v: passport.embroidery },
                { k: 'Origin', v: 'Made in Nigeria' },

                { k: 'Produced', v: passport.productionDate },

              ].map((row, i, arr) => (
                <div key={row.k} className={`flex justify-between items-center p-5 text-sm ${i < arr.length - 1 ? 'border-b border-white/[0.04]' : ''}`}>
                  <span className="text-[#666] font-medium">{row.k}</span>
                  <span className="font-semibold">{row.v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Garment record */}
          <div>
            <h3 className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#444] mb-4">Garment Record</h3>
            <div className="card-glass overflow-hidden">
              {[
                { k: 'Owner', v: truncateAddress(passport.owner), mono: true },

                { k: 'Made by', v: 'Circuit', highlight: true },

                { k: 'Royalty Rule', v: `7% on every resale`, highlight: true },
              ].map((row, i, arr) => (
                <div key={row.k} className={`flex justify-between items-center p-5 text-sm ${i < arr.length - 1 ? 'border-b border-white/[0.04]' : ''}`}>
                  <span className="text-[#666] font-medium">{row.k}</span>
                  <span className={`font-semibold ${row.mono ? 'font-mono text-[0.7rem] text-[#A3A3A3]' : ''} ${row.highlight ? 'text-white' : ''}`}>
                    {row.v}
                  </span>
                </div>
              ))}
              
              <div className="bg-white/[0.02] p-5 border-t border-white/[0.04]">
                <span className="block text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#444] mb-3">Mint Address</span>
                <code className="block w-full font-mono text-[0.65rem] text-[#666] break-all leading-relaxed hover:text-[#A3A3A3] transition-colors">{passport.mintAddress}</code>
              </div>
            </div>
          </div>

          {/* Action Links */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <a
              href={solscanTokenUrl(passport.mintAddress)}
              target="_blank"
              rel="noopener"
              className="btn-outline-circuit justify-center group"
            >
              <span>View On Solscan</span>
              <svg className="w-4 h-4 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
            </a>
            <button className="btn-circuit py-3 text-[0.7rem]" onClick={() => window.print()}>
              <span>Print Certificate</span>
            </button>
          </div>

          {/* Governance Notice */}
          <div className="flex items-start gap-4 p-6 bg-white/[0.01] border border-white/[0.06] rounded-3xl">
            <div className="shrink-0 text-[#666] pt-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <p className="text-[0.7rem] text-[#666] leading-relaxed">
              This record is immutable and exists on the Solana ledger independent of this interface. 
              The creator royalties and ownership permissions are enforced by program logic at the protocol level.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
