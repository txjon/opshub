-- 089: per-tenant item-type list + per-item type tag.
--
-- DMD (cut-and-sew, single purchase point) doesn't use blanks at all — its
-- Product Builder offers a managed list of item types (its QB categories:
-- Tops, Bottoms, Jacket, +add new) instead of blank-supplier pickers.
--
-- company_item_types  — the editable per-tenant list (DMD-wide), RLS-scoped
--                       like every other tenant table (narrows to active
--                       company via current_user_company_ids()).
-- items.qb_item_type  — the picked type stored on the item (free text, no
--                       constraint). Maps to the QB product/service in Phase 2.
--                       DMD items keep garment_type='custom' for the cut-and-sew
--                       costing path; this column carries the display/QB type.

CREATE TABLE IF NOT EXISTS company_item_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_company_item_types_company ON company_item_types(company_id);

ALTER TABLE company_item_types ENABLE ROW LEVEL SECURITY;
-- Permissive: authenticated may operate; the restrictive scope below narrows
-- to the active tenant (matches the pattern in 060_rls_company_scope.sql).
DROP POLICY IF EXISTS company_item_types_all ON company_item_types;
CREATE POLICY company_item_types_all ON company_item_types FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS company_item_types_scope ON company_item_types;
CREATE POLICY company_item_types_scope ON company_item_types AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = ANY(public.current_user_company_ids()))
  WITH CHECK (company_id = ANY(public.current_user_company_ids()));

-- Auto-stamp company_id from the active subdomain on insert (so the client
-- doesn't need to know the company uuid). Same trigger fn the other scoped
-- tables use (mig 067).
DROP TRIGGER IF EXISTS company_item_types_default_company ON company_item_types;
CREATE TRIGGER company_item_types_default_company
  BEFORE INSERT ON company_item_types
  FOR EACH ROW EXECUTE FUNCTION default_company_id_to_hpd();

ALTER TABLE items ADD COLUMN IF NOT EXISTS qb_item_type text;
COMMENT ON COLUMN items.qb_item_type IS 'Cut-and-sew item type / QB category (DMD). garment_type stays custom; this carries the display + QB product mapping.';
