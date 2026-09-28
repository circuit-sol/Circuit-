"use strict";

const express = require("express");
const { randomBytes, randomUUID } = require("node:crypto");
const { PublicKey } = require("@solana/web3.js");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

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

if (!process.env.AUTH_APP_ORIGIN) {
  throw new Error("AUTH_APP_ORIGIN is not set");
}

const appOrigin = new URL(process.env.AUTH_APP_ORIGIN).origin;
const appHost = new URL(appOrigin).host;

router.post("/challenge", async (req, res) => {
  res.set("Cache-Control", "no-store");

  const suppliedAddress = req.body?.walletAddress;
  let walletAddress;

  try {
    if (
      typeof suppliedAddress !== "string" ||
      suppliedAddress.length < 32 ||
      suppliedAddress.length > 44
    ) {
      throw new Error("Invalid address");
    }

    const publicKey = new PublicKey(suppliedAddress);

    if (!PublicKey.isOnCurve(publicKey.toBytes())) {
      throw new Error("Wallet must support signing");
    }

    walletAddress = publicKey.toBase58();
  } catch {
    return res.status(400).json({
      error: "INVALID_WALLET_ADDRESS",
    });
  }

  const challengeId = randomUUID();
  const nonce = randomBytes(32).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 5 * 60 * 1000);

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
    const { error } = await supabase.from("wallet_auth_challenges").insert({
      id: challengeId,
      wallet_address: walletAddress,
      message,
      expires_at: expiresAt.toISOString(),
    });

    if (error) throw error;

    return res.status(201).json({
      challengeId,
      walletAddress,
      message,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("Create wallet challenge failed:", error.message);

    return res.status(500).json({
      error: "CHALLENGE_CREATION_FAILED",
    });
  }
});

module.exports = router;
