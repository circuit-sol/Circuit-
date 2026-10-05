"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { uuidBytes, pickupTermsHash, unixSeconds, batchWireFields } = require("../scripts/batch-wire.cjs");

const location = { id: "eca7232d-5535-4811-9753-7660bc6fe238", name: "Circuit Demo Pickup",
  address: "Test pickup address, Lagos", instructions: "Bring your order reference when collecting." };
const batch = { id: "636e1f37-fa6a-40e1-9924-e68812cb6ef1", edition_id: "circuit-demo-drop-001",
  revision: 2, opens_at: "2026-10-05T09:00:00+00:00", closes_at: "2026-10-10T09:00:00+00:00",
  production_starts_at: "2026-10-12T09:00:00+00:00", release_at: "2026-10-25T09:00:00+00:00",
  pickup_locations: [location] };
const brand = "5d916a05-e74c-4261-8734-3e04c0a66c28";

test("UUID seed is 16 bytes in the same order as printed hex", () => {
  assert.equal(uuidBytes(batch.id).toString("hex"), "636e1f37fa6a40e19924e68812cb6ef1");
  assert.equal(uuidBytes(batch.id).length, 16);
  assert.throws(() => uuidBytes("00000000-0000-0000-0000-000000000000"));
  assert.throws(() => uuidBytes("not-a-uuid"));
});

test("hash is independent of object key order and list ordering, but binds actual terms", () => {
  const second = { ...location, id: "12345678-1234-1234-1234-123456789012" };
  const reordered = { instructions: location.instructions, address: location.address,
    name: location.name, id: location.id.toUpperCase() };
  assert.equal(pickupTermsHash([location, second]).toString("hex"),
    pickupTermsHash([second, reordered]).toString("hex"));
  assert.notEqual(pickupTermsHash([location]).toString("hex"),
    pickupTermsHash([{ ...location, address: "Other studio" }]).toString("hex"));
  assert.throws(() => pickupTermsHash([location, location]));
  assert.throws(() => pickupTermsHash([]));
});

test("UTC timestamps keep exact seconds; fractional or invalid dates are not silently rounded", () => {
  assert.equal(unixSeconds(batch.opens_at), unixSeconds("2026-10-05T09:00:00.000Z"));
  assert.throws(() => unixSeconds("2026-10-05T09:00:00.123Z"));
  assert.throws(() => unixSeconds("2026-02-30T09:00:00Z"));
  assert.throws(() => unixSeconds("2026-10-05T09:00:00"));
});

test("current batch maps to the agreed schedule", () => {
  const fields = batchWireFields(batch, brand);
  assert.equal(fields.sourceRevision, 2);
  assert.equal(fields.productionStartsAt - fields.closesAt, 172800);
  assert.equal(new Date((fields.releaseAt + 604800) * 1000).toISOString(), "2026-11-01T09:00:00.000Z");
  assert.throws(() => batchWireFields({ ...batch, production_starts_at: batch.closes_at }, brand));
});
