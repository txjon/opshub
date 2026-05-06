#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: client } = await sb.from("clients").select("id, name").ilike("name", "%Playwright%").single();
  if (!client) { console.log("Client not found"); return; }
  const { data: brief } = await sb.from("art_briefs")
    .select("id, title, concept, placement, mood_words, purpose, audience, no_gos")
    .eq("client_id", client.id)
    .ilike("title", "%Mexi%").single();
  if (!brief) { console.log("Brief not found"); return; }

  console.log("BRIEF:", brief.title);
  console.log("  concept:  ", brief.concept);
  console.log("  placement:", brief.placement);
  console.log("  purpose:  ", brief.purpose);
  console.log("  audience: ", brief.audience);
  console.log("  no_gos:   ", brief.no_gos);
  console.log("  mood:     ", brief.mood_words);

  const { data: files } = await sb.from("art_brief_files")
    .select("id, kind, file_name, drive_file_id, created_at, hpd_annotation, designer_annotation, client_annotation, uploader_role")
    .eq("brief_id", brief.id)
    .order("created_at");
  console.log(`\nFILES (${files?.length || 0}):`);
  for (const f of files || []) {
    console.log(`  [${f.kind}] ${f.file_name}  drive=${f.drive_file_id}`);
    console.log(`     by:  ${f.uploader_role}`);
    console.log(`     hpd: ${(f.hpd_annotation || "").trim()}`);
    console.log(`     dsg: ${(f.designer_annotation || "").trim()}`);
    console.log(`     cli: ${(f.client_annotation || "").trim()}`);
  }
})();
