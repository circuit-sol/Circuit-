# Frontend Implementation & Integration Report

This document details the frontend architecture implemented for the Circuit MVP. It identifies the completed features, the service layer design, and the specific modules currently running in **Simulation Mode** for demo stability.

## 1. Service Layer Architecture
The application is built with a clean separation between UI components and the data/blockchain logic. 
- **Implemented**: `lib/solana-service.ts` (Blockchain interactions) and `lib/db.ts` (Persistence).
- **Status**: These services currently operate under a global `SIMULATION_MODE` flag. They return realistic mock data with artificial latency to provide a "live" feel during the hackathon demo.

## 2. Implemented Database Schema (Supabase)
The frontend is already wired to interact with a Supabase backend. A robust persistence layer is implemented in `lib/db.ts` with a verified schema.

### Existing SQL Structure
The following tables are implemented in the frontend logic:
- **`users`**: Maps emails to generated Solana wallets.
- **`orders`**: Tracks escrow transactions, Drop IDs, and order statuses (`pending`, `delivered`).

*Note: The frontend currently falls back to LocalStorage if Supabase environment variables are not detected, ensuring zero-fail demos.*

## 3. "Invisible Wallet" Implementation
A core UX feature of Circuit is the "Invisible Blockchain" experience.
- **Implemented**: `lib/auth-context.tsx` automatically generates a new Solana `Keypair` for first-time email sign-ins.
- **Status**: The public/private key mapping is currently saved via `db.ts`. 
- **Handover Note**: The `private_key` is currently stored in plain text. A production-ready implementation should wrap the `saveUserMapping` call in an encryption module.

## 4. On-Chain Logic & Stubs
The frontend is built to handle the transaction lifecycle defined in **`INTEGRATION.md`**.

### Current Implementation State:
- **Place Order**: The UI triggers `initializeEscrow()`. It is currently stubbed to return a simulated transaction signature and Solscan link.
- **Order Flow Alignment**: While the simulation consolidates the flow into a single call, the service layer includes standalone stubs for both `registerOrder()` and `initializeEscrow()`. This matches the 2-step atomic transaction lifecycle (Supply Check -> Escrow Lock) defined in **`INTEGRATION.md` §9**.

- **Delivery Confirmation**: The UI triggers `confirmDelivery()`. It simulates the release of funds from the Escrow PDA.
- **Passport Data**: `fetchPassportData()` simulates the retrieval of pNFT metadata from the Solana ledger.

## 5. Mock Implementation Inventory
The following modules in the source code are identified as the primary points for live integration:

| Service Point | Location | Current Mocked Behavior |
| :--- | :--- | :--- |
| **Escrow Initialization** | `lib/solana-service.ts` | Generates a random TX signature and increments a local counter. |
| **Delivery Release** | `lib/solana-service.ts` | Simulates a successful fund transfer from PDA to Designer. |
| **Supply Tracking** | `lib/solana-service.ts` | Uses a local `_currentCount` variable starting at 38 (near-sold-out). |
| **User Persistence** | `lib/db.ts` | Redirects to `localStorage` if Supabase keys are missing. |
| **Email Auth** | `lib/auth-context.tsx` | Immediately signs in any valid email format. |

## 6. Environment Configuration
The frontend expects the following environment variables for a successful live-handshake:

- `NEXT_PUBLIC_SUPABASE_URL` / `API_KEY`
- `NEXT_PUBLIC_SOLANA_RPC_URL` (Devnet/Mainnet)
- `NEXT_PUBLIC_SIMULATION_MODE` (Set to `false` for live integration)

---
**Implementation Summary**: The UI is 100% complete and responsive. The interactive SPA flow (Drop -> Order -> Confirm -> Passport) is fully functional via the simulation engine. The project is ready for the backend to replace the mock function bodies with real Anchor/Supabase calls.
