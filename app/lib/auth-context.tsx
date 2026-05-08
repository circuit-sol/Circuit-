'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { genAddress } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────

interface UserSession {
  email: string;
  walletAddress: string;
  privateKey: string;
  isSignedIn: boolean;
}

interface AuthContextType {
  user: UserSession | null;
  isSignedIn: boolean;
  signIn: (email: string) => void;
  signOut: () => void;
  getPrivateKey: () => string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isSignedIn: false,
  signIn: () => {},
  signOut: () => {},
  getPrivateKey: () => null,
});

export function useAuth() {
  return useContext(AuthContext);
}

// ── Simulated Key Generation ─────────────────────────────────────────
// In production, this would be a real Solana keypair generated server-side
// and mapped to the user's email in the database.

function generateSimulatedKeypair() {
  const walletAddress = genAddress();
  // Simulated private key (base58-like string for demo)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
  let privateKey = '';
  for (let i = 0; i < 64; i++) privateKey += chars[Math.floor(Math.random() * chars.length)];
  return { walletAddress, privateKey };
}

// ── Provider ─────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);

  const signIn = useCallback((email: string) => {
    const { walletAddress, privateKey } = generateSimulatedKeypair();

    const session: UserSession = {
      email,
      walletAddress,
      privateKey,
      isSignedIn: true,
    };

    setUser(session);

    // Simulation log (not user-facing)
    console.log(
      '%c⚡ Circuit: Wallet auto-generated for user',
      'color: #D1D1D1; font-weight: bold;'
    );
    console.log(
      `%c  Email: ${email}\n  Wallet: ${walletAddress}`,
      'color: #888; font-size: 10px;'
    );
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
  }, []);

  const getPrivateKey = useCallback(() => {
    return user?.privateKey || null;
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, isSignedIn: !!user, signIn, signOut, getPrivateKey }}>
      {children}
    </AuthContext.Provider>
  );
}
