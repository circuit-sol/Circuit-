import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Digital Passport',
};

export default function GarmentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
