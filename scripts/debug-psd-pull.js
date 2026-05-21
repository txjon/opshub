require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Check item_files RLS policies
  const { data, error } = await supa.rpc("pg_query", { q: "select polname, polcmd from pg_policy where polrelid = 'item_files'::regclass" }).catch(e => ({ error: e }));
  console.log("rpc:", data, error);
  // Try a SQL fallback via raw
  const { data: pols, error: e2 } = await supa.from("pg_policies").select("policyname, cmd, qual").eq("tablename", "item_files");
  console.log("pg_policies:", pols, e2);
})();
