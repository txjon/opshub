// One-time (Oct 13 2026): rename existing tax documents to "<Client> - Resale Cert"
// in Drive and in client_files. Dry run by default; --apply to rename.
//   npx tsx --env-file=.env.local scripts/rename-resale-certs.ts [--apply]
import { createClient } from "@supabase/supabase-js";
import { renameFile } from "../lib/google-drive";
import { resaleCertFileName } from "../lib/client-info";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes("--apply");
(async () => {
  const { data, error } = await db.from("client_files").select("id, client_id, file_name, drive_file_id, created_at, clients(name)").eq("kind", "tax_exempt").order("client_id").order("created_at").range(0, 999);
  if (error) throw error;
  // a client with several tax docs gets " 2", " 3"… (oldest keeps the plain name)
  const seen = new Map<string, number>();
  const plan = (data || []).map((f: any) => {
    const n = (seen.get(f.client_id) || 0) + 1; seen.set(f.client_id, n);
    const base = resaleCertFileName(f.clients?.name || "Client", f.file_name);
    const name = n > 1 ? base.replace(/(\.[a-z0-9]+)?$/i, ` ${n}$1`) : base;
    return { ...f, to: name };
  }).filter(f => f.to !== f.file_name);
  for (const f of plan) console.log(`${f.clients?.name} | ${f.file_name} → ${f.to}`);
  console.log(`${plan.length} to rename`);
  if (!APPLY) return;
  let ok = 0;
  for (const f of plan) {
    if (f.drive_file_id) await renameFile(f.drive_file_id, f.to);
    const { error: e } = await db.from("client_files").update({ file_name: f.to }).eq("id", f.id);
    if (e) throw new Error(`${f.id}: ${e.message}`);
    ok++;
  }
  console.log(`renamed ${ok}`);
})().catch(e => { console.error(e); process.exit(1); });
