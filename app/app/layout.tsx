import type { Metadata } from "next";
import { Montserrat, Outfit, JetBrains_Mono } from "next/font/google";
import dynamic from "next/dynamic";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Toast from "@/components/Toast";
import "./globals.css";

const SolanaWalletProvider = dynamic(
  () => import("@/providers/WalletProvider"),
  { ssr: false }
);

const montserrat = Montserrat({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const outfit = Outfit({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "Circuit — Drop Zero",
    template: "CIRCUIT — %s",
  },
  description:
    "Made-to-order fashion infrastructure on Solana. Every garment confirmed, every payment trustless, every ownership permanent.",
  openGraph: {
    title: "Circuit — Made-to-Order Fashion on Solana",
    description:
      "Drop Zero: The Wrap Dress. Limited to 40 units. Payment held in trustless escrow. Ownership recorded permanently on-chain.",
    type: "website",
    images: ["/dpp-image.png"],
  },
  twitter: {
    card: "summary_large_image",
  },
  icons: {
    icon: "/logo/logo_icon_white.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${outfit.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-black text-white font-body antialiased overflow-x-hidden">
        <SolanaWalletProvider>
          <Navbar />
          <main className="flex-1 pt-[72px]" role="main">
            {children}
          </main>
          <Footer />
          <Toast />
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
