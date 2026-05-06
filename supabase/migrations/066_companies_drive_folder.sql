-- Per-tenant Drive root folder. When set, all Drive uploads for this
-- company are nested under this folder instead of the global
-- GOOGLE_DRIVE_ROOT_FOLDER_ID env var. Lets each tenant's files live
-- in a separate visible tree (HPD: legacy root, IHM: its own folder).
--
-- HPD's row stays NULL → falls back to the env var → existing files
-- and code paths unchanged. IHM's row gets populated manually after
-- the IHM Drive folder is created and shared with the service account.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS drive_folder_id text;
