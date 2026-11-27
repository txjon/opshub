-- Step 2 of mig 220: every planner lets go of its one release. The foreign
-- key (mig 192, ON DELETE RESTRICT) would otherwise block a client removing
-- a release a planner was born with. The code on prod before the Planner
-- ships already handles a null link. Releases themselves are untouched.
update line_sheets set release_id = null where release_id is not null;
