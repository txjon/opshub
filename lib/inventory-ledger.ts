// The movement ledger (migration 119) — the single source of truth for every
// quantity that moves at every handoff: ship, receive, forward, stage.
//
// Why this exists: the old model stored quantities in MUTABLE fields
// (items.ship_qtys / received_qtys, shipment_lines.*_qtys) that got overwritten
// on every wave — so history was destroyed, waves clobbered each other, and no
// two surfaces agreed. Here, every movement is ONE append-only row. Nothing is
// overwritten. Every total is a plain SUM of rows. A correction is a new
// negative-qty row tagged reverses_id, so the mistake AND the fix both stay on
// the record.
//
// items.ship_qtys / received_qtys survive ONLY as a derived cache, recomputed
// from the ledger after every write by recomputeItemFromLedger(). Existing
// readers keep working and now always show the ledger's truth. Nothing writes
// those fields except the recompute — one write path, no drift.

import { shipProgress, type SizeQtys } from "./ship-progress";
import { deriveItem, type Route, type Movement as DerivMovement } from "./item-derivation";

export type MovementType = "ship" | "receive" | "forward" | "stage" | "pull" | "adjust";

export type Movement = {
  id: string;
  item_id: string | null;
  job_id: string | null;
  description: string | null;
  type: MovementType;
  qtys: SizeQtys;                 // per-size units moved (a reversal carries negatives)
  shipment_id: string | null;
  packing_slip_id: string | null;
  tracking: string | null;
  reason: string | null;
  source: string;                 // app | legacy | backfill | import
  reverses_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

// ── pure helpers (safe on client + server) ─────────────────────────────

const sumMap = (q: SizeQtys | null | undefined): number =>
  Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);

// Keep only nonzero entries; allows negatives (reversals / receive deltas).
export function cleanSigned(q: SizeQtys | null | undefined): SizeQtys {
  const out: SizeQtys = {};
  for (const [s, n] of Object.entries(q || {})) {
    const v = Number(n) || 0;
    if (v !== 0) out[s] = v;
  }
  return out;
}

// Keep only strictly-positive entries (a normal ship/receive/forward wave).
export function cleanPositive(q: SizeQtys | null | undefined): SizeQtys {
  const out: SizeQtys = {};
  for (const [s, n] of Object.entries(q || {})) {
    const v = Number(n) || 0;
    if (v > 0) out[s] = v;
  }
  return out;
}

// signed target − prior, dropping zeros (used to turn an absolute received
// snapshot into an append-only delta movement).
export function diffQtys(target: SizeQtys | null | undefined, prior: SizeQtys | null | undefined): SizeQtys {
  const out: SizeQtys = {};
  const sizes = Array.from(new Set([...Object.keys(target || {}), ...Object.keys(prior || {})]));
  for (const s of sizes) {
    const d = (Number(target?.[s]) || 0) - (Number(prior?.[s]) || 0);
    if (d !== 0) out[s] = d;
  }
  return out;
}

// Net per-size total for one movement type. Reversals (negative qtys) net out,
// so a shipped-then-unshipped size reads 0 and is dropped.
export function sumType(movements: { type: string; qtys: SizeQtys }[], type: MovementType): SizeQtys {
  const out: SizeQtys = {};
  for (const m of movements || []) {
    if (m.type !== type) continue;
    for (const [s, n] of Object.entries(m.qtys || {})) out[s] = (out[s] || 0) + (Number(n) || 0);
  }
  for (const k of Object.keys(out)) if (out[k] <= 0) delete out[k];
  return out;
}

export type LedgerState = ReturnType<typeof shipProgress> & {
  shippedMap: SizeQtys;
  receivedMap: SizeQtys;
  forwardedMap: SizeQtys;
  stagedMap: SizeQtys;
  forwarded: number;
  staged: number;
  onHand: number;   // received − forwarded − staged (pulls tracked in pulled_inventory)
  stage: "shipped" | "in_production" | string | null;
};

// The full derived state of an item, computed from ordered + its movements.
// This is what every surface should read once the reader-cutover lands; today
// the recompute projects the ship/received parts of it back onto the item cache.
export function ledgerState(
  ordered: SizeQtys | null | undefined,
  movements: { type: string; qtys: SizeQtys }[],
  currentStage?: string | null,
): LedgerState {
  const shippedMap = sumType(movements, "ship");
  const receivedMap = sumType(movements, "receive");
  const forwardedMap = sumType(movements, "forward");
  const stagedMap = sumType(movements, "stage");
  const prog = shipProgress(ordered, shippedMap, receivedMap);
  const forwarded = sumMap(forwardedMap);
  const staged = sumMap(stagedMap);
  const onHand = Math.max(0, prog.received - forwarded - staged);
  const anyShipped = prog.shipped > 0;
  const stage = prog.fullyShipped
    ? "shipped"
    : anyShipped
      ? "in_production"
      : (currentStage === "shipped" ? "in_production" : currentStage ?? null);
  return { ...prog, shippedMap, receivedMap, forwardedMap, stagedMap, forwarded, staged, onHand, stage };
}

// ── server-side write path (needs a Supabase client) ───────────────────

type Sb = any;

// Append one immutable movement. Returns its id (or null if nothing moved /
// the insert failed — callers never block on it, same convention as handoff.ts).
export async function appendMovement(supabase: Sb, m: {
  itemId: string;
  jobId?: string | null;
  type: MovementType;
  qtys: SizeQtys;               // signed — negatives only for reversals / receive corrections
  shipmentId?: string | null;
  packingSlipId?: string | null;
  tracking?: string | null;
  reason?: string | null;
  source?: string;
  reversesId?: string | null;
  description?: string | null;
}): Promise<string | null> {
  const qtys = cleanSigned(m.qtys);
  if (Object.keys(qtys).length === 0) return null;
  try {
    const { data: { user } = { user: null } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("movements").insert({
      item_id: m.itemId,
      job_id: m.jobId ?? null,
      description: m.description ?? null,
      type: m.type,
      qtys,
      shipment_id: m.shipmentId ?? null,
      packing_slip_id: m.packingSlipId ?? null,
      tracking: (m.tracking || "").trim() || null,
      reason: (m.reason || "").trim() || null,
      source: m.source || "app",
      reverses_id: m.reversesId ?? null,
      created_by: user?.id || null,
      created_by_name: user?.email || null,
    }).select("id").single();
    if (error) { console.error("[ledger] appendMovement", error); return null; }
    return data.id as string;
  } catch (e) {
    console.error("[ledger] appendMovement", e);
    return null;
  }
}

// Recompute the item's QUANTITY cache (ship_qtys / received_qtys /
// received_at_hpd) from the ledger. THE only writer of those fields going
// forward. Call after every movement append. Returns the derived state.
//
// Deliberately does NOT own pipeline_stage: whether a shipped-short item is
// "done (variance)" or "mid-wave (more coming)" is a workflow decision the
// calling action makes — deriving stage from qty alone would demote a real
// short-ship out of "shipped". The action sets stage using the returned state.
export async function recomputeItemFromLedger(supabase: Sb, itemId: string): Promise<LedgerState | null> {
  const { data: item } = await supabase
    .from("items")
    .select("id, pipeline_stage, shipping_route, ship_final, received_at_hpd, received_at_hpd_at, forwarded_at, webstore_entered_at, jobs(shipping_route), buy_sheet_lines(size, qty_ordered)")
    .eq("id", itemId).single();
  if (!item) return null;
  const ordered: SizeQtys = Object.fromEntries(
    (item.buy_sheet_lines || []).map((l: any) => [l.size, Number(l.qty_ordered) || 0])
  );
  const { data: movements } = await supabase.from("movements").select("id, type, qtys, shipment_id, reverses_id, tracking, created_at").eq("item_id", itemId);
  const st = ledgerState(ordered, movements || [], item.pipeline_stage);

  // Canonical order-state (shortage- + finality-aware) — this is what tells us,
  // correctly, whether the item is DONE for its route. `receiveFinal` = every
  // inbound box carrying this item has been counted in, so a short is a real
  // shortage (proceed) not still-in-transit (wait). Mirrors the loaders.
  const route: Route = ((item as any).shipping_route || (item as any).jobs?.shipping_route || "ship_through") as Route;
  const { data: slines } = await supabase.from("shipment_lines").select("received, shipments(direction)").eq("item_id", itemId);
  let inbound = 0, recvd = 0;
  for (const l of (slines || []) as any[]) { if (l.shipments?.direction !== "inbound") continue; inbound += 1; if (l.received) recvd += 1; }
  const receiveFinal = inbound > 0 && recvd === inbound;
  const derivMoves: DerivMovement[] = (movements || []).map((m: any) => ({ type: m.type, qtys: m.qtys || {}, shipmentId: m.shipment_id, reversesId: m.reverses_id, id: m.id }));
  const ds = deriveItem({ ordered, route, shipFinal: !!(item as any).ship_final, receiveFinal, movements: derivMoves });

  const nowIso = new Date().toISOString();
  const receivedAtHpd = ds.shippedTotal > 0 && ds.fullyReceived;   // caught up to everything shipped (final-aware)

  // ── legacy-field bridge ──────────────────────────────────────────────────
  // The rest of the app (phase calc, portal, jobs list, dashboard, PDFs) still
  // reads these flat item fields. The ledger is the truth; mirror it here — in
  // ONE place — so every v2 write path (forward/return/edit, enter/return/edit)
  // keeps the legacy readers correct without scattering writes at each call site.
  //
  // MONOTONIC done-flags: forwarded_at / webstore_entered_at / received_at_hpd
  // are read as "item DONE / at-HPD". We only ever ADVANCE them here — never
  // clear a flag that's already set. Why: pre-ledger backfilled items carry a
  // fabricated ship=ordered gap (real received is lower, no finality signal), so
  // a naive recompute would judge them not-done and REOPEN 22 completed jobs.
  // Advance-only protects that history; the deliberate un-complete paths
  // (returnEntered / returnForwardedLine / editReceivedLine-down) clear
  // explicitly, which is the only place a regression is actually intended.
  const latestForwardTracking = (movements || [])
    .filter((m: any) => m.type === "forward" && (m.tracking || "").trim())
    .sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0]?.tracking || null;

  const update: Record<string, any> = {
    // per-size DATA caches always reflect the current ledger (not monotonic)
    ship_qtys: Object.keys(st.shippedMap).length ? st.shippedMap : null,
    received_qtys: Object.keys(st.receivedMap).length ? st.receivedMap : null,
    // received_at_hpd tracks the active receiving flow — set AND clear (a
    // downward receive correction should un-flag it), same as before.
    received_at_hpd: receivedAtHpd,
    received_at_hpd_at: receivedAtHpd ? (item.received_at_hpd_at || nowIso) : null,
  };
  // forwarded_at / webstore_entered_at are MONOTONIC (advance-only) — see note above.
  if (route === "ship_through" && ds.done) {
    update.forwarded_at = (item as any).forwarded_at || nowIso;
    if (latestForwardTracking) update.forward_tracking = latestForwardTracking;
  }
  if (route === "stage" && ds.done) {
    update.webstore_entered_at = (item as any).webstore_entered_at || nowIso;
  }
  await supabase.from("items").update(update).eq("id", itemId);

  return st;
}

// Record a SHIP wave: append a ship movement, then recompute the cache.
export async function recordShip(supabase: Sb, opts: {
  itemId: string; jobId?: string | null; waveQtys: SizeQtys;
  shipmentId?: string | null; tracking?: string | null; description?: string | null; source?: string;
}): Promise<LedgerState | null> {
  await appendMovement(supabase, {
    itemId: opts.itemId, jobId: opts.jobId, type: "ship",
    qtys: cleanPositive(opts.waveQtys), shipmentId: opts.shipmentId,
    tracking: opts.tracking, description: opts.description, source: opts.source,
  });
  return recomputeItemFromLedger(supabase, opts.itemId);
}

// Record a RECEIVE to an ABSOLUTE per-size target (the receiver edits cumulative
// counts, not deltas). Converts to an append-only delta vs the ledger's prior
// receive total, appends it, then recomputes. A downward correction appends a
// negative delta — the audit trail keeps both.
export async function recordReceive(supabase: Sb, opts: {
  itemId: string; jobId?: string | null; targetReceived: SizeQtys;
  shipmentId?: string | null; tracking?: string | null; reason?: string | null; description?: string | null;
}): Promise<LedgerState | null> {
  const { data: movements } = await supabase.from("movements").select("type, qtys").eq("item_id", opts.itemId);
  const prior = sumType(movements || [], "receive");
  const delta = diffQtys(opts.targetReceived, prior);
  await appendMovement(supabase, {
    itemId: opts.itemId, jobId: opts.jobId, type: "receive", qtys: delta,
    shipmentId: opts.shipmentId, tracking: opts.tracking, reason: opts.reason, description: opts.description,
  });
  return recomputeItemFromLedger(supabase, opts.itemId);
}

// Record a FORWARD (ship_through) or STAGE (webstore) of a per-size quantity.
export async function recordOutbound(supabase: Sb, opts: {
  itemId: string; jobId?: string | null; type: "forward" | "stage"; qtys: SizeQtys;
  tracking?: string | null; reason?: string | null; description?: string | null;
}): Promise<LedgerState | null> {
  await appendMovement(supabase, {
    itemId: opts.itemId, jobId: opts.jobId, type: opts.type,
    qtys: cleanPositive(opts.qtys), tracking: opts.tracking, reason: opts.reason, description: opts.description,
  });
  return recomputeItemFromLedger(supabase, opts.itemId);
}

// Reverse the receipt(s) of ONE specific box (shipment). Used by box-scoped
// undo so undoing one box's receipt never touches the other boxes of the same
// item. Reverses every not-yet-reversed receive movement carrying shipmentId.
export async function reverseReceiptForShipment(supabase: Sb, itemId: string, shipmentId: string, reason?: string): Promise<number> {
  const { data: rows } = await supabase.from("movements")
    .select("*").eq("item_id", itemId).eq("type", "receive").eq("shipment_id", shipmentId)
    .order("created_at", { ascending: false });
  const all = (rows || []) as Movement[];
  const reversed = new Set(all.filter(m => m.reverses_id).map(m => m.reverses_id));
  const targets = all.filter(m => !m.reverses_id && !reversed.has(m.id));
  for (const t of targets) {
    const negation: SizeQtys = {};
    for (const [s, n] of Object.entries(t.qtys || {})) negation[s] = -(Number(n) || 0);
    await appendMovement(supabase, {
      itemId, jobId: t.job_id, type: "receive", qtys: negation, shipmentId,
      reason: reason || "Undo receipt", reversesId: t.id, description: t.description,
    });
  }
  await recomputeItemFromLedger(supabase, itemId);
  return targets.length;
}

// Reverse the LAST movement of a type (per-wave undo). Finds the most recent
// non-reversal, not-yet-reversed movement of `type`, appends its negation
// (reverses_id set), and recomputes. Returns the reversed movement (or null).
export async function reverseLastMovement(supabase: Sb, itemId: string, type: MovementType, reason?: string): Promise<Movement | null> {
  const { data: rows } = await supabase.from("movements")
    .select("*").eq("item_id", itemId).order("created_at", { ascending: false });
  const all = (rows || []) as Movement[];
  const reversed = new Set(all.filter(m => m.reverses_id).map(m => m.reverses_id));
  const target = all.find(m => m.type === type && !m.reverses_id && !reversed.has(m.id));
  if (!target) return null;
  const negation: SizeQtys = {};
  for (const [s, n] of Object.entries(target.qtys || {})) negation[s] = -(Number(n) || 0);
  await appendMovement(supabase, {
    itemId, jobId: target.job_id, type, qtys: negation, shipmentId: target.shipment_id,
    reason: reason || "Undo last wave", reversesId: target.id, description: target.description,
  });
  await recomputeItemFromLedger(supabase, itemId);
  return target;
}
