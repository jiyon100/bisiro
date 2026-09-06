const pool = require('../../db/pool');

/**
 * Fetch live inventory from the built-in tracker for a given user.
 */
async function fetchInventory(config, userId) {
  const result = await pool.query(
    `SELECT product_name, variant, total_stock AS stock, unit, price_php, notes, low_stock_threshold
     FROM business_inventory
     WHERE user_id = $1 AND is_active = true
     ORDER BY product_name`,
    [userId]
  );
  return result.rows;
}

/**
 * Format built-in inventory rows into a prompt-ready string.
 */
function formatForPrompt(rows) {
  if (!rows.length) return 'No inventory data available.';
  return rows.map(r => {
    const name  = r.variant ? `${r.product_name} (${r.variant})` : r.product_name;
    const qty   = `${r.stock} ${r.unit}`;
    const price = r.price_php ? ` — ₱${r.price_php}` : '';
    const low   = r.stock <= r.low_stock_threshold ? ' ⚠ LOW STOCK' : '';
    const notes = r.notes ? ` (${r.notes})` : '';
    return `${name}: ${qty}${price}${low}${notes}`;
  }).join('\n');
}

module.exports = { fetchInventory, formatForPrompt };
