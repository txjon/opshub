-- Older proofs have a PDF but no stored spec (they predate the proof editor, or
-- were uploaded as files). They are still versions: their artifact is the file
-- that exists, they simply cannot be re-rendered. Allow that honestly rather
-- than leave a third of the history outside the model.
alter table public.proof_versions alter column spec drop not null;
