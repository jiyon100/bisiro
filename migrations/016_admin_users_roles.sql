-- Add name, role, and is_active to admin_users for staff management.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS name VARCHAR(100);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'support';
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
