#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Find FOG Working job
  const { data: jobs } = await sb.from("jobs").select("id, title, client_id, clients(name)")
    .ilike("title", "%fog%working%").limit(5);
  console.log("FOG Working job(s):");
  (jobs || []).forEach(j => console.log(`  ${j.id}  "${j.title}"  client=${j.clients?.name}`));
  if (!jobs?.length) return;
  const job = jobs[0];

  // Items on the job
  const { data: items } = await sb.from("items")
    .select("id, name, drive_link")
    .eq("job_id", job.id)
    .order("sort_order");
  console.log(`\nItems on ${job.title}: ${items?.length || 0}`);
  (items || []).slice(0, 8).forEach(i => console.log(`  ${i.id}  "${i.name}"  drive=${i.drive_link ? "yes" : "no"}`));

  // item_files for those items
  const itemIds = (items || []).map(i => i.id);
  if (itemIds.length) {
    const { data: files } = await sb.from("item_files")
      .select("item_id, stage, file_name")
      .in("item_id", itemIds).is("superseded_at", null);
    console.log(`\nitem_files on those items: ${files?.length || 0}`);
  }

  // Staging boards for this client
  const { data: boards } = await sb.from("staging_boards")
    .select("id, name, summary_label, client_name")
    .ilike("client_name", "%forward%observations%");
  console.log(`\nStaging boards for client:`);
  (boards || []).forEach(b => console.log(`  ${b.id}  "${b.name}"  (${b.summary_label})  client=${b.client_name}`));

  if (boards?.length) {
    const boardId = boards[0].id;
    const { data: sItems } = await sb.from("staging_items")
      .select("id, item_name, qty")
      .eq("board_id", boardId);
    console.log(`\nStaging items on ${boards[0].name}: ${sItems?.length || 0}`);
    (sItems || []).slice(0, 8).forEach(s => console.log(`  ${s.id}  "${s.item_name}"  qty=${s.qty}`));

    // Images
    const sIds = (sItems || []).map(s => s.id);
    if (sIds.length) {
      const { data: imgs } = await sb.from("staging_item_images")
        .select("item_id, storage_path, filename")
        .in("item_id", sIds);
      console.log(`\nStaging images: ${imgs?.length || 0}`);
      (imgs || []).slice(0, 5).forEach(i => console.log(`  item=${i.item_id}  ${i.filename || i.storage_path}`));
    }

    // Name match check
    const jobNames = new Set((items || []).map(i => i.name.trim().toLowerCase()));
    const stagingNames = (sItems || []).map(s => s.item_name.trim().toLowerCase());
    const matched = stagingNames.filter(n => jobNames.has(n)).length;
    console.log(`\nName overlap: ${matched} of ${stagingNames.length} staging items match a job item by exact (case-insensitive) name`);
  }
})();
