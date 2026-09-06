const pool        = require('../../db/pool');
const googleSheets = require('./googleSheets');
const builtIn      = require('./builtIn');

const CONNECTORS = {
  google_sheets: googleSheets,
  // airtable: require('./airtable'),  // future
  // shopify:  require('./shopify'),   // future
};

/**
 * Fetch live inventory context for a user.
 * Priority: built-in tracker (if user has inventory_access) → external integration → null.
 * @param {number} userId
 * @returns {string|null}
 */
async function getInventoryContext(userId) {
  // 1. Check built-in tracker first (premium feature)
  const userResult = await pool.query(
    'SELECT inventory_access FROM users WHERE id = $1',
    [userId]
  );
  if (userResult.rows[0]?.inventory_access) {
    try {
      const rows    = await builtIn.fetchInventory({}, userId);
      if (rows.length) return builtIn.formatForPrompt(rows);
    } catch (err) {
      console.error('Built-in inventory fetch failed:', err.message);
    }
  }

  // 2. Fall back to external integration (Google Sheets, etc.)
  const intResult = await pool.query(
    'SELECT type, config_json FROM integrations WHERE user_id = $1 AND is_active = true LIMIT 1',
    [userId]
  );
  if (!intResult.rows.length) return null;

  const { type, config_json: config } = intResult.rows[0];
  const connector = CONNECTORS[type];
  if (!connector) return null;

  try {
    const rows = await connector.fetchInventory(config);
    await pool.query(
      'UPDATE integrations SET last_synced_at = NOW() WHERE user_id = $1 AND type = $2',
      [userId, type]
    );
    return connector.formatForPrompt(rows);
  } catch (err) {
    console.error(`External inventory fetch failed (${type}):`, err.message);
    return null;
  }
}

/**
 * Check if a user qualifies for inventory_access based on monthly top-ups.
 * Grants access if total top-ups in the last 30 days >= ₱1,000.
 * Called after every successful top-up payment.
 */
async function refreshInventoryAccess(userId) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(amount_php), 0) AS total
     FROM credit_transactions
     WHERE user_id = $1 AND type = 'topup' AND created_at >= NOW() - INTERVAL '30 days'`,
    [userId]
  );
  const total   = parseFloat(result.rows[0].total);
  const granted = total >= 1000;
  await pool.query('UPDATE users SET inventory_access = $1 WHERE id = $2', [granted, userId]);
  return granted;
}

module.exports = { getInventoryContext, refreshInventoryAccess };
