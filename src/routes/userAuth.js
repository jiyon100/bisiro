const express = require('express');
const crypto  = require('crypto');
const pool    = require('../db/pool');
const { createCheckoutSession } = require('../services/paymongo');

const router = express.Router();

function requireUser(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// POST /api/user/signup
router.post('/signup', async (req, res) => {
  const { email, password, business_name, phone } = req.body;
  if (!email || !password || !business_name) {
    return res.status(400).json({ error: 'email, password and business_name required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const hash   = crypto.createHash('sha256').update(password).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, business_name, phone, is_active, setup_fee_paid)
       VALUES ($1, $2, $3, $4, false, false) RETURNING id`,
      [email.toLowerCase().trim(), hash, business_name.trim(), phone || null]
    );
    const newUserId = rows[0].id;

    const { checkoutUrl, sessionId } = await createCheckoutSession({
      amountPhp:   20000,
      description: 'Bisiro One-Time Setup Fee',
      type:        'setup_fee',
      userId:      newUserId,
    });

    await client.query(
      `INSERT INTO credit_transactions (user_id, type, amount_php, description, status)
       VALUES ($1, 'setup_fee', 20000, $2, 'pending')`,
      [newUserId, `PayMongo session ${sessionId}`]
    );

    await client.query('COMMIT');
    res.json({ checkout_url: checkoutUrl });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(400).json({ error: 'Email already registered' });
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  } finally {
    client.release();
  }
});

// POST /api/user/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const { rows } = await pool.query(
    'SELECT * FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

  const user = rows[0];
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  if (hash !== user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });

  req.session.userId      = user.id;
  req.session.userEmail   = user.email;

  res.json({
    ok:              true,
    email:           user.email,
    business_name:   user.business_name,
    setup_fee_paid:  user.setup_fee_paid,
    is_active:       user.is_active,
  });
});

// POST /api/user/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// GET /api/user/me
router.get('/me', requireUser, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, email, business_name, phone, credit_balance_php,
            setup_fee_paid, is_active, created_at
     FROM users WHERE id = $1`,
    [req.session.userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

module.exports = router;
module.exports.requireUser = requireUser;
