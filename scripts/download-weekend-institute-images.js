#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: ".env.local" });

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function getDrive() {
  let key;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } else {
    const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 || "";
    key = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  }
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/drive"],
    clientOptions: { subject: "jon@housepartydistro.com" },
  });
  return google.drive({ version: "v3", auth });
}

function safeFilename(s) {
  return (s || "untitled").replace(/[\/\\:*?"<>|]/g, "_").trim();
}

(async () => {
  const drive = getDrive();
  const outDir = path.resolve("/Users/jonburrow/Desktop/weekend-institute-brand-planner");
  fs.mkdirSync(outDir, { recursive: true });

  const { data: client } = await sb
    .from("clients")
    .select("id, name")
    .eq("name", "Weekend Institute")
    .single();
  if (!client) { console.error("client not found"); process.exit(1); }

  const { data: proposals } = await sb
    .from("client_proposal_items")
    .select("id, name, drive_file_id, created_at")
    .eq("client_id", client.id)
    .order("created_at", { ascending: true });

  console.log(`Downloading ${proposals.length} files to ${outDir}`);

  let ok = 0, skipped = 0, failed = 0;
  for (const p of proposals) {
    if (!p.drive_file_id) { skipped++; console.log(`  skip (no drive_file_id): ${p.name}`); continue; }
    try {
      // Get original mime + name extension hint
      const meta = await drive.files.get({
        fileId: p.drive_file_id,
        fields: "name, mimeType",
        supportsAllDrives: true,
      });
      const origExt = path.extname(meta.data.name || "") || "";
      const filename = safeFilename(p.name) + origExt;
      const dest = path.join(outDir, filename);

      const res = await drive.files.get(
        { fileId: p.drive_file_id, alt: "media", supportsAllDrives: true },
        { responseType: "stream" }
      );
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(dest);
        res.data.on("end", resolve).on("error", reject).pipe(ws);
        ws.on("error", reject);
      });
      ok++;
      console.log(`  ✓  ${filename}`);
    } catch (e) {
      failed++;
      console.log(`  ✗  ${p.name}  (${p.drive_file_id})  -- ${e.message}`);
    }
  }
  console.log(`\nDone: ${ok} downloaded, ${skipped} skipped, ${failed} failed`);
  console.log(`Output: ${outDir}`);
})();
