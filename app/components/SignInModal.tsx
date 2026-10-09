'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

interface SignInModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SignInModal({ isOpen, onClose }: SignInModalProps) {
  const { triggerConnect, isAuthenticating, authStatusText, isMobileDevice, isSignedIn, needsEmail, saveEmail } = useAuth();

  // Email capture state (post-login prompt)
  const [email, setEmail]           = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError]     = useState('');
  const emailInputRef = useRef<HTMLInputElement>(null);

  // Close automatically once fully signed in and email has been handled
  useEffect(() => {
    if (isSignedIn && !needsEmail) {
      onClose();
    }
  }, [isSignedIn, needsEmail, onClose]);

  // Focus email input when the email prompt appears
  useEffect(() => {
    if (needsEmail && emailInputRef.current) {
      setTimeout(() => emailInputRef.current?.focus(), 100);
    }
  }, [needsEmail]);

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
    await saveEmail(trimmed);
    setEmailLoading(false);
    setEmail('');
  };

  const handleSkipEmail = () => {
    // User can skip — email is optional for now
    saveEmail('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-label={needsEmail ? 'Add your email' : 'Sign in to Circuit'}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-[20px]"
        onClick={!isAuthenticating ? onClose : undefined}
      />

      {/* Modal */}
      <div
        className="relative card-glass max-w-[400px] w-full p-8 flex flex-col gap-6 max-h-[90vh] overflow-y-auto no-scrollbar"
        style={{ animation: 'fadeIn 0.3s ease-out' }}
      >
        {/* Close — hidden while authenticating to prevent half-state */}
        {!isAuthenticating && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-[#666] hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/[0.05]"
            aria-label="Close"
          >
            ✕
          </button>
        )}

        {/* ── View 1: Connect Wallet ─────────────────────────────────── */}
        {!needsEmail && (
          <>
            <div className="text-center">
              <h2 className="text-xl font-bold tracking-[-0.02em] mb-2">Sign in to Circuit</h2>
              <p className="text-sm text-[#A3A3A3]">
                {isMobileDevice
                  ? 'Tap below to open Circuit directly in Phantom Mobile.'
                  : 'Sign in with Phantom. No password needed.'}
              </p>
            </div>

            <button
              id="phantom-connect-btn"
              onClick={triggerConnect}
              disabled={isAuthenticating}
              className="btn-circuit w-full justify-center"
            >
              <span>
                {authStatusText || (
                  isAuthenticating
                    ? 'Verifying wallet...'
                    : (isMobileDevice ? 'Open in Phantom App' : 'Continue with Phantom')
                )}
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

            <p className="text-center text-[0.65rem] text-[#555]">
              {isMobileDevice
                ? 'Direct Universal Link into Phantom Web3 browser.'
                : 'One tap. No passwords or secret codes.'}
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

        {/* ── View 2: Email Capture (post-login) ────────────────────── */}
        {needsEmail && (
          <>
            <div className="text-center">
              <div className="text-2xl mb-3">📬</div>
              <h2 className="text-xl font-bold tracking-[-0.02em] mb-2">
                Where should we send updates?
              </h2>
              <p className="text-sm text-[#A3A3A3]">
                Add your email for order updates. You can skip this for now.
              </p>
            </div>

            <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
              <div>
                <label
                  htmlFor="notification-email"
                  className="block text-[0.65rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-2"
                >
                  Email Address
                </label>
                <input
                  ref={emailInputRef}
                  id="notification-email"
                  type="email"
                  value={email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setEmail(e.target.value); setEmailError(''); }}
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
                <span>{emailLoading ? 'Saving...' : 'Continue'}</span>
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

              <button
                type="button"
                onClick={handleSkipEmail}
                className="text-sm text-[#555] hover:text-[#888] transition-colors text-center"
              >
                Skip for now
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
