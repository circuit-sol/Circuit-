'use client';

import dynamic from 'next/dynamic';

const SolanaWalletProvider = dynamic(
  () => import('@/providers/WalletProvider'),
  { ssr: false }
);

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return <SolanaWalletProvider>{children}</SolanaWalletProvider>;
}
