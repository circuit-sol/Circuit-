/**
 * ═══════════════════════════════════════════════════════════════════════
 * Circuit — Backend API Client
 * ═══════════════════════════════════════════════════════════════════════
 *
 * All requests to the backend go through here.
 * After SIWS login, the session JWT is attached automatically to all
 * authenticated requests via the Authorization header.
 * ═══════════════════════════════════════════════════════════════════════
 */

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

// ── Types ──────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  wallet_address: string;
  email: string | null;
  auth_provider: string;
  created_at: string;
  last_login_at: string;
}

export interface ChallengeResponse {
  challengeId: string;
  nonce: string;
  walletAddress: string;
  message: string;
  expiresAt: string;
}

export interface AuthVerifyResponse {
  token: string;
  tokenType: string;
  expiresIn: number;
  user: UserProfile;
}

// ── Session Token ──────────────────────────────────────────────────────
// Stored in memory only (not localStorage) to avoid XSS exposure.
let _sessionToken: string | null = null;

export function setSessionToken(token: string | null) {
  _sessionToken = token;
}

export function getSessionToken(): string | null {
  return _sessionToken;
}

// ── Core Request Helper ────────────────────────────────────────────────
async function request<T>(path: string, init?: RequestInit, authenticated = false): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authenticated && _sessionToken) {
    headers['Authorization'] = `Bearer ${_sessionToken}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> ?? {}) },
  });

  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const err = Object.assign(
      new Error((body['message'] ?? body['error'] ?? 'Backend error') as string),
      body
    );
    throw err;
  }
  return body as T;
}

// ── Auth (SIWS) ────────────────────────────────────────────────────────

/** Step 1: Get challenge & exact signing message from backend */
export function getChallenge(walletAddress: string) {
  return request<ChallengeResponse>('/api/auth/challenge', {
    method: 'POST',
    body: JSON.stringify({ walletAddress }),
  });
}

/** Legacy alias */
export const getNonce = getChallenge;

/**
 * Step 2: Send the signed message back. The backend verifies the ed25519
 * signature against the exact challenge message and returns a JWT.
 */
export function verifySignature(walletAddress: string, signature: string, nonce: string) {
  return request<AuthVerifyResponse>('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ walletAddress, signature, nonce }),
  });
}

/** Step 3: Fetch currently authenticated user using session JWT */
export function getMe() {
  return request<{ user: UserProfile }>('/api/auth/me', {
    method: 'GET',
  }, true);
}

/** Save or update the user's notification email */
export function saveUserEmail(email: string) {
  return request<{ user: UserProfile }>('/api/user/email', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }, true); // authenticated
}

// ── Orders ────────────────────────────────────────────────────────────

export function confirmOrder(dropId: string, amountSol: number) {
  return request<{ signature: string; escrowPDA: string; buyer: string; amountSol: number }>(
    '/api/orders/confirm',
    {
      method: 'POST',
      body: JSON.stringify({ dropId, amountSol }),
    },
    true
  );
}

export function registerOrder(dropId: string) {
  return request<{ signature: string }>('/api/orders/register', {
    method: 'POST',
    body: JSON.stringify({ dropId }),
  }, true);
}

export function deliverOrder(dropId: string) {
  return request<{ signature: string; fundsReleased: number; designer: string }>(
    '/api/orders/delivery',
    {
      method: 'POST',
      body: JSON.stringify({ dropId }),
    },
    true
  );
}
