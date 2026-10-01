"use strict";

const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const createEditionImageRoutes = require("./editionImageRoutes");

if (!process.env.SUPABASE_URL)
  throw new Error("SUPABASE_URL is not set in environment");
if (!process.env.SUPABASE_SERVICE_KEY)
  throw new Error("SUPABASE_SERVICE_KEY is not set in environment");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// Authenticate email updates using the Circuit token.
const { requireAuth } = require("./sessionAuth");

// Disable the old unauthenticated user lookup/upsert endpoints.
router.use("/users", (_req, res) => {
  return res.status(410).json({
    error: "LEGACY_USER_ROUTES_DISABLED",
  });
});

// ── Admin Auth ────────────────────────────────────────────────────────────────

// POST /api/auth/admin  { identifier, password }  (identifier = email or username)
router.post("/auth/admin", async (req, res) => {
  const identifier = req.body.identifier || req.body.email;
  const password = req.body.password || req.body.passwordHash;

  if (!identifier || !password) {
    return res
      .status(400)
      .json({ error: "identifier and password are required" });
  }

  try {
    const { data, error } = await supabase
      .from("admins")
      .select("id, email, username, created_at")
      .or(`email.eq.${identifier},username.eq.${identifier}`)
      .eq("password_hash", password)
      .maybeSingle();

    if (error) {
      console.error("Admin auth Supabase error:", error.message);
      return res.status(500).json({ error: error.message });
    }
    if (!data) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({ success: true, admin: data });
  } catch (err) {
    console.error("Error in POST /api/auth/admin:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Users ─────────────────────────────────────────────────────────────────────

// POST /api/users  { email, wallet_address, private_key? }
router.post("/users", async (req, res) => {
  const { email, wallet_address, private_key } = req.body;

  if (!email || !wallet_address) {
    return res
      .status(400)
      .json({ error: "email and wallet_address are required" });
  }

  try {
    const payload = { email, wallet_address };
    if (private_key !== undefined) payload.private_key = private_key;

    const { data, error } = await supabase
      .from("users")
      .upsert(payload, { onConflict: "email" })
      .select("id, email, wallet_address, created_at")
      .single();

    if (error) {
      console.error("Save user Supabase error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error("Error in POST /api/users:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:email
router.get("/users/:email", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, wallet_address, created_at")
      .eq("email", decodeURIComponent(req.params.email))
      .maybeSingle();

    if (error) {
      console.error("Get user Supabase error:", error.message);
      return res.status(500).json({ error: error.message });
    }
    if (!data) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(data);
  } catch (err) {
    console.error("Error in GET /api/users/:email:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Orders ────────────────────────────────────────────────────────────────────

// POST /api/db/orders  { email, drop_id, tx_signature, escrow_pda, amount_usd, size?, quantity? }
router.post("/db/orders", async (req, res) => {
  const { email, drop_id, tx_signature, escrow_pda, amount_usd } = req.body;

  if (
    !email ||
    !drop_id ||
    !tx_signature ||
    !escrow_pda ||
    amount_usd == null
  ) {
    return res.status(400).json({
      error:
        "email, drop_id, tx_signature, escrow_pda, and amount_usd are required",
    });
  }

  try {
    const payload = { email, drop_id, tx_signature, escrow_pda, amount_usd };
    if (req.body.size !== undefined) payload.size = req.body.size;
    if (req.body.quantity !== undefined) payload.quantity = req.body.quantity;

    const { data, error } = await supabase
      .from("orders")
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error("Save order Supabase error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error("Error in POST /api/db/orders:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/db/orders  — all orders (admin dashboard)
router.get("/db/orders", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Get all orders Supabase error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error("Error in GET /api/db/orders:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/db/orders/count/:dropId  — order count for a drop (supply display)
router.get("/db/orders/count/:dropId", async (req, res) => {
  try {
    const { count, error } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("drop_id", req.params.dropId);

    if (error) {
      console.error("Order count Supabase error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ count: count ?? 0 });
  } catch (err) {
    console.error("Error in GET /api/db/orders/count/:dropId:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/db/orders/by-tx/:txSignature  — single order lookup by transaction signature
router.get("/db/orders/by-tx/:txSignature", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("tx_signature", req.params.txSignature)
      .maybeSingle();

    if (error) {
      console.error("Order by-tx Supabase error:", error.message);
      return res.status(500).json({ error: error.message });
    }
    if (!data) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(data);
  } catch (err) {
    console.error("Error in GET /api/db/orders/by-tx/:txSignature:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/db/orders/:email  — orders for a specific user
router.get("/db/orders/:email", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("email", decodeURIComponent(req.params.email))
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Get orders by email Supabase error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error("Error in GET /api/db/orders/:email:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/db/orders/delivery  — must be defined before /:txSignature/status
// Body: { email, delivery_location, delivery_address }
router.patch("/db/orders/delivery", async (req, res) => {
  const { email, delivery_location, delivery_address } = req.body;

  if (!email || !delivery_location || !delivery_address) {
    return res.status(400).json({
      error: "email, delivery_location, and delivery_address are required",
    });
  }

  try {
    const { data, error } = await supabase
      .from("orders")
      .update({ delivery_location, delivery_address })
      .eq("email", email)
      .eq("status", "pending")
      .select();

    if (error) {
      console.error("Update delivery Supabase error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error("Error in PATCH /api/db/orders/delivery:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/db/orders/:txSignature/status  — { status }
router.patch("/db/orders/:txSignature/status", async (req, res) => {
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: "status is required" });
  }

  try {
    const { data, error } = await supabase
      .from("orders")
      .update({ status })
      .eq("tx_signature", req.params.txSignature)
      .select();

    if (error) {
      console.error("Update order status Supabase error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error("Error in PATCH /api/db/orders/:txSignature/status:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/db/orders/lifecycle
router.patch("/db/orders/lifecycle", async (req, res) => {
  const { orderId, status, garmentSerial, mintAddress } = req.body;

  if (!orderId || !status) {
    return res.status(400).json({ error: "orderId and status are required" });
  }

  try {
    const updatePayload = { status };
    if (garmentSerial !== undefined)
      updatePayload.garment_serial = garmentSerial;
    if (mintAddress !== undefined) updatePayload.mint_address = mintAddress;

    const { data, error } = await supabase
      .from("orders")
      .update(updatePayload)
      .eq("id", orderId)
      .select();

    if (error) {
      console.error("Update lifecycle Supabase error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error("Error in PATCH /api/db/orders/lifecycle:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/db/orders/shipment
router.patch("/db/orders/shipment", async (req, res) => {
  const { orderId, details } = req.body;

  if (!orderId || details === undefined) {
    return res.status(400).json({ error: "orderId and details are required" });
  }

  try {
    const { data, error } = await supabase
      .from("orders")
      .update({ shipment_details: details })
      .eq("id", orderId)
      .select();

    if (error) {
      console.error("Update shipment Supabase error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error("Error in PATCH /api/db/orders/shipment:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── BRANDS START ──────────────────────────────────────────────────────────────────
// GET /api/brands/me — brands managed by the authenticated user
router.get("/brands/me", requireAuth, async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {
    // Confirm the token still matches the account's current wallet.
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, wallet_address")
      .eq("id", req.auth.userId)
      .maybeSingle();

    if (userError) throw userError;

    if (!user || user.wallet_address !== req.auth.walletAddress) {
      return res.status(401).json({
        error: "INVALID_OR_EXPIRED_SESSION",
      });
    }

    const { data, error } = await supabase
      .from("brand_memberships")
      .select(
        `
        role,
        brand:brands (
          id,
          name,
          slug,
          payment_wallet_address
        )
      `,
      )
      .eq("user_id", req.auth.userId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return res.json({
      brands: (data || [])
        .filter((membership) => membership.brand)
        .map((membership) => ({
          ...membership.brand,
          role: membership.role,
        })),
    });
  } catch (error) {
    console.error("Get my brands failed:", error.message);
    return res.status(500).json({
      error: "BRANDS_FETCH_FAILED",
    });
  }
});

// ── BRANDS END ──────────────────────────────────────────────────────────────────

// ── Editions ──────────────────────────────────────────────────────────────────

// Verify that the JWT still matches the user's current wallet.
async function requireCurrentAccount(req, res, next) {
  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, wallet_address")
      .eq("id", req.auth.userId)
      .maybeSingle();

    if (error) throw error;

    if (!user || user.wallet_address !== req.auth.walletAddress) {
      return res.status(401).json({
        error: "INVALID_OR_EXPIRED_SESSION",
      });
    }

    next();
  } catch (error) {
    console.error("Account validation failed:", error.message);

    return res.status(500).json({
      error: "ACCOUNT_VALIDATION_FAILED",
    });
  }
}

// Preserve the existing image-proxy response format.
// Keep image.path intact for deletion requests.
function formatEditionImages(edition) {
  return {
    ...edition,
    images: (edition.images || []).map((image) => {
      if (
        typeof image.url === "string" &&
        image.url.startsWith(`${process.env.SUPABASE_URL}/storage/`)
      ) {
        return {
          ...image,
          url: `/api/proxy-image?url=${encodeURIComponent(image.url)}`,
        };
      }

      return image;
    }),
  };
}

// GET /api/editions  — all active editions
// router.get("/editions", async (req, res) => {
//   try {
//     const activeOnly = req.query.active !== "false";
//     let query = supabase.from("editions").select("*");

//     if (activeOnly) {
//       query = query.eq("is_active", true);
//     }

//     const { data, error } = await query.order("created_at", {
//       ascending: true,
//     });

//     if (error) {
//       console.error("Get all editions Supabase error:", error.message);
//       return res.status(500).json({ error: error.message });
//     }

//     // Proxy image URLs
//     const proxyData = (data || []).map((edition) => {
//       if (edition.images) {
//         edition.images = edition.images.map((img) => {
//           if (img.url && img.url.includes("supabase")) {
//             return {
//               ...img,
//               url: `/api/proxy-image?url=${encodeURIComponent(img.url)}`,
//             };
//           }
//           return img;
//         });
//       }
//       return edition;
//     });

//     res.json(proxyData);
//   } catch (err) {
//     console.error("Error in GET /api/editions:", err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // GET /api/editions/:id  — specific edition
// router.get("/editions/:id", async (req, res) => {
//   try {
//     const { data, error } = await supabase
//       .from("editions")
//       .select("*")
//       .eq("id", req.params.id)
//       .maybeSingle();

//     if (error) {
//       console.error("Get edition by ID Supabase error:", error.message);
//       return res.status(500).json({ error: error.message });
//     }

//     if (!data) {
//       return res.status(404).json({ error: "Edition not found" });
//     }

//     // Proxy image URLs
//     if (data.images) {
//       data.images = data.images.map((img) => {
//         if (img.url && img.url.includes("supabase")) {
//           return {
//             ...img,
//             url: `/api/proxy-image?url=${encodeURIComponent(img.url)}`,
//           };
//         }
//         return img;
//       });
//     }

//     res.json(data);
//   } catch (err) {
//     console.error("Error in GET /api/editions/:id:", err);
//     res.status(500).json({ error: err.message });
//   }
// });

// POST /api/editions  — insert/update edition
// router.post("/editions", async (req, res) => {
//   try {
//     const editionData = req.body;

//     // Ensure image_url is provided to avoid NOT NULL constraint errors
//     const payload = {
//       ...editionData,
//       image_url: editionData.images?.[0]?.url || "/satin.png",
//     };

//     const { data, error } = await supabase
//       .from("editions")
//       .upsert(payload, { onConflict: "id" })
//       .select();

//     if (error) {
//       console.error("Save edition Supabase error:", error.message);
//       return res.status(500).json({ error: error.message });
//     }

//     res.json(data || []);
//   } catch (err) {
//     console.error("Error in POST /api/editions:", err);
//     res.status(500).json({ error: err.message });
//   }
// });

// UPDATED EDITIONS
// POST /api/editions — create an inactive draft
router.post("/editions", requireAuth, async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {
    const body = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ error: "INVALID_REQUEST_BODY" });
    }

    // Accept only fields supported by this draft-creation endpoint.
    const allowedFields = new Set([
      "id",
      "brand_id",
      "name",
      "description",
      "price_usd",
      "max_supply",
      "fabric",
      "headpiece",
      "embroidery",
    ]);

    const unsupportedFields = Object.keys(body).filter(
      (key) => !allowedFields.has(key),
    );

    if (unsupportedFields.length) {
      return res.status(400).json({
        error: "UNSUPPORTED_FIELDS",
        fields: unsupportedFields,
      });
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (typeof body.brand_id !== "string" || !uuidPattern.test(body.brand_id)) {
      return res.status(400).json({ error: "INVALID_BRAND_ID" });
    }

    if (
      typeof body.id !== "string" ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.id) ||
      Buffer.byteLength(body.id, "utf8") > 32
    ) {
      return res.status(400).json({ error: "INVALID_EDITION_ID" });
    }

    if (
      typeof body.name !== "string" ||
      body.name.trim().length < 1 ||
      body.name.trim().length > 120
    ) {
      return res.status(400).json({ error: "INVALID_EDITION_NAME" });
    }

    const price = body.price_usd;
    const cents = Math.round(price * 100);

    if (
      typeof price !== "number" ||
      !Number.isFinite(price) ||
      price <= 0 ||
      price > 9999999999.99 ||
      Math.abs(price * 100 - cents) > 0.000001
    ) {
      return res.status(400).json({
        error: "INVALID_PRICE",
        message: "price_usd must be positive with at most two decimal places.",
      });
    }

    if (
      !Number.isInteger(body.max_supply) ||
      body.max_supply < 1 ||
      body.max_supply > 2147483647
    ) {
      return res.status(400).json({ error: "INVALID_MAX_SUPPLY" });
    }

    const textLimits = {
      description: 10000,
      fabric: 500,
      headpiece: 500,
      embroidery: 500,
    };

    for (const [field, limit] of Object.entries(textLimits)) {
      if (
        body[field] !== undefined &&
        (typeof body[field] !== "string" || body[field].length > limit)
      ) {
        return res.status(400).json({
          error: "INVALID_FIELD",
          field,
        });
      }
    }

    // Reject a token whose wallet no longer matches the account.
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, wallet_address")
      .eq("id", req.auth.userId)
      .maybeSingle();

    if (userError) throw userError;

    if (!user || user.wallet_address !== req.auth.walletAddress) {
      return res.status(401).json({
        error: "INVALID_OR_EXPIRED_SESSION",
      });
    }

    // Signing in alone does not grant permission to create drops.
    const { data: membership, error: membershipError } = await supabase
      .from("brand_memberships")
      .select("role")
      .eq("brand_id", body.brand_id)
      .eq("user_id", req.auth.userId)
      .maybeSingle();

    if (membershipError) throw membershipError;

    if (!membership || !["owner", "editor"].includes(membership.role)) {
      return res.status(403).json({ error: "BRAND_ACCESS_DENIED" });
    }

    // Explicit fields prevent caller-controlled ownership or chain status.
    const payload = {
      id: body.id,
      brand_id: body.brand_id,
      created_by: req.auth.userId,
      name: body.name.trim(),
      description: body.description?.trim() || "",
      price_usd: cents / 100,
      max_supply: body.max_supply,
      fabric: body.fabric?.trim() || "",
      headpiece: body.headpiece?.trim() || "",
      embroidery: body.embroidery?.trim() || "",
      is_active: false,
      chain_status: "pending",
    };

    const { data, error } = await supabase
      .from("editions")
      .insert(payload)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          error: "EDITION_ID_ALREADY_EXISTS",
        });
      }

      throw error;
    }

    // Preserve the existing frontend's array response shape.
    return res.status(201).json([data]);
  } catch (error) {
    console.error("Create edition failed:", error.message);

    return res.status(500).json({
      error: "EDITION_CREATION_FAILED",
    });
  }
});

router.use("/editions/image", createEditionImageRoutes(supabase));

// GET /api/editions — public, published editions only
router.get("/editions", async (req, res) => {
  try {
    // Retire the old public route for listing drafts.
    if (req.query.active !== undefined && req.query.active !== "true") {
      return res.status(400).json({
        error: "USE_AUTHENTICATED_EDITION_LIST",
        message: "Use GET /api/editions/mine to view your drafts.",
      });
    }

    const { data, error } = await supabase
      .from("editions")
      .select("*")
      .eq("is_active", true)
      .eq("chain_status", "initialized")
      .order("created_at", { ascending: true });

    if (error) throw error;

    return res.json((data || []).map(formatEditionImages));
  } catch (error) {
    console.error("Public edition list failed:", error.message);

    return res.status(500).json({
      error: "EDITIONS_FETCH_FAILED",
    });
  }
});

// GET /api/editions/mine — drafts and published editions
// belonging to brands managed by the authenticated user.
router.get(
  "/editions/mine",
  requireAuth,
  requireCurrentAccount,
  async (req, res) => {
    res.set("Cache-Control", "no-store");

    try {
      const requestedBrandId = req.query.brand_id;

      if (
        requestedBrandId !== undefined &&
        (typeof requestedBrandId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            requestedBrandId,
          ))
      ) {
        return res.status(400).json({
          error: "INVALID_BRAND_ID",
        });
      }

      const { data: memberships, error: membershipError } = await supabase
        .from("brand_memberships")
        .select("brand_id")
        .eq("user_id", req.auth.userId)
        .in("role", ["owner", "editor"]);

      if (membershipError) throw membershipError;

      const brandIds = (memberships || []).map(
        (membership) => membership.brand_id,
      );

      if (
        requestedBrandId &&
        !brandIds.includes(requestedBrandId.toLowerCase())
      ) {
        return res.status(403).json({
          error: "BRAND_ACCESS_DENIED",
        });
      }

      if (!brandIds.length) {
        return res.json([]);
      }

      const selectedBrands = requestedBrandId
        ? [requestedBrandId.toLowerCase()]
        : brandIds;

      const { data, error } = await supabase
        .from("editions")
        .select("*")
        .in("brand_id", selectedBrands)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return res.json((data || []).map(formatEditionImages));
    } catch (error) {
      console.error("Managed edition list failed:", error.message);

      return res.status(500).json({
        error: "EDITIONS_FETCH_FAILED",
      });
    }
  },
);

// GET /api/editions/:id — public, published edition only
router.get("/editions/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) ||
      Buffer.byteLength(id, "utf8") > 32
    ) {
      return res.status(400).json({
        error: "INVALID_EDITION_ID",
      });
    }

    const { data, error } = await supabase
      .from("editions")
      .select("*")
      .eq("id", id)
      .eq("is_active", true)
      .eq("chain_status", "initialized")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        error: "EDITION_NOT_FOUND",
      });
    }

    return res.json(formatEditionImages(data));
  } catch (error) {
    console.error("Public edition lookup failed:", error.message);

    return res.status(500).json({
      error: "EDITION_FETCH_FAILED",
    });
  }
});

// PATCH /api/editions/:id — edit an uninitialized draft
router.patch(
  "/editions/:id",
  requireAuth,
  requireCurrentAccount,
  async (req, res) => {
    res.set("Cache-Control", "no-store");

    try {
      const { id } = req.params;
      const body = req.body;

      if (
        !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) ||
        Buffer.byteLength(id, "utf8") > 32
      ) {
        return res.status(400).json({
          error: "INVALID_EDITION_ID",
        });
      }

      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length === 0
      ) {
        return res.status(400).json({
          error: "INVALID_EDITION_CHANGES",
        });
      }

      const textLimits = {
        name: 120,
        description: 10000,
        fabric: 500,
        headpiece: 500,
        embroidery: 500,
      };

      const allowedFields = new Set([
        ...Object.keys(textLimits),
        "price_usd",
        "max_supply",
      ]);

      const unsupportedFields = Object.keys(body).filter(
        (key) => !allowedFields.has(key),
      );

      if (unsupportedFields.length) {
        return res.status(400).json({
          error: "UNSUPPORTED_FIELDS",
          fields: unsupportedFields,
        });
      }

      const changes = {};

      for (const [field, limit] of Object.entries(textLimits)) {
        if (!Object.hasOwn(body, field)) continue;

        if (
          typeof body[field] !== "string" ||
          body[field].length > limit ||
          (field === "name" && !body[field].trim())
        ) {
          return res.status(400).json({
            error: "INVALID_FIELD",
            field,
          });
        }

        changes[field] = body[field].trim();
      }

      if (Object.hasOwn(body, "price_usd")) {
        const price = body.price_usd;
        const cents = Math.round(price * 100);

        if (
          typeof price !== "number" ||
          !Number.isFinite(price) ||
          price <= 0 ||
          price > 9999999999.99 ||
          Math.abs(price * 100 - cents) > 0.000001
        ) {
          return res.status(400).json({
            error: "INVALID_PRICE",
          });
        }

        changes.price_usd = cents / 100;
      }

      if (Object.hasOwn(body, "max_supply")) {
        if (
          !Number.isInteger(body.max_supply) ||
          body.max_supply < 1 ||
          body.max_supply > 2147483647
        ) {
          return res.status(400).json({
            error: "INVALID_MAX_SUPPLY",
          });
        }

        changes.max_supply = body.max_supply;
      }

      const { data, error } = await supabase.rpc("update_edition_draft", {
        p_edition_id: id,
        p_user_id: req.auth.userId,
        p_wallet_address: req.auth.walletAddress,
        p_changes: changes,
      });

      if (error) {
        const statusByError = {
          INVALID_OR_EXPIRED_SESSION: 401,
          EDITION_NOT_FOUND: 404,
          BRAND_ACCESS_DENIED: 403,
          EDITION_NOT_EDITABLE: 409,
          INVALID_EDITION_CHANGES: 400,
          UNSUPPORTED_FIELDS: 400,
        };

        if (error.code === "P0001" && statusByError[error.message]) {
          return res.status(statusByError[error.message]).json({
            error: error.message,
          });
        }

        throw error;
      }

      return res.json({
        edition: formatEditionImages(data),
      });
    } catch (error) {
      console.error("Edition draft update failed:", error.message);

      return res.status(500).json({
        error: "EDITION_UPDATE_FAILED",
      });
    }
  },
);

// // POST /api/editions/image — upload Base64 image
// router.post("/editions/image", async (req, res) => {
//   return res.status(503).json({
//     error: "EDITION_IMAGES_NOT_READY",
//     message: "Edition image management is being updated.",
//   });

//   try {
//     const { id, fileName, contentType, base64Data } = req.body;
//     if (!base64Data || !fileName || !id) {
//       return res
//         .status(400)
//         .json({ error: "Missing required image payload fields" });
//     }

//     // Convert Base64 back to binary buffer
//     // base64Data usually comes as "data:image/png;base64,iVBORw0KGgo..."
//     const base64String = base64Data.split(",")[1] || base64Data;
//     const buffer = Buffer.from(base64String, "base64");

//     const safeFileName = `${id}-${Date.now()}-${fileName}`;
//     const filePath = `collections/${safeFileName}`;

//     const { error: uploadError } = await supabase.storage
//       .from("collection-images")
//       .upload(filePath, buffer, {
//         contentType: contentType || "image/png",
//         cacheControl: "3600",
//         upsert: true,
//       });

//     if (uploadError) {
//       console.error("Upload image Supabase error:", uploadError.message);
//       return res.status(500).json({ error: uploadError.message });
//     }

//     const { data } = supabase.storage
//       .from("collection-images")
//       .getPublicUrl(filePath);

//     res.json({ publicUrl: data.publicUrl });
//   } catch (err) {
//     console.error("Error in POST /api/editions/image:", err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // DELETE /api/editions/image — delete image from storage
// router.delete("/editions/image", async (req, res) => {
//   try {
//     const { imageUrl } = req.body;
//     if (!imageUrl) {
//       return res.status(400).json({ error: "imageUrl is required" });
//     }

//     // Ignore placeholder
//     if (
//       !imageUrl.includes("supabase.co") &&
//       !imageUrl.includes("supabase.in")
//     ) {
//       return res.json({ success: true });
//     }

//     // Extract file path from public URL
//     const parts = imageUrl.split("/collection-images/");
//     if (parts.length < 2)
//       return res.status(400).json({ error: "Invalid Supabase URL format" });
//     const filePath = decodeURIComponent(parts[1]);

//     const { error } = await supabase.storage
//       .from("collection-images")
//       .remove([filePath]);

//     if (error) {
//       console.error("Delete image Supabase error:", error.message);
//       return res.status(500).json({ error: error.message });
//     }

//     res.json({ success: true });
//   } catch (err) {
//     console.error("Error in DELETE /api/editions/image:", err);
//     res.status(500).json({ error: err.message });
//   }
// });

// GET /api/proxy-image — Fetch image from Supabase privately
router.get("/proxy-image", async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl || !imageUrl.startsWith(process.env.SUPABASE_URL)) {
    return res.status(403).json({ error: "Forbidden or Invalid URL" });
  }

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    res.set(
      "Content-Type",
      response.headers.get("content-type") || "image/png",
    );
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Error in proxy-image:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Save or clear the authenticated user's optional notification email.
 * This stores contact information; it does not verify email ownership.
 */
router.post("/user/email", requireAuth, async (req, res) => {
  res.set("Cache-Control", "no-store");

  const suppliedEmail = req.body?.email;

  // Require an explicit string or null.
  if (suppliedEmail !== null && typeof suppliedEmail !== "string") {
    return res.status(400).json({ error: "INVALID_EMAIL" });
  }

  // Blank strings and null clear the email.
  const email = suppliedEmail === null ? null : suppliedEmail.trim() || null;

  // Apply basic format and length validation.
  if (
    email !== null &&
    (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  ) {
    return res.status(400).json({ error: "INVALID_EMAIL" });
  }

  try {
    // Identify the user exclusively from the verified token.
    const { data: user, error } = await supabase
      .from("users")
      .update({ email })
      .eq("id", req.auth.userId)
      .eq("wallet_address", req.auth.walletAddress)
      .select("id,wallet_address,email,auth_provider,created_at,last_login_at")
      .maybeSingle();

    if (error) {
      // Handle any retained legacy unique-email constraint.
      if (error.code === "23505") {
        return res.status(409).json({ error: "EMAIL_UNAVAILABLE" });
      }

      throw error;
    }

    if (!user) {
      return res.status(401).json({ error: "ACCOUNT_NOT_FOUND" });
    }

    return res.json({ user });
  } catch (error) {
    console.error("Save notification email failed:", error.message);

    return res.status(500).json({ error: "EMAIL_UPDATE_FAILED" });
  }
});

module.exports = router;
