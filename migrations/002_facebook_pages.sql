CREATE TABLE IF NOT EXISTS facebook_pages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id VARCHAR(100) UNIQUE NOT NULL,
  page_name VARCHAR(255) NOT NULL,
  page_access_token_encrypted TEXT NOT NULL,
  automate_comments BOOLEAN DEFAULT FALSE,
  automate_dms BOOLEAN DEFAULT TRUE,
  business_hours_json JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  connected_at TIMESTAMPTZ DEFAULT NOW()
);
