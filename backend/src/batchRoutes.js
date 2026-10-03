"use strict";

const express = require("express");
const { requireAuth } = require("./sessionAuth");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITION_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HOUR_MS = 3600000;
const SELECT = "*,edition:editions!inner(brand_id)";
const PUBLIC_SELECT = "id,edition_id,name,opens_at,closes_at,production_starts_at,release_at,pickup_locations,chain_status,chain_batch_address,initialization_tx_signature,is_active,revision,created_at,updated_at,edition:editions!inner(brand_id)";
const ERROR_STATUS = {
  INVALID_OR_EXPIRED_SESSION: 401,
  BRAND_ACCESS_DENIED: 403,
  BATCH_NOT_FOUND: 404,
  EDITION_NOT_FOUND: 404,
  BATCH_NOT_EDITABLE: 409,
  BATCH_REVISION_CONFLICT: 409,
  INVALID_BATCH_CHANGES: 400,
  UNSUPPORTED_FIELDS: 400,
  MISSING_BATCH_FIELDS: 400,
  INVALID_BATCH_NAME: 400,
  INVALID_BATCH_DATE: 400,
  INVALID_BATCH_SCHEDULE: 400,
  BATCH_OPENING_MUST_BE_FUTURE: 400,
  INVALID_PICKUP_LOCATIONS: 400,
};

// Schedule information only: neither this response nor DB dates authorize money.
function formatBatch(row, now = Date.now()) {
  const { edition, ...batch } = row;
  const initialized = batch.is_active && batch.chain_status === "initialized";
  const opens = Date.parse(batch.opens_at);
  const closes = Date.parse(batch.closes_at);
  return {
    ...batch,
    ...(edition ? { brand_id: edition.brand_id } : {}),
    fulfillment_method: "pickup",
    sales_window_status: !initialized ? "draft" : now < opens ? "scheduled"
      : now < closes ? "open" : "closed",
    // Remains false until checkout and the replacement Anchor program are wired.
    checkout_enabled: false,
    cancellation_window_hours: 24,
    advance_payout_percent: 30,
    balance_payout_percent: 70,
    advance_eligible_at: new Date(closes + 48 * HOUR_MS).toISOString(),
    balance_eligible_at: new Date(Date.parse(batch.release_at) + 168 * HOUR_MS).toISOString(),
  };
}

module.exports = function createBatchRoutes(supabase) {
  const router = express.Router();

  const route = (handler) => async (req, res, next) => {
    try { await handler(req, res, next); }
    catch (error) {
      const status = error.code === "P0001" && ERROR_STATUS[error.message];
      if (status) return res.status(status).json({ error: error.message });
      console.error("Batch request failed:", error.code || "unexpected_error");
      return res.status(500).json({ error: "BATCH_REQUEST_FAILED" });
    }
  };

  const currentAccount = route(async (req, res, next) => {
    const { data, error } = await supabase.from("users").select("id,wallet_address")
      .eq("id", req.auth.userId).maybeSingle();
    if (error) throw error;
    if (!data || data.wallet_address !== req.auth.walletAddress) {
      return res.status(401).json({ error: "INVALID_OR_EXPIRED_SESSION" });
    }
    return next();
  });

  const memberships = async (userId) => {
    const { data, error } = await supabase.from("brand_memberships").select("brand_id")
      .eq("user_id", userId).in("role", ["owner", "editor"]);
    if (error) throw error;
    return (data || []).map((row) => row.brand_id);
  };

  function filters(req, res, allowed) {
    if (Object.keys(req.query).some((key) => !allowed.includes(key))) {
      res.status(400).json({ error: "UNSUPPORTED_QUERY_FIELDS" });
      return null;
    }
    const { edition_id, brand_id } = req.query;
    if (edition_id !== undefined && (typeof edition_id !== "string"
      || edition_id.length > 32 || !EDITION_ID.test(edition_id))) {
      res.status(400).json({ error: "INVALID_EDITION_ID" });
      return null;
    }
    if (brand_id !== undefined && (typeof brand_id !== "string" || !UUID.test(brand_id))) {
      res.status(400).json({ error: "INVALID_BRAND_ID" });
      return null;
    }
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if ((req.query.limit !== undefined && (typeof req.query.limit !== "string" || !/^\d+$/.test(req.query.limit)))
      || (req.query.offset !== undefined && (typeof req.query.offset !== "string" || !/^\d+$/.test(req.query.offset)))
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
      res.status(400).json({ error: "INVALID_PAGINATION" });
      return null;
    }
    return { edition_id, brand_id, limit, offset };
  }

  function listQuery(selection, f) {
    let query = supabase.from("batches").select(selection)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(f.offset, f.offset + f.limit - 1);
    if (f.edition_id) query = query.eq("edition_id", f.edition_id);
    if (f.brand_id) query = query.eq("edition.brand_id", f.brand_id);
    return query;
  }

  // Register private paths before /:id. Drafts never fall through to public reads.
  router.get("/mine", requireAuth, currentAccount, route(async (req, res) => {
    const f = filters(req, res, ["edition_id", "brand_id", "limit", "offset"]);
    if (!f) return;
    const brands = await memberships(req.auth.userId);
    if (f.brand_id && !brands.includes(f.brand_id.toLowerCase())) {
      return res.status(403).json({ error: "BRAND_ACCESS_DENIED" });
    }
    if (!brands.length) return res.json({ batches: [] });
    const { data, error } = await listQuery(SELECT, f).in("edition.brand_id", brands);
    if (error) throw error;
    return res.json({ batches: data.map((row) => formatBatch(row)) });
  }));

  router.get("/mine/:id", requireAuth, currentAccount, route(async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: "INVALID_BATCH_ID" });
    const brands = await memberships(req.auth.userId);
    if (!brands.length) return res.status(404).json({ error: "BATCH_NOT_FOUND" });
    const { data, error } = await supabase.from("batches").select(SELECT)
      .eq("id", req.params.id).in("edition.brand_id", brands).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "BATCH_NOT_FOUND" });
    return res.json({ batch: formatBatch(data) });
  }));

  router.get("/", route(async (req, res) => {
    const f = filters(req, res, ["edition_id", "brand_id", "limit", "offset"]);
    if (!f) return;
    const { data, error } = await listQuery(PUBLIC_SELECT, f)
      .eq("is_active", true).eq("chain_status", "initialized");
    if (error) throw error;
    return res.json({ batches: data.map((row) => formatBatch(row)) });
  }));

  router.get("/:id", route(async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: "INVALID_BATCH_ID" });
    const { data, error } = await supabase.from("batches").select(PUBLIC_SELECT)
      .eq("id", req.params.id).eq("is_active", true)
      .eq("chain_status", "initialized").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "BATCH_NOT_FOUND" });
    return res.json({ batch: formatBatch(data) });
  }));

  const save = (create) => route(async (req, res) => {
    if (!create && !UUID.test(req.params.id)) {
      return res.status(400).json({ error: "INVALID_BATCH_ID" });
    }
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "INVALID_BATCH_CHANGES" });
    }
    if (Buffer.byteLength(JSON.stringify(req.body), "utf8") > 65536) {
      return res.status(413).json({ error: "BATCH_PAYLOAD_TOO_LARGE" });
    }
    const changes = { ...req.body };
    let expectedRevision = null;
    if (!create) {
      expectedRevision = changes.expected_revision;
      delete changes.expected_revision;
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        return res.status(400).json({ error: "EXPECTED_REVISION_REQUIRED" });
      }
    }
    const { data, error } = await supabase.rpc("save_batch_draft", {
      p_user_id: req.auth.userId,
      p_wallet_address: req.auth.walletAddress,
      p_batch_id: create ? null : req.params.id,
      p_changes: changes,
      p_expected_revision: expectedRevision,
    });
    if (error) throw error;
    return res.status(create ? 201 : 200).json({ batch: formatBatch(data) });
  });
  router.post("/", requireAuth, currentAccount, save(true));
  router.patch("/:id", requireAuth, currentAccount, save(false));
  return router;
};
