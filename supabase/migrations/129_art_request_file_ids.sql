-- Scope each art request to a SELECTED set of files (privacy — the outside
-- designer only sees what they need to price, not the whole job folder). Stores
-- item_files.id values; the gallery + token-scoped download route both filter
-- to this set. Empty = nothing shared. See the OpsHub art request feature.
alter table art_requests
  add column if not exists file_ids uuid[] not null default '{}';
