// Seed the Dark Matter Dynamics tenant. Idempotent (upsert by slug).
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const DMD = {
  slug: "dmd",
  name: "Dark Matter Dynamics",
  legal_name: "Dark Matter Dynamics, LLC",
  job_number_prefix: "DMD",
  default_payment_provider: "quickbooks",
  bill_to_address: "6280 S Valley View Blvd, Las Vegas, NV",        // TODO confirm suite + zip
  warehouse_address: "4670 W Silverado Ranch Blvd, STE 120, Las Vegas, NV 89139", // ships through HPD
  from_email_quotes: "hello@darkmatterdynamics.co",                 // NOT yet verified in Resend
  from_email_production: "production@darkmatterdynamics.co",
  from_email_billing: "billing@darkmatterdynamics.co",
  departments: ["labs", "contacts", "settings"],
  branding: {},
  is_active: true,
};

(async () => {
  const { data: row, error } = await sb.from("companies").upsert(DMD, { onConflict: "slug" }).select().single();
  if (error) { console.error("companies upsert failed:", error.message); process.exit(1); }
  console.log("✓ companies row:");
  console.log(`   id=${row.id} slug=${row.slug} prefix=${row.job_number_prefix} provider=${row.default_payment_provider}`);
  console.log(`   bill_to=${row.bill_to_address}`);
  console.log(`   warehouse=${row.warehouse_address}`);
  console.log(`   departments=${JSON.stringify(row.departments)} drive_folder=${row.drive_folder_id||"(unset)"}`);

  // Jon's owner membership (he's god so sees all, but membership is clean)
  const { data: jon } = await sb.from("profiles").select("id").eq("id", (await sb.auth.admin.listUsers()).data.users.find(u=>u.email==="jon@housepartydistro.com")?.id).maybeSingle();
  const jonId = jon?.id;
  if (jonId) {
    const { error: mErr } = await sb.from("user_company_memberships").upsert({ user_id: jonId, company_id: row.id, role: "owner", is_active: true }, { onConflict: "user_id,company_id" });
    console.log(mErr ? `   membership err: ${mErr.message}` : `✓ Jon owner membership on DMD`);
  } else console.log("   (could not resolve Jon's user id — membership skipped; god access covers it)");
})();
