'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { utils } from '@coral-xyz/anchor';
import * as backendApi from '@/lib/backendApi';

// ── Types ────────────────────────────────────────────────────────────

interface UserSession {
  id?: string;
  walletAddress: string;
  /** Notification email — captured via post-login prompt, may be null on first login */
  email: string | null;
  isSignedIn: boolean;
}

interface AuthContextType {
  user: UserSession | null;
  isSignedIn: boolean;
  /** Triggers Phantom Connect wallet modal; call from the sign-in button */
  triggerConnect: () => void;
  signOut: () => void;
  /** True while SIWS verification is in flight */
  isAuthenticating: boolean;
  /** True if user has connected but hasn't provided their email yet */
  needsEmail: boolean;
  /** Call after the user submits the post-login email prompt */
  saveEmail: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isSignedIn: false,
  triggerConnect: () => {},
  signOut: () => {},
  isAuthenticating: false,
  needsEmail: false,
  saveEmail: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

// ── Provider ─────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, connected, disconnect, select, wallets } = useWallet();

  const [user, setUser]                       = useState<UserSession | null>(null);
  const [isAuthenticating, setAuthenticating] = useState(false);
  const [isInitializing, setIsInitializing]   = useState(true);
  const [needsEmail, setNeedsEmail]           = useState(false);

  // ── Restore session on mount ────────────────────────────────────────
  useEffect(() => {
    const savedToken   = sessionStorage.getItem('circuit_token');
    const savedWallet  = sessionStorage.getItem('circuit_wallet');
    const savedEmail   = sessionStorage.getItem('circuit_email');

    if (savedToken && savedWallet) {
      backendApi.setSessionToken(savedToken);
      setUser({
        walletAddress: savedWallet,
        email: savedEmail,
        isSignedIn: true,
      });

      // Optionally refresh user profile from /api/auth/me
      backendApi.getMe()
        .then((res) => {
          if (res?.user) {
            setUser({
              id: res.user.id,
              walletAddress: res.user.wallet_address,
              email: res.user.email,
              isSignedIn: true,
            });
            if (res.user.email) {
              sessionStorage.setItem('circuit_email', res.user.email);
              setNeedsEmail(false);
            } else {
              setNeedsEmail(true);
            }
          }
        })
        .catch(() => {
          // Token expired or invalid
          backendApi.setSessionToken(null);
          sessionStorage.removeItem('circuit_token');
          sessionStorage.removeItem('circuit_wallet');
          sessionStorage.removeItem('circuit_email');
          setUser(null);
        });

      if (!savedEmail) setNeedsEmail(true);
    }

    setIsInitializing(false);
  }, []);

  // ── SIWS: sign & verify once wallet connects ─────────────────────────
  useEffect(() => {
    if (!connected || !publicKey || !signMessage || user) return;

    const address = publicKey.toBase58();

    async function authenticate() {
      setAuthenticating(true);
      try {
        // Step 1: Get one-time challenge containing the exact message to sign
        const challenge = await backendApi.getChallenge(address);

        // Step 2: Sign the exact backend message
        const messageBytes = new TextEncoder().encode(challenge.message);
        const signatureBytes = await signMessage!(messageBytes);

        // Step 3: Base58 encode the signature to match backend bs58 verification
        const signatureBs58 = utils.bytes.bs58.encode(signatureBytes);

        // Step 4: Verify on backend → receive JWT & user profile
        const authData = await backendApi.verifySignature(address, signatureBs58, challenge.nonce);

        // Step 5: Store session
        backendApi.setSessionToken(authData.token);
        sessionStorage.setItem('circuit_token', authData.token);
        sessionStorage.setItem('circuit_wallet', address);

        if (authData.user.email) {
          sessionStorage.setItem('circuit_email', authData.user.email);
        }

        setUser({
          id: authData.user.id,
          walletAddress: address,
          email: authData.user.email,
          isSignedIn: true,
        });

        // Prompt for email if not yet set
        if (!authData.user.email) {
          setNeedsEmail(true);
        }

        console.log(
          `%c⚡ Circuit: Authenticated via SIWS — ${address}`,
          'color: #D1D1D1; font-weight: bold;'
        );
      } catch (err) {
        console.error('SIWS authentication failed:', err);
        // If user cancelled signing, disconnect wallet
        await disconnect();
      } finally {
        setAuthenticating(false);
      }
    }

    authenticate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey]);

  // ── Trigger wallet modal ─────────────────────────────────────────────
  const triggerConnect = useCallback(() => {
    const phantom = wallets.find((w: { adapter: { name: string } }) => w.adapter.name === 'Phantom');
    if (phantom) select(phantom.adapter.name as any);
  }, [wallets, select]);

  // ── Save notification email ──────────────────────────────────────────
  const saveEmail = useCallback(async (email: string) => {
    try {
      await backendApi.saveUserEmail(email);
      sessionStorage.setItem('circuit_email', email);
      setUser((prev: UserSession | null) => prev ? { ...prev, email } : prev);
      setNeedsEmail(false);
    } catch (err) {
      console.error('Failed to save email:', err);
      // Fallback: save in local session
      sessionStorage.setItem('circuit_email', email);
      setUser((prev: UserSession | null) => prev ? { ...prev, email } : prev);
      setNeedsEmail(false);
    }
  }, []);

  // ── Sign out ─────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    await disconnect();
    backendApi.setSessionToken(null);
    sessionStorage.removeItem('circuit_token');
    sessionStorage.removeItem('circuit_wallet');
    sessionStorage.removeItem('circuit_email');
    setUser(null);
    setNeedsEmail(false);
  }, [disconnect]);

  if (isInitializing) return null;

  return (
    <AuthContext.Provider
      value={{
        user,
        isSignedIn: !!user,
        triggerConnect,
        signOut,
        isAuthenticating,
        needsEmail,
        saveEmail,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
