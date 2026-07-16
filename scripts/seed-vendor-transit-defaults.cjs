#!/usr/bin/env node
/**
 * Seed per-vendor lead times + transit defaults (Jon's numbers, 2026-07-15,
 * collected via the fill-in artifact). Requires migration 123 (transit_defaults
 * column) to have been run first — the script verifies before writing.
 *
 * Usage:
 *   node scripts/seed-vendor-transit-defaults.cjs          # dry run
 *   node scripts/seed-vendor-transit-defaults.cjs --apply
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// id: [lead, ground, freight, ocean(null = unused)]
const DATA = {
  "f0794e00-a0dc-4c24-8cf1-6d4e69df1ec9": ["13th Heaven LLC", 45, 3, 3, null],
  "8a70d0ee-2c38-4970-8dd7-1974eef5f4e8": ["Alpen Design Works", 21, 3, 3, null],
  "e684a23e-6d28-4bb8-8e9c-066cfc2a9599": ["Battle Maple", 60, 3, 3, 35],
  "725d3b73-6c9d-419d-a2fb-7df1e2768ac8": ["Downeast (Nalgenes)", 14, 5, 5, null],
  "f4586e92-8d5b-4d45-b112-e72e2289d7ac": ["Elevate Prints", 10, 1, 1, null],
  "818bcb59-6ec1-4eff-a7cc-4e67f5d6489d": ["Force Multiplier (FCX)", 45, 1, 1, 35],
  "b668e516-7d60-4d59-979a-3a2419ee4ddf": ["HP Labs - In House", 5, 0, 0, null],
  "6a7cbe18-d187-431f-a044-df46cbfd7dc6": ["Icon Screening", 10, 1, 1, null],
  "1633b334-cda8-4150-bf71-d0cb01158335": ["ICON Screening", 10, 1, 1, null],
  "4eb39da4-a6d4-430f-9eb1-9466002e8a39": ["Keystone Tactical Supply", 20, 4, 4, null],
  "8c591a8e-8c44-4d0e-89fb-ca30ac6a48d9": ["Merch Bros", 25, 4, 4, null],
  "afbaa18f-15d0-4b07-9891-e2bcef8bee02": ["MK lighter", 21, 2, 2, null],
  "f2214c57-ce7a-492b-b30e-f0cdaf798ede": ["ONE OFF", 7, 2, 2, null],
  "831e478c-b0ff-48b3-8f44-1944baa9957f": ["One Stop Merch Ltd.", 21, 4, 4, 30],
  "7c8a8725-8784-4d15-9a31-552515b8abb1": ["Scorpion Strategic LLC", 90, 2, 2, 40],
  "f364747a-cadc-4be5-b4c2-99a17c061130": ["Sticker Mule", 5, 2, 2, null],
  "781a3513-1d65-4eee-ae92-fcf66038b2e4": ["Stoked on Printing", 10, 1, 1, null],
  "51a3cf08-a262-4b08-b921-9bef87aeb41b": ["Sublimation House", 21, 1, 1, null],
  "437f3d77-0375-4216-8cf3-d6b96a243cad": ["Tapstitch", 30, 5, 5, null],
  "7deea5d2-fb9d-42f4-92e0-8acf41b76b12": ["Teeland - Embroidery", 10, 1, 1, null],
  "8bf64fd1-c309-46ae-9114-2f43983eb60f": ["Teeland - Screen Printing", 10, 1, 1, null],
  "1146376d-a932-4256-8930-154a8d113216": ["Violent Gentlemen", 60, 2, 2, null],
};

(async () => {
  // verify column exists (migration 123 ran)
  const probe = await sb.from("decorators").select("id, transit_defaults").limit(1);
  if (probe.error) {
    console.error("ABORT — transit_defaults column missing. Run migration 123 in the Supabase editor first.");
    console.error("(" + probe.error.message + ")");
    process.exit(1);
  }

  let changed = 0;
  for (const [id, [name, lead, ground, freight, ocean]] of Object.entries(DATA)) {
    const { data: cur, error } = await sb.from("decorators")
      .select("id, name, lead_time_days, transit_defaults").eq("id", id).single();
    if (error || !cur) { console.error(`SKIP ${name} — not found (${error?.message})`); continue; }
    const td = { ground, freight, ...(ocean != null ? { ocean } : {}) };
    const leadChange = cur.lead_time_days !== lead ? `lead ${cur.lead_time_days ?? "—"}→${lead}` : null;
    console.log(`${name}: ${leadChange || "lead unchanged"} · transit ${JSON.stringify(td)}`);
    if (!APPLY) continue;
    const { error: ue } = await sb.from("decorators")
      .update({ lead_time_days: lead, transit_defaults: td }).eq("id", id);
    if (ue) { console.error(`  ERROR ${name}: ${ue.message}`); process.exit(1); }
    changed++;
  }
  console.log(APPLY ? `\nDone — ${changed} decorators updated.` : "\nDry run — re-run with --apply after migration 123.");
})().catch(e => { console.error(e); process.exit(1); });
