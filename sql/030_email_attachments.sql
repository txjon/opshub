-- 030_email_attachments.sql
-- Add attachments metadata to email_messages (no file data — fetched on demand from Gmail)

ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';
-- Format: [{ "filename": "photo.jpg", "mimeType": "image/jpeg", "size": 12345, "gmailMessageId": "...", "attachmentId": "..." }]
