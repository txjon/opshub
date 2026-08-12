// One-off: load Sike Ops' pre-HPD products as catalog items (Aug 12 2026).
// They came over with mockups/art/proofs in Drive (OpsHub Files/Sike Ops).
// This births ONE completed job (type_meta.source=catalog_import) whose items
// reference those files IN PLACE (no copies) so the client hub Catalog tab
// shows their history and reorders start from real art.
//
// Safe to re-run: refuses if a catalog_import job already exists for the client.
// Archive folder + empty product folders deliberately skipped (Jon, Aug 12).

require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");

const CLIENT_ID = "33d4e311-2396-4eb2-a124-c255c01db53e"; // Sike Ops
const COMPANY_ID = "4f9db6bd-bdd0-44cc-aa5c-5d67cd0b37bd"; // HPD
const SIKE_FOLDER = "1ZXbhNEjXVKfb6qf7TTw11x3jh-kFYTdB";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function drive() {
  const key = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64, "base64").toString("utf-8"));
  const auth = new google.auth.GoogleAuth({
    credentials: key, scopes: ["https://www.googleapis.com/auth/drive"],
    clientOptions: { subject: "jon@housepartydistro.com" },
  });
  return google.drive({ version: "v3", auth });
}

// Filenames in the folder mix apostrophe forms/typos — match on a
// normalized key (lowercase, alphanumerics only) instead of exact strings.
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function walkTree(d) {
  const byPath = new Map(); // normalized path -> {id, name, mimeType, size}
  async function walk(id, prefix) {
    let pageToken;
    do {
      const { data } = await d.files.list({
        q: `'${id}' in parents and trashed=false`,
        fields: "nextPageToken, files(id,name,mimeType,size)", pageSize: 200, pageToken,
      });
      for (const f of data.files) {
        const p = prefix ? `${prefix}/${f.name}` : f.name;
        byPath.set(norm(p), f);
        if (f.mimeType === "application/vnd.google-apps.folder") await walk(f.id, p);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
  }
  await walk(SIKE_FOLDER, "");
  return byPath;
}

// file spec: [stage, path]. mockup = catalog card image; print_ready = the
// production PSD (also becomes items.drive_link); proof PDFs import approved.
const ITEMS = [
  { name: "Blic Blac Tee - White", type: "tee", color: "White", files: [
    ["mockup", "Apparel/Blic Blac Tee/D - Blic blac Tee White.png"],
    ["proof", "Apparel/Blic Blac Tee/D - Sike Ops Blicc Blacc Tee White Proof.pdf"],
    ["print_ready", "Apparel/Blic Blac Tee/Sike Ops Blicc Blac Tee.psd"],
    ["print_ready", "Apparel/Blic Blac Tee/Sike Ops Tag.psd"]]},
  { name: "Blic Blac Tee - Black", type: "tee", color: "Black", files: [
    ["mockup", "Apparel/Blic Blac Tee/E- Blic Blac Tee Black.png"],
    ["proof", "Apparel/Blic Blac Tee/E - Sike Ops Blicc Blacc Tee Black Proof.pdf"],
    ["print_ready", "Apparel/Blic Blac Tee/Sike Ops Blicc Blac Tee.psd"],
    ["print_ready", "Apparel/Blic Blac Tee/Sike Ops Tag.psd"]]},
  { name: "Cell Tee", type: "tee", color: null, files: [
    ["mockup", "Apparel/Cell Tee/F - Cell Tee.png"],
    ["proof", "Apparel/Cell Tee/F - Sike Ops Cell Tee Proof.pdf"],
    ["print_ready", "Apparel/Cell Tee/F - Cell Tee.psd"],
    ["print_ready", "Apparel/Cell Tee/Sike Ops Tag.psd"]]},
  { name: "You've Been F'd Tee", type: "tee", color: null, files: [
    ["mockup", "Apparel/Get Fucked/A - Lujan You_ve Been Fd Tee.png"],
    ["proof", "Apparel/Get Fucked/Sike Ops Youve Been F'd Tee Proof.pdf"],
    ["print_ready", "Apparel/Get Fucked/Get Fucked.psd"],
    ["print_ready", "Apparel/Get Fucked/Sike Ops Tag.psd"]]},
  { name: "You've Been F'd Hoodie", type: "hoodie", color: null, files: [
    ["mockup", "Apparel/Get Fucked/B - Lujan Youve Been Fd Hoodie.png"],
    ["proof", "Apparel/Get Fucked/Sike Ops Youve Been F'd Hoodie Proof.pdf"],
    ["print_ready", "Apparel/Get Fucked/Get Fucked.psd"],
    ["print_ready", "Apparel/Get Fucked/Sike Ops Tag.psd"]]},
  { name: "Polaroid Tee", type: "tee", color: null, files: [
    ["mockup", "Apparel/Polaroid/C - Poloroid Tee.png"],
    ["proof", "Apparel/Polaroid/Sike Ops Polariod Tee Proof.pdf"],
    ["print_ready", "Apparel/Polaroid/Polaroid.psd"],
    ["print_ready", "Apparel/Polaroid/Sike Ops Tag.psd"]]},
  { name: "Polaroid Crewneck", type: "crewneck", color: null, files: [
    ["mockup", "Apparel/Polaroid/D - Polaroid Crewneck.png"],
    ["proof", "Apparel/Polaroid/Sike Ops Polariod Crewneck Proof.pdf"],
    ["print_ready", "Apparel/Polaroid/Polaroid.psd"],
    ["print_ready", "Apparel/Polaroid/Sike Ops Tag.psd"]]},
  { name: "Polaroid 2 Tee", type: "tee", color: null, files: [
    ["mockup", "Apparel/Polaroid 2/G - Polaroid 2 Tee.png"],
    ["proof", "Apparel/Polaroid 2/G - Sike Ops Polariod 2 Tee Proof.pdf"],
    ["print_ready", "Apparel/Polaroid 2/Sike Ops Polaroid Nods Tee..psd"],
    ["print_ready", "Apparel/Polaroid 2/Sike Ops Tag.psd"]]},
  { name: "Polaroid 2 Crewneck", type: "crewneck", color: null, files: [
    ["mockup", "Apparel/Polaroid 2/H - Polaroid 2 Crewneck.png"],
    ["proof", "Apparel/Polaroid 2/H - Sike Ops Polariod 2 Crewneck Proof.pdf"],
    ["print_ready", "Apparel/Polaroid 2/Sike Ops Polaroid Nods Tee..psd"],
    ["print_ready", "Apparel/Polaroid 2/Sike Ops Tag.psd"]]},
  { name: "CEO Tee", type: "tee", color: null, files: [
    ["mockup", "Apparel/Sike Ops CEO Tee/Sike Ops CEO Tee.png"],
    ["proof", "Apparel/Sike Ops CEO Tee/Sike Ops CEO Tee Proof.pdf"],
    ["print_ready", "Apparel/Sike Ops CEO Tee/Sike Ops CEO Tee.psd"],
    ["print_ready", "Apparel/Sike Ops CEO Tee/Sike Ops Tag.psd"]]},
  { name: "Ill Pro x Sike Ops Tee - White", type: "tee", color: "White", files: [
    ["mockup", "Apparel/SIke Ops Ill Pro/Ill Pro x Sike Ops/IllPro x Sike Ops White Tee.png"],
    ["proof", "Apparel/SIke Ops Ill Pro/Ill Pro x Sike Ops/Ill Pro Sike Ops White Tee Proof.pdf"],
    ["print_ready", "Apparel/SIke Ops Ill Pro/Ill Pro x Sike Ops/Ill pro x Sike Ops .psd"],
    ["print_ready", "Apparel/SIke Ops Ill Pro/Ill Pro x Sike Ops/Ill pro Sike Ops Tag.psd"]]},
  { name: "Ill Pro x Sike Ops Tee - Black", type: "tee", color: "Black", files: [
    ["mockup", "Apparel/SIke Ops Ill Pro/Ill Pro x Sike Ops/Illpro x Sike Ops Black Tee.png"],
    ["proof", "Apparel/SIke Ops Ill Pro/Ill Pro x Sike Ops/Ill Pro Sike Ops Black Tee Proof.pdf"],
    ["print_ready", "Apparel/SIke Ops Ill Pro/Ill Pro x Sike Ops/Ill pro x Sike Ops .psd"],
    ["print_ready", "Apparel/SIke Ops Ill Pro/Ill Pro x Sike Ops/Ill pro Sike Ops Tag.psd"]]},
  { name: "Pop Up Tee - White", type: "tee", color: "White", files: [
    ["mockup", "Apparel/Sike Ops Pop Up Tee/Tee/Sike Ops Pop Up Tee White.png"],
    ["proof", "Apparel/Sike Ops Pop Up Tee/Tee/Sike Ops Pop Up White Tee Proof.pdf"],
    ["print_ready", "Apparel/Sike Ops Pop Up Tee/Sike Ops Pop Up Tee.psd"],
    ["print_ready", "Apparel/Sike Ops Pop Up Tee/Sike Ops Tag.psd"]]},
  { name: "Pop Up Tee - Black", type: "tee", color: "Black", files: [
    ["mockup", "Apparel/Sike Ops Pop Up Tee/Tee/Sike Ops Pop Up Tee Black.png"],
    ["proof", "Apparel/Sike Ops Pop Up Tee/Tee/Sike Ops Pop Up Black Tee Proof.pdf"],
    ["print_ready", "Apparel/Sike Ops Pop Up Tee/Sike Ops Pop Up Tee.psd"],
    ["print_ready", "Apparel/Sike Ops Pop Up Tee/Sike Ops Tag.psd"]]},
  { name: "Pop Up Hoodie - White", type: "hoodie", color: "White", files: [
    ["mockup", "Apparel/Sike Ops Pop Up Tee/Hoodie/Sike Ops Pop Up Hoodie White.png"],
    ["proof", "Apparel/Sike Ops Pop Up Tee/Hoodie/Sike Ops Pop Up White Hoodie Proof.pdf"],
    ["print_ready", "Apparel/Sike Ops Pop Up Tee/Sike Ops Pop Up Tee.psd"],
    ["print_ready", "Apparel/Sike Ops Pop Up Tee/Sike Ops Tag.psd"]]},
  { name: "Pop Up Hoodie - Black", type: "hoodie", color: "Black", files: [
    ["mockup", "Apparel/Sike Ops Pop Up Tee/Hoodie/Sike Ops Pop Up Hoodie Black.png"],
    ["proof", "Apparel/Sike Ops Pop Up Tee/Hoodie/Sike Ops Pop Up Black Hoodie Proof.pdf"],
    ["print_ready", "Apparel/Sike Ops Pop Up Tee/Sike Ops Pop Up Tee.psd"],
    ["print_ready", "Apparel/Sike Ops Pop Up Tee/Sike Ops Tag.psd"]]},
  { name: "Blue Eyes Patch", type: "patch", color: null, files: [
    ["mockup", "Accessories/Patches/Blue Eyes Patch.png"]]},
  { name: "Hypno Eyes Patch", type: "patch", color: null, files: [
    ["mockup", "Accessories/Patches/Hypno Eyes Patch.png"]]},
  { name: "You've Been F'd Patch", type: "patch", color: null, files: [
    ["mockup", "Accessories/Patches/You've Been Fucked Patch/2022-10-24-03-1.jpg"],
    ["proof", "Accessories/Patches/You've Been Fucked Patch/FOG You've Been Fucked Proof.pdf"],
    ["print_ready", "Accessories/Patches/You've Been Fucked Patch/You've Been Fucked.psd"]]},
  { name: "Blicc Blacc Sticker", type: "sticker", color: null, files: [
    ["mockup", "Accessories/Stickers/Sike Ops Blicc Blacc Sticker.png"]]},
  { name: "Grenade Sticker", type: "sticker", color: null, files: [
    ["mockup", "Accessories/Stickers/Sike Ops Grenade Sticker.png"]]},
  { name: "Propoganda Sticker Pack", type: "sticker", color: null, files: [
    ["mockup", "Accessories/Stickers/Propoganda Sticker Pack/E - Propoganda Sticker Pack Mockup.png"],
    ["print_ready", "Accessories/Stickers/Propoganda Sticker Pack/E - Propoganda Sticker Pack.psd"]]},
];

(async () => {
  // 0. Refuse to double-import
  const { data: existing } = await sb.from("jobs")
    .select("id, job_number, type_meta").eq("client_id", CLIENT_ID);
  const dup = (existing || []).find(j => j.type_meta?.source === "catalog_import");
  if (dup) { console.error(`ABORT: catalog_import job already exists (${dup.job_number}). Delete it first to re-run.`); process.exit(1); }

  // 1. Resolve every file up front — abort before writing anything if one is missing
  console.log("Walking Drive tree…");
  const tree = await walkTree(drive());
  const missing = [];
  for (const it of ITEMS) for (const [, p] of it.files) if (!tree.get(norm(p))) missing.push(p);
  if (missing.length) { console.error("ABORT — unresolved files:\n" + missing.join("\n")); process.exit(1); }
  console.log(`All ${ITEMS.reduce((n, i) => n + i.files.length, 0)} file refs resolved.`);

  // 2. The job
  const { data: job, error: jobErr } = await sb.from("jobs").insert({
    client_id: CLIENT_ID, company_id: COMPANY_ID,
    title: "Catalog import - past products",
    job_type: "brand", phase: "complete",
    type_meta: { source: "catalog_import", imported_at: new Date().toISOString(), note: "Pre-HPD products loaded from Drive so the hub catalog starts populated. No revenue, no quantities - history reference only." },
  }).select("id, job_number").single();
  if (jobErr) { console.error("job insert failed:", jobErr.message); process.exit(1); }
  console.log(`Job ${job.job_number} (${job.id})`);

  // 3. Items + files
  for (let i = 0; i < ITEMS.length; i++) {
    const spec = ITEMS[i];
    const psd = spec.files.find(([st]) => st === "print_ready");
    const psdFile = psd ? tree.get(norm(psd[1])) : null;
    const { data: item, error: itErr } = await sb.from("items").insert({
      job_id: job.id, name: spec.name, garment_type: spec.type,
      mockup_color: spec.color, sort_order: i,
      // pipeline_stage marks it as RUN (lib/run-gate) independent of any
      // future phase recalc on this job; completed_at closes it out.
      pipeline_stage: "shipped", completed_at: new Date().toISOString(),
      drive_link: psdFile ? `https://drive.google.com/file/d/${psdFile.id}/view` : null,
    }).select("id").single();
    if (itErr) { console.error(`item "${spec.name}" failed:`, itErr.message); process.exit(1); }

    const rows = spec.files.map(([stage, p]) => {
      const f = tree.get(norm(p));
      return {
        item_id: item.id, stage, file_name: f.name,
        drive_file_id: f.id,
        drive_link: `https://drive.google.com/file/d/${f.id}/view`,
        mime_type: f.mimeType || null, file_size: f.size ? Number(f.size) : null,
        approval: stage === "proof" ? "approved" : null,
        approved_at: stage === "proof" ? new Date().toISOString() : null,
        uploaded_by: null,
      };
    });
    const { error: fErr } = await sb.from("item_files").insert(rows);
    if (fErr) { console.error(`files for "${spec.name}" failed:`, fErr.message); process.exit(1); }
    console.log(`  ✓ ${spec.name} (${rows.length} files)`);
  }

  await sb.from("job_activity").insert({
    job_id: job.id,
    message: `Catalog import: ${ITEMS.length} past Sike Ops products loaded from Drive (mockups, proofs, print files referenced in place).`,
  });
  console.log(`Done: ${ITEMS.length} items on ${job.job_number}.`);
})();
