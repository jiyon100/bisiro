const express = require('express');
const pool    = require('../db/pool');

const router = express.Router();

function userId(req) {
  return req.session.userId || req.query.user_id || req.body?.user_id || 1; // TODO: enforce session auth
}

// GET /api/settings/theme
router.get('/theme', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT theme_mode, brand_color FROM users WHERE id = $1',
      [userId(req)]
    );
    res.json(rows[0] || { theme_mode: 'light', brand_color: '#2563eb' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/theme  { theme_mode?: 'light'|'dark'|'system', brand_color?: '#RRGGBB' }
router.put('/theme', async (req, res) => {
  const { theme_mode, brand_color } = req.body;

  if (theme_mode && !['light', 'dark', 'system'].includes(theme_mode)) {
    return res.status(400).json({ error: 'Invalid theme_mode' });
  }
  if (brand_color && !/^#[0-9a-fA-F]{6}$/.test(brand_color)) {
    return res.status(400).json({ error: 'brand_color must be a hex color like #2563eb' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE users SET
         theme_mode  = COALESCE($1, theme_mode),
         brand_color = COALESCE($2, brand_color)
       WHERE id = $3
       RETURNING theme_mode, brand_color`,
      [theme_mode || null, brand_color || null, userId(req)]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/user — update business name and email
router.put('/user', async (req, res) => {
  const { business_name, email } = req.body;
  if (!business_name && !email) return res.status(400).json({ error: 'Nothing to update' });
  try {
    const { rows } = await pool.query(
      `UPDATE users SET
         business_name = COALESCE($1, business_name),
         email         = COALESCE($2, email),
         updated_at    = NOW()
       WHERE id = $3
       RETURNING id, email, business_name, credit_balance_php, is_active`,
      [business_name || null, email || null, userId(req)]
    );
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/user — user info for sidebar + balance display
router.get('/user', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, business_name, credit_balance_php, is_active,
              theme_mode, brand_color
       FROM users WHERE id = $1`,
      [userId(req)]
    );
    res.json(rows[0] || { business_name: 'Bisiro', credit_balance_php: 0, is_active: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
