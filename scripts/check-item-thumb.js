// Diagnostic: why isn't the item's thumb loading on the worksheet/portal?
//
// Usage:
//   node scripts/check-item-thumb.js HPD-2604-008 "Green F Hat"
//
// Reports the item + its active item_files (stage, drive_file_id) + asks
// Drive whether each file has a thumbnailLink. Tells us if the file
// exists, whether Drive ever generated a thumbnail for it, and whether
// it's the one the worksheet would pick (mockup > proof > print_ready).

require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const [, , jobNumberArg, ...nameParts] = process.argv;
if (!jobNumberArg) {
  console.error("Usage: node scripts/check-item-thumb.js <job-number> [item-name-substring]");
  process.exit(1);
}
const namePart = nameParts.join(" ").trim();

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getDriveToken() {
  // Mirror lib/drive-auth.ts — service account JWT, impersonating
  // jon@housepartydistro.com.
  const { JWT } = require("google-auth-library");
  const keyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
    Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 || "", "base64").toString();
  if (!keyRaw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY");
  const creds = JSON.parse(keyRaw);
  const client = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/drive"],
    subject: "jon@housepartydistro.com",
  });
  const tok = await client.authorize();
  return tok.access_token;
}

(async () => {
  const { data: job } = await supa.from("jobs").select("id, job_number, title").eq("job_number", jobNumberArg).single();
  if (!job) { console.error("Job not found"); process.exit(1); }
  console.log(`Job: ${job.job_number} — ${job.title}`);

  let itemQ = supa.from("items").select("id, name").eq("job_id", job.id);
  if (namePart) itemQ = itemQ.ilike("name", `%${namePart}%`);
  const { data: items } = await itemQ;
  if (!items?.length) { console.error("No items match"); process.exit(1); }
  console.log(`Items: ${items.length}`);

  let token;
  try { token = await getDriveToken(); } catch (e) { console.warn("Drive token failed:", e.message); }

  for (const it of items) {
    console.log(`\n--- ${it.name} (${it.id}) ---`);
    const { data: files } = await supa.from("item_files")
      .select("id, stage, drive_file_id, file_name, superseded_at, created_at")
      .eq("item_id", it.id)
      .order("created_at", { ascending: false });
    if (!files?.length) { console.log("  No item_files."); continue; }

    for (const f of files) {
      const active = !f.superseded_at;
      let driveInfo = "";
      if (token && f.drive_file_id) {
        try {
          const r = await fetch(`https://www.googleapis.com/drive/v3/files/${f.drive_file_id}?fields=name,mimeType,thumbnailLink,trashed`,
            { headers: { Authorization: `Bearer ${token}` } });
          if (r.ok) {
            const m = await r.json();
            driveInfo = `mime=${m.mimeType} trashed=${m.trashed} thumb=${m.thumbnailLink ? "yes" : "NO"}`;
          } else {
            driveInfo = `Drive ${r.status} ${r.statusText}`;
          }
        } catch (e) { driveInfo = `Drive err: ${e.message}`; }
      }
      console.log(`  ${active ? "[active]" : "[SUPERSEDED]"} stage=${f.stage} file_id=${f.drive_file_id || "(none)"} name=${f.file_name || "?"} ${driveInfo}`);
    }
  }
})();
