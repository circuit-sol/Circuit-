"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const anchor = require("@coral-xyz/anchor");
const bs58 = require("bs58").default || require("bs58");
const {
  PublicKey,
  Keypair,
  Connection,
  Transaction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} = anchor.web3;
const { uuidBytes, batchWireFields } = require("./batch-wire.cjs");
const IDS = Object.freeze({
  drops: "G4JKqCUDcfFSyQ6t2EpuCUoNtN9JwZGW3vMySnnWaFtj",
  escrow: "AWraC1ZQVWzjfRfzYB87U9nvEHYnowXrYTjZrdLVuDg9",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(code, status = 409) {
  const e = new Error(code);
  e.status = status;
  throw e;
}
function ensure(ok, code, status) {
  if (!ok) fail(code, status);
}
function pub(value) {
  try {
    return new PublicKey(value);
  } catch {
    fail("INVALID_WALLET", 400);
  }
}
function uuid(value) {
  ensure(
    typeof value === "string" &&
      UUID.test(value) &&
      !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value),
    "INVALID_ID",
    400,
  );
  return value.toLowerCase();
}
function amount(value) {
  ensure(
    typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value),
    "INVALID_LAMPORTS",
    400,
  );
  ensure(
    BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER),
    "AMOUNT_TOO_LARGE",
    400,
  );
  return value;
}
function pricing(body) {
  const unit = amount(body.unit_price_lamports);
  const sizes = body.prices_by_size_lamports ?? {};
  ensure(
    sizes &&
      typeof sizes === "object" &&
      !Array.isArray(sizes) &&
      Object.keys(sizes).length <= 30,
    "INVALID_SIZE_PRICES",
    400,
  );
  const clean = {};
  for (const k of Object.keys(sizes).sort()) {
    ensure(
      /^[A-Za-z0-9 _-]{1,32}$/.test(k) && k === k.trim(),
      "INVALID_SIZE",
      400,
    );
    Object.defineProperty(clean, k, {
      value: amount(sizes[k]),
      enumerable: true,
    });
  }
  return { unit_price_lamports: unit, prices_by_size_lamports: clean };
}
function total(prices, size, quantity) {
  ensure(
    Number.isInteger(quantity) && quantity >= 1 && quantity <= 100,
    "INVALID_QUANTITY",
    400,
  );
  const sizes = prices.prices_by_size_lamports;
  if (Object.keys(sizes).length)
    ensure(
      typeof size === "string" && Object.hasOwn(sizes, size),
      "INVALID_SIZE",
      400,
    );
  else
    ensure(
      size === null ||
        size === undefined ||
        /^[A-Za-z0-9 _-]{1,32}$/.test(size),
      "INVALID_SIZE",
      400,
    );
  return amount(
    (
      BigInt(
        Object.keys(sizes).length ? sizes[size] : prices.unit_price_lamports,
      ) * BigInt(quantity)
    ).toString(),
  );
}
function exactBody(body, allowed) {
  ensure(
    body && typeof body === "object" && !Array.isArray(body),
    "INVALID_BODY",
    400,
  );
  ensure(
    Object.keys(body).every((k) => allowed.includes(k)),
    "UNSUPPORTED_FIELDS",
    400,
  );
}
const bn = (x) => new anchor.BN(String(x));
const iso = (x) => new Date(Number(x.toString()) * 1000).toISOString();
function json(value) {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}
function verifiedMessage(result, base64) {
  ensure(result, "TRANSACTION_NOT_FINALIZED", 202);
  ensure(result.meta && result.meta.err === null, "TRANSACTION_FAILED", 409);
  ensure(
    result.version === undefined || result.version === "legacy",
    "UNEXPECTED_TRANSACTION_VERSION",
    400,
  );
  ensure(
    Buffer.from(result.transaction.message.serialize()).toString("base64") ===
      base64,
    "TRANSACTION_MISMATCH",
    400,
  );
}
class ChainService {
  constructor(env = process.env) {
    ensure(env.CLUSTER === "devnet", "CHAIN_REQUIRES_DEVNET", 503);
    ensure(
      env.DROPS_PROGRAM_ID === IDS.drops &&
        env.ESCROW_PROGRAM_ID === IDS.escrow,
      "PROGRAM_ID_MISMATCH",
      503,
    );
    let bytes;
    try {
      bytes = JSON.parse(env.CIRCUIT_OPERATIONAL_SECRET_KEY);
    } catch {
      fail("OPERATIONAL_KEY_MUST_BE_JSON_ARRAY", 503);
    }
    ensure(
      Array.isArray(bytes) &&
        bytes.length === 64 &&
        bytes.every((v) => Number.isInteger(v) && v >= 0 && v <= 255),
      "INVALID_OPERATIONAL_KEY",
      503,
    );
    this.signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
    this.connection = new Connection(
      env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
      "finalized",
    );
    // Only internally constructed initialize/purchase messages use this signer.
    const provider = new anchor.AnchorProvider(
      this.connection,
      new anchor.Wallet(this.signer),
      { commitment: "finalized", preflightCommitment: "confirmed" },
    );
    for (const [name, id] of Object.entries(IDS)) {
      const idl = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, `../../idl/circuit_${name}.json`),
          "utf8",
        ),
      );
      ensure(idl.address === id, "IDL_ADDRESS_MISMATCH", 503);
      this[name] = new anchor.Program(idl, provider);
    }
    this.config = PublicKey.findProgramAddressSync(
      [Buffer.from("circuit-config")],
      this.drops.programId,
    )[0];
  }
  async network() {
    // Exact genesis prevents accidentally using a mainnet/custom RPC with devnet IDs.
    ensure(
      (await this.connection.getGenesisHash()) ===
        "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
      "RPC_IS_NOT_DEVNET",
      503,
    );
  }
  async readiness() {
    await this.network();
    for (const p of [this.drops, this.escrow])
      ensure(
        (await this.connection.getAccountInfo(p.programId))?.executable,
        "PROGRAM_NOT_DEPLOYED",
        503,
      );
    const cfg = await this.read(this.drops, "circuitConfig", this.config);
    ensure(
      cfg.data.platformAuthority.equals(this.signer.publicKey),
      "OPERATIONAL_AUTHORITY_MISMATCH",
      503,
    );
    ensure(cfg.data.version === 1, "CONFIG_VERSION_MISMATCH", 503);
    return {
      network: "devnet",
      drops_program_id: IDS.drops,
      escrow_program_id: IDS.escrow,
      config_address: this.config.toBase58(),
      operational_wallet: this.signer.publicKey.toBase58(),
      admin_wallet: cfg.data.adminAuthority.toBase58(),
    };
  }
  addresses(batchId, orderId) {
    const batch = PublicKey.findProgramAddressSync(
      [Buffer.from("batch"), uuidBytes(batchId)],
      this.drops.programId,
    )[0];
    const vault = PublicKey.findProgramAddressSync(
      [Buffer.from("batch-vault"), batch.toBuffer()],
      this.escrow.programId,
    )[0];
    const order = orderId
      ? PublicKey.findProgramAddressSync(
          [Buffer.from("order"), vault.toBuffer(), uuidBytes(orderId)],
          this.escrow.programId,
        )[0]
      : null;
    return { batch, vault, order };
  }
  async read(program, name, address, minContextSlot) {
    const result = await this.connection.getAccountInfoAndContext(address, {
      commitment: "finalized",
      ...(minContextSlot ? { minContextSlot } : {}),
    });
    ensure(result.value, "CHAIN_ACCOUNT_NOT_FINALIZED", 202);
    ensure(
      result.value.owner.equals(program.programId),
      "CHAIN_ACCOUNT_OWNER_MISMATCH",
    );
    return {
      data: program.coder.accounts.decode(name, result.value.data),
      slot: result.context.slot,
      info: result.value,
    };
  }
  async clock() {
    const c = await this.connection.getAccountInfo(
      SYSVAR_CLOCK_PUBKEY,
      "confirmed",
    );
    ensure(c && c.data.length >= 40, "CHAIN_CLOCK_UNAVAILABLE", 503);
    return Number(c.data.readBigInt64LE(32));
  }
  batchArgs(row) {
    const wire = batchWireFields(row, row.chain_terms.brand_id);
    for (const k of ["opensAt", "closesAt", "productionStartsAt", "releaseAt"])
      wire[k] = bn(wire[k]);
    return {
      ...wire,
      sellerPaymentWallet: pub(row.chain_terms.payment_wallet),
    };
  }
  async initialize(row) {
    const a = this.addresses(row.id);
    const first = await this.drops.methods
      .initializeBatch(this.batchArgs(row))
      .accountsStrict({
        sellerAuthority: pub(row.chain_terms.seller_wallet),
        platformAuthority: this.signer.publicKey,
        config: this.config,
        batch: a.batch,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const second = await this.escrow.methods
      .initializeVault()
      .accountsStrict({
        payer: pub(row.chain_terms.seller_wallet),
        config: this.config,
        batch: a.batch,
        vault: a.vault,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return [first, second]; // Atomic: no batch exists without its vault from this flow.
  }
  async validateBatch(row, minSlot) {
    const a = this.addresses(row.id),
      expected = this.batchArgs(row);
    const stored = (
      await this.read(this.drops, "batchAccount", a.batch, minSlot)
    ).data;
    for (const key of ["batchId", "brandId", "pickupTermsHash"])
      ensure(
        Buffer.from(stored[key]).equals(Buffer.from(expected[key])),
        "CHAIN_BATCH_TERMS_MISMATCH",
      );
    for (const key of [
      "opensAt",
      "closesAt",
      "productionStartsAt",
      "releaseAt",
    ])
      ensure(stored[key].eq(expected[key]), "CHAIN_BATCH_TERMS_MISMATCH");
    ensure(
      stored.editionId === expected.editionId &&
        stored.sourceRevision === expected.sourceRevision &&
        stored.version === 1,
      "CHAIN_BATCH_TERMS_MISMATCH",
    );
    ensure(
      stored.config.equals(this.config) &&
        stored.sellerAuthority.equals(pub(row.chain_terms.seller_wallet)) &&
        stored.sellerPaymentWallet.equals(expected.sellerPaymentWallet),
      "CHAIN_BATCH_TERMS_MISMATCH",
    );
    ensure(
      stored.cancellationSeconds.eq(bn(86400)) && stored.advanceBps === 3000,
      "CHAIN_POLICY_MISMATCH",
    );
    const vault = (await this.read(this.escrow, "batchVault", a.vault, minSlot))
      .data;
    ensure(
      vault.batch.equals(a.batch) &&
        vault.config.equals(this.config) &&
        vault.sellerPaymentWallet.equals(expected.sellerPaymentWallet),
      "CHAIN_VAULT_MISMATCH",
    );
    return { addresses: a, stored, vault };
  }
  async purchase(row, wallet, orderId, choice) {
    const { addresses: a, vault } = await this.validateBatch(row);
    const now = await this.clock();
    ensure(!vault.frozen && !vault.manualSettlement, "BATCH_UNAVAILABLE");
    ensure(
      now >= vault.opensAt.toNumber() && now < vault.closesAt.toNumber(),
      "BATCH_NOT_OPEN",
    );
    ensure(
      row.pickup_locations.some(
        (l) => l.id.toLowerCase() === choice.pickup_location_id,
      ),
      "INVALID_PICKUP_LOCATION",
      400,
    );
    const lamports = total(
      row.chain_terms.pricing,
      choice.size,
      choice.quantity,
    );
    const expires = Math.min(now + 120, vault.closesAt.toNumber());
    const order = this.addresses(row.id, orderId).order;
    const ix = await this.escrow.methods
      .purchase({
        orderId: Array.from(uuidBytes(orderId)),
        pickupLocationId: Array.from(uuidBytes(choice.pickup_location_id)),
        amountLamports: bn(lamports),
        quantity: choice.quantity,
        quoteExpiresAt: bn(expires),
      })
      .accountsStrict({
        buyer: pub(wallet),
        platformAuthority: this.signer.publicKey,
        config: this.config,
        vault: a.vault,
        order,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return {
      ix,
      expected: {
        ...choice,
        amount_lamports: lamports,
        quote_expires_at: expires,
        order_address: order.toBase58(),
        vault_address: a.vault.toBase58(),
      },
    };
  }
  async receipt(batchId, orderId, minSlot) {
    return this.read(
      this.escrow,
      "orderReceipt",
      this.addresses(batchId, orderId).order,
      minSlot,
    );
  }
  async envelope(wallet, instructions, cosign = false) {
    const latest = await this.connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({
      feePayer: pub(wallet),
      recentBlockhash: latest.blockhash,
    });
    tx.add(...instructions);
    if (cosign) tx.partialSign(this.signer);
    return {
      message_base64: tx.serializeMessage().toString("base64"),
      transaction_base64: tx
        .serialize({ requireAllSignatures: false, verifySignatures: true })
        .toString("base64"),
      last_valid_block_height: latest.lastValidBlockHeight,
    };
  }
  async verify(intent, signature) {
    ensure(
      typeof signature === "string" &&
        signature.length >= 64 &&
        signature.length <= 88,
      "INVALID_SIGNATURE",
      400,
    );
    let decoded;
    try {
      decoded = bs58.decode(signature);
    } catch {
      fail("INVALID_SIGNATURE", 400);
    }
    ensure(decoded.length === 64, "INVALID_SIGNATURE", 400);
    const result = await this.connection.getTransaction(signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    verifiedMessage(result, intent.message_base64);
    return result;
  }
  async recoverSignature(intent) {
    if (intent.signature) return intent.signature;
    const a = this.addresses(intent.batch_id, intent.order_id);
    const address =
      intent.kind === "initialize"
        ? a.batch
        : intent.order_id
          ? a.order
          : a.vault;
    const signatures = await this.connection.getSignaturesForAddress(
      address,
      { limit: 30 },
      "finalized",
    );
    for (const entry of signatures) {
      if (entry.err) continue;
      const tx = await this.connection.getTransaction(entry.signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      });
      if (
        tx &&
        Buffer.from(tx.transaction.message.serialize()).toString("base64") ===
          intent.message_base64
      ) {
        verifiedMessage(tx, intent.message_base64);
        return entry.signature;
      }
    }
    fail("TRANSACTION_NOT_FINALIZED", 202);
  }
  async submit(intent, base64) {
    ensure(
      typeof base64 === "string" && base64.length <= 20000,
      "INVALID_TRANSACTION",
      400,
    );
    let tx;
    try {
      tx = Transaction.from(Buffer.from(base64, "base64"));
    } catch {
      fail("INVALID_TRANSACTION", 400);
    }
    ensure(
      tx.serializeMessage().toString("base64") === intent.message_base64,
      "TRANSACTION_MISMATCH",
      400,
    );
    ensure(tx.verifySignatures(), "MISSING_OR_INVALID_SIGNATURE", 400);
    return this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
  }
  async simple(row, wallet, kind, input = {}) {
    const { addresses: a, vault } = await this.validateBatch(row);
    const who = pub(wallet),
      accounts = { vault: a.vault };
    let builder;
    if (kind === "cancel")
      builder = this.escrow.methods
        .cancelOrder()
        .accountsStrict({
          ...accounts,
          buyer: who,
          order: this.addresses(row.id, input.order_id).order,
        });
    else if (kind === "advance" || kind === "balance")
      builder = this.escrow.methods[
        kind === "advance" ? "claimAdvance" : "claimBalance"
      ]().accountsStrict({
        ...accounts,
        caller: who,
        recipient: vault.sellerPaymentWallet,
      });
    else if (kind === "topup")
      builder = this.escrow.methods
        .topUp(bn(amount(input.amount_lamports)))
        .accountsStrict({
          ...accounts,
          contributor: who,
          systemProgram: SystemProgram.programId,
        });
    else {
      const cfg = (await this.read(this.drops, "circuitConfig", this.config))
        .data;
      ensure(cfg.adminAuthority.equals(who), "ADMIN_ACCESS_DENIED", 403);
      ensure(
        typeof input.reason === "string" &&
          input.reason.trim().length >= 3 &&
          input.reason.length <= 2000,
        "REASON_REQUIRED",
        400,
      );
      const hash = Array.from(
        crypto
          .createHash("sha256")
          .update(input.reason.trim(), "utf8")
          .digest(),
      );
      const seq = vault.adminSequence;
      const adminAccounts = {
        ...accounts,
        adminAuthority: who,
        config: this.config,
      };
      if (kind === "freeze" || kind === "unfreeze")
        builder = this.escrow.methods
          .setFrozen(kind === "freeze", seq, hash)
          .accountsStrict(adminAccounts);
      else {
        const value = bn(amount(input.amount_lamports));
        if (kind === "refund") {
          const receipt = (await this.receipt(row.id, input.order_id)).data;
          builder = this.escrow.methods
            .adminRefund(value, seq, hash)
            .accountsStrict({
              ...adminAccounts,
              order: this.addresses(row.id, input.order_id).order,
              recipient: receipt.buyer,
            });
        } else if (kind === "seller_payment")
          builder = this.escrow.methods
            .adminPaySeller(value, seq, hash)
            .accountsStrict({
              ...adminAccounts,
              recipient: vault.sellerPaymentWallet,
            });
        else if (kind === "redirect")
          builder = this.escrow.methods
            .adminRedirect(value, seq, hash)
            .accountsStrict({
              ...adminAccounts,
              recipient: pub(input.recipient),
            });
        else fail("INVALID_ACTION", 400);
      }
    }
    return builder.instruction();
  }
}
module.exports = {
  ChainService,
  IDS,
  ensure,
  fail,
  uuid,
  pub,
  amount,
  pricing,
  total,
  exactBody,
  bn,
  iso,
  json,
  verifiedMessage,
};
