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

// ── Simulated Key Generation ─────────────────────────────────────────

function generateSimulatedKeypair() {
  const walletAddress = genAddress();
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
  let privateKey = '';
  for (let i = 0; i < 64; i++) privateKey += chars[Math.floor(Math.random() * chars.length)];
  return { walletAddress, privateKey };
}

// ── Provider ─────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Persistence: Check for existing session on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem('circuit_active_email');
    if (savedEmail) {
      getUserMapping(savedEmail).then(mapping => {
        if (mapping) {
          setUser({
            email: savedEmail,
            walletAddress: mapping.walletAddress,
            privateKey: mapping.privateKey,
            isSignedIn: true
          });
        }
        setIsInitializing(false);
      });
    } else {
      setIsInitializing(false);
    }
  }, []);

  const signIn = useCallback(async (email: string) => {
    // 1. Check if user already has a mapping
    let mapping = await getUserMapping(email);

    // 2. If not, generate and save new mapping
    if (!mapping) {
      const { walletAddress, privateKey } = generateSimulatedKeypair();
      await saveUserMapping(email, walletAddress, privateKey);
      mapping = { walletAddress, privateKey };
    }

    const session: UserSession = {
      email,
      walletAddress: mapping.walletAddress,
      privateKey: mapping.privateKey,
      isSignedIn: true,
    };

    setUser(session);
    localStorage.setItem('circuit_active_email', email);

    console.log(`%c⚡ Circuit: ${mapping === null ? 'New' : 'Returning'} user authenticated`, 'color: #D1D1D1; font-weight: bold;');
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
