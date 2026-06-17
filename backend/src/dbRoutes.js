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

// POST /api/db/orders  { email, drop_id, tx_signature, escrow_pda, amount_usd, size?, quantity? }
router.post('/db/orders', async (req, res) => {
  const { email, drop_id, tx_signature, escrow_pda, amount_usd } = req.body;

  if (!email || !drop_id || !tx_signature || !escrow_pda || amount_usd == null) {
    return res.status(400).json({ error: 'email, drop_id, tx_signature, escrow_pda, and amount_usd are required' });
  }

  try {
    const payload = { email, drop_id, tx_signature, escrow_pda, amount_usd };
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

// GET /api/db/orders/count/:dropId  — order count for a drop (supply display)
router.get('/db/orders/count/:dropId', async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('drop_id', req.params.dropId);

    if (error) {
      console.error('Order count Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ count: count ?? 0 });
  } catch (err) {
    console.error('Error in GET /api/db/orders/count/:dropId:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/db/orders/by-tx/:txSignature  — single order lookup by transaction signature
router.get('/db/orders/by-tx/:txSignature', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('tx_signature', req.params.txSignature)
      .maybeSingle();

    if (error) {
      console.error('Order by-tx Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    if (!data) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(data);
  } catch (err) {
    console.error('Error in GET /api/db/orders/by-tx/:txSignature:', err);
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

// PATCH /api/db/orders/lifecycle
router.patch('/db/orders/lifecycle', async (req, res) => {
  const { orderId, status, garmentSerial, mintAddress } = req.body;

  if (!orderId || !status) {
    return res.status(400).json({ error: 'orderId and status are required' });
  }

  try {
    const updatePayload = { status };
    if (garmentSerial !== undefined) updatePayload.garment_serial = garmentSerial;
    if (mintAddress !== undefined) updatePayload.mint_address = mintAddress;

    const { data, error } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', orderId)
      .select();

    if (error) {
      console.error('Update lifecycle Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Error in PATCH /api/db/orders/lifecycle:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/db/orders/shipment
router.patch('/db/orders/shipment', async (req, res) => {
  const { orderId, details } = req.body;

  if (!orderId || details === undefined) {
    return res.status(400).json({ error: 'orderId and details are required' });
  }

  try {
    const { data, error } = await supabase
      .from('orders')
      .update({ shipment_details: details })
      .eq('id', orderId)
      .select();

    if (error) {
      console.error('Update shipment Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Error in PATCH /api/db/orders/shipment:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Editions ──────────────────────────────────────────────────────────────────

// GET /api/editions  — all active editions
router.get('/editions', async (req, res) => {
  try {
    const activeOnly = req.query.active !== 'false';
    let query = supabase.from('editions').select('*');
    
    if (activeOnly) {
      query = query.eq('is_active', true);
    }
    
    const { data, error } = await query.order('created_at', { ascending: true });

    if (error) {
      console.error('Get all editions Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    // Proxy image URLs
    const proxyData = (data || []).map(edition => {
      if (edition.images) {
        edition.images = edition.images.map(img => {
          if (img.url && img.url.includes('supabase')) {
            return { ...img, url: `/api/proxy-image?url=${encodeURIComponent(img.url)}` };
          }
          return img;
        });
      }
      return edition;
    });

    res.json(proxyData);
  } catch (err) {
    console.error('Error in GET /api/editions:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/editions/:id  — specific edition
router.get('/editions/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('editions')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) {
      console.error('Get edition by ID Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    
    if (!data) {
      return res.status(404).json({ error: 'Edition not found' });
    }

    // Proxy image URLs
    if (data.images) {
      data.images = data.images.map(img => {
        if (img.url && img.url.includes('supabase')) {
          return { ...img, url: `/api/proxy-image?url=${encodeURIComponent(img.url)}` };
        }
        return img;
      });
    }

    res.json(data);
  } catch (err) {
    console.error('Error in GET /api/editions/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/editions  — insert/update edition
router.post('/editions', async (req, res) => {
  try {
    const editionData = req.body;
    
    // Ensure image_url is provided to avoid NOT NULL constraint errors
    const payload = {
      ...editionData,
      image_url: editionData.images?.[0]?.url || '/satin.png'
    };
    
    const { data, error } = await supabase
      .from('editions')
      .upsert(payload, { onConflict: 'id' })
      .select();
      
    if (error) {
      console.error('Save edition Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Error in POST /api/editions:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/editions/image — upload Base64 image
router.post('/editions/image', async (req, res) => {
  try {
    const { id, fileName, contentType, base64Data } = req.body;
    if (!base64Data || !fileName || !id) {
      return res.status(400).json({ error: 'Missing required image payload fields' });
    }

    // Convert Base64 back to binary buffer
    // base64Data usually comes as "data:image/png;base64,iVBORw0KGgo..."
    const base64String = base64Data.split(',')[1] || base64Data;
    const buffer = Buffer.from(base64String, 'base64');
    
    const safeFileName = `${id}-${Date.now()}-${fileName}`;
    const filePath = `collections/${safeFileName}`;

    const { error: uploadError } = await supabase.storage
      .from('collection-images')
      .upload(filePath, buffer, {
        contentType: contentType || 'image/png',
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload image Supabase error:', uploadError.message);
      return res.status(500).json({ error: uploadError.message });
    }

    const { data } = supabase.storage
      .from('collection-images')
      .getPublicUrl(filePath);

    res.json({ publicUrl: data.publicUrl });
  } catch (err) {
    console.error('Error in POST /api/editions/image:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/editions/image — delete image from storage
router.delete('/editions/image', async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ error: 'imageUrl is required' });
    }
    
    // Ignore placeholder
    if (!imageUrl.includes('supabase.co') && !imageUrl.includes('supabase.in')) {
      return res.json({ success: true }); 
    }

    // Extract file path from public URL
    const parts = imageUrl.split('/collection-images/');
    if (parts.length < 2) return res.status(400).json({ error: 'Invalid Supabase URL format' });
    const filePath = decodeURIComponent(parts[1]);

    const { error } = await supabase.storage
      .from('collection-images')
      .remove([filePath]);

    if (error) {
      console.error('Delete image Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error in DELETE /api/editions/image:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/proxy-image — Fetch image from Supabase privately
router.get('/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl || !imageUrl.startsWith(process.env.SUPABASE_URL)) {
    return res.status(403).json({ error: 'Forbidden or Invalid URL' });
  }

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    res.set('Content-Type', response.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Error in proxy-image:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
