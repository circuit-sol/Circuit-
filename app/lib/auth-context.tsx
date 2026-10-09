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
  /** Triggers Phantom Connect wallet modal or deep link on mobile */
  triggerConnect: () => void;
  signOut: () => void;
  /** True while SIWS verification is in flight */
  isAuthenticating: boolean;
  /** Granular status text during auth, e.g. 'Connecting...', 'Confirm in Phantom...', 'Verifying...' */
  authStatusText: string | null;
  /** True if client is on a mobile browser outside Phantom app */
  isMobileDevice: boolean;
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
  authStatusText: null,
  isMobileDevice: false,
  needsEmail: false,
  saveEmail: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

// ── Storage Helpers ──────────────────────────────────────────────────

function getStoredSession() {
  if (typeof window === 'undefined') return { token: null, wallet: null, email: null };
  const token  = localStorage.getItem('circuit_token')  || sessionStorage.getItem('circuit_token');
  const wallet = localStorage.getItem('circuit_wallet') || sessionStorage.getItem('circuit_wallet');
  const email  = localStorage.getItem('circuit_email')  || sessionStorage.getItem('circuit_email');
  return { token, wallet, email };
}

function setStoredSession(token: string, wallet: string, email?: string | null) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('circuit_token', token);
    localStorage.setItem('circuit_wallet', wallet);
    if (email) localStorage.setItem('circuit_email', email);
  } catch (_) {}
  try {
    sessionStorage.setItem('circuit_token', token);
    sessionStorage.setItem('circuit_wallet', wallet);
    if (email) sessionStorage.setItem('circuit_email', email);
  } catch (_) {}
}

function isExplicitlyLoggedOut(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('circuit_user_disconnected') === 'true';
}

function removeStoredSession() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('circuit_token');
    localStorage.removeItem('circuit_wallet');
    localStorage.removeItem('circuit_email');
    localStorage.removeItem('walletName');
    localStorage.removeItem('circuit_last_order_tx');
    localStorage.removeItem('circuit_last_order_id');
  } catch (_) {}
  try {
    sessionStorage.removeItem('circuit_token');
    sessionStorage.removeItem('circuit_wallet');
    sessionStorage.removeItem('circuit_email');
    sessionStorage.removeItem('circuit_last_order_tx');
    sessionStorage.removeItem('circuit_last_order_id');
  } catch (_) {}
}

// ── Provider ─────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, connected, disconnect, select, wallets, connect } = useWallet();

  const [user, setUser]                       = useState<UserSession | null>(null);
  const [isAuthenticating, setAuthenticating] = useState(false);
  const [authStatusText, setAuthStatusText]   = useState<string | null>(null);
  const [isInitializing, setIsInitializing]   = useState(true);
  const [needsEmail, setNeedsEmail]           = useState(false);
  const [isMobileDevice, setIsMobileDevice]   = useState(false);

  // ── Detect mobile device on mount ──────────────────────────────────
  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const hasInjected = typeof window !== 'undefined' && Boolean(
        (window as any).phantom?.solana?.isPhantom || (window as any).solana?.isPhantom
      );
      setIsMobileDevice(isMobile && !hasInjected);
    }
  }, []);

  // ── Restore persistent session on mount ─────────────────────────────
  useEffect(() => {
    // If user explicitly signed out in a previous session, do not restore
    if (isExplicitlyLoggedOut()) {
      setIsInitializing(false);
      return;
    }

    const { token, wallet: savedWallet, email: savedEmail } = getStoredSession();

    if (token && savedWallet) {
      backendApi.setSessionToken(token);
      setUser({
        walletAddress: savedWallet,
        email: savedEmail,
        isSignedIn: true,
      });

      // Validate session with /api/auth/me
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
              setStoredSession(token, savedWallet, res.user.email);
              setNeedsEmail(false);
            } else {
              setNeedsEmail(true);
            }
          }
        })
        .catch(() => {
          // Token expired or invalid
          backendApi.setSessionToken(null);
          removeStoredSession();
          setUser(null);
        });

      if (!savedEmail) setNeedsEmail(true);
    }

    setIsInitializing(false);
  }, []);

  // ── SIWS: sign & verify once wallet connects or changes ───────────────
  useEffect(() => {
    if (!connected || !publicKey || !signMessage) return;

    const address = publicKey.toBase58();

    // If user explicitly signed out, do not auto-authenticate on phantom autoConnect
    if (isExplicitlyLoggedOut()) {
      return;
    }

    // Case 1: Already authenticated with this EXACT wallet address
    if (user && user.walletAddress === address) {
      return;
    }

    // Case 2: User switched to a DIFFERENT account in Phantom
    if (user && user.walletAddress !== address) {
      console.log(`⚡ Circuit: Active Phantom account changed from ${user.walletAddress} to ${address}`);
      backendApi.setSessionToken(null);
      removeStoredSession();
      setUser(null);
    }

    // Case 3: Check if we have a valid stored token matching this exact address
    const stored = getStoredSession();
    if (stored.token && stored.wallet === address) {
      backendApi.setSessionToken(stored.token);
      setUser({
        walletAddress: address,
        email: stored.email,
        isSignedIn: true,
      });
      return;
    }

    // Case 4: Authenticate with backend via SIWS
    async function authenticate() {
      setAuthenticating(true);
      try {
        setAuthStatusText('Signing you in...');
        // Step 1: Get one-time challenge containing the exact message to sign
        const challenge = await backendApi.getChallenge(address);

        setAuthStatusText('Sign in Phantom...');
        // Step 2: Sign the exact backend message
        const messageBytes = new TextEncoder().encode(challenge.message);
        const signatureBytes = await signMessage!(messageBytes);

        setAuthStatusText('Verifying on Circuit...');
        // Step 3: Base58 encode the signature to match backend bs58 verification
        const signatureBs58 = utils.bytes.bs58.encode(signatureBytes);

        // Step 4: Verify on backend → receive JWT & user profile
        const authData = await backendApi.verifySignature(address, signatureBs58, challenge.nonce);

        // Step 5: Store persistent session
        backendApi.setSessionToken(authData.token);
        setStoredSession(authData.token, address, authData.user.email);

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
        // If user cancelled signing, disconnect wallet so retry is clean
        await disconnect();
      } finally {
        setAuthenticating(false);
        setAuthStatusText(null);
      }
    }

    authenticate();
  }, [connected, publicKey, signMessage, user, disconnect]);

  // ── Trigger wallet modal or mobile deep link ─────────────────────────
  const triggerConnect = useCallback(async () => {
    // Explicit user action to connect: clear disconnected flag
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('circuit_user_disconnected');
      } catch (_) {}
    }

    const isMobile = typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const hasInjected = typeof window !== 'undefined' && Boolean(
      (window as any).phantom?.solana?.isPhantom || (window as any).solana?.isPhantom
    );

    // 1. If browsing on Mobile outside Phantom app, deep link directly into Phantom mobile app
    if (isMobile && !hasInjected) {
      const currentUrl = window.location.href;
      const origin = window.location.origin;
      const phantomUniversalUrl = `https://phantom.app/ul/browse/${encodeURIComponent(currentUrl)}?ref=${encodeURIComponent(origin)}`;
      window.location.href = phantomUniversalUrl;
      return;
    }

    // 2. Desktop browser extension or inside Phantom Mobile in-app browser
    const phantom = wallets.find((w: { adapter: { name: string } }) => w.adapter.name === 'Phantom');
    if (phantom) {
      select(phantom.adapter.name as any);
      if (!connected) {
        try {
          setAuthStatusText('Connecting to Phantom...');
          await connect();
        } catch (err: any) {
          console.warn('Phantom connect notice:', err?.message || err);
          setAuthStatusText(null);
        }
      }
    }
  }, [wallets, select, connect, connected]);

  // ── Save notification email ──────────────────────────────────────────
  const saveEmail = useCallback(async (email: string) => {
    try {
      await backendApi.saveUserEmail(email);
      const { token, wallet: savedWallet } = getStoredSession();
      if (token && savedWallet) setStoredSession(token, savedWallet, email);
      setUser((prev: UserSession | null) => prev ? { ...prev, email } : prev);
      setNeedsEmail(false);
    } catch (err) {
      console.error('Failed to save email:', err);
      // Fallback: save in local storage
      const { token, wallet: savedWallet } = getStoredSession();
      if (token && savedWallet) setStoredSession(token, savedWallet, email);
      setUser((prev: UserSession | null) => prev ? { ...prev, email } : prev);
      setNeedsEmail(false);
    }
  }, []);

  // ── Sign out ─────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    // Set explicit disconnect flag to prevent automatic re-login on refresh
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('circuit_user_disconnected', 'true');
      } catch (_) {}
    }
    await disconnect();
    backendApi.setSessionToken(null);
    removeStoredSession();
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
        authStatusText,
        isMobileDevice,
        needsEmail,
        saveEmail,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
