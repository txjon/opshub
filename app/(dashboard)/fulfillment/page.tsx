"use client";
import { useEffect, useMemo, useState } from "react";
import { T, font, mono } from "@/lib/theme";
import { createClient } from "@/lib/supabase/client";

// Warehouse-facing intake feed. Chronological list of stage-route
// shipments received at HPD over the last 30 days, with their
// Shopify-entry status. Pure read-only — no nav-out, no drill-in.
// Daily lookups: "did we get the FOG box on Tuesday?" / "what's
// the status of last week's delivery?"
//
// Source: items.received_at_hpd_at within window, stage route (effective).
// Grouped into shipments by (decorator, normalized tracking) to match
// the /receiving page's mental model.

type IntakeItem = {
  id: string;
  name: string;
  blank_vendor: string | null;
  units: number;
  sizes: { size: string; qty: number }[];
  received_at_hpd_at: string;
  webstore_entered_at: string | null;
};

type IntakeRow = {
  key: string;
  received_at: string;          // earliest item.received_at_hpd_at in the shipment
  decorator_name: string;
  short_code: string;
  tracking: string | null;
  client_name: string;
  project_title: string;
  display_number: string;
  items: IntakeItem[];
  total_items: number;
  total_units: number;
  // Shopify-entry rollups
  entered_count: number;
  pending_count: number;
  shopify_state: "entered" | "partial" | "pending";
  // Sub-bucket
  intake_day: string;            // YYYY-MM-DD for grouping
};

function normalizeTracking(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

function fmtDayHeader(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(d); target.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - target.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff <= 6) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function FulfillmentPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [outsideStage, setOutsideStage] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  // Click-in detail modal — read-only item breakdown for the selected
  // intake. No actions, no nav-out.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openIntake = useMemo(
    () => openKey ? rows.find(r => r.key === openKey) || null : null,
    [openKey, rows],
  );

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    if (!openKey) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenKey(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openKey]);

  async function load() {
    setLoading(true);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    // Outside packages received and routed to staging (Receiving → received,
    // route="stage"). They reach here only after going through Receiving.
    const { data: outsideStageData } = await supabase
      .from("outside_shipments").select("*").eq("route", "stage").eq("status", "received")
      .order("received_at", { ascending: false }).limit(50);
    setOutsideStage(outsideStageData || []);
    // Pull stage-route jobs touched in the last 30 days. Phase filter
    // is loose here (any phase except cancelled) because we want to
    // surface completed intakes too — that's the whole point of the
    // history feed.
    const JOB_SELECT = "id, job_number, title, shipping_route, type_meta, client_id, clients(name), items(id, name, blank_vendor, shipping_route, received_at_hpd, received_at_hpd_at, webstore_entered_at, ship_tracking, ship_qtys, received_qtys, sample_qtys, sort_order, buy_sheet_lines(size, qty_ordered), decorator_assignments(decorator_id, decorators(name, short_code)))";
    // Stage fulfillment is normally a whole-job route, but an item can be
    // overridden to "stage" on a non-stage job (migration 076). Fetch both:
    // jobs whose default route is stage, plus jobs that carry a per-item
    // stage override. The per-item `eff === "stage"` filter in the loop
    // below narrows to the right items in either set.
    const { data: overrideItemRows } = await supabase
      .from("items").select("job_id").eq("shipping_route", "stage");
    const overrideJobIds = Array.from(new Set((overrideItemRows || []).map((r: any) => r.job_id).filter(Boolean)));
    const [stageJobsRes, overrideJobsRes] = await Promise.all([
      supabase.from("jobs").select(JOB_SELECT)
        .eq("shipping_route", "stage").neq("phase", "cancelled").gte("updated_at", thirtyDaysAgo),
      overrideJobIds.length
        ? supabase.from("jobs").select(JOB_SELECT)
            .in("id", overrideJobIds).neq("shipping_route", "stage")
            .neq("phase", "cancelled").gte("updated_at", thirtyDaysAgo)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    // Merge + dedupe by id (a job can't match both branches, but guard anyway).
    const jobs = Array.from(
      new Map([...(stageJobsRes.data || []), ...(overrideJobsRes.data || [])].map((j: any) => [j.id, j])).values()
    );

    // Bucket items into shipments by (decorator, tracking) and filter
    // to those with at least one item received in the 30-day window.
    type Bucket = {
      key: string;
      received_at_candidates: string[];
      decorator_name: string;
      short_code: string;
      tracking: string | null;
      client_name: string;
      project_title: string;
      display_number: string;
      items: any[];
    };
    const buckets = new Map<string, Bucket>();
    const cutoff = Date.now() - 30 * 86400000;

    for (const j of (jobs || []) as any[]) {
      const jobRoute = j.shipping_route || "ship_through";
      const clientName = j.clients?.name || "—";
      const displayNum = j.type_meta?.qb_invoice_number || j.type_meta?.stripe_invoice_number || j.job_number;
      for (const it of (j.items || [])) {
        const eff = it.shipping_route || jobRoute;
        if (eff !== "stage") continue;
        if (!it.received_at_hpd || !it.received_at_hpd_at) continue;
        if (new Date(it.received_at_hpd_at).getTime() < cutoff) continue;

        const decAssign = it.decorator_assignments?.[0];
        const decId = decAssign?.decorator_id || null;
        const decName = decAssign?.decorators?.name || "Unassigned";
        const shortCode = decAssign?.decorators?.short_code || "";
        const trk = normalizeTracking(it.ship_tracking);
        const key = `${j.id}::${decId || decName}::${trk || `notrk:${it.received_at_hpd_at.slice(0,10)}`}`;

        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = {
            key,
            received_at_candidates: [],
            decorator_name: decName,
            short_code: shortCode,
            tracking: trk,
            client_name: clientName,
            project_title: j.title || "",
            display_number: displayNum,
            items: [],
          };
          buckets.set(key, bucket);
        }
        bucket.items.push(it);
        bucket.received_at_candidates.push(it.received_at_hpd_at);
      }
    }

    const out: IntakeRow[] = Array.from(buckets.values()).map(b => {
      const receivedAt = [...b.received_at_candidates].sort()[0];
      let totalUnits = 0;
      let enteredCount = 0;
      const itemDetails: IntakeItem[] = [];
      for (const it of b.items) {
        if (it.webstore_entered_at) enteredCount++;
        const lines = it.buy_sheet_lines || [];
        const r = it.received_qtys || {};
        const s = it.ship_qtys || {};
        const samp = it.sample_qtys || {};
        let itemUnits = 0;
        const sizeBreakdown: { size: string; qty: number }[] = [];
        for (const l of lines) {
          const delivered = r[l.size] ?? s[l.size] ?? l.qty_ordered ?? 0;
          const sampled = samp[l.size] ?? 0;
          const continuing = Math.max(0, delivered - sampled);
          if (continuing > 0) sizeBreakdown.push({ size: l.size, qty: continuing });
          itemUnits += continuing;
        }
        totalUnits += itemUnits;
        itemDetails.push({
          id: it.id,
          name: it.name,
          blank_vendor: it.blank_vendor,
          units: itemUnits,
          sizes: sizeBreakdown,
          received_at_hpd_at: it.received_at_hpd_at,
          webstore_entered_at: it.webstore_entered_at || null,
        });
      }
      const pending = b.items.length - enteredCount;
      const state: IntakeRow["shopify_state"] = pending === 0 ? "entered" : (enteredCount === 0 ? "pending" : "partial");
      return {
        key: b.key,
        received_at: receivedAt,
        decorator_name: b.decorator_name,
        short_code: b.short_code,
        tracking: b.tracking,
        client_name: b.client_name,
        project_title: b.project_title,
        display_number: b.display_number,
        items: itemDetails,
        total_items: b.items.length,
        total_units: totalUnits,
        entered_count: enteredCount,
        pending_count: pending,
        shopify_state: state,
        intake_day: receivedAt.slice(0, 10),
      };
    });

    out.sort((a, b) => b.received_at.localeCompare(a.received_at));
    setRows(out);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r =>
      r.client_name.toLowerCase().includes(q)
      || r.decorator_name.toLowerCase().includes(q)
      || r.short_code.toLowerCase().includes(q)
      || (r.tracking || "").toLowerCase().includes(q)
      || r.project_title.toLowerCase().includes(q)
      || r.display_number.toLowerCase().includes(q)
    );
  }, [rows, search]);

  // Group by intake_day for date headers (Today / Yesterday / weekday / full date)
  const grouped = useMemo(() => {
    const groups: { day: string; label: string; rows: IntakeRow[] }[] = [];
    let current: { day: string; label: string; rows: IntakeRow[] } | null = null;
    for (const r of filtered) {
      if (!current || current.day !== r.intake_day) {
        current = { day: r.intake_day, label: fmtDayHeader(r.intake_day), rows: [] };
        groups.push(current);
      }
      current.rows.push(r);
    }
    return groups;
  }, [filtered]);

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading intake feed…</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Fulfillment</h1>
        <span style={{ fontSize: 12, color: T.muted }}>
          stage intake activity · last 30 days
        </span>
        <span style={{ flex: 1 }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, vendor, tracking…"
          style={{ width: 280, padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }} />
      </div>

      {outsideStage.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={{ fontSize: 12, fontWeight: 800, color: T.text, letterSpacing: "0.08em", textTransform: "uppercase", margin: "8px 0 0" }}>Outside packages</h2>
          {outsideStage.map(s => (
            <div key={s.id} style={{ ...card, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.description}</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                  {[s.sender, s.carrier, s.tracking].filter(Boolean).join(" · ")}
                  {s.job_id && <span style={{ marginLeft: 8, color: T.accent }}>Linked to order</span>}
                </div>
              </div>
              <button onClick={async () => { await supabase.from("outside_shipments").update({ status: "done" }).eq("id", s.id); setOutsideStage(prev => prev.filter(x => x.id !== s.id)); }}
                style={{ fontSize: 10, fontWeight: 700, padding: "6px 14px", borderRadius: 6, border: "none", background: T.green, color: "#fff", cursor: "pointer", whiteSpace: "nowrap" }}>
                Mark fulfilled
              </button>
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint, lineHeight: 1.6 }}>
          No stage intakes in the last 30 days.<br />
          Shipments appear here once warehouse marks them received.
        </div>
      ) : (
        grouped.map(group => (
          <div key={group.day} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
              <h2 style={{ fontSize: 12, fontWeight: 800, color: T.text, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
                {group.label}
              </h2>
              <span style={{ fontSize: 11, color: T.muted }}>
                {group.rows.length} intake{group.rows.length === 1 ? "" : "s"}
              </span>
            </div>
            {group.rows.map(r => {
              const tone = r.shopify_state === "entered" ? T.green : r.shopify_state === "partial" ? T.amber : T.faint;
              const label = r.shopify_state === "entered"
                ? "✓ Live in Shopify"
                : r.shopify_state === "partial"
                  ? `${r.entered_count}/${r.total_items} in Shopify`
                  : "Pending Shopify entry";
              return (
                <div key={r.key}
                  onClick={() => setOpenKey(r.key)}
                  style={{
                    ...card, padding: "12px 16px", display: "flex", gap: 16, alignItems: "flex-start",
                    borderLeft: `3px solid ${tone}`,
                    cursor: "pointer", transition: "border-color 0.12s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.borderLeftColor = tone; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.borderLeftColor = tone; }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{r.client_name}</span>
                      <span style={{ fontSize: 11, color: T.faint, fontFamily: mono }}>{r.display_number}</span>
                    </div>
                    {r.project_title && (
                      <div style={{ fontSize: 12, color: T.muted, marginTop: 2, wordBreak: "break-word" }}>{r.project_title}</div>
                    )}
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                      <span>from <strong style={{ color: T.text, fontWeight: 600 }}>{r.short_code || r.decorator_name}</strong></span>
                      <span style={{ fontFamily: mono, color: T.faint, wordBreak: "break-all" }}>
                        {r.tracking || "no tracking"}
                      </span>
                      <span style={{ color: T.faint }}>
                        received {new Date(r.received_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 130 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: tone, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      {label}
                    </span>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: mono, marginTop: 2 }}>
                      {r.total_items} item{r.total_items === 1 ? "" : "s"}
                    </div>
                    <span style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>
                      {r.total_units.toLocaleString()} units
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}

      {/* Intake detail modal — read-only item breakdown. No drill-out,
          no actions; this is purely a "what was in that box" lookup. */}
      {openIntake && (() => {
        const r = openIntake;
        const tone = r.shopify_state === "entered" ? T.green : r.shopify_state === "partial" ? T.amber : T.faint;
        const label = r.shopify_state === "entered"
          ? "✓ Live in Shopify"
          : r.shopify_state === "partial"
            ? `${r.entered_count}/${r.total_items} in Shopify`
            : "Pending Shopify entry";
        return (
          <div onClick={() => setOpenKey(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(12px, 3vw, 32px)" }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: T.card, borderRadius: 14, width: "min(720px, 100%)", maxHeight: "94vh", overflow: "hidden", display: "flex", flexDirection: "column", border: `1px solid ${T.border}`, borderLeft: `3px solid ${tone}` }}>
              {/* Header */}
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{r.client_name}</div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {r.project_title && <span>{r.project_title}</span>}
                    <span style={{ fontFamily: mono, color: T.faint }}>{r.display_number}</span>
                    <span style={{ color: T.faint }}>from {r.short_code || r.decorator_name}</span>
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 800, color: tone, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {label}
                </span>
                <button onClick={() => setOpenKey(null)}
                  style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
              </div>

              {/* Meta strip */}
              <div style={{ padding: "12px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 11, color: T.muted }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>Received</div>
                  <div style={{ fontSize: 12, color: T.text, fontWeight: 600, marginTop: 2 }}>
                    {new Date(r.received_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {new Date(r.received_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>Tracking</div>
                  <div style={{ fontSize: 12, color: T.text, fontFamily: mono, marginTop: 2, wordBreak: "break-all" }}>
                    {r.tracking || <span style={{ color: T.faint }}>no tracking</span>}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>Totals</div>
                  <div style={{ fontSize: 12, color: T.text, fontWeight: 600, marginTop: 2 }}>
                    {r.total_items} item{r.total_items === 1 ? "" : "s"} · {r.total_units.toLocaleString()} units
                  </div>
                </div>
              </div>

              {/* Items */}
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
                {r.items.map(it => (
                  <div key={it.id} style={{
                    padding: "10px 12px", borderRadius: 8,
                    background: it.webstore_entered_at ? T.greenDim + "33" : T.surface,
                    border: `1px solid ${it.webstore_entered_at ? T.green + "33" : T.border}`,
                    display: "flex", gap: 12, alignItems: "flex-start",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{it.name}</div>
                      {it.blank_vendor && (
                        <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{it.blank_vendor}</div>
                      )}
                      {it.sizes.length > 0 && (
                        <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {it.sizes.map(s => (
                            <span key={s.size} style={{ fontSize: 10, fontFamily: mono, color: T.muted, padding: "2px 6px", background: T.card, borderRadius: 3 }}>
                              {s.size}:{s.qty}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: it.webstore_entered_at ? T.green : T.amber, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                        {it.webstore_entered_at ? "✓ Entered" : "Pending"}
                      </span>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: mono }}>
                        {it.units} units
                      </div>
                      {it.webstore_entered_at && (
                        <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>
                          {new Date(it.webstore_entered_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
