#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const norm = s => (s || "").trim().toLowerCase();

(async () => {
  // All FOG jobs (client_hub_enabled or not — doesn't matter)
  const { data: client } = await sb.from("clients").select("id, name")
    .ilike("name", "Forward Observations%").limit(1).single();
  if (!client) { console.error("No FOG client"); process.exit(1); }

  const { data: jobs } = await sb.from("jobs")
    .select("id, title, phase").eq("client_id", client.id).order("created_at", { ascending: false });
  console.log(`Forward Observations Group has ${jobs?.length || 0} jobs:\n`);

  const workingJob = (jobs || []).find(j => j.title === "FOG Working");
  if (!workingJob) { console.error("No FOG Working job"); process.exit(1); }

  // FOG Working items (which now have images)
  const { data: workingItems } = await sb.from("items")
    .select("id, name").eq("job_id", workingJob.id);
  const workingByName = new Map();
  for (const it of workingItems || []) workingByName.set(norm(it.name), it);

  // Which working items now have item_files (i.e., images we just added)
  const workingIds = (workingItems || []).map(i => i.id);
  const { data: workingFiles } = await sb.from("item_files")
    .select("item_id, drive_file_id, drive_link, file_name")
    .in("item_id", workingIds).is("superseded_at", null);
  const filesByWorkingItem = new Map();
  for (const f of workingFiles || []) {
    if (!filesByWorkingItem.has(f.item_id)) filesByWorkingItem.set(f.item_id, []);
    filesByWorkingItem.get(f.item_id).push(f);
  }

  // Other FOG jobs + their items
  const otherJobs = (jobs || []).filter(j => j.id !== workingJob.id && !["complete", "cancelled"].includes(j.phase));
  for (const j of otherJobs) {
    const { data: items } = await sb.from("items")
      .select("id, name").eq("job_id", j.id);
    const total = items?.length || 0;
    if (!total) continue;

    // Match by name to FOG Working
    let matched = 0, hasImageFromWorking = 0, alreadyHasFiles = 0;
    const matchExamples = [];
    const itemIdsThisJob = (items || []).map(i => i.id);
    const { data: existingFiles } = await sb.from("item_files")
      .select("item_id").in("item_id", itemIdsThisJob).is("superseded_at", null);
    const itemsWithFiles = new Set((existingFiles || []).map(f => f.item_id));

    for (const it of items || []) {
      if (itemsWithFiles.has(it.id)) { alreadyHasFiles++; continue; }
      const wi = workingByName.get(norm(it.name));
      if (wi) {
        matched++;
        if (filesByWorkingItem.has(wi.id)) {
          hasImageFromWorking++;
          if (matchExamples.length < 3) matchExamples.push(it.name);
        }
      }
    }

    console.log(`  ${j.title}  (${j.phase})`);
    console.log(`    items: ${total}   already have files: ${alreadyHasFiles}   match FOG Working w/ image: ${hasImageFromWorking}`);
    if (matchExamples.length) console.log(`    examples: ${matchExamples.join(", ")}`);
    console.log();
  }
})();
