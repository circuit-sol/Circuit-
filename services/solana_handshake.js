/**
 * ═══════════════════════════════════════════════════════════════════════
 * Circuit — Solana Service Layer (solana_handshake.js)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * This module abstracts all blockchain interactions behind clean functions.
 * In SIMULATION mode, realistic mock data is returned with simulated latency.
 * When SIMULATION is disabled, stubs are ready for Anchor RPC replacement.
 *
 * Source of Truth: Circuit-/INTEGRATION.md (backend-contracts branch)
 *
 * Program IDs (Devnet):
 *   Escrow:        8b866KXrU94jAEuZYNr8WTkuXJELPvu6eW1v89pSAUrN
 *   Drop Registry: 3i1KUa7S1FjRx34SzqRAKAYsp3S8AJkCB3x7odjua7kL
 *   Garment NFT:   G17eNpsCn4S2Xtr4f9t9fmgyf6ZVFEpdXnpqJBiBCFEo
 *
 * PDA Seeds:
 *   Escrow:  ["escrow", dropId, buyerPubkey]
 *   Drop:    ["drop", dropId]
 * ═══════════════════════════════════════════════════════════════════════
 */

const CircuitService = (() => {
    'use strict';

    // ── Configuration ────────────────────────────────────────────────────
    const SIMULATION_MODE = true;

    const CONFIG = {
        ESCROW_PROGRAM_ID:  '8b866KXrU94jAEuZYNr8WTkuXJELPvu6eW1v89pSAUrN',
        DROPS_PROGRAM_ID:   '3i1KUa7S1FjRx34SzqRAKAYsp3S8AJkCB3x7odjua7kL',
        GARMENT_MINT:       'G17eNpsCn4S2Xtr4f9t9fmgyf6ZVFEpdXnpqJBiBCFEo',
        RPC_ENDPOINT:       'https://api.devnet.solana.com',
        CLUSTER:            'devnet',
        DROP_ID:            'DROP001',
        DESIGNER_PUBKEY:    '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
        PRICE_SOL:          0.5,
        MAX_SUPPLY:         40,
    };

    // ── Helpers ──────────────────────────────────────────────────────────
    const SOLSCAN_BASE = 'https://solscan.io';

    function solscanTxUrl(sig) {
        return `${SOLSCAN_BASE}/tx/${sig}?cluster=${CONFIG.CLUSTER}`;
    }

    function solscanAccountUrl(addr) {
        return `${SOLSCAN_BASE}/account/${addr}?cluster=${CONFIG.CLUSTER}`;
    }

    function solscanTokenUrl(mint) {
        return `${SOLSCAN_BASE}/token/${mint}?cluster=${CONFIG.CLUSTER}`;
    }

    function genAddress() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
        let addr = '';
        for (let i = 0; i < 44; i++) addr += chars[Math.floor(Math.random() * chars.length)];
        return addr;
    }

    function genSignature() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
        let sig = '';
        for (let i = 0; i < 88; i++) sig += chars[Math.floor(Math.random() * chars.length)];
        return sig;
    }

    function truncateAddress(addr) {
        if (!addr || addr.length < 10) return addr;
        return addr.slice(0, 6) + '...' + addr.slice(-4);
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function randomDelay(min = 800, max = 2000) {
        return delay(min + Math.random() * (max - min));
    }

    // ── Internal State ───────────────────────────────────────────────────
    let _currentCount = 36; // Simulated starting count for demo

    // ── PDA Derivation (Stubs) ───────────────────────────────────────────

    /**
     * Derive Escrow PDA address.
     * Seeds: ["escrow", dropId, buyerPubkey]
     */
    function deriveEscrowPDA(dropId, buyerPubkey) {
        if (SIMULATION_MODE) {
            return genAddress();
        }
        // TODO: Replace with PublicKey.findProgramAddressSync(
        //   [Buffer.from("escrow"), Buffer.from(dropId), buyerPubkey.toBuffer()],
        //   new PublicKey(CONFIG.ESCROW_PROGRAM_ID)
        // );
        throw new Error('Live mode not implemented — see INTEGRATION.md §7');
    }

    /**
     * Derive Drop PDA address.
     * Seeds: ["drop", dropId]
     */
    function deriveDropPDA(dropId) {
        if (SIMULATION_MODE) {
            return genAddress();
        }
        // TODO: Replace with PublicKey.findProgramAddressSync(
        //   [Buffer.from("drop"), Buffer.from(dropId)],
        //   new PublicKey(CONFIG.DROPS_PROGRAM_ID)
        // );
        throw new Error('Live mode not implemented — see INTEGRATION.md §7');
    }

    // ── Service Functions ────────────────────────────────────────────────

    /**
     * Register an order on the Drop Registry, then lock payment in escrow.
     * Maps to INTEGRATION.md §9: placeOrder() sequence.
     *
     * @param {string} dropId
     * @param {number} amountSol
     * @param {string} buyerPubkey
     * @returns {Promise<{success, orderNumber, currentCount, maxSupply, txSignature, escrowPDA, solscanUrl}>}
     */
    async function initializeEscrow(dropId, amountSol, buyerPubkey) {
        if (SIMULATION_MODE) {
            await randomDelay(1200, 2200);

            // Simulate DropSoldOut (error code 6000)
            if (_currentCount >= CONFIG.MAX_SUPPLY) {
                throw {
                    code: 'DropSoldOut',
                    errorCode: 6000,
                    message: `Drop has reached maximum supply of ${CONFIG.MAX_SUPPLY}. No more orders can be registered.`,
                    program: 'circuit_drops',
                };
            }

            _currentCount++;
            const sig = genSignature();
            const escrowPDA = deriveEscrowPDA(dropId, buyerPubkey);

            return {
                success: true,
                orderNumber: _currentCount,
                currentCount: _currentCount,
                maxSupply: CONFIG.MAX_SUPPLY,
                txSignature: sig,
                escrowPDA: escrowPDA,
                solscanUrl: solscanTxUrl(sig),
            };
        }

        // TODO: Replace with Anchor RPC calls — see INTEGRATION.md §9
        // Step 1: registerOrder(dropsProgram, buyerWallet, dropId)
        // Step 2: initializeEscrow(escrowProgram, buyer, designerPubkey, dropId, amountSol)
        throw new Error('Live mode not implemented');
    }

    /**
     * Register an order on-chain (increment supply counter).
     * Maps to INTEGRATION.md §5.2: register_order.
     *
     * @param {string} dropId
     * @returns {Promise<{success, orderNumber, currentCount, maxSupply, txSignature}>}
     */
    async function registerOrder(dropId) {
        if (SIMULATION_MODE) {
            await randomDelay(800, 1500);

            if (_currentCount >= CONFIG.MAX_SUPPLY) {
                throw {
                    code: 'DropSoldOut',
                    errorCode: 6000,
                    message: `This drop is sold out.`,
                    program: 'circuit_drops',
                };
            }

            _currentCount++;
            const sig = genSignature();

            return {
                success: true,
                orderNumber: _currentCount,
                currentCount: _currentCount,
                maxSupply: CONFIG.MAX_SUPPLY,
                txSignature: sig,
            };
        }

        // TODO: see INTEGRATION.md §5.2
        throw new Error('Live mode not implemented');
    }

    /**
     * Confirm delivery — release escrowed funds to designer.
     * Maps to INTEGRATION.md §4.2: confirm_delivery.
     *
     * @param {string} escrowPDA
     * @param {string} dropId
     * @param {string} buyerPubkey
     * @returns {Promise<{success, txSignature, fundsReleased, designerAddress, solscanUrl}>}
     */
    async function confirmDelivery(escrowPDA, dropId, buyerPubkey) {
        if (SIMULATION_MODE) {
            await randomDelay(1500, 2500);

            const sig = genSignature();

            return {
                success: true,
                txSignature: sig,
                fundsReleased: CONFIG.PRICE_SOL,
                designerAddress: CONFIG.DESIGNER_PUBKEY,
                solscanUrl: solscanTxUrl(sig),
            };
        }

        // TODO: see INTEGRATION.md §4.2
        throw new Error('Live mode not implemented');
    }

    /**
     * Fetch current drop data from chain.
     * Maps to INTEGRATION.md §5.3: fetchDrop.
     *
     * @param {string} dropId
     * @returns {Promise<{dropId, maxSupply, currentCount, active, designerPubkey}>}
     */
    async function fetchDropData(dropId) {
        if (SIMULATION_MODE) {
            await randomDelay(400, 800);

            return {
                dropId: dropId || CONFIG.DROP_ID,
                maxSupply: CONFIG.MAX_SUPPLY,
                currentCount: _currentCount,
                active: true,
                designerPubkey: CONFIG.DESIGNER_PUBKEY,
            };
        }

        // TODO: see INTEGRATION.md §5.3
        throw new Error('Live mode not implemented');
    }

    /**
     * Fetch escrow account status.
     * Maps to INTEGRATION.md §4.3: fetchEscrow.
     *
     * @param {string} escrowPDA
     * @param {string} dropId
     * @param {string} buyerPubkey
     * @returns {Promise<{buyer, designer, amount, delivered, dropId} | null>}
     */
    async function fetchEscrowStatus(escrowPDA, dropId, buyerPubkey) {
        if (SIMULATION_MODE) {
            await randomDelay(300, 600);

            return {
                buyer: buyerPubkey || genAddress(),
                designer: CONFIG.DESIGNER_PUBKEY,
                amount: CONFIG.PRICE_SOL,
                delivered: false,
                dropId: dropId || CONFIG.DROP_ID,
            };
        }

        // TODO: see INTEGRATION.md §4.3
        throw new Error('Live mode not implemented');
    }

    /**
     * Fetch passport/NFT metadata.
     * Maps to INTEGRATION.md §6.1: fetchGarmentMetadata.
     *
     * @param {string} mintAddress
     * @returns {Promise<{garmentName, edition, dropId, productionDate, owner, creator, symbol, royaltyBps, mintAddress, solscanUrl}>}
     */
    async function fetchPassportData(mintAddress) {
        if (SIMULATION_MODE) {
            await randomDelay(500, 1000);

            const mint = mintAddress || CONFIG.GARMENT_MINT;

            return {
                garmentName: 'Circuit Drop 001 — Garment 01 of 40',
                edition: '01 of 40',
                dropId: CONFIG.DROP_ID,
                productionDate: 'May 2026',
                fabric: 'Nigerian Cotton',
                owner: genAddress(),
                creator: 'Circuit',
                symbol: 'CRCT',
                royaltyBps: 700,
                royaltyPercent: '7%',
                mintAddress: mint,
                isMutable: false,
                standard: 'Programmable Non-Fungible',
                solscanUrl: solscanTokenUrl(mint),
            };
        }

        // TODO: see INTEGRATION.md §6.1
        throw new Error('Live mode not implemented');
    }

    /**
     * Check if a wallet owns the garment NFT.
     * Maps to INTEGRATION.md §6.2: walletOwnsGarment.
     *
     * @param {string} walletAddress
     * @returns {Promise<boolean>}
     */
    async function walletOwnsGarment(walletAddress) {
        if (SIMULATION_MODE) {
            await randomDelay(300, 500);
            return true; // Always true in simulation for demo flow
        }

        // TODO: see INTEGRATION.md §6.2
        throw new Error('Live mode not implemented');
    }

    // ── Error Parser ─────────────────────────────────────────────────────
    /**
     * Parse Anchor/program errors into user-friendly messages.
     * Maps to INTEGRATION.md §8: Error Codes Reference.
     */
    function parseError(err) {
        if (!err) return 'An unexpected error occurred. Please try again.';

        const code = err.errorCode || err.code;
        const msg = err.message || err.toString?.() || '';

        // Escrow errors
        if (code === 'AlreadyDelivered' || code === 6000 && err.program === 'circuit_escrow') {
            return 'This order has already been confirmed.';
        }
        if (code === 'UnauthorizedBuyer' || code === 6001 && err.program === 'circuit_escrow') {
            return 'Only the original buyer can confirm delivery.';
        }
        if (code === 'InvalidDesigner' || code === 6002) {
            return 'Designer account mismatch. Please contact support.';
        }

        // Drop errors
        if (code === 'DropSoldOut' || (code === 6000 && err.program === 'circuit_drops')) {
            return `Drop has reached maximum supply. No more orders can be registered.`;
        }
        if (code === 'DropNotActive' || code === 6001 && err.program === 'circuit_drops') {
            return 'This drop is no longer active.';
        }

        // Wallet / network errors
        if (msg.includes('User rejected') || msg.includes('cancelled')) {
            return 'Transaction cancelled. You can try again when ready.';
        }
        if (msg.includes('Insufficient') || msg.includes('insufficient')) {
            return 'Insufficient funds. Get devnet SOL from faucet.solana.com';
        }
        if (msg.includes('Network') || msg.includes('fetch') || msg.includes('timeout')) {
            return 'Unable to reach Solana devnet. Please check your connection.';
        }

        return 'Transaction failed. Please try again.';
    }

    // ── Reset (Demo) ─────────────────────────────────────────────────────
    function resetState() {
        _currentCount = 36;
    }

    function setCount(n) {
        _currentCount = n;
    }

    function getCount() {
        return _currentCount;
    }

    // ── Init ─────────────────────────────────────────────────────────────
    if (SIMULATION_MODE) {
        console.log(
            '%c⚡ Circuit running in SIMULATION mode — mock data active',
            'color: #D1D1D1; font-weight: bold; font-size: 12px;'
        );
        console.log(
            '%cProgram IDs (Devnet):\n' +
            `  Escrow:        ${CONFIG.ESCROW_PROGRAM_ID}\n` +
            `  Drop Registry: ${CONFIG.DROPS_PROGRAM_ID}\n` +
            `  Garment NFT:   ${CONFIG.GARMENT_MINT}`,
            'color: #888; font-size: 10px;'
        );
    }

    // ── Public API ───────────────────────────────────────────────────────
    return {
        SIMULATION_MODE,
        CONFIG,

        // PDA derivation
        deriveEscrowPDA,
        deriveDropPDA,

        // Core transactions
        initializeEscrow,
        registerOrder,
        confirmDelivery,

        // Data fetching
        fetchDropData,
        fetchEscrowStatus,
        fetchPassportData,
        walletOwnsGarment,

        // Helpers
        solscanTxUrl,
        solscanAccountUrl,
        solscanTokenUrl,
        truncateAddress,
        genAddress,
        genSignature,
        parseError,

        // Demo
        resetState,
        setCount,
        getCount,
    };
})();
