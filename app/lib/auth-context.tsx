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
  /** Detailed error message if wallet connection or SIWS failed */
  authError: string | null;
  clearAuthError: () => void;
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
  authError: null,
  clearAuthError: () => {},
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
    if (email) {
      localStorage.setItem('circuit_email', email);
    } else {
      localStorage.removeItem('circuit_email');
    }
  } catch (_) {}
  try {
    sessionStorage.setItem('circuit_token', token);
    sessionStorage.setItem('circuit_wallet', wallet);
    if (email) {
      sessionStorage.setItem('circuit_email', email);
    } else {
      sessionStorage.removeItem('circuit_email');
    }
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
  const { wallet, publicKey, signMessage, connected, disconnect, select, wallets, connect } = useWallet();

  const [user, setUser]                       = useState<UserSession | null>(null);
  const [isAuthenticating, setAuthenticating] = useState(false);
  const [authStatusText, setAuthStatusText]   = useState<string | null>(null);
  const [authError, setAuthError]             = useState<string | null>(null);
  const [isInitializing, setIsInitializing]   = useState(true);
  const [needsEmail, setNeedsEmail]           = useState(false);
  const [isMobileDevice, setIsMobileDevice]   = useState(false);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

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

  // ── SIWS Authentication Engine ───────────────────────────────────────
  const authenticateWallet = useCallback(async (
    targetAddress: string,
    signFn: (msg: Uint8Array) => Promise<any>
  ) => {
    setAuthenticating(true);
    setAuthError(null);
    try {
      setAuthStatusText('Preparing challenge...');

      // Timeout helper to prevent infinite hanging on mobile app switches
      const withTimeout = <T,>(p: Promise<T>, ms: number, msg: string): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
        ]);

      // Step 1: Get one-time challenge containing the exact message to sign
      const challenge = await withTimeout(
        backendApi.getChallenge(targetAddress),
        15000,
        'Network timeout requesting sign-in challenge. Please check your connection and try again.'
      );

      setAuthStatusText('Confirm sign-in in Phantom...');
      const messageBytes = new TextEncoder().encode(challenge.message);

      // Step 2: Sign the exact backend message (45s timeout for mobile switching)
      const sigResult = await withTimeout(
        signFn(messageBytes),
        45000,
        'Wallet signature request timed out or was dismissed in Phantom.'
      );

      setAuthStatusText('Verifying on Circuit...');
      const rawSig = (sigResult as any)?.signature instanceof Uint8Array
        ? (sigResult as any).signature
        : sigResult instanceof Uint8Array
        ? sigResult
        : (sigResult as any)?.signature || sigResult;

      const signatureBs58 = utils.bytes.bs58.encode(rawSig);

      // Step 3: Verify on backend → receive JWT & user profile
      const authData = await withTimeout(
        backendApi.verifySignature(targetAddress, signatureBs58, challenge.nonce),
        15000,
        'Verification request timed out. Please try signing in again.'
      );

      backendApi.setSessionToken(authData.token);
      setStoredSession(authData.token, targetAddress, authData.user.email);

      setUser({
        id: authData.user.id,
        walletAddress: targetAddress,
        email: authData.user.email,
        isSignedIn: true,
      });

      // Prompt for email ONLY if user has never provided one before
      if (!authData.user.email) {
        setNeedsEmail(true);
      } else {
        setNeedsEmail(false);
      }

      console.log(`%c⚡ Circuit: Authenticated via SIWS — ${targetAddress}`, 'color: #D1D1D1; font-weight: bold;');
    } catch (err: any) {
      console.error('SIWS authentication failed:', err?.message || err);
      const rawMsg = err?.message || 'Authentication failed. Please try again.';
      const isReject = /reject|cancel|denied/i.test(rawMsg);
      setAuthError(isReject ? 'Sign-in cancelled in Phantom. Tap to retry.' : rawMsg);
      try {
        await disconnect();
      } catch (_) {}
    } finally {
      setAuthenticating(false);
      setAuthStatusText(null);
    }
  }, [disconnect]);

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
    authenticateWallet(address, (msg) => signMessage!(msg));
  }, [connected, publicKey, signMessage, user, disconnect, authenticateWallet]);

  // ── Trigger wallet modal or mobile deep link ─────────────────────────
  const triggerConnect = useCallback(async () => {
    setAuthError(null);
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('circuit_user_disconnected');
      } catch (_) {}
    }

    const isMobile = typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const injectedProvider = typeof window !== 'undefined' && (
      (window as any).phantom?.solana || (window as any).solana
    );
    const hasInjected = Boolean(injectedProvider?.isPhantom);

    // 1. If browsing on Mobile browser outside Phantom app, deep link directly into Phantom mobile app
    if (isMobile && !hasInjected) {
      const currentUrl = window.location.href;
      const origin = window.location.origin;
      const phantomUniversalUrl = `https://phantom.app/ul/browse/${encodeURIComponent(currentUrl)}?ref=${encodeURIComponent(origin)}`;
      window.location.href = phantomUniversalUrl;
      return;
    }

    // 2. If already connected with active key, but not yet authenticated with Circuit backend:
    // (Crucial for mobile webviews where background useEffect sign requests are suppressed without user tap)
    if (connected && publicKey && signMessage && !user) {
      await authenticateWallet(publicKey.toBase58(), (msg) => signMessage(msg));
      return;
    }

    // 3. Connect via wallet adapter
    const phantom = wallets.find((w: { adapter: { name: string } }) => w.adapter.name === 'Phantom') || wallets[0];
    if (phantom) {
      select(phantom.adapter.name as any);
      try {
        setAuthStatusText('Connecting to Phantom...');
        if (wallet?.adapter?.name === phantom.adapter.name) {
          await connect();
        } else {
          setTimeout(async () => {
            try {
              await connect();
            } catch (cErr: any) {
              if (cErr?.name !== 'WalletNotSelectedError') {
                console.warn('Phantom connect notice:', cErr?.message || cErr);
              }
            }
          }, 60);
        }
      } catch (err: any) {
        // Fallback for direct injected provider in Phantom mobile in-app browser
        if (hasInjected && injectedProvider.connect) {
          try {
            const resp = await injectedProvider.connect();
            const addr = resp?.publicKey ? resp.publicKey.toBase58() : injectedProvider.publicKey?.toBase58();
            if (addr && injectedProvider.signMessage) {
              await authenticateWallet(addr, async (msg: Uint8Array) => {
                const res = await injectedProvider.signMessage(msg, 'utf8');
                return res.signature || res;
              });
              return;
            }
          } catch (pErr: any) {
            console.error('Direct Phantom connect failed:', pErr);
          }
        }
        if (err?.name !== 'WalletNotSelectedError') {
          setAuthError(err?.message || 'Could not connect to Phantom. Please ensure Phantom is unlocked.');
        }
        setAuthStatusText(null);
      }
    }
  }, [wallets, select, connect, connected, wallet, publicKey, signMessage, user, authenticateWallet]);

  // ── Save notification email ──────────────────────────────────────────
  const saveEmail = useCallback(async (email: string) => {
    const cleanEmail = email.trim();
    try {
      await backendApi.saveUserEmail(cleanEmail);
      const { token, wallet: savedWallet } = getStoredSession();
      if (token && savedWallet) setStoredSession(token, savedWallet, cleanEmail || null);
      setUser((prev: UserSession | null) => prev ? { ...prev, email: cleanEmail || null } : prev);
      setNeedsEmail(!cleanEmail);
    } catch (err) {
      console.error('Failed to save email:', err);
      // Fallback: save in local storage
      const { token, wallet: savedWallet } = getStoredSession();
      if (token && savedWallet) setStoredSession(token, savedWallet, cleanEmail || null);
      setUser((prev: UserSession | null) => prev ? { ...prev, email: cleanEmail || null } : prev);
      setNeedsEmail(!cleanEmail);
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
        authError,
        clearAuthError,
        isMobileDevice,
        needsEmail,
        saveEmail,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
