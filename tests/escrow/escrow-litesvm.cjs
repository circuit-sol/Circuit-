"use strict";

// Executes the compiled escrow .so in a local simulated Solana bank. No RPCs,
// real wallets or network transactions. Clock changes exist ONLY in this test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const anchor = require("@coral-xyz/anchor");
const { LiteSVM, FailedTransactionMetadata } = require("litesvm");
const { Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram,
  ComputeBudgetProgram, Connection } = anchor.web3;
const root = path.resolve(__dirname, "../..");

const bn = (x) => new anchor.BN(String(x));
const bytes = (n, length = 16) => Array(length).fill(n);

async function main() {
  const platform = Keypair.generate(), admin = Keypair.generate(), outsider = Keypair.generate();
  const buyer = Keypair.generate(), buyer2 = Keypair.generate(), seller = Keypair.generate();
  const treasury = Keypair.generate();
  // Anchor is used ONLY to encode/decode ABI data, never to send an RPC request.
  const provider = new anchor.AnchorProvider(new Connection("http://127.0.0.1:8899"),
    new anchor.Wallet(outsider), {});
  const drops = new anchor.Program(JSON.parse(fs.readFileSync(path.join(root, "target/idl/circuit_drops.json"))), provider);
  const escrow = new anchor.Program(JSON.parse(fs.readFileSync(path.join(root, "target/idl/circuit_escrow.json"))), provider);
  const [config, configBump] = PublicKey.findProgramAddressSync([Buffer.from("circuit-config")], drops.programId);
  const OPEN = 1000, CLOSE = 1100, ADVANCE = CLOSE + 172800;
  const RELEASE = ADVANCE + 86400, BALANCE = RELEASE + 604800;
  const fixtures = [];
  async function account(address, name, values, owner = drops.programId) {
    fixtures.push({ address, info: { lamports: 10_000_000, data: await drops.coder.accounts.encode(name, values),
      owner, executable: false } });
  }
  await account(config, "circuitConfig", { version: 1, platformAuthority: platform.publicKey,
    adminAuthority: admin.publicKey, bump: configBump });
  const batches = [];
  for (let i = 1; i <= 4; i++) {
    const id = bytes(i);
    const [batch, bump] = PublicKey.findProgramAddressSync([Buffer.from("batch"), Buffer.from(id)], drops.programId);
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("batch-vault"), batch.toBuffer()], escrow.programId);
    await account(batch, "batchAccount", { version: 1, config, batchId: id, brandId: bytes(10),
      editionId: "circuit-demo-drop-001", sellerAuthority: seller.publicKey,
      sellerPaymentWallet: seller.publicKey, authorizedBy: platform.publicKey,
      sourceRevision: 2, pickupTermsHash: bytes(7, 32), opensAt: bn(OPEN), closesAt: bn(CLOSE),
      productionStartsAt: bn(ADVANCE), releaseAt: bn(RELEASE), advanceEligibleAt: bn(ADVANCE),
      balanceEligibleAt: bn(BALANCE), cancellationSeconds: bn(86400), advanceBps: 3000,
      createdAt: bn(900), bump }, i === 4 ? SystemProgram.programId : drops.programId);
    batches.push({ batch, vault });
  }
  for (const key of [platform, admin, outsider, buyer, buyer2, seller, treasury]) {
    fixtures.push({ address: key.publicKey, info: { lamports: 1_000_000_000,
      data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false } });
  }
  console.log("Loading escrow into LiteSVM...");
  const svm = new LiteSVM();
  svm.addProgramFromFile(escrow.programId, path.join(root, "target/deploy/circuit_escrow.so"));
  assert.ok(svm.getAccount(escrow.programId)?.executable, "Escrow program was not loaded");
  for (const fixture of fixtures) svm.setAccount(fixture.address, fixture.info);
  const payer = Keypair.generate();
  requireSuccess(svm.airdrop(payer.publicKey, 10_000_000_000n), "fund test payer");
  console.log(`Escrow loaded; ${fixtures.length} fixture accounts installed.`);
  let nonce = 0;
  async function clock(t) {
    const c = svm.getClock();
    c.unixTimestamp = BigInt(t);
    svm.setClock(c);
  }
  async function sendIx(ix, signers = []) {
    const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: svm.latestBlockhash() });
    // Unique message for repeated failed/boundary instructions at the same blockhash.
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: ++nonce }), ix);
    const unique = new Map([payer, ...signers].map((k) => [k.publicKey.toBase58(), k]));
    tx.sign(...unique.values());
    requireSuccess(svm.sendTransaction(tx), "escrow transaction");
  }
  function instruction(name, args, accounts) {
    const def = escrow.idl.instructions.find((i) => i.name === name);
    assert.ok(def, `IDL missing ${name}; rebuild both IDLs`);
    return new TransactionInstruction({ programId: escrow.programId,
      data: escrow.coder.instruction.encode(name, args),
      keys: def.accounts.map((a) => {
        assert.ok(accounts[a.name], `Missing ${name}.${a.name}`);
        return { pubkey: accounts[a.name], isSigner: !!a.signer, isWritable: !!a.writable };
      }) });
  }
  const call = (name, args, accounts, signers = []) => sendIx(instruction(name, args, accounts), signers);
  const read = async (name, address) => {
    const info = svm.getAccount(address);
    assert.ok(info, `Missing account ${address.toBase58()}`);
    return escrow.coder.accounts.decode(name, Buffer.from(info.data));
  };
  const balance = (address) => {
    const amount = svm.getBalance(address);
    assert.notEqual(amount, null, `Missing balance ${address.toBase58()}`);
    return amount;
  };
  const [a, b, c, forged] = batches;
  const realBatches = [a, b, c];
  const reasonHash = bytes(9, 32);
  const adminAccounts = (v, who = admin) => ({ adminAuthority: who.publicKey, config, vault: v.vault });
  const claimAccounts = (v, recipient = seller.publicKey) => ({ caller: outsider.publicKey, vault: v.vault, recipient });
  const freeze = (v, frozen, seq, who = admin) => call("setFrozen",
    { frozen, expectedSequence: bn(seq), reasonHash }, adminAccounts(v, who), [who]);
  const redirect = (v, amount, seq, recipient = treasury.publicKey) => call("adminRedirect",
    { amount: bn(amount), expectedSequence: bn(seq), reasonHash },
    { ...adminAccounts(v), recipient }, [admin]);
  const orderAddress = (v, id) => PublicKey.findProgramAddressSync(
    [Buffer.from("order"), v.vault.toBuffer(), Buffer.from(id)], escrow.programId)[0];
  function buy(v, n, amount, who = buyer, signer = platform, expiry = CLOSE) {
    const id = bytes(n); const order = orderAddress(v, id);
    return { order, run: () => call("purchase", { args: { orderId: id, pickupLocationId: bytes(8),
      amountLamports: bn(amount), quantity: 1, quoteExpiresAt: bn(expiry) } },
    { buyer: who.publicKey, platformAuthority: signer.publicKey, config, vault: v.vault,
      order, systemProgram: SystemProgram.programId }, [who, signer]) };
  }
  const cancel = (v, order, who = buyer) => call("cancelOrder", {},
    { buyer: who.publicKey, vault: v.vault, order }, [who]);
  const refund = (v, order, recipient, amount, seq) => call("adminRefund",
    { amount: bn(amount), expectedSequence: bn(seq), reasonHash },
    { ...adminAccounts(v), order, recipient }, [admin]);

  await clock(900);
  await rejectsTransaction(() => call("initializeVault", {}, { payer: payer.publicKey,
    config, batch: forged.batch, vault: forged.vault, systemProgram: SystemProgram.programId }));
  for (const v of realBatches) await call("initializeVault", {}, { payer: payer.publicKey,
    config, batch: v.batch, vault: v.vault, systemProgram: SystemProgram.programId });
  await rejectsTransaction(() => buy(a, 1, 1000).run());
  await clock(OPEN);
  await rejectsTransaction(() => buy(a, 1, 1000, buyer, outsider).run());
  await rejectsTransaction(() => buy(a, 1, 1000, buyer, platform, OPEN).run());
  const a1 = buy(a, 1, 1000); await a1.run();
  await rejectsTransaction(() => a1.run()); // duplicate order, not duplicate transaction
  const b1 = buy(b, 1, 500); await b1.run();
  const b2 = buy(b, 2, 500, buyer2); await b2.run();
  const c1 = buy(c, 1, 1000); await c1.run();
  await clock(CLOSE - 1);
  const a2 = buy(a, 2, 1000); await a2.run(); // repeat buyer, different order ID
  assert.equal((await read("orderReceipt", a2.order)).cancelUntil.toNumber(), CLOSE - 1 + 86400);
  await clock(CLOSE);
  await rejectsTransaction(() => buy(a, 3, 1000).run());
  console.log("PASS: sale and quote boundaries, platform authorization, unique orders");

  await rejectsTransaction(() => freeze(a, true, 0, outsider));
  await freeze(a, true, 0);
  await rejectsTransaction(() => redirect(a, 1, 1)); // before close+48h
  await rejectsTransaction(() => cancel(a, a2.order, buyer2));
  await rejectsTransaction(() => cancel(b, a2.order)); // wrong batch
  const beforeCancel = await balance(buyer.publicKey);
  await cancel(a, a2.order);
  assert.equal(await balance(buyer.publicKey), beforeCancel + 1000n);
  await rejectsTransaction(() => cancel(a, a2.order));
  await freeze(a, false, 1);
  await clock(OPEN + 86400);
  await rejectsTransaction(() => cancel(a, a1.order)); // exactly 24h
  console.log("PASS: late cancellation after closing, even frozen; no double/foreign cancellation");

  await clock(ADVANCE - 1);
  await rejectsTransaction(() => call("claimAdvance", {}, claimAccounts(a), [outsider]));
  await clock(ADVANCE);
  await rejectsTransaction(() => call("claimAdvance", {}, claimAccounts(a, treasury.publicKey), [outsider]));
  const beforeSeller = await balance(seller.publicKey);
  for (const v of realBatches) await call("claimAdvance", {}, claimAccounts(v), [outsider]);
  assert.equal(await balance(seller.publicKey), beforeSeller + 900n);
  await rejectsTransaction(() => call("claimAdvance", {}, claimAccounts(a), [outsider]));
  console.log("PASS: 30% only after deadline, cancelled purchases excluded, fixed seller recipient");

  await clock(RELEASE);
  await freeze(b, true, 0);
  await freeze(c, true, 0);
  await rejectsTransaction(() => refund(b, b1.order, treasury.publicKey, 500, 1));
  await rejectsTransaction(() => refund(b, b1.order, buyer.publicKey, 501, 1));
  const buyerBeforeRefund = await balance(buyer.publicKey);
  await refund(b, b1.order, buyer.publicKey, 500, 1);
  assert.equal(await balance(buyer.publicKey), buyerBeforeRefund + 500n);
  await rejectsTransaction(() => refund(b, b1.order, buyer.publicKey, 1, 2));
  await rejectsTransaction(() => refund(b, b2.order, buyer2.publicKey, 500, 2)); // only 200 left
  await call("topUp", { amount: bn(300) }, { contributor: admin.publicKey,
    vault: b.vault, systemProgram: SystemProgram.programId }, [admin]);
  await refund(b, b2.order, buyer2.publicKey, 500, 2);
  assert.equal((await read("batchVault", b.vault)).totalAdminRefunded.toNumber(), 1000);
  console.log("PASS: full buyer refunds from pooled remainder, bounded by purchase and available funds; topup");

  const treasuryBefore = await balance(treasury.publicKey);
  await rejectsTransaction(() => redirect(c, 701, 1));
  await rejectsTransaction(() => redirect(c, 100, 1, c.vault));
  await redirect(c, 100, 1);
  assert.equal(await balance(treasury.publicKey), treasuryBefore + 100n);
  await rejectsTransaction(() => redirect(c, 100, 1)); // stale decision sequence
  await call("adminPaySeller", { amount: bn(200), expectedSequence: bn(2), reasonHash },
    { ...adminAccounts(c), recipient: seller.publicKey }, [admin]);
  await freeze(c, false, 3);
  await clock(BALANCE);
  await rejectsTransaction(() => call("claimBalance", {}, claimAccounts(c), [outsider])); // manual mode persists
  await freeze(c, true, 4);
  await redirect(c, 400, 5);
  assert.equal((await read("orderReceipt", c1.order)).refundedLamports.toNumber(), 0);
  assert.equal((await read("batchVault", c.vault)).totalRedirected.toNumber(), 500);
  console.log("PASS: arbitrary treasury transfer, partial seller payout, replay protection, no false buyer refund");

  // Explicitly exercise one second before and at the final deadline.
  await clock(BALANCE - 1);
  await rejectsTransaction(() => call("claimBalance", {}, claimAccounts(a), [outsider]));
  await sendIx(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: a.vault, lamports: 777 }), [admin]);
  await call("syncSurplus", {}, { caller: outsider.publicKey, vault: a.vault }, [outsider]);
  assert.equal((await read("batchVault", a.vault)).totalTopups.toNumber(), 777);
  await clock(BALANCE);
  const beforeFinal = await balance(seller.publicKey);
  await call("claimBalance", {}, claimAccounts(a), [outsider]);
  assert.equal(await balance(seller.publicKey), beforeFinal + 700n);
  await rejectsTransaction(() => call("claimBalance", {}, claimAccounts(a), [outsider]));
  await rejectsTransaction(() => call("claimBalance", {}, claimAccounts(b), [outsider]));
  console.log("PASS: final 70% deadline, no repeat payout, donated SOL not treated as sales");

  for (const v of realBatches) {
    const info = svm.getAccount(v.vault);
    const state = await read("batchVault", v.vault);
    const available = BigInt(state.totalDeposited.toString()) + BigInt(state.totalTopups.toString())
      - BigInt(state.totalCancelled.toString()) - BigInt(state.totalAdminRefunded.toString())
      - BigInt(state.totalSellerPaid.toString()) - BigInt(state.totalRedirected.toString());
    assert.equal(BigInt(info.lamports) - svm.minimumBalanceForRentExemption(BigInt(info.data.length)), available);
  }
  console.log("PASS: actual lamports reconcile with every vault ledger, with rent preserved");
  console.log("Escrow SBF simulation suite complete. Drops authorization bootstrap and Devnet still require separate checks.");
}
class SimulatedTransactionFailure extends Error {}
async function rejectsTransaction(action) {
  // A JavaScript encoding/setup error must never count as a rejected contract instruction.
  await assert.rejects(action, error => error instanceof SimulatedTransactionFailure);
}
function requireSuccess(result, label) {
  if (result instanceof FailedTransactionMetadata) {
    throw new SimulatedTransactionFailure(`${label} failed: ${result.toString()}\n${result.meta().logs().join("\n")}`);
  }
  assert.ok(result, `${label}: missing transaction result`);
  return result;
}

function runtimeSmoke() {
  const svm = new LiteSVM();
  const payer = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  requireSuccess(svm.airdrop(payer.publicKey, 2_000_000_000n), "airdrop");
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: svm.latestBlockhash() });
  tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: 1_000_000 }));
  tx.sign(payer);
  requireSuccess(svm.sendTransaction(tx), "smoke transfer");
  assert.equal(svm.getBalance(recipient), 1_000_000n);
  const c = svm.getClock();
  c.unixTimestamp = 1234n;
  svm.setClock(c);
  assert.equal(svm.getClock().unixTimestamp, 1234n);
  assert.ok(svm.minimumBalanceForRentExemption(0n) > 0n);
  console.log("PASS: LiteSVM native runtime, signed transfer, balances, clock and rent.");
}

Promise.resolve().then(() => process.argv.includes("--runtime-smoke") ? runtimeSmoke() : main())
  .catch((error) => { console.error(error); process.exitCode = 1; });
