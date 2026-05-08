#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // 1. Find client by name (loose match — could be "Weekend Institute", "Weekened Institute", etc.)
  const { data: clients, error: cErr } = await sb
    .from("clients")
    .select("id, name, company_id")
    .or("name.ilike.%weekend%,name.ilike.%weekened%");
  if (cErr) { console.error("client lookup error:", cErr); process.exit(1); }
  console.log("Matching clients:");
  (clients || []).forEach(c => console.log(`  ${c.id}  "${c.name}"  company=${c.company_id}`));
  if (!clients?.length) { console.log("(no matches)"); return; }

  for (const client of clients) {
    console.log(`\n=== ${client.name} (${client.id}) ===`);

    // 2. New brand planner: client_proposal_items
    const { data: proposals, error: pErr } = await sb
      .from("client_proposal_items")
      .select("id, name, drive_file_id, drive_link, qty_estimate, garment_type, status, notes, created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: true });
    if (pErr) console.error("  proposal lookup error:", pErr);
    console.log(`\n  client_proposal_items: ${proposals?.length || 0}`);
    (proposals || []).forEach(p => {
      console.log(`    - ${p.name}`);
      console.log(`        status=${p.status}  qty=${p.qty_estimate}  type=${p.garment_type}`);
      console.log(`        drive_file_id=${p.drive_file_id}`);
      console.log(`        drive_link=${p.drive_link}`);
      if (p.notes) console.log(`        notes=${p.notes}`);
    });

    // 3. Older staging_boards/items (in case images live there)
    const { data: boards } = await sb
      .from("staging_boards")
      .select("id, name, summary_label, client_name")
      .or(`client_name.ilike.%weekend%,client_name.ilike.%weekened%`);
    console.log(`\n  staging_boards (legacy): ${boards?.length || 0}`);
    for (const b of (boards || [])) {
      console.log(`    board ${b.id} "${b.name}" client=${b.client_name}`);
      const { data: sItems } = await sb
        .from("staging_items")
        .select("id, item_name, qty")
        .eq("board_id", b.id);
      for (const s of (sItems || [])) {
        const { data: imgs } = await sb
          .from("staging_item_images")
          .select("id, drive_file_id, drive_link, image_url, file_name")
          .eq("item_id", s.id);
        console.log(`      item "${s.item_name}" qty=${s.qty}  images=${imgs?.length || 0}`);
        (imgs || []).forEach(i => {
          console.log(`        - ${i.file_name || "(unnamed)"}`);
          console.log(`            drive_file_id=${i.drive_file_id}`);
          console.log(`            drive_link=${i.drive_link || i.image_url}`);
        });
      }
    }
  }
})();
