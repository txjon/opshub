-- 156: social-style reactions on Lab designs (Jon, Aug 3 2026).
-- A client thumbs a design up (approve, locks that file) or down (pass — the
-- design drops into the "passed on" strip). 'down' is the only stored value
-- today; up resolves into lab_threads.approved_file_url as before.
alter table lab_messages add column if not exists reaction text;
