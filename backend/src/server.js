'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const cors    = require('cors');
const routes    = require('./routes');
const dbRoutes  = require('./dbRoutes');

const app  = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = [
  'http://localhost:3000',
  'https://circuit-sol.vercel.app',
  'https://circuit-production-9fdc.up.railway.app',
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(new Error('CORS policy violation'), false);
    }
    return callback(null, true);
  },
  credentials: true,
}));

app.use(express.json());

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    cluster:   process.env.CLUSTER || 'devnet',
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ────────────────────────────────────────────────────────────────

app.use('/api', routes);
app.use('/api', dbRoutes);

// ── 404 fallback ─────────────────────────────────────────────────────────────

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('════════════════════════════════════════════════');
  console.log('  Circuit Backend');
  console.log('════════════════════════════════════════════════');
  console.log(`  Port    : ${PORT}`);
  console.log(`  Cluster : ${process.env.CLUSTER || 'devnet'}`);
  console.log(`  Escrow  : ${process.env.ESCROW_PROGRAM_ID}`);
  console.log(`  Drops   : ${process.env.DROPS_PROGRAM_ID}`);
  console.log('════════════════════════════════════════════════');
});
