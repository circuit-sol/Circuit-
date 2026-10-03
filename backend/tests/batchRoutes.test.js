"use strict";

// Dependency-free route contract tests with mocked Express, auth and Supabase.
// These do not replace the SQL smoke test or a deployed PostgREST integration test.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const USER = "10000000-0000-4000-8000-000000000001";
const BRAND = "20000000-0000-4000-8000-000000000001";
const BATCH = "30000000-0000-4000-8000-000000000001";
const row = {
  id: BATCH, edition_id: "demo", name: "First batch", revision: 1,
  opens_at: "2099-01-01T00:00:00Z", closes_at: "2099-01-02T00:00:00Z",
  production_starts_at: "2099-01-04T00:00:00Z", release_at: "2099-02-01T00:00:00Z",
  is_active: false, chain_status: "pending", pickup_locations: [],
};

function harness(options = {}) {
  const routes = [];
  const calls = [];
  const router = Object.fromEntries(["get", "post", "patch"].map((method) => [method,
    (url, ...handlers) => routes.push({ method, url, handlers })]));
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/batchRoutes.js"), "utf8"), {
    module, Buffer, console,
    require(name) {
      if (name === "express") return { Router: () => router };
      if (name === "./sessionAuth") return { requireAuth: (req, res, next) => req.auth
        ? next() : res.status(401).json({ error: "AUTHENTICATION_REQUIRED" }) };
      throw new Error(name);
    },
  });
  const client = {
    from(table) {
      const call = { table, ops: [] }; calls.push(call);
      const result = () => table === "users"
        ? { data: { id: USER, wallet_address: options.wallet || "wallet" }, error: null }
        : table === "brand_memberships"
          ? { data: (options.brands || [BRAND]).map((brand_id) => ({ brand_id })), error: null }
          : { data: options.rows || [], error: options.readError || null };
      const query = {};
      for (const op of ["select", "eq", "in", "order", "range"]) {
        query[op] = (...args) => { call.ops.push([op, ...args]); return query; };
      }
      query.maybeSingle = async () => table === "batches"
        ? { data: options.single || null, error: null } : result();
      query.then = (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
      return query;
    },
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      return { data: row, error: options.rpcError || null };
    },
  };
  module.exports(client);
  return {
    calls,
    async request(method, url, input = {}) {
      const route = routes.find((r) => r.method === method && r.url === url);
      assert.ok(route);
      const req = { query: {}, params: { id: BATCH }, body: {},
        auth: { userId: USER, walletAddress: "wallet" }, ...input };
      const res = { statusCode: 200, status(n) { this.statusCode = n; return this; },
        json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; } };
      let index = 0;
      const next = () => route.handlers[index++]?.(req, res, next);
      await next();
      return res;
    },
  };
}

test("writes reject absent auth and stale wallet without RPC", async () => {
  let h = harness();
  assert.equal((await h.request("post", "/", { auth: null })).statusCode, 401);
  assert.equal(h.calls.length, 0);
  h = harness({ wallet: "changed-wallet" });
  assert.equal((await h.request("post", "/")).statusCode, 401);
  assert.equal(h.calls.filter((c) => c.rpc).length, 0);
});

test("create uses verified identity and returns fixed policy without enabling checkout", async () => {
  const h = harness();
  const result = await h.request("post", "/", { body: { name: "First batch" } });
  assert.equal(result.statusCode, 201);
  const call = h.calls.find((c) => c.rpc);
  assert.equal(call.args.p_user_id, USER);
  assert.equal(call.args.p_wallet_address, "wallet");
  assert.equal(call.args.p_batch_id, null);
  assert.equal(result.body.batch.checkout_enabled, false);
  assert.equal(result.body.batch.advance_eligible_at, "2099-01-04T00:00:00.000Z");
  assert.equal(result.body.batch.balance_eligible_at, "2099-02-08T00:00:00.000Z");
});

test("PATCH requires a revision and removes it from editable fields", async () => {
  const h = harness();
  assert.equal((await h.request("patch", "/:id")).statusCode, 400);
  const r = await h.request("patch", "/:id", { body: { expected_revision: 1, name: "Renamed" } });
  assert.equal(r.statusCode, 200);
  const call = h.calls.find((c) => c.rpc);
  assert.equal(call.args.p_expected_revision, 1);
  assert.equal(call.args.p_changes.expected_revision, undefined);
});

test("RPC denial, locked batch and stale revisions map to HTTP errors", async () => {
  for (const [message, expected] of [["BRAND_ACCESS_DENIED", 403],
    ["BATCH_NOT_EDITABLE", 409], ["BATCH_REVISION_CONFLICT", 409],
    ["INVALID_BATCH_SCHEDULE", 400], ["UNSUPPORTED_FIELDS", 400]]) {
    const h = harness({ rpcError: { code: "P0001", message } });
    const r = await h.request("post", "/");
    assert.equal(r.statusCode, expected);
    assert.equal(r.body.error, message);
  }
});

test("public reads require initialized and active and drafts return 404", async () => {
  const h = harness();
  const r = await h.request("get", "/:id", { auth: null });
  assert.equal(r.statusCode, 404);
  const ops = h.calls[0].ops;
  assert.ok(ops.some((x) => x[0] === "eq" && x[1] === "is_active" && x[2] === true));
  assert.ok(ops.some((x) => x[0] === "eq" && x[1] === "chain_status" && x[2] === "initialized"));
});

test("seller reads are restricted to membership brands", async () => {
  let h = harness({ brands: [] });
  assert.deepEqual((await h.request("get", "/mine")).body, { batches: [] });
  h = harness();
  await h.request("get", "/mine");
  const batchCall = h.calls.find((c) => c.table === "batches");
  assert.ok(batchCall.ops.some((x) => x[0] === "in" && x[1] === "edition.brand_id" && x[2][0] === BRAND));
  assert.equal((await h.request("get", "/mine", {
    query: { brand_id: "90000000-0000-4000-8000-000000000001" },
  })).statusCode, 403);
});

test("invalid IDs, unsupported filters and malformed pagination fail before reading batches", async () => {
  const h = harness();
  assert.equal((await h.request("get", "/:id", { params: { id: "bad" } })).statusCode, 400);
  for (const query of [{ active: "false" }, { limit: "101" }, { limit: ["10"] },
    { offset: "-1" }, { edition_id: "bad id" }]) {
    assert.equal((await h.request("get", "/", { query })).statusCode, 400);
  }
  assert.equal(h.calls.length, 0);
});

test("oversized and array mutation bodies never reach RPC", async () => {
  const h = harness();
  assert.equal((await h.request("post", "/", { body: [] })).statusCode, 400);
  assert.equal((await h.request("post", "/", { body: { name: "x".repeat(65537) } })).statusCode, 413);
  assert.equal(h.calls.filter((c) => c.rpc).length, 0);
});
