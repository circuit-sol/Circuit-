"use strict";

// Load the wallet and signature utilities.
const { Keypair } = require("@solana/web3.js");
const nacl = require("tweetnacl");
const bs58Module = require("bs58");
const bs58 = bs58Module.default || bs58Module;

// Match this to your running backend's port.
const BACKEND_URL = "http://localhost:3001";

async function main() {
  // Generate a disposable wallet used only for this test.
  // No funds are needed, and its private key is never printed or saved.
  const testWallet = Keypair.generate();
  const walletAddress = testWallet.publicKey.toBase58();

  // Request a fresh challenge for THIS wallet.
  // A challenge for your personal wallet would not match this key.
  const response = await fetch(`${BACKEND_URL}/api/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress }),
  });

  const challenge = await response.json();

  // Stop if the backend could not create the challenge.
  if (!response.ok) {
    throw new Error(
      `Challenge failed (${response.status}): ${JSON.stringify(challenge)}`,
    );
  }

  // Sign the exact message returned by the backend.
  const signatureBytes = nacl.sign.detached(
    Buffer.from(challenge.message, "utf8"),
    testWallet.secretKey,
  );

  // // Encode the signature as Base58 for our /verify endpoint.
  // const body = {
  //   challengeId: challenge.challengeId,
  //   signature: bs58.encode(signatureBytes),
  // };

  // Match the updated /verify request format.
  const body = {
    walletAddress,
    nonce: challenge.nonce,
    signature: bs58.encode(signatureBytes),
  };

  // Copy the printed JSON into Postman's raw JSON request body.
  console.log(JSON.stringify(body, null, 2));
}

// Report errors and exit unsuccessfully if the test setup fails.
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
