"use strict";

// Run via Anchor's test script on a fresh LOCAL upgradeable validator deployment.
// This script cannot deploy programs and refuses non-local RPC endpoints.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { randomUUID } = require("node:crypto");
const { uuidBytes, batchWireFields } = require("./batch-wire.cjs");
// const backendRequire = createRequire(path.resolve(__dirname, "../backend/package.json"));
// const anchor = backendRequire("@coral-xyz/anchor");
const testRequire = createRequire(
  path.resolve(__dirname, "../tests/escrow/package.json"),
);
const anchor = testRequire("@coral-xyz/anchor");
const { Keypair, PublicKey, SystemProgram } = anchor.web3;

async function main() {
  const rpc = process.env.ANCHOR_PROVIDER_URL;
  assert.ok(
    rpc,
    "Run through anchor test so ANCHOR_PROVIDER_URL and ANCHOR_WALLET are set",
  );
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(rpc).hostname),
    "Local validator only",
  );
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const idl = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../target/idl/circuit_drops.json"),
      "utf8",
    ),
  );
  const program = new anchor.Program(idl, provider);
  assert.notEqual(
    program.programId.toBase58(),
    "3i1KUa7S1FjRx34SzqRAKAYsp3S8AJkCB3x7odjua7kL",
    "Rotate the POC program identity and rebuild the IDL before testing",
  );
  const platform = Keypair.generate();
  const admin = Keypair.generate();
  const seller = Keypair.generate();
  const outsider = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("circuit-config")],
    program.programId,
  );
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const [programData] = PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    loader,
  );
  assert.equal(
    await provider.connection.getAccountInfo(config),
    null,
    "Use a fresh local test ledger",
  );

  // Only provider spends local faucet SOL; generated test keys stay in memory.
  for (const key of [platform, admin, seller, outsider]) {
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: key.publicKey,
        lamports: 1_000_000_000,
      }),
    );
    await provider.sendAndConfirm(tx);
  }
  const initAccounts = {
    upgradeAuthority: provider.wallet.publicKey,
    platformAuthority: platform.publicKey,
    adminAuthority: admin.publicKey,
    program: program.programId,
    programData,
    config,
    systemProgram: SystemProgram.programId,
  };
  const rejectCode = (operation, code) =>
    assert.rejects(
      operation,
      (error) => error.error?.errorCode?.code === code,
      `Expected Anchor error ${code}`,
    );

  await rejectCode(
    () =>
      program.methods
        .initializeConfig()
        .accountsStrict({
          ...initAccounts,
          upgradeAuthority: outsider.publicKey,
        })
        .signers([platform, admin, outsider])
        .rpc(),
    "UnauthorizedUpgradeAuthority",
  );
  assert.equal(await provider.connection.getAccountInfo(config), null);
  await program.methods
    .initializeConfig()
    .accountsStrict(initAccounts)
    .signers([platform, admin])
    .rpc();
  const storedConfig = await program.account.circuitConfig.fetch(config);
  assert.equal(
    storedConfig.adminAuthority.toBase58(),
    admin.publicKey.toBase58(),
  );
  console.log(
    "PASS: only the deployed program's upgrade authority can bootstrap config",
  );

  function freshArgs() {
    const start = Math.floor(Date.now() / 1000) + 3600;
    const iso = (seconds) => new Date(seconds * 1000).toISOString();
    const batch = {
      id: randomUUID(),
      edition_id: "circuit-demo-drop-001",
      revision: 2,
      opens_at: iso(start),
      closes_at: iso(start + 3600),
      production_starts_at: iso(start + 3600 + 172800),
      release_at: iso(start + 3600 + 172800 + 86400),
      pickup_locations: [
        {
          id: randomUUID(),
          name: "Test pickup",
          address: "Test studio",
          instructions: "",
        },
      ],
    };
    const fields = batchWireFields(
      batch,
      "5d916a05-e74c-4261-8734-3e04c0a66c28",
    );
    return {
      ...fields,
      sellerPaymentWallet: recipient,
      opensAt: new anchor.BN(fields.opensAt),
      closesAt: new anchor.BN(fields.closesAt),
      productionStartsAt: new anchor.BN(fields.productionStartsAt),
      releaseAt: new anchor.BN(fields.releaseAt),
    };
  }
  function batchAddress(args) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("batch"), Buffer.from(args.batchId)],
      program.programId,
    )[0];
  }
  function create(args, signingPlatform = platform, includeSeller = true) {
    return program.methods
      .initializeBatch(args)
      .accountsStrict({
        sellerAuthority: seller.publicKey,
        platformAuthority: signingPlatform.publicKey,
        config,
        batch: batchAddress(args),
        systemProgram: SystemProgram.programId,
      })
      .signers(includeSeller ? [seller, signingPlatform] : [signingPlatform])
      .rpc();
  }
  let args = freshArgs();
  await rejectCode(() => create(args, outsider), "UnauthorizedPlatform");
  assert.equal(
    await provider.connection.getAccountInfo(batchAddress(args)),
    null,
  );
  await assert.rejects(() => create(args, platform, false));
  assert.equal(
    await provider.connection.getAccountInfo(batchAddress(args)),
    null,
  );
  console.log(
    "PASS: wrong Circuit signer and missing seller signature rejected",
  );

  args = freshArgs();
  args.productionStartsAt = args.productionStartsAt.subn(1);
  await rejectCode(() => create(args), "ProductionTooEarly");
  assert.equal(
    await provider.connection.getAccountInfo(batchAddress(args)),
    null,
  );
  args = freshArgs();
  args.opensAt = new anchor.BN(0);
  await rejectCode(() => create(args), "OpeningMustBeFuture");
  args = freshArgs();
  args.pickupTermsHash = Array(32).fill(0);
  await rejectCode(() => create(args), "InvalidPickupTerms");
  args = freshArgs();
  args.sellerPaymentWallet = batchAddress(args);
  await rejectCode(() => create(args), "InvalidPaymentWallet");
  console.log("PASS: invalid schedule, terms and payment recipient rejected");

  args = freshArgs();
  await create(args);
  const address = batchAddress(args);
  const stored = await program.account.batchAccount.fetch(address);
  assert.equal(stored.sellerAuthority.toBase58(), seller.publicKey.toBase58());
  assert.equal(stored.sellerPaymentWallet.toBase58(), recipient.toBase58());
  assert.equal(stored.authorizedBy.toBase58(), platform.publicKey.toBase58());
  assert.equal(stored.sourceRevision, 2);
  assert.equal(stored.advanceBps, 3000);
  assert.equal(stored.cancellationSeconds.toNumber(), 86400);
  assert.equal(
    stored.advanceEligibleAt.toString(),
    args.closesAt.addn(172800).toString(),
  );
  assert.equal(
    stored.balanceEligibleAt.toString(),
    args.releaseAt.addn(604800).toString(),
  );
  assert.deepEqual(Array.from(stored.pickupTermsHash), args.pickupTermsHash);
  assert.deepEqual(
    Array.from(stored.brandId),
    Array.from(uuidBytes("5d916a05-e74c-4261-8734-3e04c0a66c28")),
  );
  await assert.rejects(() => create(args));
  console.log("PASS: exact stored terms and duplicate batch rejection");

  const replacementPlatform = outsider;
  await rejectCode(
    () =>
      program.methods
        .setPlatformAuthority()
        .accountsStrict({
          adminAuthority: seller.publicKey,
          newPlatformAuthority: replacementPlatform.publicKey,
          config,
        })
        .signers([seller, replacementPlatform])
        .rpc(),
    "UnauthorizedAdmin",
  );
  await program.methods
    .setPlatformAuthority()
    .accountsStrict({
      adminAuthority: admin.publicKey,
      newPlatformAuthority: replacementPlatform.publicKey,
      config,
    })
    .signers([admin, replacementPlatform])
    .rpc();
  await rejectCode(() => create(freshArgs(), platform), "UnauthorizedPlatform");
  await create(freshArgs(), replacementPlatform);
  await program.methods
    .transferAdminAuthority()
    .accountsStrict({
      adminAuthority: admin.publicKey,
      newAdminAuthority: seller.publicKey,
      config,
    })
    .signers([admin, seller])
    .rpc();
  await rejectCode(
    () =>
      program.methods
        .setPlatformAuthority()
        .accountsStrict({
          adminAuthority: admin.publicKey,
          newPlatformAuthority: platform.publicKey,
          config,
        })
        .signers([admin, platform])
        .rpc(),
    "UnauthorizedAdmin",
  );
  const unchanged = await program.account.batchAccount.fetch(address);
  assert.equal(
    unchanged.authorizedBy.toBase58(),
    stored.authorizedBy.toBase58(),
  );
  assert.equal(
    unchanged.sellerPaymentWallet.toBase58(),
    stored.sellerPaymentWallet.toBase58(),
  );
  console.log(
    "PASS: authority changes invalidate old authority without rewriting old batch terms",
  );
  console.log(
    "All phase-one validator checks passed. No escrow/payment behavior tested in this phase.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
