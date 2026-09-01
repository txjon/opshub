"use client";
// BULK IMPORT — one all-stores Shipping Cost export → a draft postage invoice
// per client (Jon, Sep 1 2026: "parse the bulk, separate it out into invoice
// drafts, then go client by client"). Deliberately THIN: this page only maps
// stores to clients, guards double-billing, and creates DRAFT
// shipstation_reports rows using each client's saved rates — review / edit /
// push / send all happen on the existing per-invoice pages. Store → client
// mapping is learned once (shipstation_store_map, mig 168) and reused monthly.
// Covers per-shipment POSTAGE clients only: Full Service needs its sales CSV,
// and fulfillment-only clients run their own ShipStation (not in this export).
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { parseShipmentsCsv, buildPostageInvoice, dateOnly, type ShipmentRow } from "@/lib/shipstation-csv";
import { parsePeriodRange, monthAlignedLabel, rangesOverlap } from "@/lib/billing-period";

const fmtD = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (n: number) => Number(n || 0).toLocaleString("en-US");

type Client = { id: string; name: string; hpd_fee_pct: number | null; hpd_per_package_fee: number | null };
type MapRow = { store_name: string; client_id: string | null; skip: boolean };
type PriorReport = { id: string; client_id: string; report_type: string; period_label: string | null; qb_invoice_number: string | null; totals: any };

function shipDateAsDate(raw: string): Date | null {
  const t = dateOnly(raw);
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return null;
}

export default function BulkFulfillmentImportPage() {
  const supabase = createClient();

  const [clients, setClients] = useState<Client[]>([]);
  const [storeMap, setStoreMap] = useState<Record<string, MapRow>>({});
  const [reports, setReports] = useState<PriorReport[]>([]);
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [parseError, setParseError] = useState("");
  const [dropHot, setDropHot] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({});          // clientId → include
  const [markerChecks, setMarkerChecks] = useState<Record<string, boolean>>({}); // clientId → create $0 marker
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [created, setCreated] = useState<{ clientName: string; id: string | null; noBillables: boolean; total: number }[] | null>(null);

  useEffect(() => {
    (async () => {
      const [c, m, r] = await Promise.all([
        supabase.from("clients").select("id, name, hpd_fee_pct, hpd_per_package_fee").order("name"),
        supabase.from("shipstation_store_map").select("store_name, client_id, skip"),
        supabase.from("shipstation_reports").select("id, client_id, report_type, period_label, qb_invoice_number, totals"),
      ]);
      setClients((c.data || []) as Client[]);
      const byStore: Record<string, MapRow> = {};
      for (const row of (m.data || []) as MapRow[]) byStore[row.store_name] = row;
      setStoreMap(byStore);
      setReports((r.data || []) as PriorReport[]);
    })();
  }, []);

  async function onFile(file: File) {
    setParseError(""); setCreated(null); setCreateError("");
    try {
      const parsed = parseShipmentsCsv(await file.text());
      if (!parsed.some(r => r.store)) throw new Error("No Store column found — export the all-stores Shipping Cost report (Store = All).");
      setRows(parsed);
      setChecks({}); setMarkerChecks({});
    } catch (e: any) {
      setParseError(e.message || "Failed to parse CSV");
      setRows([]);
    }
  }

  // Remember an assignment (or a skip) forever.
  async function assignStore(storeName: string, clientId: string | null, skip: boolean) {
    const row: MapRow = { store_name: storeName, client_id: clientId, skip };
    setStoreMap(m => ({ ...m, [storeName]: row }));
    await (supabase.from("shipstation_store_map") as any)
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "store_name" });
  }

  // ── Derivations ─────────────────────────────────────────────────────────
  const window_ = useMemo(() => {
    let min: Date | null = null, max: Date | null = null;
    for (const r of rows) {
      const d = shipDateAsDate(r.ship_date);
      if (!d) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
    if (!min || !max) return null;
    return { min, max, label: monthAlignedLabel(min, max), range: parsePeriodRange(monthAlignedLabel(min, max))! };
  }, [rows]);

  const byStore = useMemo(() => {
    const m: Record<string, ShipmentRow[]> = {};
    for (const r of rows) (m[r.store || "(no store)"] ||= []).push(r);
    return m;
  }, [rows]);

  // Store rows split three ways: mapped (grouped by client), skipped, unmapped.
  const { clientGroups, skippedStores, unmappedStores } = useMemo(() => {
    const groups: Record<string, { client: Client; stores: string[]; rows: ShipmentRow[] }> = {};
    const skipped: { store: string; rows: ShipmentRow[] }[] = [];
    const unmapped: { store: string; rows: ShipmentRow[] }[] = [];
    for (const [store, srows] of Object.entries(byStore)) {
      const map = storeMap[store];
      if (map?.skip) { skipped.push({ store, rows: srows }); continue; }
      const client = map?.client_id ? clients.find(c => c.id === map.client_id) : undefined;
      if (!client) { unmapped.push({ store, rows: srows }); continue; }
      const g = (groups[client.id] ||= { client, stores: [], rows: [] });
      g.stores.push(store);
      g.rows.push(...srows);
    }
    const sorted = Object.values(groups).sort((a, b) => b.rows.length - a.rows.length);
    return { clientGroups: sorted, skippedStores: skipped, unmappedStores: unmapped };
  }, [byStore, storeMap, clients]);

  // Double-billing guard: any existing report for this client whose period
  // overlaps the window locks the row.
  function overlapFor(clientId: string): PriorReport | null {
    if (!window_) return null;
    for (const r of reports) {
      if (r.client_id !== clientId) continue;
      const pr = parsePeriodRange(r.period_label);
      if (pr && rangesOverlap(pr, window_.range)) return r;
    }
    return null;
  }

  const groupCalcs = useMemo(() => clientGroups.map(g => {
    const markup = Number(g.client.hpd_fee_pct) || 0;
    const perPkg = Number(g.client.hpd_per_package_fee) || 0;
    const noRates = g.client.hpd_fee_pct == null && g.client.hpd_per_package_fee == null;
    const overlap = overlapFor(g.client.id);
    const inv = buildPostageInvoice(g.rows, markup, perPkg);
    return { ...g, markup, perPkg, noRates, overlap, inv };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [clientGroups, reports, window_]);

  // "No billables" filler candidates: previously billed clients with zero
  // shipments in the file and nothing already covering the window.
  const noBillableClients = useMemo(() => {
    if (!window_ || rows.length === 0) return [];
    const inFile = new Set(clientGroups.map(g => g.client.id));
    const billedEver = new Set(reports.filter(r => !r.totals?.no_billables).map(r => r.client_id));
    return clients.filter(c => billedEver.has(c.id) && !inFile.has(c.id) && !overlapFor(c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, reports, clientGroups, window_, rows.length]);

  const included = groupCalcs.filter(g => !g.overlap && (checks[g.client.id] ?? true));
  const markers = noBillableClients.filter(c => markerChecks[c.id] ?? true);

  async function createDrafts() {
    if (!window_) return;
    setCreating(true); setCreateError("");
    try {
      const { data: user } = await supabase.auth.getUser();
      const out: { clientName: string; id: string | null; noBillables: boolean; total: number }[] = [];
      for (const g of included) {
        const { data, error } = await (supabase.from("shipstation_reports") as any)
          .insert({
            client_id: g.client.id,
            report_type: "postage",
            postage_mode: "per_shipment",
            period_label: window_.label,
            hpd_fee_pct: g.markup,
            per_package_fee: g.perPkg,
            line_items: g.inv.line_items,
            totals: g.inv.totals,
            created_by: user.user?.id || null,
          })
          .select("id").single();
        if (error) throw new Error(`${g.client.name}: ${error.message}`);
        out.push({ clientName: g.client.name, id: data.id, noBillables: false, total: g.inv.totals.invoice_total });
      }
      for (const c of markers) {
        const { data, error } = await (supabase.from("shipstation_reports") as any)
          .insert({
            client_id: c.id,
            report_type: "postage",
            postage_mode: "per_shipment",
            period_label: window_.label,
            hpd_fee_pct: 0,
            per_package_fee: 0,
            line_items: [],
            totals: { shipments: 0, items: 0, paid: 0, cost_raw: 0, cost: 0, insurance: 0, billed: 0, margin: 0, fulfillment: 0, invoice_total: 0, no_billables: true },
            created_by: user.user?.id || null,
          })
          .select("id").single();
        if (error) throw new Error(`${c.name}: ${error.message}`);
        out.push({ clientName: c.name, id: data.id, noBillables: true, total: 0 });
      }
      setCreated(out);
      // Refresh reports so a second run against the same file locks everything.
      const { data: r } = await supabase.from("shipstation_reports").select("id, client_id, report_type, period_label, qb_invoice_number, totals");
      setReports((r || []) as PriorReport[]);
    } catch (e: any) {
      setCreateError(e.message || "Create failed");
    } finally {
      setCreating(false);
    }
  }

  // ── Styles ──────────────────────────────────────────────────────────────
  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 18px", width: "100%", maxWidth: 1040 };
  const thStyle: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}` };
  const tdStyle: React.CSSProperties = { padding: "8px 10px", fontSize: 12.5, borderBottom: `1px solid ${T.border}`, fontFamily: mono, verticalAlign: "top" };
  const label = (t: string) => <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{t}</div>;
  const btnPrimary: React.CSSProperties = { background: T.accent, color: "#0a0a0a", border: "none", borderRadius: 7, padding: "11px 28px", fontSize: 13.5, fontFamily: font, fontWeight: 700, cursor: "pointer" };
  const select: React.CSSProperties = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontSize: 12, padding: "6px 8px", fontFamily: font, outline: "none" };

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <div style={{ width: "100%", maxWidth: 1040 }}>
        <div style={{ fontSize: 11, color: T.muted, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          <a href="/invoices?stream=fulfillment" style={{ color: T.muted, textDecoration: "none" }}>← Invoices</a> · Fulfillment
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 25, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Bulk Import</h1>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 6 }}>
          One all-stores export → a draft invoice per client. Review and push each from its own page.
        </div>
      </div>

      {/* ── Done view ── */}
      {created ? (
        <div style={{ ...card, maxWidth: 640, display: "flex", flexDirection: "column", gap: 10 }}>
          {label(`Created ${created.length} draft${created.length === 1 ? "" : "s"} · ${window_?.label || ""}`)}
          {created.map(c => (
            <div key={c.id || c.clientName} style={{ display: "flex", alignItems: "baseline", gap: 12, fontSize: 13 }}>
              <span style={{ fontWeight: 700 }}>{c.clientName}</span>
              {c.noBillables
                ? <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.faint }}>No billables</span>
                : <span style={{ fontFamily: mono, fontWeight: 700 }}>{fmtD(c.total)}</span>}
              {!c.noBillables && c.id && (
                <a href={`/invoices/fulfillment/${c.id}`} style={{ marginLeft: "auto", fontSize: 12, color: T.blue, fontWeight: 700, textDecoration: "none" }}>Review →</a>
              )}
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: `1px solid ${T.border}`, paddingTop: 12, marginTop: 4 }}>
            <a href="/invoices?stream=fulfillment" style={{ ...btnPrimary, textDecoration: "none" }}>Open the invoices list</a>
          </div>
        </div>
      ) : rows.length === 0 ? (
        /* ── Stage 1: drop the file ── */
        <div style={{ ...card, maxWidth: 720, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 11.5, color: T.muted }}>
            Get the file:{" "}
            <a href="https://ship11.shipstation.com/dashboard/reports/ShippingCosts" target="_blank" rel="noopener noreferrer"
              style={{ color: T.blue, fontWeight: 700, textDecoration: "none" }}>
              ShipStation → Insights → Reports → Shipping Cost ↗
            </a>
            {" "}— set the date range, Store = <strong style={{ color: T.text }}>All</strong>, all providers/services - Export to CSV
          </div>
          <div
            onDragOver={e => { e.preventDefault(); setDropHot(true); }}
            onDragLeave={() => setDropHot(false)}
            onDrop={e => { e.preventDefault(); setDropHot(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
            onClick={() => document.getElementById("bulk-file-input")?.click()}
            style={{ border: `1.5px dashed ${dropHot ? T.accent : T.border}`, borderRadius: 12, padding: "48px 20px", background: dropHot ? T.surface : "transparent", textAlign: "center", cursor: "pointer" }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Drop the all-stores export here — or click to choose</div>
            <div style={{ fontSize: 11, color: T.faint, marginTop: 5 }}>Shipping Cost CSV · one file, every client</div>
            <input id="bulk-file-input" type="file" accept=".csv,text/csv" style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); (e.target as any).value = ""; }} />
          </div>
          {parseError && <div style={{ fontSize: 12, color: T.red }}>{parseError}</div>}
        </div>
      ) : (
        /* ── Stage 2: review the split ── */
        <>
          <div style={{ width: "100%", maxWidth: 1040, fontSize: 12.5, color: T.muted }}>
            <strong style={{ color: T.text, fontFamily: mono }}>{fmtN(rows.length)}</strong> shipments ·{" "}
            window <strong style={{ color: T.text, fontFamily: mono }}>{window_?.label}</strong> ·{" "}
            {clientGroups.length} client{clientGroups.length === 1 ? "" : "s"}
            <button onClick={() => { setRows([]); }} style={{ background: "none", border: "none", color: T.faint, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: font, marginLeft: 12, textDecoration: "underline", textUnderlineOffset: 3 }}>
              start over
            </button>
          </div>

          {/* Unmapped stores — assign or skip, remembered forever. */}
          {unmappedStores.length > 0 && (
            <div style={{ ...card, borderColor: T.amber + "66" }}>
              {label("New stores — tell me who these are (remembered for every future run)")}
              {unmappedStores.map(u => (
                <div key={u.store} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", fontSize: 13, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, minWidth: 180 }}>{u.store}</span>
                  <span style={{ fontFamily: mono, fontSize: 11.5, color: T.muted }}>{fmtN(u.rows.length)} shipments</span>
                  <select defaultValue="" style={select} onChange={e => { if (e.target.value) assignStore(u.store, e.target.value, false); }}>
                    <option value="" disabled>Assign to client…</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button onClick={() => assignStore(u.store, null, true)}
                    style={{ background: "none", border: `1px solid ${T.border}`, color: T.muted, fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 5, cursor: "pointer", fontFamily: font }}>
                    Skip — internal / not billable
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* The split — one draft per client. */}
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 40, textAlign: "center" }}></th>
                  <th style={thStyle}>Client</th>
                  <th style={thStyle}>Store(s)</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Ships</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Carrier cost</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Est. invoice</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {groupCalcs.map(g => {
                  const locked = !!g.overlap;
                  const on = !locked && (checks[g.client.id] ?? true);
                  return (
                    <tr key={g.client.id} style={{ opacity: locked ? 0.55 : 1 }}>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <input type="checkbox" checked={on} disabled={locked}
                          onChange={() => setChecks(c => ({ ...c, [g.client.id]: !on }))} style={{ cursor: locked ? "default" : "pointer" }} />
                      </td>
                      <td style={{ ...tdStyle, fontFamily: font, fontWeight: 700 }}>{g.client.name}</td>
                      <td style={{ ...tdStyle, fontFamily: font, fontSize: 11, color: T.muted }}>{g.stores.join(" + ")}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtN(g.rows.length)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", color: T.muted }}>{fmtD(g.inv.totals.cost_raw)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmtD(g.inv.totals.invoice_total)}</td>
                      <td style={{ ...tdStyle, fontFamily: font }}>
                        {locked ? (
                          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.amber }}>
                            Already billed{g.overlap!.qb_invoice_number ? ` · #${g.overlap!.qb_invoice_number}` : " · draft exists"}
                          </span>
                        ) : g.noRates ? (
                          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.amber }}>No saved rates · drafts at $0</span>
                        ) : (
                          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.green }}>
                            Ready · {(g.markup * 100).toFixed(0)}% + {fmtD(g.perPkg)}/pkg
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* No billables — the rolling-scan filler months. */}
          {noBillableClients.length > 0 && (
            <div style={card}>
              {label(`No billables this window — mark the month (shows faint in History)`)}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
                {noBillableClients.map(c => {
                  const on = markerChecks[c.id] ?? true;
                  return (
                    <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, cursor: "pointer" }}>
                      <input type="checkbox" checked={on} onChange={() => setMarkerChecks(m => ({ ...m, [c.id]: !on }))} />
                      {c.name}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Skipped stores — visible, reversible, expandable for an eyeball. */}
          {skippedStores.length > 0 && (
            <div style={{ width: "100%", maxWidth: 1040, fontSize: 11.5, color: T.faint }}>
              Skipped:{" "}
              {skippedStores.map((s, i) => (
                <span key={s.store}>
                  <button onClick={() => setExpandedStore(expandedStore === s.store ? null : s.store)}
                    style={{ background: "none", border: "none", color: T.muted, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: font, padding: 0, textDecoration: "underline", textUnderlineOffset: 3 }}>
                    {s.store}
                  </button>
                  {" "}({fmtN(s.rows.length)}) <button onClick={() => assignStore(s.store, null, false)} style={{ background: "none", border: "none", color: T.faint, fontSize: 10.5, cursor: "pointer", fontFamily: font, padding: 0 }}>unskip</button>
                  {i < skippedStores.length - 1 ? " · " : ""}
                </span>
              ))}
              {expandedStore && (
                <div style={{ marginTop: 8, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", maxHeight: 220, overflowY: "auto" }}>
                  {(byStore[expandedStore] || []).map(r => (
                    <div key={r.idx} style={{ display: "flex", gap: 12, fontSize: 11.5, fontFamily: mono, color: T.muted, padding: "2px 0" }}>
                      <span>{dateOnly(r.ship_date)}</span>
                      <span style={{ fontFamily: font, color: T.text }}>{r.recipient || "—"}</span>
                      <span>{r.order_number || "—"}</span>
                      <span style={{ marginLeft: "auto" }}>{fmtD(r.shipping_cost)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {createError && <div style={{ width: "100%", maxWidth: 1040, fontSize: 12, color: T.red, fontWeight: 700 }}>{createError}</div>}

          <div style={{ width: "100%", maxWidth: 1040, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 14, paddingBottom: 20 }}>
            <span style={{ fontSize: 12, color: T.muted }}>
              {included.length} draft{included.length === 1 ? "" : "s"}
              {markers.length > 0 ? ` + ${markers.length} no-billables marker${markers.length === 1 ? "" : "s"}` : ""}
              {" "}· {fmtD(included.reduce((a, g) => a + g.inv.totals.invoice_total, 0))} total
            </span>
            <button onClick={createDrafts} disabled={creating || (included.length === 0 && markers.length === 0) || unmappedStores.length > 0}
              title={unmappedStores.length > 0 ? "Assign or skip the new stores first" : undefined}
              style={{ ...btnPrimary, opacity: creating || (included.length === 0 && markers.length === 0) || unmappedStores.length > 0 ? 0.5 : 1 }}>
              {creating ? "Creating…" : "Create drafts"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
