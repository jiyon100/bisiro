const express = require('express');
const pool    = require('../db/pool');

const router = express.Router();

function userId(req) {
  return req.session.userId || req.query.user_id || 1; // TODO: enforce session auth
}

// Specific named routes MUST come before /:id to avoid being swallowed by the param route

// GET /api/conversations/stats/summary — metric cards for dashboard
router.get('/stats/summary', async (req, res) => {
  try {
    const uid = userId(req);
    const pageId = req.query.page_id || null;
    const pageFilter = pageId ? `AND facebook_page_id = ${parseInt(pageId, 10)}` : '';

    const [repliesResult, activeResult, alertsResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS count FROM reply_logs
         WHERE user_id = $1 AND replied_at > NOW() - INTERVAL '24 hours'`,
        [uid]
      ),
      pool.query(
        `SELECT COUNT(*) AS count FROM conversations
         WHERE user_id = $1 AND ai_paused = false AND status = 'ongoing' ${pageFilter}`,
        [uid]
      ),
      pool.query(
        `SELECT COUNT(*) AS count FROM conversations
         WHERE user_id = $1 AND (ai_paused = true OR status = 'closing') ${pageFilter}`,
        [uid]
      ),
    ]);

    res.json({
      replies_today:        parseInt(repliesResult.rows[0].count),
      active_conversations: parseInt(activeResult.rows[0].count),
      needs_attention:      parseInt(alertsResult.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations/pages/list — page switcher data
router.get('/pages/list', async (req, res) => {
  try {
    const uid = userId(req);
    const result = await pool.query(
      `SELECT id, page_id, page_name, is_active, automation_type
       FROM facebook_pages WHERE user_id = $1 ORDER BY page_name`,
      [uid]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations/notifications/list — unread notifications
router.get('/notifications/list', async (req, res) => {
  try {
    const uid = userId(req);
    const result = await pool.query(
      `SELECT id, type, message, created_at FROM notifications
       WHERE user_id = $1 AND is_read = false ORDER BY created_at DESC LIMIT 20`,
      [uid]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations/notifications/:id/read
router.post('/notifications/:id/read', async (req, res) => {
  try {
    const uid = userId(req);
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
      [req.params.id, uid]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations — list with status, filter by tab
// ?filter=all|needs_attention|automated   ?page_id=<facebook_pages.id>
router.get('/', async (req, res) => {
  try {
    const uid    = userId(req);
    const filter = req.query.filter || 'all';
    const pageId = req.query.page_id || null;

    let whereExtra = '';
    if (filter === 'needs_attention') {
      whereExtra = `AND (c.ai_paused = true OR c.status = 'closing')`;
    } else if (filter === 'automated') {
      whereExtra = `AND c.ai_paused = false AND c.status = 'ongoing'`;
    }

    const pageFilter = pageId ? `AND c.facebook_page_id = ${parseInt(pageId, 10)}` : '';

    const result = await pool.query(
      `SELECT c.id, c.customer_psid, c.customer_name, c.status, c.ai_paused, c.pause_type,
              c.last_message_at, c.pause_started_at,
              fp.page_name,
              (SELECT content FROM conversation_messages
               WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message
       FROM conversations c
       JOIN facebook_pages fp ON fp.id = c.facebook_page_id
       WHERE c.user_id = $1 ${whereExtra} ${pageFilter}
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT 50`,
      [uid]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations/:id — full thread
router.get('/:id', async (req, res) => {
  try {
    const uid = userId(req);
    const convResult = await pool.query(
      `SELECT c.*, fp.page_name FROM conversations c
       JOIN facebook_pages fp ON fp.id = c.facebook_page_id
       WHERE c.id = $1 AND c.user_id = $2`,
      [req.params.id, uid]
    );
    if (!convResult.rows[0]) return res.status(404).json({ error: 'Not found' });

    const messages = await pool.query(
      `SELECT sender, content, sent_at FROM conversation_messages
       WHERE conversation_id = $1 ORDER BY sent_at ASC`,
      [req.params.id]
    );

    res.json({ conversation: convResult.rows[0], messages: messages.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations/:id/take-over — owner manually pauses AI
router.post('/:id/take-over', async (req, res) => {
  try {
    const uid = userId(req);
    await pool.query(
      `UPDATE conversations
       SET ai_paused = true, pause_type = 'pending', pause_started_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, uid]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations/:id/resume-ai — owner re-enables AI
router.post('/:id/resume-ai', async (req, res) => {
  try {
    const uid = userId(req);
    await pool.query(
      `UPDATE conversations
       SET ai_paused = false, pause_type = null, pause_started_at = null
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, uid]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations/:id/manual-reply — owner sends a message manually
router.post('/:id/manual-reply', async (req, res) => {
  try {
    const uid = userId(req);
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });

    await pool.query(
      `INSERT INTO conversation_messages (conversation_id, sender, content)
       VALUES ($1, 'owner', $2)`,
      [req.params.id, content]
    );
    await pool.query(
      `UPDATE conversations SET last_message_at = NOW() WHERE id = $1 AND user_id = $2`,
      [req.params.id, uid]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
