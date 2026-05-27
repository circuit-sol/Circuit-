'use strict';

const express       = require('express');
const router        = express.Router();
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL)         throw new Error('SUPABASE_URL is not set in environment');
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY is not set in environment');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Admin Auth ────────────────────────────────────────────────────────────────

// POST /api/auth/admin  { identifier, password }  (identifier = email or username)
router.post('/auth/admin', async (req, res) => {
  const identifier = req.body.identifier || req.body.email;
  const password   = req.body.password   || req.body.passwordHash;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'identifier and password are required' });
  }

  try {
    const { data, error } = await supabase
      .from('admins')
      .select('id, email, username, created_at')
      .or(`email.eq.${identifier},username.eq.${identifier}`)
      .eq('password_hash', password)
      .maybeSingle();

    if (error) {
      console.error('Admin auth Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    if (!data) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({ success: true, admin: data });
  } catch (err) {
    console.error('Error in POST /api/auth/admin:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Users ─────────────────────────────────────────────────────────────────────

// POST /api/users  { email, wallet_address, private_key? }
router.post('/users', async (req, res) => {
  const { email, wallet_address, private_key } = req.body;

  if (!email || !wallet_address) {
    return res.status(400).json({ error: 'email and wallet_address are required' });
  }

  try {
    const payload = { email, wallet_address };
    if (private_key !== undefined) payload.private_key = private_key;

    const { data, error } = await supabase
      .from('users')
      .upsert(payload, { onConflict: 'email' })
      .select('id, email, wallet_address, created_at')
      .single();

    if (error) {
      console.error('Save user Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /api/users:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:email
router.get('/users/:email', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, wallet_address, created_at')
      .eq('email', decodeURIComponent(req.params.email))
      .maybeSingle();

    if (error) {
      console.error('Get user Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    if (!data) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(data);
  } catch (err) {
    console.error('Error in GET /api/users/:email:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Orders ────────────────────────────────────────────────────────────────────

// POST /api/db/orders  { email, drop_id, tx_signature, escrow_pda, amount_sol, size?, quantity? }
router.post('/db/orders', async (req, res) => {
  const { email, drop_id, tx_signature, escrow_pda, amount_sol } = req.body;

  if (!email || !drop_id || !tx_signature || !escrow_pda || amount_sol == null) {
    return res.status(400).json({ error: 'email, drop_id, tx_signature, escrow_pda, and amount_sol are required' });
  }

  try {
    const payload = { email, drop_id, tx_signature, escrow_pda, amount_sol };
    if (req.body.size     !== undefined) payload.size     = req.body.size;
    if (req.body.quantity !== undefined) payload.quantity = req.body.quantity;

    const { data, error } = await supabase
      .from('orders')
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error('Save order Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /api/db/orders:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/db/orders  — all orders (admin dashboard)
router.get('/db/orders', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Get all orders Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Error in GET /api/db/orders:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/db/orders/:email  — orders for a specific user
router.get('/db/orders/:email', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('email', decodeURIComponent(req.params.email))
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Get orders by email Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Error in GET /api/db/orders/:email:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/db/orders/delivery  — must be defined before /:txSignature/status
// Body: { email, delivery_location, delivery_address }
router.patch('/db/orders/delivery', async (req, res) => {
  const { email, delivery_location, delivery_address } = req.body;

  if (!email || !delivery_location || !delivery_address) {
    return res.status(400).json({ error: 'email, delivery_location, and delivery_address are required' });
  }

  try {
    const { data, error } = await supabase
      .from('orders')
      .update({ delivery_location, delivery_address })
      .eq('email', email)
      .eq('status', 'pending')
      .select();

    if (error) {
      console.error('Update delivery Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Error in PATCH /api/db/orders/delivery:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/db/orders/:txSignature/status  — { status }
router.patch('/db/orders/:txSignature/status', async (req, res) => {
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }

  try {
    const { data, error } = await supabase
      .from('orders')
      .update({ status })
      .eq('tx_signature', req.params.txSignature)
      .select();

    if (error) {
      console.error('Update order status Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Error in PATCH /api/db/orders/:txSignature/status:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
