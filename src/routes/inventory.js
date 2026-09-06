const express = require('express');
const pool    = require('../db/pool');

const router = express.Router();

// Middleware — gate all routes behind inventory_access
async function requireInventoryAccess(req, res, next) {
  const userId = req.session.userId || req.query.user_id || req.body?.user_id || 1;
  req.userId   = userId;
  const result = await pool.query('SELECT inventory_access FROM users WHERE id = $1', [userId]);
  if (!result.rows[0]?.inventory_access) {
    return res.status(403).json({
      error: 'Inventory Tracker is a premium feature. Top up ₱1,000 or more this month to unlock it.',
      upgrade_required: true,
    });
  }
  next();
}

router.use(requireInventoryAccess);

// GET /api/inventory — list all items
router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT id, product_name, variant, sku, total_stock AS stock_qty, unit,
            low_stock_threshold, price_php, notes, is_active, last_updated_at
     FROM business_inventory
     WHERE user_id = $1
     ORDER BY product_name, variant`,
    [req.userId]
  );
  res.json(result.rows);
});

// POST /api/inventory — add a new product
router.post('/', async (req, res) => {
  const { product_name, variant, sku, stock_qty = 0, unit = 'pcs', low_stock_threshold = 5, price_php, notes } = req.body;
  if (!product_name) return res.status(400).json({ error: 'product_name is required' });

  const result = await pool.query(
    `INSERT INTO business_inventory
       (user_id, product_name, variant, sku, total_stock, unit, low_stock_threshold, price_php, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [req.userId, product_name, variant || null, sku || null, stock_qty, unit, low_stock_threshold, price_php || null, notes || null]
  );

  // Log the initial stock entry
  if (stock_qty > 0) {
    await pool.query(
      `INSERT INTO inventory_logs (user_id, inventory_id, change_type, quantity_before, quantity_change, quantity_after, note)
       VALUES ($1,$2,'initial',0,$3,$3,'Initial stock')`,
      [req.userId, result.rows[0].id, stock_qty]
    );
  }

  res.status(201).json(result.rows[0]);
});

// PUT /api/inventory/:id — edit product details
router.put('/:id', async (req, res) => {
  const { product_name, variant, sku, unit, low_stock_threshold, price_php, notes, is_active } = req.body;
  await pool.query(
    `UPDATE business_inventory SET
       product_name = COALESCE($1, product_name),
       variant = COALESCE($2, variant),
       sku = COALESCE($3, sku),
       unit = COALESCE($4, unit),
       low_stock_threshold = COALESCE($5, low_stock_threshold),
       price_php = COALESCE($6, price_php),
       notes = COALESCE($7, notes),
       is_active = COALESCE($8, is_active),
       last_updated_at = NOW()
     WHERE id = $9 AND user_id = $10`,
    [product_name, variant, sku, unit, low_stock_threshold, price_php, notes, is_active, req.params.id, req.userId]
  );
  res.json({ success: true });
});

// DELETE /api/inventory/:id — remove a product
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM business_inventory WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory/:id/adjust — add, deduct, or set stock
router.post('/:id/adjust', async (req, res) => {
  const { change_type, quantity, note } = req.body;
  // change_type: 'add' | 'deduct' | 'adjust'
  // quantity: always positive; for deduct it's subtracted

  if (!['add', 'deduct', 'adjust'].includes(change_type)) {
    return res.status(400).json({ error: 'change_type must be add, deduct, or adjust' });
  }
  if (quantity === undefined || quantity < 0) {
    return res.status(400).json({ error: 'quantity must be a non-negative number' });
  }

  const item = await pool.query(
    'SELECT total_stock FROM business_inventory WHERE id = $1 AND user_id = $2',
    [req.params.id, req.userId]
  );
  if (!item.rows.length) return res.status(404).json({ error: 'Item not found' });

  const before = item.rows[0].total_stock;
  let after, change;

  if (change_type === 'add')    { after = before + quantity; change = +quantity; }
  if (change_type === 'deduct') { after = Math.max(0, before - quantity); change = -(before - after); }
  if (change_type === 'adjust') { after = quantity; change = quantity - before; }

  await pool.query(
    'UPDATE business_inventory SET total_stock = $1, last_updated_at = NOW() WHERE id = $2',
    [after, req.params.id]
  );
  await pool.query(
    `INSERT INTO inventory_logs (user_id, inventory_id, change_type, quantity_before, quantity_change, quantity_after, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req.userId, req.params.id, change_type, before, change, after, note || null]
  );

  res.json({ before, after, change });
});

// GET /api/inventory/:id/logs — stock history for one item
router.get('/:id/logs', async (req, res) => {
  const result = await pool.query(
    `SELECT change_type, quantity_before, quantity_change, quantity_after, note, created_at
     FROM inventory_logs WHERE inventory_id = $1 AND user_id = $2
     ORDER BY created_at DESC LIMIT 50`,
    [req.params.id, req.userId]
  );
  res.json(result.rows);
});

// GET /api/inventory/alerts — items at or below low_stock_threshold
router.get('/alerts', async (req, res) => {
  const result = await pool.query(
    `SELECT id, product_name, variant, total_stock AS stock_qty, unit, low_stock_threshold
     FROM business_inventory
     WHERE user_id = $1 AND is_active = true AND total_stock <= low_stock_threshold
     ORDER BY total_stock ASC`,
    [req.userId]
  );
  res.json(result.rows);
});

module.exports = router;
