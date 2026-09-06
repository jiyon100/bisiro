CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facebook_page_id INTEGER REFERENCES facebook_pages(id) ON DELETE SET NULL,
  customer_psid VARCHAR(100) NOT NULL,
  customer_name VARCHAR(255),
  ai_paused BOOLEAN DEFAULT FALSE,
  pause_type VARCHAR(20) CHECK (pause_type IN ('complete', 'pending', null)),
  pause_started_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'closing', 'spam', 'ended')),
  outcome_tag VARCHAR(50) CHECK (outcome_tag IN ('closed_sale', 'follow_up', 'not_interested', 'custom', null)),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
