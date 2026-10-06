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

const BASE = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

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

export interface PickupLocation {
  id?: string;
  name: string;
  address: string;
  city: string;
  country: string;
  postal_code?: string;
  instructions?: string;
}

export interface BatchPricing {
  unit_price_lamports: number;
  prices_by_size_lamports?: Record<string, number>;
}

export interface Batch {
  id: string;
  edition_id: string;
  brand_id?: string;
  name: string;
  opens_at: string;
  closes_at: string;
  production_starts_at: string;
  release_at: string;
  pickup_locations: PickupLocation[];
  chain_terms?: {
    brand_id?: string;
    seller_wallet?: string;
    payment_wallet?: string;
    pricing?: BatchPricing;
  };
  chain_vault_address?: string;
  chain_batch_address?: string;
  chain_status?: 'pending' | 'initialized' | 'failed';
  initialization_tx_signature?: string;
  is_active?: boolean;
  revision?: number;
  created_at?: string;
  updated_at?: string;
  fulfillment_method?: string;
  sales_window_status?: 'draft' | 'scheduled' | 'open' | 'closed';
  checkout_enabled?: boolean;
  pricing?: BatchPricing | null;
  cancellation_window_hours?: number;
  advance_payout_percent?: number;
  balance_payout_percent?: number;
  advance_eligible_at?: string;
  balance_eligible_at?: string;
}

export interface CreateBatchPayload {
  edition_id: string;
  name: string;
  opens_at: string;
  closes_at: string;
  production_starts_at: string;
  release_at: string;
  pickup_locations: PickupLocation[];
}

export interface UpdateBatchPayload {
  name?: string;
  opens_at?: string;
  closes_at?: string;
  production_starts_at?: string;
  release_at?: string;
  pickup_locations?: PickupLocation[];
}

export interface ChainIntent {
  intent_id: string;
  kind: 'initialize' | 'purchase' | 'cancel' | 'collected' | 'refund';
  network: 'devnet';
  transaction_base64: string;
  last_valid_block_height: number;
  batch_id: string;
  order_id?: string;
  amount_lamports?: string;
  [key: string]: unknown;
}

export interface ChainOrder {
  id: string;
  batch_id: string;
  user_id: string;
  buyer_wallet: string;
  pickup_location_id: string;
  quantity: number;
  size?: string;
  amount_lamports: string;
  order_address: string;
  vault_address: string;
  purchase_signature: string;
  purchased_at: string;
  cancel_until: string;
  cancelled: boolean;
  refunded_lamports: string;
  collected_at?: string;
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
  // Whitelist matching backend dbRoutes.js allowedFields exactly
  const ALLOWED_CREATE_FIELDS = [
    'id', 'brand_id', 'name', 'description', 'price_usd', 'max_supply', 'fabric', 'headpiece', 'embroidery'
  ] as const;

  const cleanPayload: Record<string, unknown> = {};
  const rawPayload = payload as unknown as Record<string, unknown>;
  for (const field of ALLOWED_CREATE_FIELDS) {
    const val = rawPayload[field];
    if (val !== undefined && val !== null && val !== '') {
      if (field === 'price_usd') {
        cleanPayload[field] = Math.round(Number(val) * 100) / 100;
      } else if (field === 'max_supply') {
        cleanPayload[field] = Math.floor(Number(val));
      } else if (typeof val === 'string') {
        cleanPayload[field] = val.trim();
      } else {
        cleanPayload[field] = val;
      }
    }
  }

  // Ensure mandatory fields
  cleanPayload.id = String(cleanPayload.id || '').trim();
  cleanPayload.brand_id = String(cleanPayload.brand_id || '').trim();
  cleanPayload.name = String(cleanPayload.name || '').trim();
  cleanPayload.price_usd = Math.round(Number(payload.price_usd || 0) * 100) / 100;
  cleanPayload.max_supply = Math.floor(Number(payload.max_supply || 1));

  return request<Edition[]>('/api/editions', {
    method: 'POST',
    body: JSON.stringify(cleanPayload),
  }, true);
}

/** Update an uninitialized draft edition */
export function updateEditionDraft(id: string, payload: UpdateEditionPayload) {
  // Whitelist matching backend dbRoutes.js allowedFields exactly
  const ALLOWED_UPDATE_FIELDS = [
    'name', 'description', 'fabric', 'headpiece', 'embroidery', 'price_usd', 'max_supply'
  ] as const;

  const cleanPayload: Record<string, unknown> = {};
  const rawPayload = payload as unknown as Record<string, unknown>;
  for (const field of ALLOWED_UPDATE_FIELDS) {
    const val = rawPayload[field];
    if (val !== undefined && val !== null) {
      if (field === 'price_usd') {
        cleanPayload[field] = Math.round(Number(val) * 100) / 100;
      } else if (field === 'max_supply') {
        cleanPayload[field] = Math.floor(Number(val));
      } else if (typeof val === 'string') {
        cleanPayload[field] = val.trim();
      } else {
        cleanPayload[field] = val;
      }
    }
  }

  return request<{ edition: Edition }>(`/api/editions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(cleanPayload),
  }, true);
}

/** Upload an image to an existing draft edition */
export function uploadEditionImage(id: string, base64Data: string, tag?: string) {
  const cleanTag = tag ? tag.trim().slice(0, 100) : undefined;
  return request<{
    publicUrl: string;
    image: { path: string; url: string; tag?: string };
    edition: Edition;
  }>('/api/editions/image', {
    method: 'POST',
    body: JSON.stringify({ id, base64Data, ...(cleanTag ? { tag: cleanTag } : {}) }),
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

export interface EscrowSummary {
  batch_address: string;
  vault_address: string;
  seller_payment_wallet: string;
  frozen: boolean;
  manual_settlement: boolean;
  advance_claimed: boolean;
  balance_claimed: boolean;
  advance_eligible_at: string;
  balance_eligible_at: string;
  total_deposited: string;
  total_cancelled: string;
  total_topups: string;
  total_admin_refunded: string;
  total_seller_paid: string;
  total_redirected: string;
  admin_sequence: string;
}

// ── Batches ────────────────────────────────────────────────────────────

/** Public list of active, on-chain initialized batches for an edition */
export function getPublicBatches(editionId?: string, limit = 50, offset = 0) {
  const params = new URLSearchParams();
  if (editionId) params.append('edition_id', editionId);
  params.append('limit', String(limit));
  params.append('offset', String(offset));
  return request<{ batches: Batch[] }>(`/api/batches?${params.toString()}`, {
    method: 'GET',
  });
}

/** Public lookup for a single batch by ID */
export function getPublicBatchById(batchId: string) {
  return request<{ batch: Batch }>(`/api/batches/${encodeURIComponent(batchId)}`, {
    method: 'GET',
  });
}

/** Seller list of all managed batches (drafts & published) */
export function getMyBatches(options?: { editionId?: string; brandId?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (options?.editionId) params.append('edition_id', options.editionId);
  if (options?.brandId) params.append('brand_id', options.brandId);
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<{ batches: Batch[] }>(`/api/batches/mine${query}`, {
    method: 'GET',
  }, true);
}

/** Seller lookup for an owned batch by ID */
export function getMyBatchById(batchId: string) {
  return request<{ batch: Batch }>(`/api/batches/mine/${encodeURIComponent(batchId)}`, {
    method: 'GET',
  }, true);
}

function sanitizePickupLocations(locations: PickupLocation[]) {
  return (locations || []).map((loc) => {
    let address = (loc.address || '').trim();
    if (loc.city && !address.toLowerCase().includes(loc.city.toLowerCase().trim())) {
      address = `${address}, ${loc.city.trim()}`;
    }
    if (loc.country && !address.toLowerCase().includes(loc.country.toLowerCase().trim())) {
      address = `${address}, ${loc.country.trim()}`;
    }
    const clean: { name: string; address: string; instructions?: string } = {
      name: (loc.name || '').trim().slice(0, 120),
      address: address.trim().slice(0, 1000),
    };
    if (loc.instructions && loc.instructions.trim()) {
      clean.instructions = loc.instructions.trim().slice(0, 2000);
    }
    return clean;
  });
}

function ensureIsoUtc(dateStr: string): string {
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    throw new Error('INVALID_BATCH_DATE');
  }
  return parsed.toISOString();
}

/** Create a new preorder batch draft */
export function createBatchDraft(payload: CreateBatchPayload) {
  const cleanPayload = {
    edition_id: String(payload.edition_id).trim(),
    name: String(payload.name).trim().slice(0, 120),
    opens_at: ensureIsoUtc(payload.opens_at),
    closes_at: ensureIsoUtc(payload.closes_at),
    production_starts_at: ensureIsoUtc(payload.production_starts_at),
    release_at: ensureIsoUtc(payload.release_at),
    pickup_locations: sanitizePickupLocations(payload.pickup_locations),
  };

  return request<{ batch: Batch }>('/api/batches', {
    method: 'POST',
    body: JSON.stringify(cleanPayload),
  }, true);
}

/** Update an uninitialized batch draft */
export function updateBatchDraft(batchId: string, payload: UpdateBatchPayload, expectedRevision: number) {
  const cleanChanges: Record<string, unknown> = {
    expected_revision: expectedRevision,
  };
  if (payload.name !== undefined) cleanChanges.name = String(payload.name).trim().slice(0, 120);
  if (payload.opens_at !== undefined) cleanChanges.opens_at = ensureIsoUtc(payload.opens_at);
  if (payload.closes_at !== undefined) cleanChanges.closes_at = ensureIsoUtc(payload.closes_at);
  if (payload.production_starts_at !== undefined) cleanChanges.production_starts_at = ensureIsoUtc(payload.production_starts_at);
  if (payload.release_at !== undefined) cleanChanges.release_at = ensureIsoUtc(payload.release_at);
  if (payload.pickup_locations !== undefined) cleanChanges.pickup_locations = sanitizePickupLocations(payload.pickup_locations);

  return request<{ batch: Batch }>(`/api/batches/${encodeURIComponent(batchId)}`, {
    method: 'PATCH',
    body: JSON.stringify(cleanChanges),
  }, true);
}

// ── Verified Chain Integration ──────────────────────────────────────────

/** Check chain readiness status (operational wallet, config, programs) */
export function getChainStatus() {
  return request<{
    status: string;
    network: string;
    drops_program_id: string;
    escrow_program_id: string;
    config_address: string;
    operational_wallet: string;
    admin_wallet: string;
  }>('/api/chain/status', {
    method: 'GET',
  });
}

/**
 * Step 1 (Initialize): Prepare transaction to initialize a batch + vault on Solana.
 * Pre-cosigned by operational wallet. Seller signs fee-payer / sellerAuthority.
 */
export function prepareBatchInitialize(batchId: string, payload: {
  expected_revision: number;
  unit_price_lamports: string;
  prices_by_size_lamports?: Record<string, string>;
}) {
  const cleanPayload: Record<string, unknown> = {
    expected_revision: Number(payload.expected_revision),
    unit_price_lamports: String(payload.unit_price_lamports).trim(),
  };
  if (payload.prices_by_size_lamports && typeof payload.prices_by_size_lamports === 'object') {
    cleanPayload.prices_by_size_lamports = payload.prices_by_size_lamports;
  }
  return request<ChainIntent>(`/api/chain/batches/${encodeURIComponent(batchId)}/initialize/prepare`, {
    method: 'POST',
    body: JSON.stringify(cleanPayload),
  }, true);
}

/**
 * Step 1 (Purchase): Prepare buyer purchase transaction.
 * Generates quote + atomic order instruction pre-cosigned by operational wallet.
 */
export function prepareBatchPurchase(batchId: string, payload: {
  order_id: string;
  quantity: number;
  size?: string;
  pickup_location_id: string;
}) {
  const cleanPayload: Record<string, unknown> = {
    order_id: String(payload.order_id).toLowerCase().trim(),
    quantity: Math.floor(Number(payload.quantity)),
    pickup_location_id: String(payload.pickup_location_id).toLowerCase().trim(),
  };
  if (payload.size) {
    cleanPayload.size = String(payload.size).trim();
  }
  return request<ChainIntent>(`/api/chain/batches/${encodeURIComponent(batchId)}/purchase/prepare`, {
    method: 'POST',
    body: JSON.stringify(cleanPayload),
  }, true);
}

/** Look up an intent */
export function getChainIntent(intentId: string) {
  return request<ChainIntent>(`/api/chain/intents/${encodeURIComponent(intentId)}`, {
    method: 'GET',
  }, true);
}

/**
 * Step 2 (Submit): Submit buyer-signed transaction to Devnet via backend.
 * Returns 202 status and tx signature.
 */
export function submitChainIntent(intentId: string, signedTransactionBase64: string) {
  return request<{ signature: string; intent_id: string; status: string }>(
    `/api/chain/intents/${encodeURIComponent(intentId)}/submit`,
    {
      method: 'POST',
      body: JSON.stringify({ signed_transaction_base64: signedTransactionBase64 }),
    },
    true
  );
}

/**
 * Step 3 (Confirm): Finalize transaction confirmation on-chain and record order.
 */
export function confirmChainIntent(intentId: string, signature?: string) {
  const cleanPayload: Record<string, string> = {};
  if (signature && typeof signature === 'string' && signature.trim()) {
    cleanPayload.signature = signature.trim();
  }
  return request<{ status: string; intent_id: string; signature: string; order?: ChainOrder }>(
    `/api/chain/intents/${encodeURIComponent(intentId)}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify(cleanPayload),
    },
    true
  );
}

/** Retrieve authenticated buyer's chain orders */
export function getMyChainOrders() {
  return request<{ orders: ChainOrder[] }>('/api/chain/orders/mine', {
    method: 'GET',
  }, true);
}

/** Retrieve an individual chain order */
export function getChainOrderById(orderId: string) {
  return request<{ order: ChainOrder }>(`/api/chain/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
  }, true);
}

/** Prepare cancellation within the 24-hour buyer window */
export function prepareOrderCancel(orderId: string) {
  return request<ChainIntent>(`/api/chain/orders/${encodeURIComponent(orderId)}/cancel/prepare`, {
    method: 'POST',
    body: JSON.stringify({}),
  }, true);
}

/**
 * Buyer records collection/receipt of item at pickup location.
 * Decoupled from immediate payout release.
 */
export function recordOrderCollected(orderId: string) {
  return request<{ status: string; payment_release_authorized: boolean }>(
    `/api/chain/orders/${encodeURIComponent(orderId)}/collected`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
    true
  );
}

/**
 * Buyer reports an issue or missing order after the release date.
 * Filed with Circuit admin review.
 */
export function reportOrderIssue(orderId: string, message: string) {
  return request<{ status: string; automatic_freeze: boolean }>(
    `/api/chain/orders/${encodeURIComponent(orderId)}/report`,
    {
      method: 'POST',
      body: JSON.stringify({ message: message.trim().slice(0, 2000) }),
    },
    true
  );
}

/** Inspect live on-chain escrow summary for a batch */
export function getBatchEscrow(batchId: string) {
  return request<{ escrow: EscrowSummary }>(`/api/chain/batches/${encodeURIComponent(batchId)}/escrow`, {
    method: 'GET',
  }, true);
}

/** Retrieve all chain orders recorded for a seller's batch */
export function getBatchOrders(batchId: string) {
  return request<{ orders: ChainOrder[] }>(`/api/chain/batches/${encodeURIComponent(batchId)}/orders`, {
    method: 'GET',
  }, true);
}

/** Prepare batch claims or admin actions */
export function prepareBatchAction(batchId: string, payload: {
  action: 'advance' | 'balance' | 'topup' | 'freeze' | 'unfreeze' | 'refund' | 'seller_payment' | 'redirect';
  amount_lamports?: string;
  recipient?: string;
  reason?: string;
  order_id?: string;
}) {
  const cleanPayload: Record<string, unknown> = {
    action: payload.action,
  };
  if (payload.amount_lamports) cleanPayload.amount_lamports = String(payload.amount_lamports).trim();
  if (payload.recipient) cleanPayload.recipient = String(payload.recipient).trim();
  if (payload.reason) cleanPayload.reason = String(payload.reason).trim();
  if (payload.order_id) cleanPayload.order_id = String(payload.order_id).toLowerCase().trim();

  return request<ChainIntent>(`/api/chain/batches/${encodeURIComponent(batchId)}/actions/prepare`, {
    method: 'POST',
    body: JSON.stringify(cleanPayload),
  }, true);
}

