CREATE TABLE IF NOT EXISTS agent_configs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  system_prompt TEXT NOT NULL,
  business_context TEXT,
  tone VARCHAR(50),
  language_preference VARCHAR(50) DEFAULT 'taglish',
  sample_messages TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
