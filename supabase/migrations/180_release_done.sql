-- 180 — release status 'done' (Sep 17 2026). Multi-buy releases (Phase 4)
-- never reach 'cut' — they're bought out in one or more buys and stay
-- 'closed' forever, parked on The House / Releases as "your move" with a
-- stale "awaiting numbers" label (FOG August 26 Pre-Order). 'done' is the
-- explicit close: every line covered, the team marks it done.
alter table releases drop constraint if exists releases_status_check;
alter table releases add constraint releases_status_check
  check (status in ('building','ready','live','closed','cut','shelved','done'));
