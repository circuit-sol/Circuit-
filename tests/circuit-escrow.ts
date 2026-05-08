import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { assert } from "chai";

// ─── Program ID ───────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey(
  "8b866KXrU94jAEuZYNr8WTkuXJELPvu6eW1v89pSAUrN"
);

// ─── Manually crafted IDL (Anchor 0.30.x spec 0.1.0) ─────────────────────────
// Discriminators pre-computed: sha256("global:<name>")[0..8]  /  sha256("account:<Name>")[0..8]

const IDL = {
  address: "8b866KXrU94jAEuZYNr8WTkuXJELPvu6eW1v89pSAUrN",
  metadata: { name: "circuit_escrow", version: "0.1.0", spec: "0.1.0" },
  instructions: [
    {
      name: "initialize_escrow",
      discriminator: [243, 160, 77, 153, 11, 92, 48, 209],
      accounts: [
        { name: "buyer",          writable: true,  signer: true  },
        { name: "designer"                                        },
        { name: "escrow_account", writable: true,
          pda: { seeds: [
            { kind: "const",   value: [101, 115, 99, 114, 111, 119] }, // b"escrow"
            { kind: "arg",     path: "drop_id" },
            { kind: "account", path: "buyer"   },
          ]},
        },
        { name: "system_program", address: "11111111111111111111111111111111" },
      ],
      args: [
        { name: "drop_id", type: "string" },
        { name: "amount",  type: "u64"    },
      ],
    },
    {
      name: "confirm_delivery",
      discriminator: [11, 109, 227, 53, 179, 190, 88, 155],
      accounts: [
        { name: "buyer",          writable: true,  signer: true },
        { name: "designer",       writable: true                },
        { name: "escrow_account", writable: true               },
      ],
      args: [],
    },
  ],
  accounts: [
    { name: "EscrowAccount", discriminator: [36, 69, 48, 18, 128, 225, 125, 135] },
  ],
  types: [
    {
      name: "EscrowAccount",
      type: {
        kind: "struct",
        fields: [
          { name: "buyer",     type: "pubkey" },
          { name: "designer",  type: "pubkey" },
          { name: "amount",    type: "u64"    },
          { name: "drop_id",   type: "string" },
          { name: "delivered", type: "bool"   },
          { name: "bump",      type: "u8"     },
        ],
      },
    },
  ],
  errors: [
    { code: 6000, name: "AlreadyDelivered",  msg: "Escrow has already been marked as delivered"         },
    { code: 6001, name: "UnauthorizedBuyer", msg: "Only the original buyer can confirm delivery"        },
    { code: 6002, name: "InvalidDesigner",   msg: "Designer account does not match the escrow record"  },
    { code: 6003, name: "InvalidAmount",     msg: "Escrow amount must be greater than zero"            },
    { code: 6004, name: "InvalidDropId",     msg: "Drop ID cannot be empty"                            },
    { code: 6005, name: "DropIdTooLong",     msg: "Drop ID exceeds the maximum length of 64 characters"},
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function confirmTx(
  connection: anchor.web3.Connection,
  sig: string
): Promise<void> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
}

/** Try devnet airdrop up to `retries` times, then fall back to a transfer from
 *  the provider wallet so a flaky faucet never aborts the suite. */
async function fundAccount(
  provider: anchor.AnchorProvider,
  address: PublicKey,
  lamports: number,
  retries = 3
): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const sig = await provider.connection.requestAirdrop(address, lamports);
      await confirmTx(provider.connection, sig);
      console.log(`  Airdrop succeeded on attempt ${attempt + 1}`);
      return;
    } catch {
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
      }
    }
  }
  // All airdrop attempts exhausted — draw from provider wallet (has SOL)
  console.log("  Airdrop failed; transferring from provider wallet...");
  const tx = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey:   address,
      lamports,
    })
  );
  await provider.sendAndConfirm(tx);
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("circuit-escrow", () => {
  // anchor test --provider.cluster devnet sets ANCHOR_PROVIDER_URL + ANCHOR_WALLET
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Typed as any — IDL is hand-crafted; avoids "type instantiation excessively deep" from generic inference
  const program: any = new anchor.Program(IDL as any, provider);

  // Fresh keypairs for every test run — no shared state with mainnet / localnet
  const buyer    = Keypair.generate();
  const designer = Keypair.generate();

  const DROP_ID       = "DROP001";
  const ESCROW_AMOUNT = new anchor.BN(0.1 * LAMPORTS_PER_SOL); // 100_000_000 lamports

  // Derive PDA using same seeds as the on-chain program:
  // seeds = [b"escrow", drop_id.as_bytes(), buyer.key().as_ref()]
  const [escrowPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"),
      Buffer.from(DROP_ID),
      buyer.publicKey.toBuffer(),
    ],
    PROGRAM_ID
  );

  // ── Setup ─────────────────────────────────────────────────────────────────

  before("fund buyer with 2 SOL (airdrop with provider-wallet fallback)", async () => {
    console.log(`\n  Buyer:      ${buyer.publicKey.toBase58()}`);
    console.log(`  Designer:   ${designer.publicKey.toBase58()}`);
    console.log(`  Escrow PDA: ${escrowPda.toBase58()}\n`);

    await fundAccount(provider, buyer.publicKey, 2 * LAMPORTS_PER_SOL);

    const balance = await provider.connection.getBalance(
      buyer.publicKey,
      "confirmed"
    );
    console.log(`  Buyer balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    assert.isAtLeast(balance, LAMPORTS_PER_SOL, "buyer underfunded");
  });

  // ── Test 1: initialize_escrow ─────────────────────────────────────────────

  it("initialises escrow: PDA created and holds ≥ 0.1 SOL", async () => {
    const tx = await program.methods
      .initializeEscrow(DROP_ID, ESCROW_AMOUNT)
      .accounts({
        buyer:         buyer.publicKey,
        designer:      designer.publicKey,
        escrowAccount: escrowPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc({ commitment: "confirmed" });

    console.log(`  initializeEscrow tx: ${tx}`);

    // ── Verify on-chain account fields ───────────────────────────────────
    const escrow = await (program.account as any).escrowAccount.fetch(
      escrowPda,
      "confirmed"
    );

    assert.equal(
      escrow.buyer.toBase58(),
      buyer.publicKey.toBase58(),
      "escrow.buyer mismatch"
    );
    assert.equal(
      escrow.designer.toBase58(),
      designer.publicKey.toBase58(),
      "escrow.designer mismatch"
    );
    assert.isTrue(
      escrow.amount.eq(ESCROW_AMOUNT),
      `escrow.amount should be ${ESCROW_AMOUNT.toString()}, got ${escrow.amount.toString()}`
    );
    assert.equal(escrow.dropId, DROP_ID, "escrow.dropId mismatch");
    assert.isFalse(escrow.delivered, "delivered should be false at init");

    // ── Verify PDA balance includes the escrowed funds ───────────────────
    const pdaBalance = await provider.connection.getBalance(
      escrowPda,
      "confirmed"
    );
    assert.isAtLeast(
      pdaBalance,
      ESCROW_AMOUNT.toNumber(),
      `PDA should hold ≥ ${ESCROW_AMOUNT.toNumber()} lamports (0.1 SOL)`
    );
    console.log(
      `  PDA balance: ${pdaBalance / LAMPORTS_PER_SOL} SOL  (${pdaBalance} lamports)`
    );
  });

  // ── Test 2: confirm_delivery ─────────────────────────────────────────────

  it("confirms delivery: designer receives exactly 0.1 SOL and delivered = true", async () => {
    const designerBefore = await provider.connection.getBalance(
      designer.publicKey,
      "confirmed"
    );

    const tx = await program.methods
      .confirmDelivery()
      .accounts({
        buyer:         buyer.publicKey,
        designer:      designer.publicKey,
        escrowAccount: escrowPda,
      })
      .signers([buyer])
      .rpc({ commitment: "confirmed" });

    console.log(`  confirmDelivery tx: ${tx}`);

    // ── Verify escrow marked delivered ───────────────────────────────────
    const escrow = await (program.account as any).escrowAccount.fetch(
      escrowPda,
      "confirmed"
    );
    assert.isTrue(escrow.delivered, "delivered should be true after confirm");

    // ── Verify designer received exactly the escrowed amount ─────────────
    const designerAfter = await provider.connection.getBalance(
      designer.publicKey,
      "confirmed"
    );
    const received = designerAfter - designerBefore;

    assert.equal(
      received,
      ESCROW_AMOUNT.toNumber(),
      `designer should receive exactly ${ESCROW_AMOUNT.toNumber()} lamports, got ${received}`
    );
    console.log(`  Designer received: ${received / LAMPORTS_PER_SOL} SOL  ✓`);
  });

  // ── Test 3: guard — double delivery rejected ──────────────────────────────

  it("rejects second confirm_delivery with AlreadyDelivered (6000)", async () => {
    let threw = false;
    try {
      await program.methods
        .confirmDelivery()
        .accounts({
          buyer:         buyer.publicKey,
          designer:      designer.publicKey,
          escrowAccount: escrowPda,
        })
        .signers([buyer])
        .rpc();
    } catch (err: any) {
      threw = true;
      const msg: string = err.toString();
      const isExpected =
        msg.includes("AlreadyDelivered") ||
        msg.includes("6000")             ||
        (err.error && err.error.errorCode && err.error.errorCode.number === 6000);
      assert.isTrue(
        isExpected,
        `expected AlreadyDelivered (6000), got: ${msg}`
      );
      console.log("  Correctly rejected: AlreadyDelivered  ✓");
    }
    assert.isTrue(threw, "second confirmDelivery should have thrown");
  });
});
