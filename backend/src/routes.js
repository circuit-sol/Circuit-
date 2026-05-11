'use strict';

const express = require('express');
const router  = express.Router();
const { createWallet, getWallet } = require('./walletManager');
const { initializeEscrow, registerOrder, confirmDelivery } = require('./transactionService');

// ── Wallet ────────────────────────────────────────────────────────────────────

// POST /api/wallet/create  { userId }
router.post('/wallet/create', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const result = await createWallet(userId);
    console.log('✅ Wallet created!');
    console.log('User:', userId);
    console.log('Public key:', result.publicKey);
    res.json(result);
  } catch (err) {
    console.error('Error in /api/wallet/create:', err);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wallet/:userId
router.get('/wallet/:userId', async (req, res) => {
  try {
    const wallet = await getWallet(req.params.userId);
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
    res.json(wallet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Orders ────────────────────────────────────────────────────────────────────

// POST /api/orders/confirm  { userId, dropId, amountSol }
router.post('/orders/confirm', async (req, res) => {
  const { userId, dropId, amountSol } = req.body;
  if (!userId || !dropId || amountSol == null) {
    return res.status(400).json({ error: 'userId, dropId, amountSol are required' });
  }

  try {
    const result = await initializeEscrow(userId, dropId, Number(amountSol));
    console.log('✅ Order confirmed successfully!');
    console.log('User:', userId);
    console.log('Transaction signature:', result.signature);
    console.log('Escrow PDA:', result.escrowPDA);
    res.json(result);
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('DropSoldOut') || msg.includes('6000')) {
      return res.status(409).json({ error: 'DropSoldOut', message: 'This drop is sold out.' });
    }
    console.error('Error in /api/orders/confirm:', err);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: msg });
  }
});

// POST /api/orders/register  { userId, dropId }
router.post('/orders/register', async (req, res) => {
  const { userId, dropId } = req.body;
  if (!userId || !dropId) {
    return res.status(400).json({ error: 'userId and dropId are required' });
  }

  try {
    const result = await registerOrder(userId, dropId);
    res.json(result);
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('DropSoldOut') || msg.includes('6000')) {
      return res.status(409).json({ error: 'DropSoldOut', message: 'This drop is sold out.' });
    }
    console.error('Error in /api/orders/register:', err);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: msg });
  }
});

// POST /api/orders/delivery  { userId, dropId }
router.post('/orders/delivery', async (req, res) => {
  const { userId, dropId } = req.body;
  if (!userId || !dropId) {
    return res.status(400).json({ error: 'userId and dropId are required' });
  }

  try {
    const result = await confirmDelivery(userId, dropId);
    res.json(result);
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('Account does not exist')) {
      return res.status(404).json({ error: 'Escrow not found for this user + drop.' });
    }
    if (msg.includes('AlreadyDelivered') || msg.includes('6000')) {
      return res.status(409).json({ error: 'AlreadyDelivered', message: 'Delivery already confirmed.' });
    }
    console.error('Error in /api/orders/delivery:', err);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
