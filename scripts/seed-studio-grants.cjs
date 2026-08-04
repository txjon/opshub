#!/usr/bin/env node
// Grant migration for the studio replacement (Aug 4 2026): everyone granted
// the old /art-studio (or /studio2) gets /studio; the dead hrefs come out.
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data: profiles } = await db.from("profiles").select("id, full_name, page_access").not("page_access", "is", null);
  for (const p of profiles || []) {
    const cur = p.page_access || [];
    if (!cur.includes("/art-studio") && !cur.includes("/studio2")) continue;
    const next = [...new Set(cur.filter(h => h !== "/art-studio" && h !== "/studio2").concat("/studio"))];
    await db.from("profiles").update({ page_access: next }).eq("id", p.id);
    console.log("✓ " + (p.full_name || p.id) + " → /studio");
  }
  console.log("done");
})();
