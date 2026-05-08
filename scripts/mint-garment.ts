import { createUmi }        from "@metaplex-foundation/umi-bundle-defaults";
import {
  mplTokenMetadata,
  createProgrammableNft,
}                            from "@metaplex-foundation/mpl-token-metadata";
import {
  generateSigner,
  percentAmount,
  keypairIdentity,
}                            from "@metaplex-foundation/umi";
import * as fs               from "fs";
import * as os               from "os";
import * as path             from "path";

// ─── Config ──────────────────────────────────────────────────────────────────

const DEVNET_RPC = "https://api.devnet.solana.com";

// Placeholder until real image is uploaded to Arweave.
// Replace this with the Arweave transaction URI before mainnet.
const METADATA_URI = "https://arweave.net/placeholder";

// ─── Off-chain metadata (upload this JSON to Arweave before mainnet) ─────────

const OFF_CHAIN_METADATA = {
  name:        "Circuit Drop 001 - Garment 01/40",
  symbol:      "CRCT",
  description: "Made-to-order. Produced because this buyer confirmed. Recorded permanently on Solana.",
  image:       METADATA_URI,
  attributes: [
    { trait_type: "Edition",          value: "01 of 40"        },
    { trait_type: "Drop",             value: "Drop Zero"       },
    { trait_type: "Production Date",  value: "May 2026"        },
    { trait_type: "Fabric",           value: "Nigerian Cotton" },
  ],
  properties: {
    files:    [{ uri: METADATA_URI, type: "image/png" }],
    category: "image",
  },
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. Connect to devnet ──────────────────────────────────────────────────
  const umi = createUmi(DEVNET_RPC).use(mplTokenMetadata());

  // ── 2. Load default Solana keypair (~/.config/solana/id.json) ────────────
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(keypairPath)) {
    throw new Error(
      `Solana keypair not found at ${keypairPath}.\nRun 'solana-keygen new' to create one.`
    );
  }
  const secretKey = Uint8Array.from(
    JSON.parse(fs.readFileSync(keypairPath, "utf-8")) as number[]
  );
  const walletKeypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
  umi.use(keypairIdentity(walletKeypair));

  // ── 3. Print context ──────────────────────────────────────────────────────
  console.log("════════════════════════════════════════════════════════");
  console.log("  Circuit — Garment pNFT Mint");
  console.log("════════════════════════════════════════════════════════");
  console.log(`  Network  : devnet`);
  console.log(`  Wallet   : ${walletKeypair.publicKey}`);

  // ── 4. Generate a fresh mint keypair for this garment ────────────────────
  const mint = generateSigner(umi);
  console.log(`  Mint     : ${mint.publicKey}`);
  console.log("════════════════════════════════════════════════════════\n");

  // ── 5. Print off-chain metadata JSON for reference ───────────────────────
  console.log("Off-chain metadata JSON (upload to Arweave, then update METADATA_URI):");
  console.log(JSON.stringify(OFF_CHAIN_METADATA, null, 2));
  console.log();

  // ── 6. Create + mint the pNFT in one atomic transaction ──────────────────
  // createProgrammableNft = createV1 + mintV1 in a single transaction builder.
  // Sending them together is required: pNFT account-owner checks (metadata,
  // masterEdition, tokenRecord) only resolve correctly in a shared context.
  console.log("Minting pNFT (create + mint in one transaction)...");
  await createProgrammableNft(umi, {
    mint,
    name:                 OFF_CHAIN_METADATA.name,
    symbol:               OFF_CHAIN_METADATA.symbol,
    uri:                  METADATA_URI,
    sellerFeeBasisPoints: percentAmount(7, 2),
    isMutable:            true,
  }).sendAndConfirm(umi);
  console.log("          Done.\n");

  // ── 8. Print result ───────────────────────────────────────────────────────
  console.log("════════════════════════════════════════════════════════");
  console.log("  pNFT minted successfully");
  console.log("════════════════════════════════════════════════════════");
  console.log(`  MINT ADDRESS : ${mint.publicKey}`);
  console.log(
    `  Explorer     : https://explorer.solana.com/address/${mint.publicKey}?cluster=devnet`
  );
  console.log("════════════════════════════════════════════════════════");
  console.log();
  console.log("Next steps:");
  console.log("  1. Upload the metadata JSON above to Arweave (e.g. via Bundlr / Shadow Drive)");
  console.log("  2. Replace METADATA_URI in this file with the real Arweave tx URI");
  console.log("  3. Re-run to mint additional garments, or call updateV1 to patch this one");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\n  Mint failed:", message);
  process.exit(1);
});
