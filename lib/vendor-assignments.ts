// The vendor is CHOSEN in costing (costProds[].printVendor), but the production
// board's vendor strips, the vendor portal's order list and the PO's
// sent-date stamps all read decorator_assignments. The job page keeps the two
// in step on every decoration edit (JobDetailV2 flushDeco). Paths that write a
// costProd any other way must call this, or the item shows "Unassigned vendor"
// and the order never reaches the vendor's portal (HPD-2609-044 duplicate,
// Oct 2026).
//
// Creates a CLEAN assignment only: vendor + decoration type. No stage, dates
// or tracking — a copied item is a new run, and the PO send stamps those.
// Items that already have an assignment are left alone.

type Db = any;

export async function ensureVendorAssignments(db: Db, itemIds: string[], costProds: any[]): Promise<number> {
  if (!itemIds.length) return 0;
  const { data: decorators, error: dErr } = await db.from("decorators").select("id, name, short_code");
  if (dErr) throw new Error(`decorators: ${dErr.message}`);
  const { data: existing, error: aErr } = await db.from("decorator_assignments").select("item_id").in("item_id", itemIds);
  if (aErr) throw new Error(`decorator_assignments: ${aErr.message}`);
  const has = new Set((existing || []).map((a: any) => a.item_id));

  const rows: any[] = [];
  for (const id of itemIds) {
    if (has.has(id)) continue;
    const cp = (costProds || []).find((p: any) => p?.id === id);
    const v = cp?.printVendor;
    if (!v) continue;
    const dec = (decorators || []).find((d: any) => d.short_code === v || d.name === v);
    if (!dec) continue;
    rows.push({ item_id: id, decorator_id: dec.id, decoration_type: cp.decorationType || "screen_print", pipeline_stage: null });
  }
  if (!rows.length) return 0;
  const { error } = await db.from("decorator_assignments").insert(rows);
  if (error) throw new Error(`decorator_assignments insert: ${error.message}`);
  return rows.length;
}
