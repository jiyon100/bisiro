require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const session = require('express-session');
const pool    = require('./db/pool');

const app = express();
app.use(cors());
app.use(session({
  secret: process.env.SESSION_SECRET || 'bisiro-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }, // set true behind HTTPS in production
}));

// Webhooks must be mounted BEFORE express.json() so the PayMongo handler
// receives a raw Buffer for signature verification. The Facebook POST route
// applies express.json() itself.
app.use('/auth',             require('./routes/auth'));
app.use('/api/user',         require('./routes/userAuth'));
app.use('/webhooks',         require('./routes/webhooks'));

app.use(express.json());
app.use('/api/wizard',       require('./routes/wizard'));
app.use('/api/integrations', require('./routes/integrations'));
app.use('/api/inventory',    require('./routes/inventory'));
app.use('/api/payments',       require('./routes/payments'));
app.use('/api/conversations',  require('./routes/conversations'));
app.use('/api/admin',          require('./routes/admin'));
app.use('/api/settings',       require('./routes/settings'));
app.use(express.static('public'));

app.get('/', (req, res) => res.redirect('/login.html'));

app.get('/health', async (req, res) => {
  let dbOk = false;
  try {
    await pool.query('SELECT 1');
    dbOk = true;
  } catch (_) {}
  res.json({ status: 'ok', db: dbOk });
});

// Handoff resume timers — PROJECT_SPEC §7
// Runs every minute; lightweight (index on ai_paused + pause_type)
setInterval(async () => {
  try {
    // 'complete' pauses auto-resume after 30 min
    await pool.query(
      `UPDATE conversations
       SET ai_paused = false, pause_type = null, pause_started_at = null
       WHERE ai_paused = true AND pause_type = 'complete'
         AND pause_started_at < NOW() - INTERVAL '30 minutes'`
    );

    // 'pending' pauses: create a 24-hr safety-net notification if not already sent
    const stale = await pool.query(
      `SELECT id, user_id, customer_name FROM conversations
       WHERE ai_paused = true AND pause_type = 'pending'
         AND pause_started_at < NOW() - INTERVAL '24 hours'`
    );
    for (const conv of stale.rows) {
      const alreadyNotified = await pool.query(
        `SELECT id FROM notifications
         WHERE user_id = $1 AND type = 'pending_followup'
           AND message LIKE $2 AND created_at > NOW() - INTERVAL '24 hours'`,
        [conv.user_id, `%conversation ${conv.id}%`]
      );
      if (!alreadyNotified.rows.length) {
        await pool.query(
          `INSERT INTO notifications (user_id, type, message)
           VALUES ($1, 'pending_followup', $2)`,
          [conv.user_id,
           `${conv.customer_name || 'A customer'} is still waiting — you said you'd check back (conversation ${conv.id}). Don't leave them hanging!`]
        );
      }
    }
  } catch (err) {
    console.error('Resume timer error:', err.message);
  }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Kill other node processes first.`);
  else console.error('Server error:', err);
  process.exit(1);
});

module.exports = app;
