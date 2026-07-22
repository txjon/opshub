// Legacy art indexer (Jul 22 2026) — read-only walk of one client's archive
// folder into legacy_art_files pointers. Nothing in Drive is touched.
// Re-runnable: wipes + reloads the given root's rows (IDs are stable, so a
// re-index after Drive reorganizing just refreshes paths).
//
// Usage: npx tsx scripts/index-legacy-art.ts <driveFolderId> "<client name>"
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const [, , ROOT, CLIENT_NAME] = process.argv;
if (!ROOT || !CLIENT_NAME) { console.error('Usage: npx tsx scripts/index-legacy-art.ts <folderId> "<client name>"'); process.exit(1); }

const key = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 || "", "base64").toString("utf-8"));
const auth = new google.auth.GoogleAuth({ credentials: key, scopes: ["https://www.googleapis.com/auth/drive"], clientOptions: { subject: "jon@housepartydistro.com" } });
const drive = google.drive({ version: "v3", auth });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const SKIP = /^\.ds_store$|^icon\r?$/i;   // filesystem noise, not art

async function listChildren(id: string): Promise<any[]> {
  const out: any[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${id}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime)",
      pageSize: 1000, pageToken,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    out.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

(async () => {
  const { data: client } = await db.from("clients").select("id, name").ilike("name", `%${CLIENT_NAME}%`).limit(2);
  if (!client || client.length !== 1) {
    console.error(`Client match for "${CLIENT_NAME}": ${(client || []).map((c: any) => c.name).join(", ") || "none"} — need exactly one`);
    process.exit(1);
  }
  const clientId = (client[0] as any).id;
  console.log(`indexing into client: ${(client[0] as any).name}`);

  const rows: any[] = [];
  async function walk(id: string, path: string) {
    const kids = await listChildren(id);
    for (const k of kids) {
      if (k.mimeType === "application/vnd.google-apps.folder") {
        await walk(k.id, path ? `${path}/${k.name}` : k.name);
      } else if (!SKIP.test(k.name || "")) {
        rows.push({
          client_id: clientId, root_folder_id: ROOT,
          drive_file_id: k.id, file_name: k.name || null, mime_type: k.mimeType || null,
          folder_path: path || null,
          size_bytes: k.size ? Number(k.size) : null,
          modified_at: k.modifiedTime || null,
        });
      }
    }
    process.stdout.write(`\rwalked: ${rows.length} files…`);
  }
  await walk(ROOT, "");
  console.log("");

  await db.from("legacy_art_files").delete().eq("root_folder_id", ROOT);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("legacy_art_files").insert(rows.slice(i, i + 500));
    if (error) { console.error(error.message); process.exit(1); }
  }
  const designs = new Set(rows.map(r => r.folder_path).filter(Boolean));
  console.log(`✓ indexed ${rows.length} files · ${designs.size} folders/designs · client ${(client[0] as any).name}`);
  const top = new Map<string, number>();
  for (const r of rows) { const seg = (r.folder_path || "(root)").split("/")[0]; top.set(seg, (top.get(seg) || 0) + 1); }
  for (const [seg, n] of Array.from(top.entries()).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(5)}  ${seg}`);
})().catch(e => { console.error("INDEX FAIL:", e.message); process.exit(1); });
