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

export interface Brand {
  id: string;
  name: string;
  slug: string;
  payment_wallet_address: string;
  role: 'owner' | 'editor' | 'member';
}

export interface EditionImage {
  path?: string;
  url: string;
  tag?: string;
}

export interface Edition {
  id: string;
  brand_id?: string;
  name: string;
  description?: string;
  price_usd: number;
  max_supply: number;
  fabric?: string;
  headpiece?: string;
  embroidery?: string;
  images?: EditionImage[];
  is_active?: boolean;
  chain_status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateEditionPayload {
  id: string;
  brand_id: string;
  name: string;
  description?: string;
  price_usd: number;
  max_supply: number;
  fabric?: string;
  headpiece?: string;
  embroidery?: string;
}

export interface UpdateEditionPayload {
  name?: string;
  description?: string;
  price_usd?: number;
  max_supply?: number;
  fabric?: string;
  headpiece?: string;
  embroidery?: string;
}

// ── Session Token ──────────────────────────────────────────────────────
let _sessionToken: string | null = null;

export function setSessionToken(token: string | null) {
  _sessionToken = token;
}

export function getSessionToken(): string | null {
  if (_sessionToken) return _sessionToken;
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem('circuit_token');
  }
  return null;
}

// ── Core Request Helper ────────────────────────────────────────────────
async function request<T>(path: string, init?: RequestInit, authenticated = false): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getSessionToken();
  if (authenticated && token) {
    headers['Authorization'] = `Bearer ${token}`;
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
  }, true);
}

// ── Brands ─────────────────────────────────────────────────────────────

/** Retrieve all brands the authenticated user manages */
export function getMyBrands() {
  return request<{ brands: Brand[] }>('/api/brands/me', {
    method: 'GET',
  }, true);
}

// ── Editions / Drops ───────────────────────────────────────────────────

/** Public list of active and on-chain initialized editions */
export function getPublicEditions() {
  return request<Edition[]>('/api/editions', {
    method: 'GET',
  });
}

/** Public lookup for a published edition */
export function getPublicEditionById(id: string) {
  return request<Edition>(`/api/editions/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
}

/** Retrieve all managed editions (drafts & published) for the authenticated seller */
export function getMyEditions(brandId?: string) {
  const query = brandId ? `?brand_id=${encodeURIComponent(brandId)}` : '';
  return request<Edition[]>(`/api/editions/mine${query}`, {
    method: 'GET',
  }, true);
}

/** Create a new inactive draft edition */
export function createEdition(payload: CreateEditionPayload) {
  const cleanPayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== '') cleanPayload[key] = value;
  }
  // Ensure required fields are always present
  cleanPayload.id = payload.id;
  cleanPayload.brand_id = payload.brand_id;
  cleanPayload.name = payload.name;
  cleanPayload.price_usd = payload.price_usd;
  cleanPayload.max_supply = payload.max_supply;

  return request<Edition[]>('/api/editions', {
    method: 'POST',
    body: JSON.stringify(cleanPayload),
  }, true);
}

/** Update an uninitialized draft edition */
export function updateEditionDraft(id: string, payload: UpdateEditionPayload) {
  const cleanPayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) cleanPayload[key] = value;
  }

  return request<{ edition: Edition }>(`/api/editions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(cleanPayload),
  }, true);
}

/** Upload an image to an existing draft edition */
export function uploadEditionImage(id: string, base64Data: string, tag?: string) {
  return request<{
    publicUrl: string;
    image: { path: string; url: string; tag?: string };
    edition: Edition;
  }>('/api/editions/image', {
    method: 'POST',
    body: JSON.stringify({ id, base64Data, ...(tag ? { tag } : {}) }),
  }, true);
}

/** Delete an image from an edition draft using its exact storage path */
export function deleteEditionImage(id: string, path: string) {
  return request<{
    success: boolean;
    detached: boolean;
    cleanupPending: boolean;
    path: string;
    edition: Edition;
  }>('/api/editions/image', {
    method: 'DELETE',
    body: JSON.stringify({ id, path }),
  }, true);
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
