'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

interface SignInModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SignInModal({ isOpen, onClose }: SignInModalProps) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || isLoading) return;

    setIsLoading(true);
    // Simulate brief processing for premium feel
    await new Promise(resolve => setTimeout(resolve, 1200));
    await signIn(email.trim());
    setIsLoading(false);
    setEmail('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Sign in to Circuit">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-[20px]" onClick={onClose} />

      {/* Modal */}
      <div className="relative card-glass max-w-[400px] w-full p-8 flex flex-col gap-6" style={{ animation: 'fadeIn 0.3s ease-out' }}>
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#666] hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/[0.05]"
          aria-label="Close"
        >
          ✕
        </button>

        {/* Header */}
        <div className="text-center">
          <h2 className="text-xl font-bold tracking-[-0.02em] mb-2">Sign in to Circuit</h2>
          <p className="text-sm text-[#A3A3A3]">Enter your email to continue</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="email-input" className="block text-[0.65rem] font-bold uppercase tracking-[0.12em] text-[#666] mb-2">
              Email Address
            </label>
            <input
              ref={inputRef}
              id="email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@gmail.com"
              required
              className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.12] rounded-xl text-white text-sm placeholder:text-[#666] focus:border-[#D1D1D1] focus:outline-none transition-colors"
              autoComplete="email"
            />
          </div>

          <button
            type="submit"
            disabled={!email.trim() || isLoading}
            className="btn-circuit w-full justify-center"
          >
            <span>{isLoading ? 'Setting up your account...' : 'Continue'}</span>
            <span className="btn-arrow" aria-hidden="true">
              {isLoading ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 010 20 10 10 0 010-20" strokeLinecap="round" className="animate-spin origin-center" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              )}
            </span>
          </button>
        </form>

        <p className="text-[0.7rem] text-[#666] text-center leading-relaxed">
          Your account is secured with Solana blockchain technology.
          <br />No extensions or apps required.
        </p>
      </div>
    </div>
  );
}
