"use strict";

const { createHash } = require("node:crypto");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidBytes(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("Invalid UUID");
  const bytes = Buffer.from(value.replaceAll("-", ""), "hex");
  if (bytes.every((b) => b === 0)) throw new Error("UUID cannot be zero");
  return bytes;
}

function pickupTermsBytes(locations) {
  if (!Array.isArray(locations) || locations.length < 1 || locations.length > 20) {
    throw new Error("Expected 1–20 pickup locations");
  }
  const seen = new Set();
  const canonical = locations.map((location) => {
    if (!location || typeof location !== "object" || Array.isArray(location)) throw new Error("Invalid location");
    if (Object.keys(location).some((key) => !["id", "name", "address", "instructions"].includes(key))) {
      throw new Error("Unsupported location field");
    }
    uuidBytes(location.id);
    const id = location.id.toLowerCase();
    if (seen.has(id)) throw new Error("Duplicate location ID");
    seen.add(id);
    for (const [key, min, max] of [["name", 1, 120], ["address", 1, 1000], ["instructions", 0, 2000]]) {
      const value = key === "instructions" ? (location[key] ?? "") : location[key];
      if (typeof value !== "string" || value !== value.trim()
        || Array.from(value).length < min || Array.from(value).length > max) {
        throw new Error(`Invalid pickup ${key}`);
      }
    }
    // Deliberate fixed key order. Strings are UTF-8, with no Unicode normalization.
    return { id, name: location.name, address: location.address, instructions: location.instructions ?? "" };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return Buffer.from("circuit:pickup:v1\n" + JSON.stringify(canonical), "utf8");
}

function pickupTermsHash(locations) {
  return createHash("sha256").update(pickupTermsBytes(locations)).digest();
}

function unixSeconds(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.0{1,6})?(Z|\+00:00)$/.test(value)) {
    throw new Error("Initialization dates must be UTC, at whole-second precision");
  }
  const ms = Date.parse(value);
  if (!Number.isSafeInteger(ms) || ms % 1000 !== 0
    || new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error("Invalid initialization date");
  }
  return ms / 1000;
}

// Pure conversion only: no API calls, wallet access, signing or submission.
// brandId and payment wallet MUST come from the backend's authorized brand record.
function batchWireFields(batch, brandId) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(batch.edition_id) || batch.edition_id.length > 32) {
    throw new Error("Invalid edition ID");
  }
  if (!Number.isInteger(batch.revision) || batch.revision < 1 || batch.revision > 2147483647) {
    throw new Error("Invalid source revision");
  }
  const opensAt = unixSeconds(batch.opens_at);
  const closesAt = unixSeconds(batch.closes_at);
  const productionStartsAt = unixSeconds(batch.production_starts_at);
  const releaseAt = unixSeconds(batch.release_at);
  if (!(closesAt > opensAt && productionStartsAt >= closesAt + 172800
    && releaseAt > productionStartsAt)) throw new Error("Invalid batch schedule");
  return {
    batchId: Array.from(uuidBytes(batch.id)),
    brandId: Array.from(uuidBytes(brandId)), editionId: batch.edition_id,
    sourceRevision: batch.revision,
    pickupTermsHash: Array.from(pickupTermsHash(batch.pickup_locations)),
    opensAt, closesAt, productionStartsAt, releaseAt,
  };
}

module.exports = { uuidBytes, pickupTermsBytes, pickupTermsHash, unixSeconds, batchWireFields };
