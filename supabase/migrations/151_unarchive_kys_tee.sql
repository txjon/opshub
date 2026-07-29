-- 151: unarchive the KYS Tee V2 (HPD-2607-017) — Jon wants it live in FOG's
-- pipeline In-Stock lane (2026-07-28). It was archived post-entry; under the
-- new 30-day in-stock window manual archive wins, so the flag comes off.
-- (The Nalgenes + Tee 3-PACK stay archived — Jon's explicit pick.)
-- NOTE first apply targeted the wrong id (66ec1899… = a scratch-job test item,
-- harmless null→null no-op); this corrected version targets the real item.
update items set archived_at = null
where id = 'fa11456e-b059-47e2-b842-c52d97fe9f94';
