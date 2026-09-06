-- Built-in inventory tracker — premium feature (requires ₱1,000/month top-up)
CREATE TABLE IF NOT EXISTS business_inventory (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_name VARCHAR(255) NOT NULL,
  variant VARCHAR(255),           -- size, color, flavor, model, etc.
  sku VARCHAR(100),               -- optional internal code
  total_stock INTEGER NOT NULL DEFAULT 0,
  unit VARCHAR(50) DEFAULT 'pcs', -- pcs, kg, liters, strips, etc.
  low_stock_threshold INTEGER DEFAULT 5,  -- alert when stock drops to this level
  price_php NUMERIC(12,2),        -- optional — overrides wizard price list if set
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track monthly top-up totals for feature gating
-- Add inventory_access flag to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS inventory_access BOOLEAN DEFAULT FALSE;
