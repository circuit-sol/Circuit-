# Circuit Protocol

Circuit is a premier made-to-order fashion platform powered by Solana. We redefine the fashion supply chain by producing garments only after demand is confirmed on-chain.

👉 **New to the codebase? Start by reading our comprehensive [Developer Guide](docs/DEVELOPER_GUIDE.md).**
## 🌟 The Vision: "Invisible Blockchain"
Circuit provides a world-class luxury experience where the blockchain is a silent, robust engine.
- **Seamless Onboarding**: Users sign up with email/social accounts.
- **Automated Wallets**: Solana wallets are created behind the scenes, abstracting away the complexity of seed phrases.
- **Verifiable Provenance**: Every garment is minted as a unique Digital Product Passport (NFT) upon production.
- **On-Chain Security**: Escrow-based payments ensure funds are only released when milestones are met.

## 🏗️ Project Structure
- **/app**: The primary Next.js frontend application.
- **/programs**: Solana program source code (Anchor).
- **/services**: Shared utility services and blockchain handshake logic.

## 🚀 Tech Stack
- **Frontend**: Next.js 15, TypeScript, Tailwind CSS.
- **Backend/Auth**: Supabase (Database & Auth), LocalStorage persistence.
- **Blockchain**: Solana (Devnet), @solana/web3.js.

## 🛠️ Development Status
The project is currently in the **Hackathon MVP** stage.
- **Frontend**: Fully functional SPA with simulated on-chain flows and mock data.
- **Invisible Auth**: Persistent user-to-wallet mapping is active.
- **Deployment**: Configured for Vercel.

---
© 2026 Circuit Protocol. All rights reserved.
