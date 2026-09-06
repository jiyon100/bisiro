CREATE TABLE IF NOT EXISTS pricing_config (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value NUMERIC(18, 10) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial pricing values
-- Token prices from PROJECT_SPEC §3: Haiku 4.5 = $1/1M in, $5/1M out; Sonnet 4.6 = $3/1M in, $15/1M out
-- 2.9x markup — see PROJECT_SPEC.md §2
INSERT INTO pricing_config (key, value) VALUES
  ('markup_multiplier',                    2.9),
  ('usd_to_php_rate',                      58),
  ('haiku_input_price_per_token_usd',      0.000001),
  ('haiku_output_price_per_token_usd',     0.000005),
  ('sonnet_input_price_per_token_usd',     0.000003),
  ('sonnet_output_price_per_token_usd',    0.000015)
ON CONFLICT (key) DO NOTHING;
