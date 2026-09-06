const express = require('express');
const pool    = require('../db/pool');
const { createCheckoutSession } = require('../services/paymongo');

const router = express.Router();
router.use((req, res, next) => {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
});

// Minimum top-up per PROJECT_SPEC §2
const MIN_TOPUP_PHP  = 500;
const SETUP_FEE_PHP  = 20000;

function requireUser(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

function userId(req) { return req.session.userId; }

// POST /api/payments/topup
// Creates a PayMongo Checkout Session for a credit top-up.
// PLACEHOLDER: requires PAYMONGO_SECRET_KEY in .env
router.post('/topup', async (req, res) => {
  try {
    const amount = parseFloat(req.body.amount_php);
    if (!amount || amount < MIN_TOPUP_PHP) {
      return res.status(400).json({ error: `Minimum top-up is ₱${MIN_TOPUP_PHP}` });
    }

    const uid = userId(req);
    const { checkoutUrl, sessionId } = await createCheckoutSession({
      amountPhp:   amount,
      description: `Bisiro Credit Top-up — ₱${amount}`,
      type:        'topup',
      userId:      uid,
    });

    // Record as pending so admin can approve manually if webhook is missed
    await pool.query(
      `INSERT INTO credit_transactions (user_id, type, amount_php, description, status)
       VALUES ($1, 'topup', $2, $3, 'pending')`,
      [uid, amount, `PayMongo session ${sessionId}`]
    );

    res.json({ checkout_url: checkoutUrl, session_id: sessionId });
  } catch (err) {
    console.error('Top-up error:', err.message);
    res.status(500).json({ error: 'Could not create checkout session. Check PAYMONGO_SECRET_KEY.' });
  }
});

// POST /api/payments/setup-fee
// Creates a PayMongo Checkout Session for the one-time ₱20,000 setup fee.
// PLACEHOLDER: requires PAYMONGO_SECRET_KEY in .env
router.post('/setup-fee', async (req, res) => {
  try {
    const uid = userId(req);

    const userResult = await pool.query('SELECT setup_fee_paid FROM users WHERE id = $1', [uid]);
    if (userResult.rows[0]?.setup_fee_paid) {
      return res.status(400).json({ error: 'Setup fee already paid.' });
    }

    const { checkoutUrl, sessionId } = await createCheckoutSession({
      amountPhp:   SETUP_FEE_PHP,
      description: 'Bisiro One-Time Setup Fee',
      type:        'setup_fee',
      userId:      uid,
    });

    await pool.query(
      `INSERT INTO credit_transactions (user_id, type, amount_php, description, status)
       VALUES ($1, 'setup_fee', $2, $3, 'pending')`,
      [uid, SETUP_FEE_PHP, `PayMongo session ${sessionId}`]
    );

    res.json({ checkout_url: checkoutUrl, session_id: sessionId });
  } catch (err) {
    console.error('Setup fee error:', err.message);
    res.status(500).json({ error: 'Could not create checkout session. Check PAYMONGO_SECRET_KEY.' });
  }
});

// GET /api/payments/balance
router.get('/balance', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT credit_balance_php, setup_fee_paid, is_active FROM users WHERE id = $1',
      [userId(req)]
    );
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payments/history
router.get('/history', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT type, amount_php, description, status, created_at
       FROM credit_transactions WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [userId(req)]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
