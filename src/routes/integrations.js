const express = require('express');
const pool    = require('../db/pool');
const { getInventoryContext } = require('../services/inventory');

const router = express.Router();

// GET /api/integrations — list integrations for the current user
router.get('/', async (req, res) => {
  const userId = req.session.userId || req.query.user_id || 1;
  const result = await pool.query(
    'SELECT id, type, config_json, is_active, last_synced_at FROM integrations WHERE user_id = $1 ORDER BY id',
    [userId]
  );
  // Mask any sensitive keys before returning
  const rows = result.rows.map(r => ({
    ...r,
    config_json: maskSecrets(r.config_json),
  }));
  res.json(rows);
});

// POST /api/integrations — save a new integration
router.post('/', async (req, res) => {
  const userId = req.session.userId || req.body.user_id || 1;
  const { type, config } = req.body;

  if (!type || !config) return res.status(400).json({ error: 'type and config are required' });

  const SUPPORTED = ['google_sheets'];
  if (!SUPPORTED.includes(type)) {
    return res.status(400).json({ error: `Unsupported type. Supported: ${SUPPORTED.join(', ')}` });
  }

  try {
    const result = await pool.query(
      `INSERT INTO integrations (user_id, type, config_json)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [userId, type, config]
    );
    res.json({ id: result.rows[0]?.id, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/integrations/:id — update config or toggle active
router.put('/:id', async (req, res) => {
  const { config, is_active } = req.body;
  const updates = [];
  const values  = [];
  if (config    !== undefined) { updates.push(`config_json = $${updates.length + 1}`); values.push(config); }
  if (is_active !== undefined) { updates.push(`is_active = $${updates.length + 1}`);   values.push(is_active); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(req.params.id);
  await pool.query(`UPDATE integrations SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
  res.json({ success: true });
});

// POST /api/integrations/test — fetch a preview of the inventory to verify the connection
router.post('/test', async (req, res) => {
  const userId = req.session.userId || req.body.user_id || 1;
  try {
    const context = await getInventoryContext(userId);
    if (!context) return res.status(404).json({ error: 'No active integration found for this user' });
    res.json({ preview: context });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Facebook pages ─────────────────────────────────────────────────────────

// GET /api/integrations/pages — list connected Facebook pages for a user
router.get('/pages', async (req, res) => {
  const uid = req.session.userId || req.query.user_id || 1;
  try {
    const { rows } = await pool.query(
      `SELECT id, page_id, page_name, is_active, automation_type, created_at
       FROM facebook_pages WHERE user_id = $1 ORDER BY page_name`,
      [uid]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/connect-page — save a new Facebook page connection
router.post('/connect-page', async (req, res) => {
  const uid = req.session.userId || req.body.user_id || 1;
  const { page_id, page_name, page_access_token } = req.body;
  if (!page_id) return res.status(400).json({ error: 'page_id is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO facebook_pages (user_id, page_id, page_name, page_access_token_encrypted, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (page_id) DO UPDATE
         SET page_name = EXCLUDED.page_name,
             page_access_token_encrypted = EXCLUDED.page_access_token_encrypted,
             is_active = true
       RETURNING id, page_id, page_name`,
      [uid, page_id, page_name || page_id, page_access_token || '']
    );
    res.json({ success: true, page: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/disconnect-page — remove a Facebook page connection
router.post('/disconnect-page', async (req, res) => {
  const uid = req.session.userId || req.body.user_id || 1;
  const { page_id } = req.body;
  if (!page_id) return res.status(400).json({ error: 'page_id is required' });
  try {
    await pool.query(
      `UPDATE facebook_pages SET is_active = false WHERE page_id = $1 AND user_id = $2`,
      [page_id, uid]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/pause-all — pause all AI automation for a user
router.post('/pause-all', async (req, res) => {
  const uid = req.session.userId || req.body.user_id || 1;
  try {
    await pool.query(
      `UPDATE conversations SET ai_paused = true, pause_type = 'pending', pause_started_at = NOW()
       WHERE user_id = $1 AND ai_paused = false`,
      [uid]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function maskSecrets(config) {
  if (!config) return config;
  const masked = { ...config };
  if (masked.api_key)     masked.api_key     = masked.api_key.slice(0, 6) + '...';
  if (masked.private_key) masked.private_key = '[hidden]';
  return masked;
}

module.exports = router;
