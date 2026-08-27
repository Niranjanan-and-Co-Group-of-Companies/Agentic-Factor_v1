-- Platform welcome messages — generated daily by Inngest cron via Claude.
-- Random message shown on Command Center empty state instead of failure alerts.

CREATE TABLE IF NOT EXISTS platform_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message     TEXT        NOT NULL,
  batch_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS platform_messages_batch_date_idx ON platform_messages (batch_date DESC);

-- Service role can read/write; anon cannot
ALTER TABLE platform_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON platform_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
