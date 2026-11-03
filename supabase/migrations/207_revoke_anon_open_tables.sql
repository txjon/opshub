-- 207: anon-key audit (Nov 3 2026). Of 110 tables, these three answered the
-- public anon key: favorites + la_apparel_catalog accepted anon INSERTs (RLS
-- off or an open policy, created outside migrations) and staging_item_messages
-- was anon-readable. Nothing uses them as anon: favorites is read/written by
-- signed-in staff (authenticated), la_apparel_catalog and staging messages go
-- through server routes on the service role (share-token access included).
revoke all on table public.favorites from anon;
revoke all on table public.la_apparel_catalog from anon;
revoke all on table public.staging_item_messages from anon;
notify pgrst, 'reload schema';
