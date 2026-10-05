"use strict";

// Devnet only. The deployer also acts as the test seller/buyer and fee payer.
// Does not write Supabase, modify config, or change payout policy.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const req = createRequire(path.join(root, "tests/escrow/package.json"));
const anchor = req("@coral-xyz/anchor");
const { Keypair, PublicKey, Connection, SystemProgram, SYSVAR_CLOCK_PUBKEY } = anchor.web3;
const { uuidBytes, batchWireFields } = require("./batch-wire.cjs");
const bn = value => new anchor.BN(String(value));
const AMOUNT = 1_000_000; // 0.001 Devnet SOL, refunded on cancellation (rent/fees remain).
const DROPS = "G4JKqCUDcfFSyQ6t2EpuCUoNtN9JwZGW3vMySnnWaFtj";
const ESCROW = "AWraC1ZQVWzjfRfzYB87U9nvEHYnowXrYTjZrdLVuDg9";
const KEYDIR = path.join(os.homedir(), ".config/solana/circuit-v2/devnet");
const statePath = path.join(KEYDIR, "devnet-smoke-state.json");

async function main() {
  assert.ok(process.argv.includes("--execute"), "Run with --execute to send Devnet transactions");
  function key(name, expected) {
    const k = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
      fs.readFileSync(path.join(KEYDIR, name), "utf8"))));
    assert.equal(k.publicKey.toBase58(), expected, `Wrong ${name}`);
    return k;
  }
  const payer = key("deployer.json", "3DFFrxUK94XUHPjb1L8fNyoBSWodn2dMwA8rFw4yB5Ej");
  const platform = key("operational.json", "AymxnQbp1FKzAAXScXZwpJiF1UjYKRaRivh3N4txpfBW");
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer),
    { commitment: "confirmed", preflightCommitment: "confirmed" });
  function program(name, expected) {
    const idl = JSON.parse(fs.readFileSync(path.join(root, `target/idl/${name}.json`), "utf8"));
    assert.equal(idl.address, expected, `Rebuild ${name} IDL with the current program ID`);
    return new anchor.Program(idl, provider);
  }
  const drops = program("circuit_drops", DROPS);
  const escrow = program("circuit_escrow", ESCROW);
  for (const p of [drops, escrow]) {
    assert.ok((await connection.getAccountInfo(p.programId))?.executable, "Program is not executable");
  }
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("circuit-config")], drops.programId);
  const cfg = await drops.account.circuitConfig.fetch(config);
  assert.equal(cfg.platformAuthority.toBase58(), platform.publicKey.toBase58());
  assert.equal(cfg.adminAuthority.toBase58(), "DYLNrA1tX1UXcxWrWJ3djMDvXqU7sTZXRY1p96hASc5w");
  async function now() {
    const clock = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    assert.ok(clock && clock.data.length >= 40, "Cannot read Devnet clock");
    return Number(clock.data.readBigInt64LE(32));
  }
  let state = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, "utf8"))
    : { network: "devnet", drops: DROPS, escrow: ESCROW, batchId: randomUUID(),
        brandId: randomUUID(), orderId: randomUUID(), pickupId: randomUUID(), transactions: {} };
  assert.equal(state.network, "devnet");
  assert.equal(state.drops, DROPS);
  assert.equal(state.escrow, ESCROW);
  const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  const [batch] = PublicKey.findProgramAddressSync(
    [Buffer.from("batch"), uuidBytes(state.batchId)], drops.programId);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("batch-vault"), batch.toBuffer()], escrow.programId);
  const [order] = PublicKey.findProgramAddressSync(
    [Buffer.from("order"), vault.toBuffer(), uuidBytes(state.orderId)], escrow.programId);
  save(); // Preserve public IDs before sending, so reruns inspect the same accounts.
  async function send(label, builder) {
    const signature = await builder.rpc();
    state.transactions[label] = signature;
    save();
    console.log(`${label}: ${signature}`);
  }
  let storedBatch = await drops.account.batchAccount.fetchNullable(batch);
  if (!storedBatch) {
    const opens = await now() + 30;
    const closes = opens + 3600;
    const iso = t => new Date(t * 1000).toISOString();
    state.terms = {
      id: state.batchId, edition_id: "devnet-smoke-test", revision: 1,
      opens_at: iso(opens), closes_at: iso(closes),
      production_starts_at: iso(closes + 172800), release_at: iso(closes + 259200),
      pickup_locations: [{ id: state.pickupId, name: "Devnet test pickup",
        address: "Test fixture only", instructions: "Not a real product" }],
    };
    save();
    const args = batchWireFields(state.terms, state.brandId);
    for (const field of ["opensAt", "closesAt", "productionStartsAt", "releaseAt"]) args[field] = bn(args[field]);
    args.sellerPaymentWallet = payer.publicKey;
    await send("initializeBatch", drops.methods.initializeBatch(args).accountsStrict({
      sellerAuthority: payer.publicKey, platformAuthority: platform.publicKey,
      config, batch, systemProgram: SystemProgram.programId,
    }).signers([platform]));
    storedBatch = await drops.account.batchAccount.fetch(batch);
  }
  assert.equal(storedBatch.sellerAuthority.toBase58(), payer.publicKey.toBase58());
  assert.equal(storedBatch.sellerPaymentWallet.toBase58(), payer.publicKey.toBase58());
  assert.equal(storedBatch.config.toBase58(), config.toBase58());
  assert.equal(storedBatch.editionId, "devnet-smoke-test");
  if (!await escrow.account.batchVault.fetchNullable(vault)) {
    await send("initializeVault", escrow.methods.initializeVault().accountsStrict({
      payer: payer.publicKey, config, batch, vault, systemProgram: SystemProgram.programId,
    }));
  }
  console.log("PASS: batch and escrow vault exist on Devnet.");
  let receipt = await escrow.account.orderReceipt.fetchNullable(order);
  if (!receipt) {
    console.log("Waiting for the batch opening time (usually under 30 seconds)...");
    const stop = Date.now() + 120000;
    while (await now() < storedBatch.opensAt.toNumber()) {
      assert.ok(Date.now() < stop, "Opening wait timed out; rerun this same command");
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    const current = await now();
    assert.ok(current < storedBatch.closesAt.toNumber(),
      "Test batch has closed. Keep the state file and report this output before creating another test.");
    await send("purchase", escrow.methods.purchase({
      orderId: Array.from(uuidBytes(state.orderId)), pickupLocationId: Array.from(uuidBytes(state.pickupId)),
      amountLamports: bn(AMOUNT), quantity: 1,
      quoteExpiresAt: bn(Math.min(current + 300, storedBatch.closesAt.toNumber())),
    }).accountsStrict({ buyer: payer.publicKey, platformAuthority: platform.publicKey,
      config, vault, order, systemProgram: SystemProgram.programId }).signers([platform]));
    receipt = await escrow.account.orderReceipt.fetch(order);
  }
  assert.equal(receipt.buyer.toBase58(), payer.publicKey.toBase58());
  assert.equal(receipt.vault.toBase58(), vault.toBase58());
  assert.equal(receipt.amountPaid.toNumber(), AMOUNT);
  assert.equal(receipt.cancelUntil.sub(receipt.purchasedAt).toNumber(), 86400);
  console.log("PASS: 0.001 SOL purchase and full 24-hour cancellation window.");
  if (!receipt.cancelled) {
    assert.ok(await now() < receipt.cancelUntil.toNumber(), "Cancellation window has elapsed");
    await send("cancelOrder", escrow.methods.cancelOrder().accountsStrict({
      buyer: payer.publicKey, vault, order,
    }));
  }
  receipt = await escrow.account.orderReceipt.fetch(order);
  const vaultInfo = await connection.getAccountInfo(vault);
  const ledger = escrow.coder.accounts.decode("batchVault", vaultInfo.data);
  assert.equal(receipt.cancelled, true);
  assert.equal(receipt.refundedLamports.toNumber(), AMOUNT);
  assert.equal(ledger.totalDeposited.toNumber(), AMOUNT);
  assert.equal(ledger.totalCancelled.toNumber(), AMOUNT);
  for (const field of ["totalTopups", "totalAdminRefunded", "totalSellerPaid", "totalRedirected"]) {
    assert.equal(ledger[field].toNumber(), 0);
  }
  const rent = await connection.getMinimumBalanceForRentExemption(vaultInfo.data.length);
  assert.equal(vaultInfo.lamports, rent, "Vault should retain rent only after full cancellation");
  console.log("PASS: full cancellation refund; vault ledger reconciles and rent is preserved.");
  console.log("Batch:", batch.toBase58());
  console.log("Vault:", vault.toBase58());
  console.log("Order:", order.toBase58());
  console.log("Public test state:", statePath);
  console.log("Devnet smoke test complete. Backend integration and timed payouts are not tested here.");
}

main().catch(error => {
  console.error(error.message);
  if (error.logs) console.error(error.logs.join("\n"));
  console.error("State is preserved. Rerun the same command after resolving the error; do not delete the state file.");
  process.exitCode = 1;
});
