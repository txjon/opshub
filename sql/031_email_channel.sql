-- 031_email_channel.sql
-- Add channel + decorator_id to email_messages for separating client vs production threads

ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'client' CHECK (channel IN ('client', 'production'));
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS decorator_id UUID REFERENCES decorators(id);
CREATE INDEX IF NOT EXISTS idx_email_messages_channel ON email_messages(job_id, channel);
