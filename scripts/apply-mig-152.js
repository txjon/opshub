#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
require("dotenv").config({ path: ".env.local" });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { error } = await supabase.rpc("exec_sql", { sql: fs.readFileSync("supabase/migrations/152_split_stickermule_double_tracking.sql", "utf8") });
  if (error) { console.error("RPC failed:\n", error.message); process.exit(1); }
  const { data: boxes } = await supabase.from("shipments").select("id, tracking, status").in("id", ["48910bf6-bbbd-46f8-82f9-7e7cbbdec93a", "a3f6f7d2-9c41-4a58-8d15-2b6a01572901"]);
  for (const b of boxes) {
    const { data: lines } = await supabase.from("shipment_lines").select("description, ship_qtys").eq("shipment_id", b.id);
    console.log("box", b.tracking, "|", b.status, "|", (lines || []).map(l => `${l.description} ${JSON.stringify(l.ship_qtys)}`).join(", "));
  }
  console.log("✓ Migration 152 applied.");
})();
