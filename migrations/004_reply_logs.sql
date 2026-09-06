CREATE TABLE IF NOT EXISTS reply_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facebook_page_id INTEGER REFERENCES facebook_pages(id) ON DELETE SET NULL,
  reply_type VARCHAR(20) NOT NULL CHECK (reply_type IN ('comment', 'dm')),
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd NUMERIC(12, 8) NOT NULL,
  cost_php NUMERIC(12, 4) NOT NULL,
  message_preview VARCHAR(500),
  replied_at TIMESTAMPTZ DEFAULT NOW()
);
