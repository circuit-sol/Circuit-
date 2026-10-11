'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

interface SignInModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'signin' | 'update-email';
}

export default function SignInModal({ isOpen, onClose, mode = 'signin' }: SignInModalProps) {
  const {
    triggerConnect,
    isAuthenticating,
    authStatusText,
    authError,
    clearAuthError,
    isMobileDevice,
    isSignedIn,
    needsEmail,
    saveEmail,
    user,
  } = useAuth();

  // Email capture state (post-login prompt / profile update)
  const [email, setEmail]               = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError]     = useState('');
  const emailInputRef                   = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setEmail(user?.email || '');
      setEmailError('');
      if (clearAuthError) clearAuthError();

      // If user already has an email and this is not a manual update request from profile toggle:
      // close immediately! Never show the email update popup unsolicited.
      if (isSignedIn && user?.email && mode !== 'update-email') {
        onClose();
      }
    }
  }, [isOpen, isSignedIn, user?.email, mode, onClose, clearAuthError]);

  // If user completes sign-in during this session and already has an email: close immediately
  useEffect(() => {
    if (isOpen && isSignedIn && user?.email && mode !== 'update-email') {
      onClose();
    }
  }, [isOpen, isSignedIn, user?.email, mode, onClose]);

  // Determine whether to display email view
  const isExplicitUpdate = mode === 'update-email';
  const showEmailView = isExplicitUpdate || (isSignedIn && !user?.email);

  // Focus email input when email prompt or update view is shown
  useEffect(() => {
    if (isOpen && showEmailView && emailInputRef.current) {
      setTimeout(() => emailInputRef.current?.focus(), 120);
    }
  }, [isOpen, showEmailView]);

  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || emailLoading) return;

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(trimmed)) {
      setEmailError('Please enter a valid email address.');
      return;
    }

    setEmailLoading(true);
    setEmailError('');
    try {
      await saveEmail(trimmed);
      setEmailLoading(false);
      onClose();
    } catch (err: any) {
      setEmailLoading(false);
      setEmailError(err?.message || 'Failed to save email. Please try again.');
    }
  };

  const handleSkipEmail = () => {
    saveEmail('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-label={showEmailView ? 'Email settings' : 'Sign in to Circuit'}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-[20px]"
        onClick={!isAuthenticating ? onClose : undefined}
      />

      {/* Modal Card */}
      <div
        className="relative card-glass max-w-[420px] w-full p-8 flex flex-col gap-6 max-h-[90vh] overflow-y-auto no-scrollbar border border-white/[0.12] shadow-[0_25px_60px_rgba(0,0,0,0.8)]"
        style={{ animation: 'fadeIn 0.25s ease-out' }}
      >
        {/* Close Button — hidden while authenticating */}
        {!isAuthenticating && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-[#666] hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/[0.05]"
            aria-label="Close"
          >
            ✕
          </button>
        )}

        {/* ── View 1: Connect Wallet (pre-login) ─────────────────────── */}
        {!showEmailView && (
          <>
            <div className="text-center">
              <h2 className="text-xl font-bold tracking-[-0.02em] mb-2">Sign in to Circuit</h2>
              <p className="text-sm text-[#A3A3A3]">
                {isMobileDevice
                  ? 'Tap below to open Circuit directly in Phantom Mobile.'
                  : 'Sign in with Phantom. No password needed.'}
              </p>
            </div>

            {/* Auth Error Banner if previous attempt failed or timed out */}
            {authError && (
              <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-center flex flex-col gap-1">
                <p className="text-xs text-red-400 font-medium">{authError}</p>
                <p className="text-[0.65rem] text-[#888]">Tap below to retry</p>
              </div>
            )}

            {isMobileDevice ? (
              <div className="flex flex-col gap-3">
                <a
                  href={typeof window !== 'undefined' ? `https://phantom.app/ul/browse/${encodeURIComponent(window.location.href)}?ref=${encodeURIComponent(window.location.origin)}` : 'https://phantom.app'}
                  id="phantom-deep-link-btn"
                  className="btn-circuit w-full justify-center text-center py-3.5"
                >
                  <span>Open in Phantom App</span>
                  <span className="btn-arrow" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </span>
                </a>
                <button
                  type="button"
                  onClick={triggerConnect}
                  disabled={isAuthenticating}
                  className="btn-outline-circuit justify-center py-2.5 text-xs text-[#A3A3A3] hover:text-white border-white/10 hover:border-white/30"
                >
                  <span>
                    {authStatusText || (isAuthenticating ? 'Connecting...' : 'Connect in Current Browser')}
                  </span>
                </button>
              </div>
            ) : (
              <button
                id="phantom-connect-btn"
                onClick={triggerConnect}
                disabled={isAuthenticating}
                className="btn-circuit w-full justify-center"
              >
                <span>
                  {authStatusText || (isAuthenticating ? 'Verifying wallet...' : 'Continue with Phantom')}
                </span>
                <span className="btn-arrow" aria-hidden="true">
                  {isAuthenticating ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2a10 10 0 010 20 10 10 0 010-20" strokeLinecap="round" className="animate-spin origin-center" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  )}
                </span>
              </button>
            )}

            <p className="text-center text-[0.65rem] text-[#555]">
              One tap. Cryptographically signed with your Solana key.
            </p>

            {/* Phantom download helper */}
            <div className="pt-2 border-t border-white/[0.08] flex flex-col gap-2 text-center">
              <p className="text-[0.7rem] text-[#777]">
                Don&apos;t have Phantom installed?
              </p>
              <a
                href={
                  isMobileDevice
                    ? (typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent)
                        ? 'https://apps.apple.com/app/phantom-solana-wallet/id1598432977'
                        : 'https://play.google.com/store/apps/details?id=app.phantom')
                    : 'https://phantom.app/download'
                }
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline-circuit justify-center py-2 text-[0.7rem] text-[#A3A3A3] hover:text-white border-white/10 hover:border-white/30"
              >
                <span>Get Phantom (Free) ↗</span>
              </a>
            </div>
          </>
        )}

        {/* ── View 2: Email Capture / Update (logged-in view) ────────── */}
        {showEmailView && (
          <>
            <div className="text-center">
              {/* Connected Wallet Status Pill */}
              {user?.walletAddress && (
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-[0.65rem] text-[#A3A3A3] font-mono mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_#34d399]" />
                  <span>Connected: {user.walletAddress.slice(0, 4)}...{user.walletAddress.slice(-4)}</span>
                </div>
              )}

              <h2 className="text-xl font-bold tracking-[-0.02em] mb-2">
                {isExplicitUpdate ? 'Update Notification Email' : 'Where should we send updates?'}
              </h2>
              <p className="text-sm text-[#A3A3A3]">
                {isExplicitUpdate
                  ? 'Update the email address used for order receipts and pickup updates.'
                  : 'Add your email for order receipts, tracking, and atelier pickup notices.'}
              </p>

              {isExplicitUpdate && user?.email && (
                <div className="mt-2.5 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[0.75rem] text-[#888] inline-block font-mono">
                  Current: <span className="text-white font-medium">{user.email}</span>
                </div>
              )}
            </div>

            <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
              <div>
                <label
                  htmlFor="notification-email"
                  className="block text-[0.65rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-2"
                >
                  {isExplicitUpdate ? 'New Email Address' : 'Email Address'}
                </label>
                <input
                  ref={emailInputRef}
                  id="notification-email"
                  type="email"
                  value={email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setEmail(e.target.value);
                    setEmailError('');
                  }}
                  placeholder="you@gmail.com"
                  className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.12] rounded-xl text-white text-sm placeholder:text-[#666] focus:border-[#D1D1D1] focus:outline-none transition-colors"
                  autoComplete="email"
                />
                {emailError && (
                  <p className="mt-1 text-xs text-red-400">{emailError}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={!email.trim() || emailLoading}
                className="btn-circuit w-full justify-center"
              >
                <span>{emailLoading ? 'Saving...' : isExplicitUpdate ? 'Save New Email' : 'Save Email'}</span>
                <span className="btn-arrow" aria-hidden="true">
                  {emailLoading ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2a10 10 0 010 20 10 10 0 010-20" strokeLinecap="round" className="animate-spin origin-center" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  )}
                </span>
              </button>

              {isExplicitUpdate ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="text-sm text-[#555] hover:text-[#888] transition-colors text-center"
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSkipEmail}
                  className="text-sm text-[#555] hover:text-[#888] transition-colors text-center"
                >
                  Skip for now
                </button>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
