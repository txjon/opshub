-- 029_email_messages.sql
-- Project-scoped email thread storage (inbound + outbound)

CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_emails TEXT[] NOT NULL DEFAULT '{}',
  cc_emails TEXT[] DEFAULT '{}',
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  resend_message_id TEXT,
  in_reply_to TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_messages_job_id ON email_messages(job_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_created ON email_messages(created_at DESC);

-- RLS: authenticated users can read/write
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage email_messages"
  ON email_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);
