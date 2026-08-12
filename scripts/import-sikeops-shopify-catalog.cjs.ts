// 2026-08-12: Import Sike Ops Shopify products export as CATALOG HISTORY —
// one completed housing job, one item per product (name, garment_type,
// retail), Shopify CDN image → Drive → item_files mockup. Idempotent by
// item name on the housing job. Source: inbox-slips/products_export_1 (1).csv
import dotenv from "dotenv";
dotenv.config({ path: "/Users/jonburrow/opshub/.env.local", quiet: true } as any);
import fs from "fs";
// Minimal RFC-4180 CSV parser (quoted fields, embedded newlines) — the
// export carries multiline HTML descriptions, so naive splitting fails.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let field = "", row: string[] = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const head = rows[0];
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
import { createClient } from "@supabase/supabase-js";
import { getItemFolderId, uploadFile } from "@/lib/google-drive";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const SIKE = "33d4e311-2396-4eb2-a124-c255c01db53e";
const JOB_TITLE = "Sike Ops — Shop History (import)";

const gtype = (t: string, title: string) => {
  const s = (t + " " + title).toLowerCase();
  if (/crewneck/.test(s)) return "crewneck";
  if (/hoodie/.test(s)) return "hoodie";
  if (/t-?shirt|tee\b|tshirt/.test(s)) return "tee";
  if (/hat\b/.test(s)) return "hat";
  if (/patch/.test(s)) return "patch";
  if (/sticker|slap|paper/.test(s)) return "sticker";
  if (/flag/.test(s)) return "flag";
  return "custom";
};

(async () => {
  const raw = fs.readFileSync("/Users/jonburrow/opshub/inbox-slips/products_export_1 (1).csv");
  const rows: any[] = parseCsv(raw.toString("utf8"));
  const products = new Map<string, any>();
  for (const row of rows) {
    const p = products.get(row.Handle) || { title: null, type: null, price: null, img: null };
    if (row.Title) p.title = row.Title;
    if (row.Type) p.type = row.Type;
    if (row["Variant Price"] && p.price == null) { const n = Number(row["Variant Price"]); if (n > 0) p.price = n; }
    if (row["Image Src"] && (p.img == null || row["Image Position"] === "1")) p.img = row["Image Src"];
    products.set(row.Handle, p);
  }
  const list = [...products.values()].filter(p => p.title);
  console.log("products parsed:", list.length);

  let { data: job } = await admin.from("jobs").select("id, job_number").eq("client_id", SIKE).eq("title", JOB_TITLE).maybeSingle();
  if (!job) {
    const ins = await admin.from("jobs").insert({
      title: JOB_TITLE, client_id: SIKE, job_type: "webstore", phase: "complete",
      job_number: "", notes: "Imported from Shopify products export — catalog history for Run it back / release re-runs.",
    } as never).select("id, job_number").single();
    if (ins.error) { console.error("job create failed:", ins.error.message); process.exit(1); }
    job = ins.data as any;
  }
  console.log("housing job:", (job as any).job_number, (job as any).id);

  const { data: existing } = await admin.from("items").select("name").eq("job_id", (job as any).id);
  const have = new Set((existing || []).map((i: any) => i.name));
  const folderId = await getItemFolderId("Sike Ops", "Shop History (import)", "Mockups");
  let made = 0, skipped = 0, imgOk = 0, imgFail = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (have.has(p.title)) { skipped++; continue; }
    const { data: item, error } = await admin.from("items").insert({
      job_id: (job as any).id, name: p.title, garment_type: gtype(p.type || "", p.title),
      client_retail_per_unit: p.price ?? null, pipeline_stage: "shipped", sort_order: (i + 1) * 10,
    } as never).select("id").single();
    if (error) { console.error("item fail:", p.title, error.message); continue; }
    made++;
    if (p.img) {
      try {
        const res = await fetch(p.img);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get("content-type") || "image/jpeg";
        const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
        const up = await uploadFile(folderId, `${p.title.replace(/[/\\:]/g, "-").slice(0, 80)}.${ext}`, mime, buf);
        await admin.from("item_files").insert({
          item_id: (item as any).id, file_name: `${p.title}.${ext}`, stage: "mockup",
          drive_file_id: up.fileId, drive_link: up.webViewLink, mime_type: mime, file_size: buf.length,
        } as never);
        imgOk++;
      } catch (e: any) { imgFail++; console.log("  img fail:", p.title, e.message); }
    }
    if (made % 10 === 0) console.log(`  … ${made} items in`);
  }
  console.log(`done: ${made} items created, ${skipped} skipped (existing), images ${imgOk} ok / ${imgFail} failed`);
})();
