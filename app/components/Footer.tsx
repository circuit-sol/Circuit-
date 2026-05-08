import Image from 'next/image';

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.12] py-10 px-8">
      <div className="max-w-[1400px] mx-auto flex items-center justify-between flex-col md:flex-row gap-2 text-center md:text-left">
        <div className="flex items-center gap-2">
          <Image src="/logo/logo_icon_white.svg" alt="" width={22} height={22} aria-hidden="true" />
          <span className="font-brand text-sm font-semibold tracking-[0.05em]">Circuit</span>
        </div>
        <p className="text-[0.78rem] text-[#D1D1D1] font-semibold tracking-[0.06em]">...with the edge</p>
        <span className="text-[0.68rem] text-[#666]">Built on Solana · Nigeria · May 2026</span>
      </div>
    </footer>
  );
}
