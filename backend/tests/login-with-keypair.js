"use strict";

const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({
  path: path.join(__dirname, "../.env"),
});

const { Keypair } = require("@solana/web3.js");
const nacl = require("tweetnacl");
const bs58Module = require("bs58");
const bs58 = bs58Module.default || bs58Module;

async function main() {
  const baseUrl = process.env.TEST_BACKEND_URL?.trim().replace(/\/+$/, "");

  const expectedWallet = process.env.TEST_WALLET_ADDRESS?.trim();
  const keypairPath = process.env.TEST_WALLET_KEYPAIR_PATH?.trim();

  if (!baseUrl || !expectedWallet || !keypairPath) {
    throw new Error(
      "Set TEST_BACKEND_URL, TEST_WALLET_ADDRESS and " +
        "TEST_WALLET_KEYPAIR_PATH in backend/.env",
    );
  }

  // Relative paths are resolved from the backend folder.
  const absolutePath = path.resolve(__dirname, "..", keypairPath);
  const secret = JSON.parse(fs.readFileSync(absolutePath, "utf8"));

  if (
    !Array.isArray(secret) ||
    secret.length !== 64 ||
    !secret.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  ) {
    throw new Error("Expected a Solana keypair JSON array of 64 bytes.");
  }

  const wallet = Keypair.fromSecretKey(Uint8Array.from(secret));
  const walletAddress = wallet.publicKey.toBase58();

  if (walletAddress !== expectedWallet) {
    throw new Error(`Wrong keypair: the file belongs to ${walletAddress}`);
  }

  async function post(route, body) {
    const response = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${route}: HTTP ${response.status}, non-JSON response`);
    }

    if (!response.ok) {
      throw new Error(
        `${route}: HTTP ${response.status} — ` +
          `${data.error || "Request failed"}`,
      );
    }

    return data;
  }

  // Request a fresh, single-use challenge.
  const challenge = await post("/api/auth/challenge", {
    walletAddress,
  });

  if (
    challenge.walletAddress !== walletAddress ||
    typeof challenge.message !== "string" ||
    typeof challenge.nonce !== "string"
  ) {
    throw new Error("Invalid challenge response.");
  }

  // Sign locally. The private key is never sent to the API.
  const signature = bs58.encode(
    nacl.sign.detached(
      Buffer.from(challenge.message, "utf8"),
      wallet.secretKey,
    ),
  );

  const session = await post("/api/auth/verify", {
    walletAddress,
    nonce: challenge.nonce,
    signature,
  });

  if (!session.token || !session.user) {
    throw new Error("Login response is missing token or user.");
  }

  console.log("Backend:", baseUrl);
  console.log("User:", session.user.id);
  console.log("Wallet:", session.user.wallet_address);
  console.log("Expires in:", session.expiresIn, "seconds");
  console.log("\nBearer token:\n" + session.token);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
