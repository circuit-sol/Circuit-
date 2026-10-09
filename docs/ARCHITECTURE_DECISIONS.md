# Circuit — Architecture & Product Decisions

This document outlines core strategic, operational, and architectural decisions under review for Circuit's production platform.

---

## 1. Creator Onboarding & Listing Verification

### The Challenge
Circuit’s production model advances 30% of total preorder capital to designers 48 hours after a drop window closes to fund fabric sourcing and manufacturing. If creator accounts are completely open and unvetted, malicious actors could list unauthorized apparel, capture buyer commitments, claim advance funds, and fail to fulfill garments.

### Decision Options
* **Option A: Curated / Admin Approval Gate (Recommended for V1)**
  * Any designer can register and prepare collections/drafts inside **My Studio**.
  * Publishing a live drop to the public storefront requires a 1-click admin approval or a verified invite code from Circuit.
  * *Pros:* 100% protection against fraudulent listings during launch; guarantees high craftsmanship and brand reputation.
  * *Cons:* Requires administrative review prior to each drop going live.
* **Option B: Self-Serve with Escrow Collateral / Security Deposit**
  * Designers stake a refundable security deposit or connect verified business credentials (e.g. Stripe Identity / CAC registration) to publish autonomously.
  * *Pros:* Fully permissionless.
  * *Cons:* Creates friction for early indie designers with limited upfront capital.
* **Option C: Tiered Advance Release**
  * First-time designers receive the 30% advance only upon providing proof-of-production (fabric invoice or cutting photos uploaded to Circuit).
  * Established, vetted designers receive the 30% automatically 48 hours after orders close.

---

## 2. Admin Dashboard Architecture & Permissions

### Role Separation
The platform requires a distinct separation between:
1. **Buyers / Collectors**: Browsing, ordering, tracking delivery, and unlocking digital product passports.
2. **Creators / Brands**: Managing drops, reviewing size-by-size production sheets, setting pickup stations, and claiming earnings.
3. **Circuit Platform Administration**: Overseeing treasury, platform health, dispute mediation, and creator approvals.

### Core Capabilities for Admin V1
* **Authentication**: Dedicated `/admin` route authenticated via authorized admin wallet public keys and/or admin credentials, separate from consumer sessions.
* **Brand & Drop Management**:
  * Review pending drops submitted by designers.
  * Toggle live status or suspend brand accounts in breach of terms.
* **Escrow & Treasury Oversight**:
  * Real-time visibility into total value locked (TVL) across active drop escrows.
  * Platform fee collection and protocol treasury balances.
* **Communications**:
  * Ability to broadcast official delivery or production updates to buyers of a specific batch.
  * Direct customer support inbox for order escalation.

---

## 3. Payout Settlement & Buffer Timing

### Current Model
* **30% Advance**: Unlocks 48 hours after the drop window closes to fund raw material procurement and atelier production.
* **70% Balance**: Unlocks immediately when the buyer confirms physical garment arrival, or automatically 7 days after the scheduled delivery date if no complaints or disputes are filed.

### Operational Buffer
* A 48-hour post-close window is strictly required to allow buyers to exercise their 24-hour no-questions-asked cancellation window.
* An automated 1-hour cron execution buffer ensures blockchain transactions and fiat off-ramps reconcile cleanly before funds are disbursed to creator wallets.

---

## 4. Brand-Led Dispute Resolution & Buyer Support

### Framework
* **Frontline Brand Resolution**:
  * Designers are directly responsible for garment sizing, quality, and local pickup coordination.
  * Each drop displays the brand's verified support channels (Support Email, WhatsApp, Instagram).
* **Circuit Mediation Protocol**:
  * If an order is not ready by the pickup date or arrives defective, buyers can tap **Report an Issue** on the confirmation page.
  * Reporting an issue pauses the 7-day automatic release of the 70% balance escrow.
  * Circuit administration reviews the dispute, facilitating either manufacturer remediation or a full buyer refund from the remaining escrow.

---

## 5. Creator Social Media & Trust Signals

### Brand Identity & Discovery
* Creators provide direct links to their public brand presence:
  * Instagram
  * Twitter / X
  * TikTok
  * Direct Customer Care (WhatsApp / Email)
* These channels appear as verified icons alongside the designer’s name on both the storefront hero and the preorder checkout panel, giving buyers immediate confidence in the atelier behind the piece.

---

## 6. Secondary Market & Digital Product Passport (NFC + On-Chain Ownership)

### Physical-to-Digital Connection
* Every manufactured garment is physically fitted with an encrypted NFC chip or stitched QR code sewn into the garment label.
* Tapping the garment with an NFC-enabled smartphone launches the garment's Digital Passport on Circuit:
  * Verifies authentic atelier origin.
  * Displays the unique edition number (e.g., `#04 of 50`), release batch, tailor, and provenance history.
  * Links to the collector’s on-chain token (Metaplex Core / cNFT on Solana).

### Secondary Market & Resale Royalties
* **Peer-to-Peer Authenticated Resale**: Collectors can list verified pieces for resale directly through Circuit. The physical garment's authenticity is guaranteed by its on-chain passport.
* **Perpetual Creator Royalties**: On every secondary transfer, an automated protocol royalty (e.g., 5%–10%) is routed directly to the original designer’s wallet, establishing sustainable long-term revenue for independent creators.

---

## 7. Fiat & Local Payment On-Ramps vs. Pure Solana Crypto UX

### The Challenge
High-fashion consumers and indie streetwear collectors frequently do not maintain self-custodied Solana wallets (e.g., Phantom) or pre-funded USDC balances. Requiring crypto-only checkout creates high drop abandonment.

### Decision Options
* **Option A: Pure Solana Native (Current V1)**
  * Users connect Phantom/Solflare and pay in SOL or USDC directly via on-chain Escrow program.
  * *Pros:* Lowest operational complexity, zero chargeback fraud risk, instantaneous verifiable escrow.
  * *Cons:* Excludes mainstream, non-crypto fashion buyers.
* **Option B: Hybrid Fiat On-Ramp (Stripe / MoonPay / Paystack)**
  * Non-crypto buyers can check out via Credit Card, Apple Pay, or Local Bank Transfer.
  * An automated backend relayer exchanges fiat for USDC and executes the escrow deposit instruction on Solana on behalf of the buyer's generated key.
  * *Pros:* Unlocks global mainstream fashion shoppers and local market penetration.
  * *Cons:* Requires chargeback mitigation and payment processor compliance.
* **Option C: Embedded Social Wallets (Privy / Dynamic)**
  * Users log in with Email or Apple ID. An invisible Solana wallet is generated under the hood. Users fund via credit card or linked account without ever needing to manage private keys.

---

## 8. Production Thresholds: Minimum Order Quantity (MOQ) vs. Fixed Supply

### The Challenge
Independent ateliers often have factory or fabric mill Minimum Order Quantities (e.g., 15–20 garments). If a drop only receives 3 preorders, producing them may cause the atelier a net financial loss.

### Decision Options
* **Option A: Fixed Supply Preorder Cap (Current V1)**
  * Designers set a maximum supply cap (e.g., 50 pieces).
  * Whatever sells within the drop window goes into production.
  * *Best for:* Designers who produce in-house or have flexible made-to-order capacity.
* **Option B: Crowdfunding MOQ Threshold**
  * Designers define both a Target MOQ (e.g., 20 units) and a Maximum Cap (e.g., 50 units).
  * If the drop reaches MOQ before closing, production is confirmed and the 30% advance is unlocked post-close.
  * If the drop fails to reach MOQ by the closing deadline, the drop is marked unfulfilled, and 100% of buyer funds in escrow are automatically refunded to buyers without penalties.

