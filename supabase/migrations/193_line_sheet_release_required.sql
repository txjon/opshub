-- 193: finish 192 — APPLY AT THE PUSH that ships the release-scoped hub
-- line sheet (prod code before that still inserts sheets without a release
-- and gates the old standalone tab on 'linesheets').
alter table line_sheets alter column release_id set not null;
-- The standalone Line Sheet tab is gone; the sheet rides the 'releases' grant.
update clients set portal_features = array_remove(portal_features, 'linesheets')
  where 'linesheets' = any(portal_features);
notify pgrst, 'reload schema';
