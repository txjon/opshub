-- Art Studio: external design team workflow
-- Replaces Slack for art brief → WIP → final → approval pipeline

-- ── ART BRIEFS ──
-- One brief per art need. Multiple briefs possible per item (revisions, concept changes).
CREATE TABLE IF NOT EXISTS art_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid REFERENCES items(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  title text,
  concept text,
  placement text,
  colors text,
  reference_urls jsonb DEFAULT '[]',
  deadline date,
  internal_notes text,
  state text DEFAULT 'draft' CHECK (state IN ('draft','sent','in_progress','wip_review','client_review','revisions','final_approved','delivered')),
  assigned_to text,
  version_count int DEFAULT 0,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS art_briefs_item_id_idx ON art_briefs(item_id);
CREATE INDEX IF NOT EXISTS art_briefs_job_id_idx ON art_briefs(job_id);
CREATE INDEX IF NOT EXISTS art_briefs_state_idx ON art_briefs(state);

-- ── ART BRIEF FILES ──
-- Versioned WIPs and finals per brief.
CREATE TABLE IF NOT EXISTS art_brief_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id uuid REFERENCES art_briefs(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  drive_file_id text,
  drive_link text,
  mime_type text,
  file_size int,
  version int DEFAULT 1,
  kind text CHECK (kind IN ('reference','wip','final','client_intake')),
  notes text,
  uploaded_by uuid REFERENCES profiles(id),
  uploader_role text DEFAULT 'hpd' CHECK (uploader_role IN ('hpd','designer','client')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS art_brief_files_brief_id_idx ON art_brief_files(brief_id);

-- ── ART BRIEF MESSAGES ──
-- Threaded chat per brief. Scoped by visibility.
CREATE TABLE IF NOT EXISTS art_brief_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id uuid REFERENCES art_briefs(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('hpd','designer','client')),
  sender_name text,
  sender_id uuid REFERENCES profiles(id),
  message text NOT NULL,
  visibility text DEFAULT 'all' CHECK (visibility IN ('all','hpd_only','hpd_designer')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS art_brief_messages_brief_id_idx ON art_brief_messages(brief_id);

-- ── ART CLIENT REQUESTS ──
-- Client intake submissions before HPD translates to a designer brief.
CREATE TABLE IF NOT EXISTS art_client_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid REFERENCES items(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  brief_id uuid REFERENCES art_briefs(id) ON DELETE SET NULL,
  concept text,
  directions text,
  reference_urls jsonb DEFAULT '[]',
  state text DEFAULT 'new' CHECK (state IN ('new','reviewed','translated','rejected')),
  submitted_by_contact text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS art_client_requests_item_id_idx ON art_client_requests(item_id);
CREATE INDEX IF NOT EXISTS art_client_requests_state_idx ON art_client_requests(state);

-- ── RLS POLICIES ──
ALTER TABLE art_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE art_brief_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE art_brief_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE art_client_requests ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read/write (internal team). External designer/client access goes through token-verified API routes.
CREATE POLICY "Authenticated users manage art_briefs" ON art_briefs FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users manage art_brief_files" ON art_brief_files FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users manage art_brief_messages" ON art_brief_messages FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users manage art_client_requests" ON art_client_requests FOR ALL USING (auth.uid() IS NOT NULL);
