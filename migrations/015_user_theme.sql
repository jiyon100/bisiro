-- Per-user theme preference (dark mode) and per-business brand color.
-- 'light' | 'dark' | 'system' — 'system' follows the owner's OS preference client-side.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS theme_mode VARCHAR(10) NOT NULL DEFAULT 'light'
    CHECK (theme_mode IN ('light', 'dark', 'system'));

-- Hex color, defaults to the platform's current blue-600.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS brand_color VARCHAR(7) NOT NULL DEFAULT '#2563eb';
