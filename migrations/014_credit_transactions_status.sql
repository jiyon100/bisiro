-- Extend credit_transactions for pending payment tracking and setup_fee type.
-- Drop the old CHECK constraint on type so we can add 'setup_fee'.
ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_type_check;

ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_type_check
  CHECK (type IN ('topup', 'deduction', 'setup_fee', 'refund'));

-- Status column: 'pending' until webhook fires, then 'confirmed'.
-- Existing rows are settled — default to 'confirmed'.
ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'confirmed';

ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_credit_transactions_status ON credit_transactions(status);
