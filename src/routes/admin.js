const express  = require('express');
const crypto   = require('crypto');
const pool     = require('../db/pool');

const router = express.Router();

// Simple session-based admin auth (no external library needed)
function requireAdmin(req, res, next) {
  if (req.session.adminId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// POST /api/admin/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const { rows } = await pool.query('SELECT * FROM admin_users WHERE email = $1', [email]);
  if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

  const hash = crypto.createHash('sha256').update(password).digest('hex');
  if (hash !== rows[0].password_hash) return res.status(401).json({ error: 'Invalid credentials' });

  req.session.adminId    = rows[0].id;
  req.session.adminEmail = rows[0].email;
  req.session.adminRole  = rows[0].role || 'support';
  res.json({ ok: true, email: rows[0].email, role: req.session.adminRole });
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// GET /api/admin/me
router.get('/me', requireAdmin, (req, res) => {
  res.json({ email: req.session.adminEmail, role: req.session.adminRole || 'support' });
});

// ── Pricing config ──────────────────────────────────────────────────────────

// GET /api/admin/pricing
router.get('/pricing', requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT key, value FROM pricing_config ORDER BY key');
  res.json(rows);
});

// PUT /api/admin/pricing/:key
router.put('/pricing/:key', requireAdmin, async (req, res) => {
  const { value } = req.body;
  if (value === undefined || isNaN(parseFloat(value))) {
    return res.status(400).json({ error: 'value must be a number' });
  }
  await pool.query(
    'UPDATE pricing_config SET value = $1, updated_at = NOW() WHERE key = $2',
    [parseFloat(value), req.params.key]
  );
  res.json({ ok: true });
});

// ── Reply logs ──────────────────────────────────────────────────────────────

// GET /api/admin/reply-logs?user_id=&page_id=&from=&to=&limit=&offset=
router.get('/reply-logs', requireAdmin, async (req, res) => {
  const { user_id, page_id, from, to, limit = 50, offset = 0 } = req.query;

  const conditions = [];
  const params     = [];

  if (user_id) { params.push(user_id);   conditions.push(`u.id = $${params.length}`); }
  if (page_id) { params.push(page_id);   conditions.push(`rl.facebook_page_id = $${params.length}`); }
  if (from)    { params.push(from);      conditions.push(`rl.replied_at >= $${params.length}`); }
  if (to)      { params.push(to);        conditions.push(`rl.replied_at <= $${params.length}`); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  params.push(parseInt(limit));
  params.push(parseInt(offset));

  const { rows } = await pool.query(`
    SELECT rl.id, rl.facebook_page_id, rl.reply_type, rl.input_tokens, rl.output_tokens,
           rl.cost_usd, rl.cost_php, rl.message_preview, rl.replied_at,
           fp.page_name, u.email AS user_email, u.business_name
    FROM reply_logs rl
    LEFT JOIN facebook_pages fp ON fp.id = rl.facebook_page_id
    LEFT JOIN users u ON u.id = fp.user_id
    ${where}
    ORDER BY rl.replied_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  const count = await pool.query(`
    SELECT COUNT(*) FROM reply_logs rl
    LEFT JOIN facebook_pages fp ON fp.id = rl.facebook_page_id
    LEFT JOIN users u ON u.id = fp.user_id
    ${where}
  `, params.slice(0, params.length - 2));

  res.json({ rows, total: parseInt(count.rows[0].count) });
});

// ── Users & payments ────────────────────────────────────────────────────────

// GET /api/admin/users
router.get('/users', requireAdmin, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.email, u.business_name, u.credit_balance_php, u.setup_fee_paid, u.is_active, u.created_at,
           COUNT(fp.id) AS page_count
    FROM users u
    LEFT JOIN facebook_pages fp ON fp.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);
  res.json(rows);
});

// GET /api/admin/pending-payments
// Lists credit_transaction rows still in 'pending' state (webhook may have been missed)
router.get('/pending-payments', requireAdmin, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT ct.id, ct.user_id, ct.amount_php, ct.type, ct.description, ct.created_at,
           u.email AS user_email
    FROM credit_transactions ct
    JOIN users u ON u.id = ct.user_id
    WHERE ct.status = 'pending'
    ORDER BY ct.created_at DESC
  `);
  res.json(rows);
});

// POST /api/admin/approve-payment/:id
// Manual fallback: mark a pending transaction as confirmed and credit the user.
router.post('/approve-payment/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  const { rows } = await pool.query(
    "SELECT * FROM credit_transactions WHERE id = $1 AND status = 'pending'",
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Pending transaction not found' });

  const tx = rows[0];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "UPDATE credit_transactions SET status = 'confirmed', updated_at = NOW() WHERE id = $1",
      [id]
    );

    if (tx.type === 'setup_fee') {
      await client.query(
        'UPDATE users SET setup_fee_paid = true, is_active = true WHERE id = $1',
        [tx.user_id]
      );
    } else {
      // Top-up: credit balance and re-activate
      await client.query(
        `UPDATE users SET credit_balance_php = credit_balance_php + $1,
         is_active = true WHERE id = $2`,
        [tx.amount_php, tx.user_id]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Stats ───────────────────────────────────────────────────────────────────

// GET /api/admin/stats
router.get('/stats', requireAdmin, async (req, res) => {
  const [[users], [activeUsers], [replies], [revenue], [pending]] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM users').then(r => r.rows),
    pool.query("SELECT COUNT(*) FROM users WHERE is_active = true").then(r => r.rows),
    pool.query("SELECT COUNT(*) FROM reply_logs WHERE replied_at > NOW() - INTERVAL '24 hours'").then(r => r.rows),
    pool.query("SELECT COALESCE(SUM(amount_php),0) AS total FROM credit_transactions WHERE status='confirmed' AND type='topup' AND created_at > NOW() - INTERVAL '30 days'").then(r => r.rows),
    pool.query("SELECT COUNT(*) FROM credit_transactions WHERE status='pending'").then(r => r.rows),
  ]);

  res.json({
    total_users:         parseInt(users.count),
    active_users:        parseInt(activeUsers.count),
    replies_last_24h:    parseInt(replies.count),
    revenue_last_30d:    parseFloat(revenue.total),
    pending_payments:    parseInt(pending.count),
  });
});

// ── Per-user management ─────────────────────────────────────────────────────

// GET /api/admin/transactions — all credit transactions
router.get('/transactions', requireAdmin, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT ct.id, ct.user_id, ct.amount_php, ct.type, ct.description, ct.status, ct.created_at,
           u.email AS user_email, u.business_name
    FROM credit_transactions ct
    JOIN users u ON u.id = ct.user_id
    ORDER BY ct.created_at DESC
    LIMIT 200
  `);
  res.json(rows);
});

// GET /api/admin/user/:id/transactions
router.get('/user/:id/transactions', requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, amount_php, type, description, status, created_at
     FROM credit_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.params.id]
  );
  res.json(rows);
});

// POST /api/admin/user/:id/add-credit
router.post('/user/:id/add-credit', requireAdmin, async (req, res) => {
  const { amount_php, description = 'Admin credit adjustment' } = req.body;
  if (!amount_php || isNaN(parseFloat(amount_php))) return res.status(400).json({ error: 'amount_php required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE users SET credit_balance_php = credit_balance_php + $1 WHERE id = $2`,
      [parseFloat(amount_php), req.params.id]
    );
    await client.query(
      `INSERT INTO credit_transactions (user_id, amount_php, type, description, status)
       VALUES ($1, $2, 'topup', $3, 'confirmed')`,
      [req.params.id, parseFloat(amount_php), description]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/admin/user/:id/set-active
router.post('/user/:id/set-active', requireAdmin, async (req, res) => {
  const { is_active } = req.body;
  if (is_active === undefined) return res.status(400).json({ error: 'is_active required' });
  try {
    await pool.query(
      `UPDATE users SET is_active = $1 WHERE id = $2`,
      [!!is_active, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Staff management ────────────────────────────────────────────────────────

// GET /api/admin/staff
router.get('/staff', requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, email, role, is_active, created_at FROM admin_users ORDER BY created_at ASC'
  );
  res.json(rows);
});

// POST /api/admin/staff
router.post('/staff', requireAdmin, async (req, res) => {
  const { name, email, password, role = 'support' } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (!['super_admin', 'support'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  try {
    const { rows } = await pool.query(
      `INSERT INTO admin_users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, is_active, created_at`,
      [name || null, email, hash, role]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email already in use' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/staff/:id
router.patch('/staff/:id', requireAdmin, async (req, res) => {
  const { role, is_active, name } = req.body;
  const updates = [];
  const params  = [];
  if (role      !== undefined) { params.push(role);       updates.push(`role = $${params.length}`); }
  if (is_active !== undefined) { params.push(!!is_active); updates.push(`is_active = $${params.length}`); }
  if (name      !== undefined) { params.push(name);       updates.push(`name = $${params.length}`); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  await pool.query(`UPDATE admin_users SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
  res.json({ ok: true });
});

// DELETE /api/admin/staff/:id
router.delete('/staff/:id', requireAdmin, async (req, res) => {
  if (parseInt(req.params.id) === req.session.adminId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  await pool.query('DELETE FROM admin_users WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
