'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { fetchPassportData, type PassportData } from '@/lib/solana-service';
import { truncateAddress, solscanTokenUrl } from '@/lib/utils';
import { GARMENT_MINT } from '@/lib/constants';

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
      <section className="min-h-[calc(100vh-72px)] flex items-center justify-center" aria-label="Loading passport">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          <p className="text-sm text-[#A3A3A3]">Loading passport data from Solana...</p>
        </div>
      </section>
    );
  }

  if (error || !passport) {
    return (
      <section className="min-h-[calc(100vh-72px)] flex items-center justify-center px-6" aria-label="Passport not found">
        <div className="card-glass max-w-[480px] w-full p-10 flex flex-col items-center text-center gap-4">
          <div className="text-4xl">🔍</div>
          <h1 className="text-xl font-bold">No Passport Found</h1>
          <p className="text-sm text-[#A3A3A3]">
            No garment record was found for mint address:<br />
            <code className="font-mono text-xs text-[#666] break-all">{mint}</code>
          </p>
          <p className="text-xs text-[#666]">Verify the mint address or scan the QR code on your garment.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-[calc(100vh-72px)] flex flex-col" aria-label="Digital Passport">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="ambient-orb orb-white" />
        <div className="ambient-orb orb-grey" />
      </div>

      {/* Header */}
      <div className="max-w-[1200px] mx-auto w-full px-6 md:px-8 pt-10 md:pt-16 text-center relative z-10" style={{ animation: 'fadeIn 0.5s ease-out' }}>
        <span className="inline-block px-3 py-1 rounded-full text-[0.7rem] font-semibold uppercase tracking-[0.06em] border border-[#D1D1D1] text-[#D1D1D1] mb-4">
          Digital Product Passport
        </span>
        <h1 className="text-3xl md:text-4xl font-bold tracking-[-0.03em] mb-3">On-Chain Ownership Record</h1>
        <p className="text-sm text-[#A3A3A3] max-w-[500px] mx-auto leading-relaxed">
          Every Circuit garment is permanently recorded on Solana. 
          Scan the QR or NFC tag on your garment to view this page.
        </p>
      </div>

      {/* Content Grid */}
      <div className="max-w-[1200px] mx-auto w-full px-6 md:px-8 py-10 md:py-16 grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-16 relative z-10">
        
        {/* Image Column */}
        <div className="flex flex-col gap-4 items-center" style={{ animation: 'fadeIn 0.6s ease-out 0.1s both' }}>
          <div className="relative w-full max-w-[420px] rounded-[24px] overflow-hidden border border-white/[0.12] bg-[#0D0D0D] shadow-[0_20px_60px_rgba(0,0,0,.5)]">
            <Image
              src="/dpp-image.png"
              alt={`${passport.garmentName} — Digital Product Passport`}
              width={500}
              height={600}
              className="w-full h-auto object-cover"
              priority
            />
            <div className="absolute bottom-4 right-4 bg-black/70 backdrop-blur-[12px] rounded-full px-3 py-1.5 text-[0.7rem] font-mono font-bold border border-white/[0.12]">
              {passport.symbol}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-[#A3A3A3]">
            <span className="w-1.5 h-1.5 bg-[#D1D1D1] rounded-full shadow-[0_0_8px_rgba(209,209,209,.4)]" aria-hidden="true" />
            Edition {passport.edition}
          </div>
        </div>

        {/* Data Column */}
        <div className="flex flex-col gap-6" style={{ animation: 'fadeIn 0.6s ease-out 0.2s both' }}>
          
          {/* Garment Information */}
          <div>
            <h3 className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-3">Garment Information</h3>
            <div className="card-glass rounded-2xl overflow-hidden">
              {[
                { k: 'Name', v: passport.garmentName },
                { k: 'Drop', v: 'Drop Zero' },
                { k: 'Fabric', v: passport.fabric },
                { k: 'Production', v: passport.productionDate },
              ].map((row, i, arr) => (
                <div key={row.k} className={`flex justify-between p-4 text-sm ${i < arr.length - 1 ? 'border-b border-white/[0.08]' : ''}`}>
                  <span className="text-[#666] shrink-0">{row.k}</span>
                  <span className="text-right">{row.v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Blockchain Record */}
          <div>
            <h3 className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-[#D1D1D1] mb-3">Blockchain Record</h3>
            <div className="card-glass rounded-2xl overflow-hidden">
              {[
                { k: 'Symbol', v: passport.symbol, mono: true },
                { k: 'Owner', v: truncateAddress(passport.owner), mono: true },
                { k: 'Creator', v: passport.creator },
                { k: 'Royalty', v: `${passport.royaltyPercent} on all resales`, highlight: true },
                { k: 'Standard', v: 'pNFT', mono: true },
              ].map((row, i, arr) => (
                <div key={row.k} className={`flex justify-between items-center p-4 text-sm ${i < arr.length - 1 ? 'border-b border-white/[0.08]' : ''}`}>
                  <span className="text-[#666] shrink-0">{row.k}</span>
                  <span className={`text-right ${row.mono ? 'font-mono text-xs text-[#A3A3A3]' : ''} ${row.highlight ? 'text-[#D1D1D1] font-semibold' : ''}`}>
                    {row.v}
                  </span>
                </div>
              ))}
              
              {/* Mint Address */}
              <div className="border-t border-white/[0.08] p-4">
                <span className="block text-[0.65rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-2">Mint Address</span>
                <code className="block font-mono text-xs text-[#A3A3A3] break-all leading-relaxed">{passport.mintAddress}</code>
              </div>
            </div>
          </div>

          {/* Solscan Link */}
          <a
            href={solscanTokenUrl(passport.mintAddress)}
            target="_blank"
            rel="noopener"
            className="btn-outline-circuit justify-center"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
            <span>View on Solscan</span>
          </a>

          {/* Permanence Notice */}
          <div className="flex items-start gap-3 p-4 bg-white/[0.02] border border-white/[0.08] rounded-2xl">
            <div className="shrink-0 text-[#D1D1D1] mt-0.5">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <p className="text-xs text-[#A3A3A3] leading-relaxed">
              This record is permanent on Solana. It exists regardless of Circuit&apos;s website. 
              The garment&apos;s provenance, ownership, and royalty rules are enforced by the blockchain, 
              not by any company or server.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
