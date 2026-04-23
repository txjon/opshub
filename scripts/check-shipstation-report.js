#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data } = await supabase
    .from("shipstation_reports")
    .select("id, period_label, qb_invoice_id, qb_invoice_number, qb_payment_link, sent_at, sent_to, clients(name)")
    .order("created_at", { ascending: false })
    .limit(3);
  console.log(JSON.stringify(data, null, 2));
})();
