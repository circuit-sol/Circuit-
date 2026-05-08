import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

// ─── Program ID ───────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey(
  "3i1KUa7S1FjRx34SzqRAKAYsp3S8AJkCB3x7odjua7kL"
);

// ─── Manually crafted IDL (Anchor 0.30.x spec 0.1.0) ─────────────────────────
// Discriminators: sha256("global:<name>")[0..8]  /  sha256("account:<Name>")[0..8]

const IDL = {
  address: "3i1KUa7S1FjRx34SzqRAKAYsp3S8AJkCB3x7odjua7kL",
  metadata: { name: "circuit_drops", version: "0.1.0", spec: "0.1.0" },
  instructions: [
    {
      name: "create_drop",
      discriminator: [157, 142, 145, 247, 92, 73, 59, 48],
      accounts: [
        { name: "designer",     writable: true, signer: true },
        {
          name: "drop_account", writable: true,
          pda: { seeds: [
            { kind: "const", value: [100, 114, 111, 112] }, // b"drop"
            { kind: "arg",   path: "drop_id" },
          ]},
        },
        { name: "system_program", address: "11111111111111111111111111111111" },
      ],
      args: [
        { name: "drop_id",    type: "string" },
        { name: "max_supply", type: "u64"    },
      ],
    },
    {
      name: "register_order",
      discriminator: [92, 37, 29, 46, 77, 250, 219, 6],
      accounts: [
        { name: "authority",   signer: true  },
        { name: "drop_account", writable: true },
      ],
      args: [],
    },
  ],
  accounts: [
    { name: "DropAccount", discriminator: [173, 242, 121, 245, 229, 150, 14, 87] },
  ],
  types: [
    {
      name: "DropAccount",
      type: {
        kind: "struct",
        fields: [
          { name: "designer",       type: "pubkey" },
          { name: "max_supply",     type: "u64"    },
          { name: "current_count",  type: "u64"    },
          { name: "drop_id",        type: "string" },
          { name: "active",         type: "bool"   },
          { name: "bump",           type: "u8"     },
        ],
      },
    },
  ],
  errors: [
    { code: 6000, name: "DropSoldOut",      msg: "Drop has reached maximum supply"                },
    { code: 6001, name: "DropNotActive",    msg: "Drop is not currently active"                   },
    { code: 6002, name: "InvalidDropId",    msg: "Drop ID cannot be empty"                        },
    { code: 6003, name: "DropIdTooLong",    msg: "Drop ID exceeds the maximum length of 64 characters" },
    { code: 6004, name: "InvalidMaxSupply", msg: "Max supply must be greater than zero"           },
  ],
};

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("circuit-drops", () => {
  // anchor test --provider.cluster devnet sets ANCHOR_PROVIDER_URL + ANCHOR_WALLET
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Typed as any to avoid "type instantiation excessively deep" from generic inference
  const program: any = new anchor.Program(IDL as any, provider);

  // Use the provider wallet as designer — it already has SOL, no airdrop needed.
  const designer   = provider.wallet.publicKey;
  const DROP_ID    = "DEMO_DROP";
  const MAX_SUPPLY = new anchor.BN(3);

  // PDA: seeds = [b"drop", drop_id.as_bytes()]
  const [dropPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("drop"), Buffer.from(DROP_ID)],
    PROGRAM_ID
  );

  console.log(`\n  Designer:  ${designer.toBase58()}`);
  console.log(`  Drop PDA:  ${dropPda.toBase58()}`);
  console.log(`  Max supply: ${MAX_SUPPLY.toString()}\n`);

  // ── 1. Create drop ────────────────────────────────────────────────────────

  it("creates a drop with drop_id DEMO_DROP and max_supply 3", async () => {
    const tx = await program.methods
      .createDrop(DROP_ID, MAX_SUPPLY)
      .accounts({
        designer,
        dropAccount:   dropPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log(`  createDrop tx: ${tx}`);

    const drop = await program.account.dropAccount.fetch(dropPda, "confirmed");

    assert.equal(drop.designer.toBase58(), designer.toBase58(), "designer mismatch");
    assert.isTrue(drop.maxSupply.eq(MAX_SUPPLY),  `maxSupply should be 3, got ${drop.maxSupply}`);
    assert.isTrue(drop.currentCount.eq(new anchor.BN(0)), "currentCount should start at 0");
    assert.equal(drop.dropId, DROP_ID, "dropId mismatch");
    assert.isTrue(drop.active, "drop should be active");

    console.log(
      `  State: count=${drop.currentCount}/${drop.maxSupply}  active=${drop.active}`
    );
  });

  // ── 2–4. Three successful register_order calls ────────────────────────────

  for (let order = 1; order <= 3; order++) {
    it(`registers order ${order}/3 — should succeed`, async () => {
      const before = await program.account.dropAccount.fetch(dropPda, "confirmed");

      const tx = await program.methods
        .registerOrder()
        .accounts({
          authority:   provider.wallet.publicKey,
          dropAccount: dropPda,
        })
        .rpc({ commitment: "confirmed" });

      console.log(`  registerOrder ${order} tx: ${tx}`);

      const after = await program.account.dropAccount.fetch(dropPda, "confirmed");
      const expectedCount = new anchor.BN(order);

      assert.isTrue(
        after.currentCount.eq(expectedCount),
        `currentCount should be ${order}, got ${after.currentCount.toString()}`
      );
      assert.isTrue(
        after.currentCount.eq(before.currentCount.addn(1)),
        "currentCount should increment by exactly 1"
      );

      console.log(
        `  State: count=${after.currentCount}/${after.maxSupply}`
      );
    });
  }

  // ── 5. 4th call must fail with DropSoldOut (6000) ────────────────────────

  it("rejects 4th order with DropSoldOut error (code 6000)", async () => {
    // Confirm we are already at max before attempting
    const drop = await program.account.dropAccount.fetch(dropPda, "confirmed");
    assert.isTrue(
      drop.currentCount.eq(MAX_SUPPLY),
      `expected currentCount = 3 before 4th attempt, got ${drop.currentCount.toString()}`
    );

    let threw = false;
    try {
      await program.methods
        .registerOrder()
        .accounts({
          authority:   provider.wallet.publicKey,
          dropAccount: dropPda,
        })
        .rpc();
      assert.fail("4th registerOrder should have thrown DropSoldOut");
    } catch (err: any) {
      threw = true;
      const msg: string = err.toString();
      const isDropSoldOut =
        msg.includes("DropSoldOut") ||
        msg.includes("6000")        ||
        (err.error?.errorCode?.number === 6000);

      assert.isTrue(
        isDropSoldOut,
        `expected DropSoldOut (6000), got: ${msg}`
      );
      console.log("  Correctly rejected: DropSoldOut (6000)  ✓");
    }
    assert.isTrue(threw, "should have thrown on 4th order");
  });

  // ── 6. Final state verification ───────────────────────────────────────────

  it("final state: current_count = 3 and cannot exceed max_supply", async () => {
    const drop = await program.account.dropAccount.fetch(dropPda, "confirmed");

    assert.isTrue(
      drop.currentCount.eq(new anchor.BN(3)),
      `currentCount should be 3, got ${drop.currentCount.toString()}`
    );
    assert.isTrue(
      drop.currentCount.eq(drop.maxSupply),
      "currentCount should equal maxSupply (sold out)"
    );
    assert.isTrue(drop.active, "drop remains active even when sold out");
    assert.equal(drop.dropId, DROP_ID, "dropId unchanged");

    console.log(
      `  Final state: count=${drop.currentCount}/${drop.maxSupply}  active=${drop.active}  sold_out=${drop.currentCount.gte(drop.maxSupply)}`
    );
  });
});
