# Backend Integration Guide — Circuit

This guide is for the frontend developer wiring the Circuit UI to the three on-chain
components deployed to Solana devnet. All examples are TypeScript and copy-paste ready.

---

## Table of Contents

1. [Deployed Contracts & Addresses](#1-deployed-contracts--addresses)
2. [Installation](#2-installation)
3. [Provider Setup](#3-provider-setup)
4. [Escrow Program](#4-escrow-program)
   - [initialize_escrow — user confirms order](#41-initialize_escrow--user-confirms-order)
   - [confirm_delivery — user confirms receipt](#42-confirm_delivery--user-confirms-receipt)
   - [Fetch escrow state](#43-fetch-escrow-state)
5. [Drop Registry Program](#5-drop-registry-program)
   - [create_drop — designer creates a drop](#51-create_drop--designer-creates-a-drop)
   - [register_order — order is placed](#52-register_order--order-is-placed)
   - [Fetch drop state](#53-fetch-drop-state)
6. [Garment NFT — Metaplex UMI](#6-garment-nft--metaplex-umi)
   - [Fetch NFT metadata](#61-fetch-nft-metadata)
   - [Check wallet ownership](#62-check-wallet-ownership)
7. [PDA Reference](#7-pda-reference)
8. [Error Codes Reference](#8-error-codes-reference)
9. [Full Order Flow (Escrow + Drop Registry together)](#9-full-order-flow-escrow--drop-registry-together)

---

## 1. Deployed Contracts & Addresses

### Escrow Program

| Field       | Value |
|-------------|-------|
| Program ID  | `8b866KXrU94jAEuZYNr8WTkuXJELPvu6eW1v89pSAUrN` |
| Network     | Devnet |
| Solscan     | https://solscan.io/account/8b866KXrU94jAEuZYNr8WTkuXJELPvu6eW1v89pSAUrN?cluster=devnet |
| Purpose     | Locks buyer payment until delivery is confirmed |

### Drop Registry Program

| Field       | Value |
|-------------|-------|
| Program ID  | `3i1KUa7S1FjRx34SzqRAKAYsp3S8AJkCB3x7odjua7kL` |
| Network     | Devnet |
| Solscan     | https://solscan.io/account/3i1KUa7S1FjRx34SzqRAKAYsp3S8AJkCB3x7odjua7kL?cluster=devnet |
| Purpose     | Enforces per-drop supply cap — rejects orders beyond `max_supply` |

### Demo Garment NFT

| Field        | Value |
|--------------|-------|
| Mint Address | `G17eNpsCn4S2Xtr4f9t9fmgyf6ZVFEpdXnpqJBiBCFEo` |
| Standard     | pNFT (Programmable Non-Fungible) |
| Network      | Devnet |
| Solscan      | https://solscan.io/token/G17eNpsCn4S2Xtr4f9t9fmgyf6ZVFEpdXnpqJBiBCFEo?cluster=devnet |
| Purpose      | Permanent on-chain ownership record for the physical garment |

---

## 2. Installation

```bash
npm install \
  @coral-xyz/anchor \
  @solana/web3.js \
  @metaplex-foundation/umi \
  @metaplex-foundation/umi-bundle-defaults \
  @metaplex-foundation/mpl-token-metadata
```

---

## 3. Provider Setup

Both programs share the same provider setup. Call this once and pass `program` /
`provider` into your components.

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";

// ── Program IDs ──────────────────────────────────────────────────────────────
export const ESCROW_PROGRAM_ID  = new PublicKey("8b866KXrU94jAEuZYNr8WTkuXJELPvu6eW1v89pSAUrN");
export const DROPS_PROGRAM_ID   = new PublicKey("3i1KUa7S1FjRx34SzqRAKAYsp3S8AJkCB3x7odjua7kL");
export const DEMO_GARMENT_MINT  = new PublicKey("G17eNpsCn4S2Xtr4f9t9fmgyf6ZVFEpdXnpqJBiBCFEo");

// ── IDLs ─────────────────────────────────────────────────────────────────────
// Discriminators: sha256("global:<instruction_name>")[0..8]
//                 sha256("account:<AccountName>")[0..8]

export const ESCROW_IDL = {
  address: "8b866KXrU94jAEuZYNr8WTkuXJELPvu6eW1v89pSAUrN",
  metadata: { name: "circuit_escrow", version: "0.1.0", spec: "0.1.0" },
  instructions: [
    {
      name: "initialize_escrow",
      discriminator: [243, 160, 77, 153, 11, 92, 48, 209],
      accounts: [
        { name: "buyer",          writable: true, signer: true },
        { name: "designer" },
        { name: "escrow_account", writable: true },
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
        { name: "buyer",          writable: true, signer: true },
        { name: "designer",       writable: true },
        { name: "escrow_account", writable: true },
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

export const DROPS_IDL = {
  address: "3i1KUa7S1FjRx34SzqRAKAYsp3S8AJkCB3x7odjua7kL",
  metadata: { name: "circuit_drops", version: "0.1.0", spec: "0.1.0" },
  instructions: [
    {
      name: "create_drop",
      discriminator: [157, 142, 145, 247, 92, 73, 59, 48],
      accounts: [
        { name: "designer",     writable: true, signer: true },
        { name: "drop_account", writable: true },
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
        { name: "authority",   signer: true   },
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
    { code: 6000, name: "DropSoldOut",      msg: "Drop has reached maximum supply"                        },
    { code: 6001, name: "DropNotActive",    msg: "Drop is not currently active"                           },
    { code: 6002, name: "InvalidDropId",    msg: "Drop ID cannot be empty"                                },
    { code: 6003, name: "DropIdTooLong",    msg: "Drop ID exceeds the maximum length of 64 characters"   },
    { code: 6004, name: "InvalidMaxSupply", msg: "Max supply must be greater than zero"                   },
  ],
};

// ── Provider factory (call once, e.g. on wallet connect) ─────────────────────
export function createProvider(wallet: anchor.Wallet) {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const provider   = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  return provider;
}

export function createEscrowProgram(provider: anchor.AnchorProvider): any {
  return new anchor.Program(ESCROW_IDL as any, provider);
}

export function createDropsProgram(provider: anchor.AnchorProvider): any {
  return new anchor.Program(DROPS_IDL as any, provider);
}
```

---

## 4. Escrow Program

### Account structure

```typescript
interface EscrowAccount {
  buyer:     PublicKey;   // wallet that locked funds
  designer:  PublicKey;   // wallet that receives payment on delivery
  amount:    anchor.BN;   // escrowed lamports (BN because u64 > Number.MAX_SAFE_INTEGER)
  dropId:    string;      // e.g. "DROP001"
  delivered: boolean;     // false until buyer calls confirm_delivery
  bump:      number;
}
```

### PDA derivation

```typescript
import { PublicKey } from "@solana/web3.js";

export function deriveEscrowPda(
  dropId: string,
  buyerPublicKey: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"),
      Buffer.from(dropId),
      buyerPublicKey.toBuffer(),
    ],
    ESCROW_PROGRAM_ID
  );
  return pda;
}
```

---

### 4.1 `initialize_escrow` — user confirms order

Call this when the buyer clicks **"Confirm Order"**. Transfers `amountSol` from the
buyer's wallet into a PDA escrow account. Funds are locked until `confirm_delivery`.

```typescript
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * @param program       - from createEscrowProgram()
 * @param buyer         - buyer's connected wallet PublicKey
 * @param designerPubkey - designer's wallet PublicKey (payment recipient)
 * @param dropId        - the drop identifier string, e.g. "DROP001"
 * @param amountSol     - amount in SOL (e.g. 0.1 for 0.1 SOL)
 */
export async function initializeEscrow(
  program: any,
  buyer: PublicKey,
  designerPubkey: PublicKey,
  dropId: string,
  amountSol: number
): Promise<string> {
  const escrowPda    = deriveEscrowPda(dropId, buyer);
  const amountLamports = new anchor.BN(amountSol * LAMPORTS_PER_SOL);

  const tx = await program.methods
    .initializeEscrow(dropId, amountLamports)
    .accounts({
      buyer:         buyer,
      designer:      designerPubkey,
      escrowAccount: escrowPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: "confirmed" });

  console.log("Escrow initialized. Tx:", tx);
  return tx; // transaction signature
}
```

> **Note:** `buyer` must be the connected wallet signer. In a browser wallet context
> (Phantom, Backpack, etc.) the wallet adapter handles signing automatically — you do
> not need to pass a keypair.

---

### 4.2 `confirm_delivery` — user confirms receipt

Call this when the buyer clicks **"I received my garment"**. Transfers the escrowed
funds to the designer and marks the escrow as delivered.

```typescript
/**
 * @param program        - from createEscrowProgram()
 * @param buyer          - buyer's connected wallet PublicKey (must be the original buyer)
 * @param designerPubkey - must match the designer stored in the EscrowAccount
 * @param dropId         - same dropId used in initializeEscrow
 */
export async function confirmDelivery(
  program: any,
  buyer: PublicKey,
  designerPubkey: PublicKey,
  dropId: string
): Promise<string> {
  const escrowPda = deriveEscrowPda(dropId, buyer);

  try {
    const tx = await program.methods
      .confirmDelivery()
      .accounts({
        buyer:         buyer,
        designer:      designerPubkey,
        escrowAccount: escrowPda,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Delivery confirmed. Tx:", tx);
    return tx;
  } catch (err: any) {
    // Handle known escrow errors
    if (err.toString().includes("AlreadyDelivered") || err?.error?.errorCode?.number === 6000) {
      throw new Error("This order has already been confirmed.");
    }
    if (err.toString().includes("UnauthorizedBuyer") || err?.error?.errorCode?.number === 6001) {
      throw new Error("Only the original buyer can confirm delivery.");
    }
    throw err;
  }
}
```

---

### 4.3 Fetch escrow state

```typescript
/**
 * Returns null if no escrow exists for this buyer/drop combination.
 */
export async function fetchEscrow(
  program: any,
  dropId: string,
  buyerPublicKey: PublicKey
): Promise<EscrowAccount | null> {
  const escrowPda = deriveEscrowPda(dropId, buyerPublicKey);

  try {
    const account = await program.account.escrowAccount.fetch(
      escrowPda,
      "confirmed"
    );
    return account as EscrowAccount;
  } catch {
    return null; // account doesn't exist yet
  }
}

// Usage example
const escrow = await fetchEscrow(escrowProgram, "DROP001", buyerWallet.publicKey);
if (escrow) {
  console.log("Amount locked:", escrow.amount.toNumber() / LAMPORTS_PER_SOL, "SOL");
  console.log("Delivered:",     escrow.delivered);
}
```

---

## 5. Drop Registry Program

### Account structure

```typescript
interface DropAccount {
  designer:      PublicKey;  // wallet that created the drop
  maxSupply:     anchor.BN;  // total units available
  currentCount:  anchor.BN;  // orders placed so far
  dropId:        string;     // e.g. "DROP001"
  active:        boolean;    // false = orders rejected even if supply remains
  bump:          number;
}
```

### PDA derivation

```typescript
export function deriveDropPda(dropId: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("drop"), Buffer.from(dropId)],
    DROPS_PROGRAM_ID
  );
  return pda;
}
```

---

### 5.1 `create_drop` — designer creates a drop

Call this once per drop when the designer publishes a new collection.

```typescript
/**
 * @param program       - from createDropsProgram()
 * @param designer      - designer's connected wallet PublicKey
 * @param dropId        - unique string identifier, max 64 chars, e.g. "DROP001"
 * @param maxSupply     - total number of garments available
 */
export async function createDrop(
  program: any,
  designer: PublicKey,
  dropId: string,
  maxSupply: number
): Promise<string> {
  const dropPda = deriveDropPda(dropId);

  const tx = await program.methods
    .createDrop(dropId, new anchor.BN(maxSupply))
    .accounts({
      designer:     designer,
      dropAccount:  dropPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: "confirmed" });

  console.log("Drop created. Tx:", tx);
  return tx;
}
```

---

### 5.2 `register_order` — an order is placed

Call this every time a buyer places an order. The program automatically rejects the
call with `DropSoldOut` once `current_count >= max_supply` — no frontend supply check
is needed.

```typescript
/**
 * @param program   - from createDropsProgram()
 * @param authority - the connected wallet placing the order (buyer or admin)
 * @param dropId    - the drop to register the order against
 */
export async function registerOrder(
  program: any,
  authority: PublicKey,
  dropId: string
): Promise<string> {
  const dropPda = deriveDropPda(dropId);

  try {
    const tx = await program.methods
      .registerOrder()
      .accounts({
        authority:   authority,
        dropAccount: dropPda,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Order registered. Tx:", tx);
    return tx;
  } catch (err: any) {
    // DropSoldOut is error code 6000 on the drops program
    if (err.toString().includes("DropSoldOut") || err?.error?.errorCode?.number === 6000) {
      throw new Error("This drop is sold out.");
    }
    if (err.toString().includes("DropNotActive") || err?.error?.errorCode?.number === 6001) {
      throw new Error("This drop is no longer active.");
    }
    throw err;
  }
}
```

---

### 5.3 Fetch drop state

```typescript
export async function fetchDrop(
  program: any,
  dropId: string
): Promise<DropAccount | null> {
  const dropPda = deriveDropPda(dropId);

  try {
    const account = await program.account.dropAccount.fetch(
      dropPda,
      "confirmed"
    );
    return account as DropAccount;
  } catch {
    return null;
  }
}

// Usage: check remaining supply before showing "Buy" button
const drop = await fetchDrop(dropsProgram, "DROP001");
if (drop) {
  const remaining = drop.maxSupply.sub(drop.currentCount).toNumber();
  console.log(`${remaining} of ${drop.maxSupply.toNumber()} remaining`);
  const isSoldOut = drop.currentCount.gte(drop.maxSupply);
  const canOrder  = drop.active && !isSoldOut;
}
```

---

## 6. Garment NFT — Metaplex UMI

### 6.1 Fetch NFT metadata

```typescript
import { createUmi }  from "@metaplex-foundation/umi-bundle-defaults";
import {
  mplTokenMetadata,
  fetchDigitalAsset,
}                     from "@metaplex-foundation/mpl-token-metadata";
import { publicKey }  from "@metaplex-foundation/umi";

const GARMENT_MINT = "G17eNpsCn4S2Xtr4f9t9fmgyf6ZVFEpdXnpqJBiBCFEo";

export async function fetchGarmentMetadata() {
  const umi = createUmi("https://api.devnet.solana.com")
    .use(mplTokenMetadata());

  const asset = await fetchDigitalAsset(umi, publicKey(GARMENT_MINT));

  // On-chain fields
  console.log("Name:    ", asset.metadata.name);
  console.log("Symbol:  ", asset.metadata.symbol);
  console.log("URI:     ", asset.metadata.uri);       // Arweave JSON link
  console.log("Mutable: ", asset.metadata.isMutable);
  console.log("Standard:", asset.metadata.tokenStandard);

  // Off-chain JSON (attributes, description, image) — fetch the URI
  if (asset.metadata.uri && !asset.metadata.uri.includes("placeholder")) {
    const response  = await fetch(asset.metadata.uri);
    const offChain  = await response.json();
    console.log("Description:", offChain.description);
    console.log("Image:      ", offChain.image);
    console.log("Attributes: ", offChain.attributes);
    // offChain.attributes: [
    //   { trait_type: "Edition",         value: "01 of 40"       },
    //   { trait_type: "Drop",            value: "Drop Zero"      },
    //   { trait_type: "Production Date", value: "May 2026"       },
    //   { trait_type: "Fabric",          value: "Nigerian Cotton" },
    // ]
    return offChain;
  }

  return asset.metadata;
}
```

---

### 6.2 Check wallet ownership

Use this to gate UI features (e.g. "Confirm Delivery" button) behind ownership of
the garment NFT.

```typescript
import {
  fetchAllDigitalAssetWithTokenByOwner,
} from "@metaplex-foundation/mpl-token-metadata";
import { publicKey } from "@metaplex-foundation/umi";

/**
 * Returns true if `walletAddress` holds the garment NFT.
 */
export async function walletOwnsGarment(walletAddress: string): Promise<boolean> {
  const umi = createUmi("https://api.devnet.solana.com")
    .use(mplTokenMetadata());

  const assets = await fetchAllDigitalAssetWithTokenByOwner(
    umi,
    publicKey(walletAddress)
  );

  return assets.some(
    (a) => a.mint.publicKey.toString() === GARMENT_MINT
  );
}
```

---

## 7. PDA Reference

Both programs use deterministic addresses (PDAs) so you never need to store
addresses in a database — derive them on demand from the drop/buyer combination.

| Account        | Seeds                                      | Program                |
|----------------|--------------------------------------------|------------------------|
| EscrowAccount  | `["escrow", dropId, buyerPublicKey]`       | Escrow Program         |
| DropAccount    | `["drop", dropId]`                         | Drop Registry Program  |

```typescript
// Escrow PDA — unique per buyer × drop
const [escrowPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("escrow"), Buffer.from(dropId), buyer.toBuffer()],
  ESCROW_PROGRAM_ID
);

// Drop PDA — one per drop, shared across all buyers
const [dropPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("drop"), Buffer.from(dropId)],
  DROPS_PROGRAM_ID
);
```

> `dropId` must be the same string used when the account was created — casing matters.

---

## 8. Error Codes Reference

### Escrow Program

| Code | Name               | Meaning                                      | When it fires                            |
|------|--------------------|----------------------------------------------|------------------------------------------|
| 6000 | `AlreadyDelivered` | Delivery already confirmed                   | `confirm_delivery` called twice          |
| 6001 | `UnauthorizedBuyer`| Signer is not the escrow's buyer             | Wrong wallet calls `confirm_delivery`    |
| 6002 | `InvalidDesigner`  | Designer account doesn't match stored value  | Wrong designer passed to instruction     |
| 6003 | `InvalidAmount`    | Amount is zero                               | `initialize_escrow` with 0 lamports      |
| 6004 | `InvalidDropId`    | Drop ID is empty string                      | Empty `drop_id` passed                   |
| 6005 | `DropIdTooLong`    | Drop ID exceeds 64 characters                | `drop_id.length > 64`                    |

### Drop Registry Program

| Code | Name               | Meaning                                      | When it fires                            |
|------|--------------------|----------------------------------------------|------------------------------------------|
| 6000 | `DropSoldOut`      | `current_count >= max_supply`                | Order placed on a sold-out drop          |
| 6001 | `DropNotActive`    | Drop has been deactivated                    | `register_order` on inactive drop        |
| 6002 | `InvalidDropId`    | Drop ID is empty string                      | `create_drop` with empty `drop_id`       |
| 6003 | `DropIdTooLong`    | Drop ID exceeds 64 characters                | `drop_id.length > 64`                    |
| 6004 | `InvalidMaxSupply` | `max_supply` is zero                         | `create_drop` with `max_supply = 0`      |

### Checking errors in the frontend

```typescript
function parseAnchorError(err: any): string {
  const code: number | undefined = err?.error?.errorCode?.number;
  const msg:  string             = err?.toString() ?? "";

  // Escrow errors
  if (code === 6000 || msg.includes("AlreadyDelivered")) return "Order already confirmed.";
  if (code === 6001 || msg.includes("UnauthorizedBuyer")) return "Only the buyer can confirm delivery.";

  // Drop errors (same code namespace, different program)
  if (code === 6000 || msg.includes("DropSoldOut"))   return "This drop is sold out.";
  if (code === 6001 || msg.includes("DropNotActive")) return "This drop is no longer active.";

  return "Transaction failed. Please try again.";
}
```

---

## 9. Full Order Flow (Escrow + Drop Registry together)

This is the complete sequence when a buyer purchases a garment from a Circuit drop.

```typescript
/**
 * Complete purchase flow — call this when buyer clicks "Confirm Order".
 *
 * Steps:
 *  1. Register the order on-chain (increments supply counter, rejects if sold out)
 *  2. Lock payment in escrow (funds held until delivery confirmed)
 *
 * @param buyerWallet    - buyer's connected wallet (Phantom / Backpack)
 * @param designerPubkey - designer's wallet address
 * @param dropId         - e.g. "DROP001"
 * @param amountSol      - price in SOL
 */
export async function placeOrder(
  provider:        anchor.AnchorProvider,
  buyerWallet:     PublicKey,
  designerPubkey:  PublicKey,
  dropId:          string,
  amountSol:       number
): Promise<{ orderTx: string; escrowTx: string }> {
  const escrowProgram = createEscrowProgram(provider);
  const dropsProgram  = createDropsProgram(provider);

  // Step 1 — Register order (will throw DropSoldOut if supply exhausted)
  let orderTx: string;
  try {
    orderTx = await registerOrder(dropsProgram, buyerWallet, dropId);
  } catch (err: any) {
    if (err.message === "This drop is sold out.") {
      throw new Error("Sorry — this drop just sold out.");
    }
    throw err;
  }

  // Step 2 — Lock payment in escrow
  const escrowTx = await initializeEscrow(
    escrowProgram,
    buyerWallet,
    designerPubkey,
    dropId,
    amountSol
  );

  return { orderTx, escrowTx };
}

/**
 * Confirm delivery — call this when buyer clicks "I received my garment".
 * Releases escrowed funds to the designer.
 */
export async function confirmOrderDelivery(
  provider:        anchor.AnchorProvider,
  buyerWallet:     PublicKey,
  designerPubkey:  PublicKey,
  dropId:          string
): Promise<string> {
  const escrowProgram = createEscrowProgram(provider);
  return confirmDelivery(escrowProgram, buyerWallet, designerPubkey, dropId);
}
```

### Flow diagram

```
Buyer clicks "Confirm Order"
        │
        ▼
registerOrder(dropId)
        │ on-chain: currentCount += 1
        │ reverts with DropSoldOut if sold out
        │
        ▼
initializeEscrow(dropId, amount)
        │ on-chain: funds locked in PDA
        │ EscrowAccount { delivered: false }
        │
        ▼
[garment is produced & shipped]
        │
        ▼
Buyer clicks "I received my garment"
        │
        ▼
confirmDelivery(dropId)
        │ on-chain: funds transferred to designer
        │ EscrowAccount { delivered: true }
        ▼
      Done
```

---

*Network: Solana Devnet — switch `clusterApiUrl("devnet")` to `clusterApiUrl("mainnet-beta")` and update program IDs when going to production.*
