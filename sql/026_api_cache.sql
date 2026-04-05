-- 026_api_cache.sql
-- Server-side cache for slow external APIs (AS Colour, LA Apparel)

CREATE TABLE IF NOT EXISTS api_cache (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE api_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read api_cache"
  ON api_cache FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can write api_cache"
  ON api_cache FOR ALL TO authenticated USING (true) WITH CHECK (true);
