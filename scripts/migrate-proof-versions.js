#!/usr/bin/env node
// Bring existing proofs into the versions model.
//
// Every active proof file becomes a version whose PDF is the file that already
// exists — so nothing is re-rendered, nothing changes for anyone looking at a
// proof today, and the approval that was on the file lands on the version.
// Dry run unless --apply.
require("dotenv").config({ path: ".env.local", quiet: true });
const { createClient } = require("@supabase/supabase-js");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes("--apply");

const all = async (table, sel, f) => {
  let out = [], from = 0;
  for (;;) {
    let q = db.from(table).select(sel).range(from, from + 999);
    if (f) q = f(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
};

(async () => {
  const proofs = await all("item_files", "id,item_id,file_name,drive_file_id,approval,approved_at,created_at,superseded_at", q => q.eq("stage", "proof"));
  const items = await all("items", "id,name,blank_vendor,blank_sku,proof_spec,artwork_status");
  const itemById = new Map(items.map(i => [i.id, i]));
  const mockups = await all("item_files", "item_id,drive_file_id,created_at", q => q.eq("stage", "mockup").is("superseded_at", null));
  const mockupByItem = new Map();
  for (const m of mockups) if (!mockupByItem.has(m.item_id)) mockupByItem.set(m.item_id, m.drive_file_id);

  const existing = await all("proof_versions", "item_id,version");
  const haveItems = new Set(existing.map(e => e.item_id));

  const byItem = {};
  for (const p of proofs) (byItem[p.item_id] ||= []).push(p);

  let planned = 0, fileOnly = 0, skippedDone = 0, approved = 0;
  const rows = [];
  for (const [itemId, list] of Object.entries(byItem)) {
    if (haveItems.has(itemId)) { skippedDone++; continue; }
    const item = itemById.get(itemId);
    // No spec means it cannot be re-rendered — the file IS the version.
    if (!item?.proof_spec) fileOnly++;
    const sorted = list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    sorted.forEach((p, i) => {
      const isLast = i === sorted.length - 1;
      const isApproved = p.approval === "approved";
      if (isApproved) approved++;
      rows.push({
        item_id: itemId,
        version: i + 1,
        // The newest file is what people see today; older ones are history.
        state: isApproved ? "approved" : (p.superseded_at || !isLast) ? "superseded" : "sent",
        spec: item?.proof_spec || null,
        item_snapshot: { name: item?.name || null, blank_vendor: item?.blank_vendor || null, blank_sku: item?.blank_sku || null, migrated: true, fileOnly: !item?.proof_spec },
        mockup_drive_file_id: mockupByItem.get(itemId) || null,
        // The file that already exists IS this version's artifact. Keeping it
        // means nothing is re-rendered and nothing looks different.
        pdf_drive_file_id: p.drive_file_id || null,
        pdf_created_at: p.created_at,
        created_at: p.created_at,
        approved_at: p.approved_at || null,
        approved_by: isApproved ? "migrated" : null,
        approval_source: isApproved ? "carried" : null,
        superseded_at: p.superseded_at || (!isLast ? p.created_at : null),
        note: "Migrated from item_files (Sep 2026)",
      });
      planned++;
    });
  }

  console.log(`proof files: ${proofs.length} | items already migrated: ${skippedDone} | file-only (no spec, cannot re-render): ${fileOnly}`);
  console.log(`${APPLY ? "INSERTING" : "would insert"} ${planned} versions across ${new Set(rows.map(r => r.item_id)).size} items (${approved} approved)`);
  if (!APPLY) { console.log("dry run only"); return; }

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("proof_versions").insert(rows.slice(i, i + 200));
    if (error) { console.error("insert failed:", error.message); process.exit(1); }
  }
  const { count } = await db.from("proof_versions").select("id", { count: "exact", head: true });
  console.log("proof_versions rows now:", count);
})();
