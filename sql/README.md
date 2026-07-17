# ARCHIVE — do not add files here

These numbered files (021-032) were applied out-of-band during early client/
decorator-portal development and their numbers COLLIDE with entirely different
migrations in `supabase/migrations/` (e.g. sql/022_staging_boards.sql vs
supabase/migrations/022_art_studio_standalone.sql). They are kept only as a
historical record of what was run.

**All new schema changes go in `supabase/migrations/` with the next number
there.** Never renumber or re-run anything in this directory.
