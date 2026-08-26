-- 166: THE DESIGNER DOOR on the RUN (Jon, Aug 26 2026) — a work order can hang
-- off an ITEM (a job's run) as well as a design (art_brief). The July model:
-- creative bakes into the design; vector clean-up / separations live on the
-- item, and the accepted file becomes the item's print-ready file → the PO.
-- Replaces the in-job "Request art pricing" gallery (art_requests) for new sends.
alter table design_work_orders alter column brief_id drop not null;
alter table design_work_orders add column if not exists item_id uuid references items(id) on delete cascade;
alter table design_work_orders add column if not exists job_id uuid references jobs(id) on delete cascade;
alter table design_work_orders add column if not exists accepted_item_file_id uuid references item_files(id) on delete set null;
alter table design_work_orders drop constraint if exists design_work_orders_target_check;
alter table design_work_orders add constraint design_work_orders_target_check check (brief_id is not null or item_id is not null);
create index if not exists design_work_orders_item_idx on design_work_orders(item_id);
create index if not exists design_work_orders_job_idx on design_work_orders(job_id);

-- Deliveries on an item order are REAL item files (stage 'vector' while in
-- review, 'print_ready' once accepted). Loose attachments in the thread (our
-- references) ride as a Drive id only — they're not production files.
alter table design_wo_messages add column if not exists item_file_id uuid references item_files(id) on delete set null;
alter table design_wo_messages add column if not exists drive_file_id text;
