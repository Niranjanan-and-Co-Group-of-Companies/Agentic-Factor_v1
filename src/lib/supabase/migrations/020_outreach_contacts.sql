-- ============================================================
-- Migration 020: Outreach Contacts
--
-- Tracks every company the outreach mission has contacted so
-- agents never email the same domain twice. A single atomic
-- upsert serves as both the deduplication check and the
-- record — no double-send even under concurrent runs.
-- ============================================================

CREATE TABLE outreach_contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  domain       TEXT NOT NULL,
  company_name TEXT,
  email        TEXT,
  status       TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'replied', 'bounced', 'unsubscribed')),
  notes        TEXT,
  first_sent_at TIMESTAMPTZ DEFAULT now(),
  last_sent_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, domain)
);

ALTER TABLE outreach_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants see own outreach contacts" ON outreach_contacts
  FOR ALL USING (tenant_id = auth.uid());

CREATE INDEX idx_outreach_contacts_tenant ON outreach_contacts(tenant_id);
CREATE INDEX idx_outreach_contacts_domain  ON outreach_contacts(tenant_id, domain);
