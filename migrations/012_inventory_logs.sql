-- Audit trail for stock changes (add, deduct, adjust)
CREATE TABLE IF NOT EXISTS inventory_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inventory_id INTEGER NOT NULL REFERENCES business_inventory(id) ON DELETE CASCADE,
  change_type VARCHAR(20) NOT NULL CHECK (change_type IN ('add', 'deduct', 'adjust', 'initial')),
  quantity_before INTEGER NOT NULL,
  quantity_change INTEGER NOT NULL,  -- positive = add, negative = deduct
  quantity_after INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
