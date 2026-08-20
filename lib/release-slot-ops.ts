// Release slot operations — ONE implementation for both sides of the glass
// (Continuum Phase 1.5, Aug 20 2026). The hub route and the internal /drops
// route are thin wrappers over these; the lane rules (lib/release-lanes
// doctrine), ownership checks, and status guards live here only.
//
// Actor model — full ops parity (Jon):
//   client — lineup edits while BUILDING; qtys while CLOSED (their step 5)
//   ops    — everything, any time PRE-CUT ("we need to be able to do
//            everything our client can do")
import { hasRun } from "@/lib/run-gate";

type Db = any; // supabase service-role client
export type SlotActor = "client" | "ops";
export type ReleaseRow = { id: string; client_id: string; status: string; company_id?: string | null };
export type SlotOpFail = { error: string; status: number };
const fail = (error: string, status: number): SlotOpFail => ({ error, status });
export const isSlotOpFail = (r: unknown): r is SlotOpFail => !!r && typeof (r as any).error === "string";

const preCut = (r: ReleaseRow) => r.status !== "cut";
const lineupEditable = (r: ReleaseRow, actor: SlotActor) =>
  actor === "ops" ? preCut(r) : r.status === "building";

// ── POST: add a line. Three lanes: { briefId, lineId } spec line ·
//    { briefId } direct studio pull · { itemId } pipeline · { itemId,
//    rerun: true } catalog re-run (must have actually run). ──────────────
export async function addSlot(
  db: Db, release: ReleaseRow,
  body: { briefId?: string; lineId?: string; itemId?: string; rerun?: boolean },
  actor: SlotActor,
): Promise<SlotOpFail | { slotId: string }> {
  if (!lineupEditable(release, actor)) return fail("This release is locked", 409);
  const { briefId, lineId, itemId, rerun } = body;
  const { count } = await db.from("release_slots").select("id", { count: "exact", head: true }).eq("release_id", release.id);

  let insert: Record<string, any>;
  if (itemId) {
    // Item-sourced line — pipeline item riding along, or a catalog RE-RUN.
    const { data: item } = await db.from("items")
      .select("id, name, client_retail_per_unit, pipeline_stage, jobs!inner(client_id, phase), buy_sheet_lines(size, qty_ordered)")
      .eq("id", String(itemId)).single();
    if (!item || (item as any).jobs?.client_id !== release.client_id) return fail("Item not found", 404);
    if (rerun && !hasRun((item as any).jobs?.phase, (item as any).pipeline_stage)) {
      return fail("That piece hasn't been produced yet", 400);
    }
    const qtys: Record<string, number> = {};
    for (const l of ((item as any).buy_sheet_lines || [])) {
      const n = Number(l.qty_ordered) || 0;
      if (n > 0) qtys[l.size] = n;
    }
    insert = {
      company_id: release.company_id || null,
      release_id: release.id,
      brief_id: null,
      line_id: rerun ? `rerun:${(item as any).id}` : `item:${(item as any).id}`,
      item_id: (item as any).id,
      format: (item as any).name,
      retail: (item as any).client_retail_per_unit ?? null,
      model: null,
      // pipeline: the run's real numbers ride along; re-run: last run
      // prefills, closing numbers overwrite
      qtys,
      sort_order: (count || 0),
    };
  } else if (briefId && !lineId) {
    // Direct studio pull — a design needs no product spec to be planned.
    // Guarded against double-birth: one committed lane per design.
    const { data: brief } = await db.from("art_briefs")
      .select("id, client_id, state, internal_only").eq("id", String(briefId)).single();
    if (!brief || (brief as any).client_id !== release.client_id || (brief as any).internal_only) {
      return fail("Design not found", 404);
    }
    if (!["working", "with_client", "approved"].includes((brief as any).state)) {
      return fail("That design left the studio", 409);
    }
    const { data: openSlots } = await db.from("release_slots")
      .select("id, releases!inner(status)").eq("brief_id", (brief as any).id).neq("releases.status", "cut");
    if ((openSlots || []).length) return fail("Already on a release", 409);
    const { data: openReq } = await db.from("lab_order_requests")
      .select("id").eq("brief_id", (brief as any).id).is("handled_at", null).limit(1);
    if ((openReq || []).length) return fail("Already ordered from the studio", 409);
    const { count: born } = await db.from("items")
      .select("id", { count: "exact", head: true }).eq("design_id", (brief as any).id);
    if (born) return fail("Already in production", 409);
    insert = {
      company_id: release.company_id || null,
      release_id: release.id,
      brief_id: (brief as any).id,
      line_id: `design:${(brief as any).id}`,
      format: null, retail: null, model: null,
      sort_order: (count || 0),
    };
  } else {
    const { data: brief } = await db.from("art_briefs")
      .select("id, client_id, product_spec, internal_only").eq("id", String(briefId || "")).single();
    if (!brief || (brief as any).client_id !== release.client_id || (brief as any).internal_only) return fail("Idea not found", 404);
    const line = (Array.isArray((brief as any).product_spec?.products) ? (brief as any).product_spec.products : []).find((x: any) => x.id === lineId);
    if (!line) return fail("Line not found on that idea", 404);
    insert = {
      company_id: release.company_id || null,
      release_id: release.id,
      brief_id: (brief as any).id,
      line_id: String(lineId),
      format: line.format || null,
      retail: line.retail ?? null,
      model: line.model || null,
      line_notes: line.notes || null,
      sort_order: (count || 0),
    };
  }
  const { data, error } = await db.from("release_slots").insert(insert).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return fail("Already on this release", 409);
    return fail(error.message, 500);
  }
  return { slotId: (data as any).id };
}

// ── DELETE: remove a line ─────────────────────────────────────────────
export async function removeSlot(
  db: Db, release: ReleaseRow, slotId: string, actor: SlotActor,
): Promise<SlotOpFail | { ok: true }> {
  if (!lineupEditable(release, actor)) return fail("This release is locked", 409);
  await db.from("release_slots").delete().eq("id", String(slotId || "")).eq("release_id", release.id);
  return { ok: true };
}

// ── PATCH: spec (format/retail) or per-size qtys ───────────────────────
export async function patchSlot(
  db: Db, release: ReleaseRow,
  body: { slotId?: string; qtys?: Record<string, unknown>; format?: unknown; retail?: unknown },
  actor: SlotActor,
): Promise<SlotOpFail | { ok: true }> {
  const { slotId, qtys, format, retail } = body;
  if (!slotId) return fail("Missing slot", 400);
  if (format !== undefined || retail !== undefined) {
    if (!lineupEditable(release, actor)) return fail("This release is locked", 409);
    const patch: Record<string, any> = {};
    if (format !== undefined) patch.format = String(format || "").trim().slice(0, 60) || null;
    if (retail !== undefined) patch.retail = retail === null || retail === "" ? null : Math.max(0, Math.round(Number(retail) * 100) / 100 || 0);
    const { error } = await db.from("release_slots").update(patch)
      .eq("id", String(slotId)).eq("release_id", release.id);
    if (error) return fail(error.message, 500);
    return { ok: true };
  }
  // Numbers: the client's step is after the sale closes; ops any time pre-cut.
  if (actor === "client" && release.status !== "closed") return fail("Numbers open after the sale closes", 409);
  if (actor === "ops" && !preCut(release)) return fail("This release is already cut", 409);
  const clean = Object.fromEntries(Object.entries(qtys || {})
    .map(([s, n]) => [String(s).slice(0, 20), Math.max(0, Math.min(1000000, Math.round(Number(n) || 0)))])
    .filter(([, n]) => (n as number) > 0));
  const { error } = await db.from("release_slots")
    .update({ qtys: clean, qtys_confirmed_at: null })
    .eq("id", String(slotId)).eq("release_id", release.id);
  if (error) return fail(error.message, 500);
  return { ok: true };
}
