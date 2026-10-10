"use strict";

const express = require("express");
const { randomBytes, randomUUID } = require("node:crypto");
const { PublicKey } = require("@solana/web3.js");
const { createClient } = require("@supabase/supabase-js");
const nacl = require("tweetnacl");
const bs58Module = require("bs58");
const { issueSession, requireAuth } = require("./sessionAuth");

// Support both CommonJS and default-export versions of bs58.
const bs58 = bs58Module.default || bs58Module;
const router = express.Router();

// This server-only client can access the protected challenge table.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

// Identify the application requesting the signature.
if (!process.env.AUTH_APP_ORIGIN) {
  throw new Error("AUTH_APP_ORIGIN is not set");
}

const appOrigin = new URL(process.env.AUTH_APP_ORIGIN).origin;
const appHost = new URL(appOrigin).host;

// TODO: Confirm unused
// Only accept UUID v4 IDs, matching randomUUID() below.
// const UUID_V4 =
//   /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Authentication responses must not be cached.
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// TODO: Check this persists
// Exclude the legacy private_key column from responses.
const USER_FIELDS =
  "id,wallet_address,email,auth_provider,created_at,last_login_at";

/**
 * POST /api/auth/[challenge, nonce]
 * Body: { walletAddress }
 *
 * Creates a temporary login request. It does NOT log the user in.
 * The frontend passes the returned message unchanged to Phantom.
 */
router.post(["/nonce", "/challenge"], async (req, res) => {
  const suppliedAddress = req.body?.walletAddress;
  let walletAddress;

  try {
    // Reject missing, incorrectly typed, or oversized addresses.
    if (
      typeof suppliedAddress !== "string" ||
      suppliedAddress.length < 32 ||
      suppliedAddress.length > 44
    ) {
      throw new Error("Invalid address");
    }

    const publicKey = new PublicKey(suppliedAddress);

    // This login flow requires a key capable of Ed25519 signing.
    // Program-derived addresses cannot sign login messages.
    if (!PublicKey.isOnCurve(publicKey.toBytes())) {
      throw new Error("Wallet must support signing");
    }

    walletAddress = publicKey.toBase58();
  } catch {
    return res.status(400).json({
      error: "INVALID_WALLET_ADDRESS",
    });
  }

  // Generate a unique request ID and cryptographically random nonce.
  const challengeId = randomUUID();
  const nonce = randomBytes(32).toString("hex");
  const issuedAt = new Date();

  // Five minutes to complete this login attempt, not session duration.
  const expiresAt = new Date(issuedAt.getTime() + 5 * 60 * 1000);

  // Preserve the existing message format for this implementation step.
  // This is a custom signMessage payload, not a transaction.
  const message = [
    `${appHost} wants you to sign in with your Solana account:`,
    walletAddress,
    "",
    "Sign in to Circuit. This does not authorize a transaction.",
    "",
    `URI: ${appOrigin}`,
    "Version: 1",
    "Chain ID: solana:devnet",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
    `Request ID: ${challengeId}`,
  ].join("\n");

  try {
    // Store the exact message so verification never trusts
    // a client-supplied replacement message or wallet address.
    const { error } = await supabase.from("wallet_auth_challenges").insert({
      id: challengeId,
      nonce,
      wallet_address: walletAddress,
      message,
      expires_at: expiresAt.toISOString(),
    });

    if (error) throw error;

    return res.status(201).json({
      challengeId,
      nonce,
      walletAddress,
      message,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    // Log diagnostic information locally, not credentials or tokens.
    console.error("Create wallet challenge failed:", error.message || error);

    return res.status(500).json({
      error: "CHALLENGE_CREATION_FAILED",
      details: error.message || String(error),
    });
  }
});

/**
 * Verify the signature of the complete message returned by /nonce.
 * Body: { walletAddress, signature, nonce }
 */
router.post("/verify", async (req, res) => {
  const { walletAddress, signature, nonce } = req.body || {};

  // Validate the agreed frontend payload.
  if (
    typeof walletAddress !== "string" ||
    walletAddress.length < 32 ||
    walletAddress.length > 44 ||
    typeof nonce !== "string" ||
    !/^[0-9a-f]{64}$/.test(nonce) ||
    typeof signature !== "string" ||
    signature.length < 64 ||
    signature.length > 88
  ) {
    return res.status(400).json({
      error: "INVALID_VERIFICATION_REQUEST",
    });
  }

  let publicKey;
  let signatureBytes;

  try {
    // Decode the address and Base58 signature.
    publicKey = new PublicKey(walletAddress);
    signatureBytes = bs58.decode(signature);

    if (
      !PublicKey.isOnCurve(publicKey.toBytes()) ||
      signatureBytes.length !== nacl.sign.signatureLength
    ) {
      throw new Error("Invalid key or signature");
    }
  } catch {
    return res.status(400).json({
      error: "INVALID_KEY_OR_SIGNATURE_ENCODING",
    });
  }

  try {
    // Retrieve the challenge associated with this nonce and wallet.
    const { data: challenge, error: fetchError } = await supabase
      .from("wallet_auth_challenges")
      .select("id,wallet_address,message,expires_at,consumed_at")
      .eq("nonce", nonce)
      .eq("wallet_address", publicKey.toBase58())
      .maybeSingle();

    if (fetchError) throw fetchError;

    // Reject expired, missing, or already-used challenges.
    if (
      !challenge ||
      challenge.consumed_at !== null ||
      Date.parse(challenge.expires_at) <= Date.now()
    ) {
      return res.status(401).json({
        error: "INVALID_OR_EXPIRED_CHALLENGE",
      });
    }

    // Verify the exact message stored by our backend.
    const validSignature = nacl.sign.detached.verify(
      Buffer.from(challenge.message, "utf8"),
      signatureBytes,
      publicKey.toBytes(),
    );

    if (!validSignature) {
      return res.status(401).json({
        error: "INVALID_SIGNATURE",
      });
    }

    // SQL 002 created this function. It consumes the challenge
    // and creates/updates the user within one transaction.
    const { data: user, error: loginError } = await supabase
      .rpc("complete_wallet_login", {
        p_challenge_id: challenge.id,
        p_wallet_address: challenge.wallet_address,
      })
      .select(USER_FIELDS)
      .maybeSingle();

    if (loginError) throw loginError;

    // Another request could have consumed the challenge first.
    if (!user) {
      return res.status(401).json({
        error: "INVALID_OR_EXPIRED_CHALLENGE",
      });
    }

    // Issue a token tied to the saved account.
    const session = issueSession(user);

    return res.status(200).json({
      ...session,
      user,
    });
  } catch (error) {
    console.error("Wallet verification failed:", error.message);

    return res.status(500).json({
      error: "VERIFICATION_FAILED",
    });
  }
});

// Return the saved account associated with the verified token.
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from("users")
      .select(USER_FIELDS)
      .eq("id", req.auth.userId)
      .eq("wallet_address", req.auth.walletAddress)
      .maybeSingle();

    if (error) throw error;

    if (!user) {
      return res.status(401).json({
        error: "ACCOUNT_NOT_FOUND",
      });
    }

    return res.json({ user });
  } catch (error) {
    console.error("Read current user failed:", error.message);

    return res.status(500).json({
      error: "USER_LOOKUP_FAILED",
    });
  }
});

module.exports = router;
