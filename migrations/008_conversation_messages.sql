CREATE TABLE IF NOT EXISTS conversation_messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender VARCHAR(20) NOT NULL CHECK (sender IN ('customer', 'ai', 'owner')),
  content TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
