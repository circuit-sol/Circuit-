'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { genAddress } from '@/lib/utils';
import { saveUserMapping, getUserMapping } from '@/lib/db';

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
  signIn: (email: string) => Promise<void>;
  signOut: () => void;
  getPrivateKey: () => string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isSignedIn: false,
  signIn: async () => {},
  signOut: () => {},
  getPrivateKey: () => null,
});

export function useAuth() {
  return useContext(AuthContext);
}

import * as backendApi from '@/lib/backendApi';

// ── Provider ─────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Persistence: Check for existing session on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem('circuit_active_email');
    if (savedEmail) {
      // 1. Fetch wallet from backend (source of truth)
      backendApi.getWallet(savedEmail).then(wallet => {
        if (wallet) {
          setUser({
            email: savedEmail,
            walletAddress: wallet.publicKey,
            privateKey: 'SECURED_BY_INFRASTRUCTURE', // Real key is in backend
            isSignedIn: true
          });
        }
        setIsInitializing(false);
      }).catch(() => {
        setIsInitializing(false);
      });
    } else {
      setIsInitializing(false);
    }
  }, []);

  const signIn = useCallback(async (email: string) => {
    // 1. Create or fetch wallet from real backend
    const { publicKey } = await backendApi.createWallet(email);

    const session: UserSession = {
      email,
      walletAddress: publicKey,
      privateKey: 'SECURED_BY_INFRASTRUCTURE',
      isSignedIn: true,
    };

    setUser(session);
    localStorage.setItem('circuit_active_email', email);

    // 2. Also keep Supabase mapping in sync for order history lookups
    await saveUserMapping(email, publicKey, 'SECURED_BY_INFRASTRUCTURE');

    console.log(`%c⚡ Circuit: Real on-chain wallet synced for ${email}`, 'color: #D1D1D1; font-weight: bold;');
    console.log(`%cWallet: ${publicKey}`, 'color: #888; font-size: 10px;');
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    localStorage.removeItem('circuit_active_email');
  }, []);

  const getPrivateKey = useCallback(() => {
    return user?.privateKey || null;
  }, [user]);

  // Prevent flash of unauthenticated state while initializing
  if (isInitializing) return null;

  return (
    <AuthContext.Provider value={{ user, isSignedIn: !!user, signIn, signOut, getPrivateKey }}>
      {children}
    </AuthContext.Provider>
  );
}
