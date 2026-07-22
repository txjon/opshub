-- 142: internal-until-shared (Jon, Jul 22). HPD-born ideas (the Counter,
-- flips, archive pulls) can prep quietly before the client sees them.
-- false = visible in the client's hub (all existing briefs stay visible).
alter table art_briefs add column if not exists internal_only boolean not null default false;
