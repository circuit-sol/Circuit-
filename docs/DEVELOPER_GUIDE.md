# Circuit Developer Guide

Welcome to the Circuit Protocol developer documentation. This guide provides comprehensive information on our architecture, tech stack, and workflows. Whether you are building frontend components, integrating with Solana, or modifying backend services, this guide will help you understand how Circuit operates.

## 🌟 1. Project Vision: "Invisible Blockchain"

Circuit is a premium made-to-order fashion platform powered by Solana. We redefine the fashion supply chain by ensuring garments are produced only after demand is confirmed on-chain. 

Our core UX philosophy is the **"Invisible Blockchain"**:
- **Seamless Onboarding**: Users sign up with standard email or social accounts. No extensions required.
- **Custodial Wallets**: We automatically generate and manage Solana wallets behind the scenes, abstracting away seed phrases and transaction fees.
- **Verifiable Provenance**: Every garment produced is minted as a Digital Product Passport (pNFT), creating a permanent on-chain ownership record.
- **On-Chain Escrow**: Payments are secured in a smart contract and released only when delivery milestones are met.

---

## 🏗️ 2. System Architecture

Circuit is divided into three primary components, maintaining a clean separation of concerns:

### Frontend (`/app`)
- **Tech**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4.
- **Purpose**: The customer-facing single-page application (SPA). Handles UI, simulated/live on-chain logic, routing, and user sessions. 

### Backend (`/backend`)
- **Tech**: Node.js v22+, Express, `@solana/web3.js`, Supabase JS.
- **Purpose**: A custodial wallet manager and transaction service. It handles API requests from the frontend, interfaces with the Solana blockchain, and securely manages the custodial keys mapping via Supabase.

### On-Chain Programs (`/programs`)
- **Tech**: Rust, Anchor Framework.
- **Purpose**: The Solana smart contracts defining our escrow and drop registry logic.
  - **Escrow Program**: Locks buyer payments securely until delivery is confirmed.
  - **Drop Registry**: Enforces per-drop supply caps and tracks total commitments on-chain.

---

## 🛠️ 3. Tech Stack Deep Dive

- **Framework**: Next.js (Frontend), Express (Backend)
- **Styling**: Tailwind CSS v4
- **Database & Auth**: Supabase (PostgreSQL, GoTrue)
  - Manages `users` table mapping emails to generated Solana wallets.
  - Manages `orders` table tracking escrow transactions and drops.
- **Blockchain Network**: Solana (currently deployed on Devnet)
- **Smart Contract Framework**: Anchor (`@coral-xyz/anchor`)
- **NFT Standard**: Metaplex UMI (`@metaplex-foundation/umi`, `mpl-token-metadata`) for Programmable NFTs (pNFTs).

---

## 💻 4. Local Setup & Development

Follow these steps to get the Circuit platform running locally.

### Prerequisites
- Node.js >= 22.0.0
- npm or pnpm
- (Optional) Rust and Solana CLI for local program deployment.

### 4.1 Environment Configuration
Both the frontend and backend require `.env` files. **Do not commit actual secrets or private keys.**

**Frontend (`app/.env.local`)**:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_SIMULATION_MODE=false # Set to true to bypass live network calls
```

**Backend (`backend/.env`)**:
```env
PORT=3001
CLUSTER=devnet
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role
ESCROW_PROGRAM_ID=8b866KXrU94jAEuZYNr8WTkuXJELPvu6eW1v89pSAUrN
DROPS_PROGRAM_ID=3i1KUa7S1FjRx34SzqRAKAYsp3S8AJkCB3x7odjua7kL
```

### 4.2 Running the Project

**1. Install Dependencies**
Run from the root directory to install workspace dependencies (if using a workspace setup) or inside each folder:
```bash
# Frontend
cd app
npm install

# Backend
cd ../backend
npm install
```

**2. Start the Backend**
```bash
cd backend
npm run dev
# The server will start on http://localhost:3001
```

**3. Start the Frontend**
```bash
cd app
npm run dev
# The Next.js app will be available at http://localhost:3000
```

---

## 🔄 5. Core Workflows

### 5.1 The "Invisible" Auth Flow
1. User enters their email in the UI.
2. The frontend passes the email to `lib/auth-context.tsx`.
3. If it's a first-time sign-in, the backend/frontend generates a new Solana `Keypair`.
4. This keypair is securely mapped to the user's email via the `saveUserMapping` function (persisted in Supabase).
5. The user is now "logged in" and has a funded (or fundable) custodial wallet ready for transactions.

### 5.2 The Purchase & Escrow Lifecycle
1. **Supply Check**: User clicks "Confirm Order". The frontend calls the Drop Registry program to verify the drop isn't sold out (`register_order`).
2. **Escrow Lock**: If supply is available, the frontend/backend calls `initialize_escrow`. Funds are transferred from the user's custodial wallet into a secure Program Derived Address (PDA).
3. **Production**: The physical garment is manufactured.
4. **Delivery & Release**: Once the garment is received, the buyer triggers `confirm_delivery`. Funds are released from the PDA to the designer.
5. **NFT Minting**: Upon successful delivery, a Digital Product Passport (pNFT) is minted to the user's wallet via Metaplex, serving as a permanent record of ownership and authenticity.

---

## 🧪 6. Current Development State & Simulation

The project currently supports a **Simulation Mode** (useful for demos, hackathons, or offline development). 

### What is Simulation Mode?
When `SIMULATION_MODE` is active, the frontend stubs out real Solana RPC calls and instead returns realistic mock data (with artificial latency) in `lib/solana-service.ts`.
- **Escrow**: Generates a mock transaction signature and Solscan link.
- **Database**: Falls back to `localStorage` if Supabase environment variables are missing.
- **Supply**: Uses a local variable state for drop counts to ensure the demo UI reacts correctly to purchases.

### Transitioning to Live Mode
To connect the UI to the actual Solana devnet and your live database:
1. Ensure all environment variables are correctly populated.
2. Set `NEXT_PUBLIC_SIMULATION_MODE=false`.

---

## 🚀 7. Deployment & Infrastructure

Circuit uses modern PaaS providers to ensure high availability and ease of deployment.

### 7.1 Supabase (Database & Authentication)
Supabase provides our PostgreSQL database and handles off-chain persistence.
- **Configuration**: Ensure you create the necessary tables before going live:
  - `users` (id, email, wallet_address, private_key). *(Note: For production, `private_key` must be encrypted before storage).*
  - `orders` (id, email, drop_id, tx_signature, escrow_pda, amount_usd, size, quantity, status).
- **Environment Variables**: Get your `URL`, `Anon Key`, and `Service Role Key` from your Supabase Project Settings and add them to both Vercel and Railway dashboards.

### 7.2 Railway (Backend Deployment)
The Node.js Express backend is deployed on [Railway](https://railway.app/).
- **Configuration**: The project uses the `backend/railway.json` configuration file, which utilizes the `NIXPACKS` builder and automatically runs `node src/server.js`.
- **Deployment Process**:
  1. Link your GitHub repository to a new Railway project.
  2. Set the Root Directory in Railway settings to `/backend`.
  3. Add the production environment variables (from `.env` section 4.1) directly into the Railway variables dashboard.
  4. Railway will automatically build and expose the backend at a `.up.railway.app` URL. Update the frontend's `NEXT_PUBLIC_BACKEND_URL` to point here.

### 7.3 Vercel (Frontend Deployment)
The Next.js application is deployed on [Vercel](https://vercel.com).
- **Configuration**: Standard Next.js deployment. Set the Root Directory to `/app`.
- **Environment Variables**: Add all `.env.local` variables to the Vercel project settings, ensuring `NEXT_PUBLIC_SIMULATION_MODE` is explicitly set to `false` in production.

---
*For detailed, copy-paste ready code snippets for integrating the smart contracts, please reference [INTEGRATION.md](../INTEGRATION.md) and [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md).*
