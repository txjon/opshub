// One-off (Sep 17 2026): bring the retired pre-order tool's 7 projects into
// Releases as DONE history — one release per fulfillment_project, one slot
// per preorder_product (matched to the cut job's item by name when possible,
// else a legacy line), FOG April from its fulfillment_inventory items.
// Idempotent: skips a project whose legacy id is already on a release.
require("dotenv").config({ path: ".env.local", quiet: true });
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const norm = (s) => String(s || "").toLowerCase().replace(/\*?\s*pre[- ]?order\s*\*?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const day = (ts) => ts ? String(ts).slice(0, 10) : null;
(async () => {
  const { data: projects } = await sb.from("fulfillment_projects").select("*").order("created_at");
  const { data: existing } = await sb.from("releases").select("id, meta");
  const done = new Set((existing || []).map(r => r.meta && r.meta.legacy_fulfillment_project_id).filter(Boolean));
  const now = new Date().toISOString();
  for (const p of projects) {
    if (done.has(p.id)) { console.log("skip (already imported):", p.name); continue; }
    const { data: products } = await sb.from("preorder_products").select("*").eq("preorder_id", p.id).order("sort_order");
    let jobId = p.source_job_id || null;
    let items = [];
    if (jobId) { const { data } = await sb.from("items").select("id, name, sell_per_unit").eq("job_id", jobId); items = data || []; }
    // FOG April: no products, no source job — its lines are the inventory items
    let invItems = [];
    if (!products.length) {
      const { data: inv } = await sb.from("fulfillment_inventory").select("source_item_id").eq("project_id", p.id);
      if (inv && inv.length) {
        const { data } = await sb.from("items").select("id, name, job_id, sell_per_unit, client_retail_per_unit").in("id", inv.map(x => x.source_item_id));
        invItems = data || [];
        if (!jobId && invItems.length) jobId = invItems[0].job_id;
      }
    }
    const model = p.mode === "drop" ? "stock" : "preorder";
    const { data: rel, error } = await sb.from("releases").insert({
      client_id: p.client_id, company_id: p.company_id, title: p.name, status: "done", model,
      target_live_date: day(p.open_date), window_close_date: day(p.close_date),
      notes: [p.notes, `Imported from the retired pre-order tool on 2026-09-17 (${p.platform || "shopify"}${p.store_name ? ` · ${p.store_name}` : ""}${p.target_ship_date ? ` · target ship ${p.target_ship_date}` : ""}).`].filter(Boolean).join("\n"),
      meta: { legacy_fulfillment_project_id: p.id, legacy_status: p.status, legacy_preorder_status: p.preorder_status, platform: p.platform, target_ship_date: p.target_ship_date, buffer_pct: p.buffer_pct },
      job_id: jobId, status_timestamps: { building: p.created_at, live: p.open_date || null, closed: p.close_date || null, done: now, imported: now },
      created_at: p.created_at,
    }).select("id").single();
    if (error) { console.log("FAILED", p.name, error.message); continue; }
    const slots = [];
    let sort = 0;
    for (const pr of products) {
      const key = norm(pr.name);
      const match = items.find(i => norm(i.name) === key) || items.find(i => key.includes(norm(i.name)) || norm(i.name).includes(key));
      slots.push({
        release_id: rel.id, company_id: p.company_id, brief_id: null,
        line_id: match ? `item:${match.id}` : `legacy:${pr.id}`, item_id: match ? match.id : null,
        format: pr.name, retail: pr.retail_price ?? null, model,
        line_notes: [pr.notes, pr.shopify_product_url ? `Shopify: ${pr.shopify_product_url}` : null, match ? null : "no matching item on the cut job"].filter(Boolean).join(" · ") || null,
        sort_order: sort++, created_at: pr.created_at,
      });
    }
    for (const it of invItems) {
      slots.push({ release_id: rel.id, company_id: p.company_id, brief_id: null, line_id: `item:${it.id}`, item_id: it.id, format: it.name, retail: it.client_retail_per_unit ?? null, model, sort_order: sort++, created_at: p.created_at });
    }
    if (slots.length) { const { error: sErr } = await sb.from("release_slots").insert(slots); if (sErr) console.log("  slots FAILED", sErr.message); }
    console.log("imported:", p.name, "→", rel.id.slice(0, 8), "| lines", slots.length, "| matched items", slots.filter(s => s.item_id).length, "| job", jobId ? jobId.slice(0, 8) : "-");
  }
})();
