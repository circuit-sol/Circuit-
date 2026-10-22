'use strict';
const express = require('express');
const { requireAuth } = require('./sessionAuth');

module.exports = function createBrandRoutes(db) {
  const router = express.Router();
  router.post('/', requireAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'INVALID_BODY' });
    }
    if (Object.keys(body).some(key => !['name', 'slug'].includes(key))) {
      return res.status(400).json({ error: 'UNSUPPORTED_FIELDS' });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
    if (!name || [...name].length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
      return res.status(400).json({ error: 'INVALID_BRAND_NAME' });
    }
    if (!slug || slug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return res.status(400).json({ error: 'INVALID_BRAND_SLUG' });
    }
    try {
      // Identity and initial payment wallet come only from the verified JWT.
      // The RPC rechecks the current DB wallet and inserts both records atomically.
      const { data, error } = await db.rpc('circuit_create_brand', {
        p_user_id: req.auth.userId,
        p_wallet_address: req.auth.walletAddress,
        p_name: name,
        p_slug: slug,
      });
      if (error) {
        if (error.code === '28000') return res.status(401).json({ error: 'INVALID_OR_EXPIRED_SESSION' });
        if (error.code === '23505') return res.status(409).json({ error: 'BRAND_SLUG_TAKEN' });
        if (error.code === '22023') return res.status(400).json({ error: 'INVALID_BRAND_DETAILS' });
        throw error;
      }
      return res.status(201).json({ brand: data });
    } catch (error) {
      console.error('Create brand failed:', error.code || 'UNKNOWN');
      return res.status(500).json({ error: 'BRAND_CREATE_FAILED' });
    }
  });
  return router;
};