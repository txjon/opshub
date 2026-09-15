"use client";
// Logistics → Destinations. Where a project's goods go: the default ship-to
// (from the client's address book) and, when needed, a per-item per-size split
// across two or more addresses (split shipments, mig 180).
//
// View only — reads lib/destinations, writes lib/destination-actions. Rendered
// inside JobDetailV2's Logistics block (dark T tokens, same card language).
// Design map: https://claude.ai/artifact/TaR32tPynQBHzpn7BFk2hv

import React, { useEffect, useMemo, useState } from "react";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { createClient } from "@/lib/supabase/client";
import { ModalShell } from "@/components/board-kit";
import { logJobActivity } from "@/components/JobActivityPanel";
import { addressLines, resolveJobShipTo, sumQ, type LocationRow, type SizeQtys } from "@/lib/destinations";
import { createLocation, saveItemSplit, setJobShipTo, type SplitRow } from "@/lib/destination-actions";

type Item = { id: string; name: string; qtys?: Record<string, number> | null };
type SplitByItem = Record<string, { location_id: string; qtys: SizeQtys; sort_order: number }[]>;

const LBL: React.CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.faint };
const CARD: React.CSSProperties = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px", minWidth: 0 };
const INPUT: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 13, fontFamily: font, outline: "none", boxSizing: "border-box", width: "100%", colorScheme: "dark" };
const LINK: React.CSSProperties = { background: "none", border: "none", padding: 0, cursor: "pointer", color: T.blue, fontSize: 12.5, fontWeight: 700, fontFamily: font };
const BTN: React.CSSProperties = { fontSize: 12.5, fontWeight: 800, padding: "8px 14px", borderRadius: 999, border: `1px solid ${T.border}`, background: T.card, color: T.text, cursor: "pointer", fontFamily: font };
const BTN_PRIMARY: React.CSSProperties = { ...BTN, background: T.accent, color: "#111", border: `1px solid ${T.accent}` };

export function DestinationsPanel({ jobId, clientId, route, shipToLocationId, typeMeta, clientShippingAddress, items, isMobile, onShipToChange, onError }: {
  jobId: string;
  clientId: string | null;
  route: string;                       // job route; stage = no client destination
  shipToLocationId: string | null;
  typeMeta: any;                       // legacy fallback only (resolveJobShipTo)
  clientShippingAddress: string | null;
  items: Item[];
  isMobile: boolean;
  onShipToChange: (projectedTypeMeta: Record<string, any>) => void;   // keeps V2's job state in step
  onError: (msg: string, e?: any) => void;
}) {
  const sb = useMemo(() => createClient(), []);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [splits, setSplits] = useState<SplitByItem>({});
  const [loaded, setLoaded] = useState(false);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editor, setEditor] = useState(false);
  const [localShipToId, setLocalShipToId] = useState<string | null>(shipToLocationId);
  useEffect(() => setLocalShipToId(shipToLocationId), [shipToLocationId]);

  const reload = async () => {
    if (!clientId) { setLocations([]); setSplits({}); setLoaded(true); return; }
    const [{ data: locs }, { data: sp }] = await Promise.all([
      sb.from("client_locations").select("id, client_id, job_id, label, address, contact_name, contact_phone, is_default, active")
        .eq("client_id", clientId).eq("active", true).or(`job_id.is.null,job_id.eq.${jobId}`).order("is_default", { ascending: false }).order("label"),
      items.length ? sb.from("item_destinations").select("item_id, location_id, qtys, sort_order").in("item_id", items.map(i => i.id)) : Promise.resolve({ data: [] as any[] }),
    ]);
    setLocations((locs || []) as LocationRow[]);
    const by: SplitByItem = {};
    for (const r of (sp || []) as any[]) (by[r.item_id] = by[r.item_id] || []).push(r);
    for (const k of Object.keys(by)) by[k].sort((a, b) => a.sort_order - b.sort_order);
    setSplits(by); setLoaded(true);
  };
  useEffect(() => { reload(); }, [clientId, jobId, items.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  const shipTo = resolveJobShipTo({ ship_to_location_id: localShipToId, type_meta: typeMeta, clients: { shipping_address: clientShippingAddress } }, locations);
  const book = locations.filter(l => !l.job_id);
  const projectOnly = locations.filter(l => l.job_id);
  const locById = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations]);

  const choose = async (loc: LocationRow) => {
    try {
      const meta = await setJobShipTo(sb, jobId, loc);
      setLocalShipToId(loc.id); setPicking(false); onShipToChange(meta);
      logJobActivity(jobId, `Ship-to set to ${loc.label}`);
    } catch (e) { onError("Ship-to save failed — not saved", e); }
  };

  const splitItems = items.filter(it => (splits[it.id] || []).length > 1);
  const splitDestIds = Array.from(new Set(splitItems.flatMap(it => splits[it.id].map(r => r.location_id))));

  if (route === "stage") return null;   // webstore drop — no client destination

  return (
    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
      {/* ── default destination ── */}
      <div style={CARD}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <span style={LBL}>Destination</span>
          {!picking && clientId && <button style={LINK} onClick={() => setPicking(true)}>{shipTo ? "Change" : "Add address"}</button>}
        </div>
        {!picking && (
          shipTo ? (
            <div style={{ fontSize: 13, lineHeight: 1.4 }}>
              <div style={{ ...LBL, color: T.muted, marginBottom: 3 }}>{shipTo.label}</div>
              {addressLines(shipTo.address).map((l, i) => <div key={i} style={{ fontWeight: 700 }}>{l}</div>)}
              {shipTo.contactName && <div style={{ color: T.muted, fontSize: 12, marginTop: 3 }}>{shipTo.contactName}{shipTo.contactPhone ? ` · ${shipTo.contactPhone}` : ""}</div>}
            </div>
          ) : <div style={{ fontSize: 13, color: T.amber, fontWeight: 700 }}>No address on file</div>
        )}
        {picking && (
          <div style={{ display: "grid", gap: 6 }}>
            {[...book, ...projectOnly].map(l => (
              <button key={l.id} onClick={() => choose(l)}
                style={{ textAlign: "left", background: l.id === localShipToId ? T.card : "transparent", border: `1px solid ${l.id === localShipToId ? T.text : T.border}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer", color: T.text, fontFamily: font }}>
                <div style={{ ...LBL, color: T.muted, marginBottom: 2 }}>{l.label}{l.job_id ? " · this project only" : l.is_default ? " · default" : ""}</div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{addressLines(l.address).join(", ")}</div>
              </button>
            ))}
            {!adding && (
              <div style={{ display: "flex", gap: 14, marginTop: 2 }}>
                <button style={LINK} onClick={() => setAdding(true)}>+ New address</button>
                <button style={{ ...LINK, color: T.muted }} onClick={() => setPicking(false)}>Cancel</button>
              </div>
            )}
            {adding && clientId && (
              <NewLocationForm clientId={clientId} jobId={jobId}
                onCancel={() => setAdding(false)}
                onCreated={async (loc) => { setAdding(false); await reload(); await choose(loc); }}
                onError={onError} />
            )}
          </div>
        )}
      </div>

      {/* ── split ── */}
      {loaded && shipTo && items.length > 0 && (
        <div style={CARD}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: splitItems.length ? 8 : 0 }}>
            <span style={LBL}>Split shipment{splitItems.length ? ` · ${splitItems.length} of ${items.length} items` : ""}</span>
            <button style={LINK} onClick={() => setEditor(true)}>{splitItems.length ? "Edit split" : "Ship to more than one address →"}</button>
          </div>
          {splitItems.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 360 }}>
                <thead><tr>
                  <th style={{ ...LBL, textAlign: "left", padding: "4px 10px 4px 0", fontWeight: 800 }}>Item</th>
                  {splitDestIds.map(id => <th key={id} style={{ ...LBL, textAlign: "right", padding: "4px 10px", fontWeight: 800, whiteSpace: "nowrap" }}>{locById.get(id)?.label || "?"}</th>)}
                  <th style={{ ...LBL, textAlign: "right", padding: "4px 0 4px 10px", fontWeight: 800 }}>Ordered</th>
                </tr></thead>
                <tbody>
                  {splitItems.map(it => (
                    <tr key={it.id} style={{ borderTop: `1px solid ${T.border}` }}>
                      <td style={{ padding: "6px 10px 6px 0", fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</td>
                      {splitDestIds.map(id => { const r = splits[it.id].find(x => x.location_id === id); return <td key={id} style={{ padding: "6px 10px", textAlign: "right", fontFamily: mono, fontVariantNumeric: "tabular-nums" }}>{r ? sumQ(r.qtys) : <span style={{ color: T.faint }}>0</span>}</td>; })}
                      <td style={{ padding: "6px 0 6px 10px", textAlign: "right", fontFamily: mono, fontVariantNumeric: "tabular-nums", color: T.muted }}>{sumQ(it.qtys || {})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editor && shipTo && shipTo.locationId && clientId && (
        <SplitEditor jobId={jobId} clientId={clientId} primary={locById.get(shipTo.locationId)!} locations={locations} items={items} splits={splits} isMobile={isMobile}
          onClose={() => setEditor(false)}
          onSaved={async () => { setEditor(false); await reload(); }}
          onLocationsChanged={reload}
          onError={onError} />
      )}
    </div>
  );
}

function NewLocationForm({ clientId, jobId, onCancel, onCreated, onError }: {
  clientId: string; jobId?: string | null; onCancel: () => void; onCreated: (loc: LocationRow) => void; onError: (m: string, e?: any) => void;
}) {
  const sb = useMemo(() => createClient(), []);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [scope, setScope] = useState<"book" | "project">(jobId ? "book" : "book");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!address.trim()) return;
    setBusy(true);
    try {
      const loc = await createLocation(sb, { clientId, jobId: scope === "project" ? jobId : null, label, address, contactName: contact, contactPhone: phone });
      onCreated(loc);
    } catch (e) { onError("Address save failed — not saved", e); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ display: "grid", gap: 8, border: `1px solid ${T.border}`, borderRadius: 8, padding: 10, marginTop: 4 }}>
      <input id="newloc-label" style={INPUT} placeholder="Label (Marketing office, Warehouse, …)" value={label} onChange={e => setLabel(e.target.value)} />
      <textarea id="newloc-address" style={{ ...INPUT, minHeight: 70, resize: "vertical", lineHeight: 1.45 }} placeholder={"Company\nStreet\nCity, ST ZIP"} value={address} onChange={e => setAddress(e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input id="newloc-contact" style={INPUT} placeholder="Contact (optional)" value={contact} onChange={e => setContact(e.target.value)} />
        <input id="newloc-phone" style={INPUT} placeholder="Phone (optional)" value={phone} onChange={e => setPhone(e.target.value)} />
      </div>
      {jobId && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: T.muted, cursor: "pointer" }}>
          <input type="checkbox" checked={scope === "project"} onChange={e => setScope(e.target.checked ? "project" : "book")} />
          Only for this project (don't save to the client's address book)
        </label>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button style={BTN} onClick={onCancel} disabled={busy}>Cancel</button>
        <button style={BTN_PRIMARY} onClick={save} disabled={busy || !address.trim()}>{busy ? "Saving…" : "Save address"}</button>
      </div>
    </div>
  );
}

// The split grid. The project's default destination is the REMAINDER column:
// the operator types what goes to the OTHER addresses and the rest stays on
// the default — so a 100 / 400 split is one number per size, not two.
function SplitEditor({ jobId, clientId, primary, locations, items, splits, isMobile, onClose, onSaved, onLocationsChanged, onError }: {
  jobId: string; clientId: string; primary: LocationRow; locations: LocationRow[]; items: Item[]; splits: SplitByItem; isMobile: boolean;
  onClose: () => void; onSaved: () => void; onLocationsChanged: () => Promise<void>; onError: (m: string, e?: any) => void;
}) {
  const sb = useMemo(() => createClient(), []);
  const others = locations.filter(l => l.id !== primary.id);
  const initialDests = Array.from(new Set(Object.values(splits).flat().map(r => r.location_id).filter(id => id !== primary.id)));
  const [dests, setDests] = useState<string[]>(initialDests);
  const [adding, setAdding] = useState(false);
  // grid[itemId][locationId][size] = units to that (non-primary) destination
  const [grid, setGrid] = useState<Record<string, Record<string, SizeQtys>>>(() => {
    const g: Record<string, Record<string, SizeQtys>> = {};
    for (const it of items) { g[it.id] = {}; for (const r of splits[it.id] || []) if (r.location_id !== primary.id) g[it.id][r.location_id] = { ...r.qtys }; }
    return g;
  });
  const [busy, setBusy] = useState(false);
  const locById = new Map(locations.map(l => [l.id, l]));

  const set = (itemId: string, locId: string, size: string, v: string) => {
    const n = Math.max(0, parseInt(v, 10) || 0);
    setGrid(g => ({ ...g, [itemId]: { ...g[itemId], [locId]: { ...(g[itemId]?.[locId] || {}), [size]: n } } }));
  };
  const remainder = (it: Item, size: string) => (Number(it.qtys?.[size]) || 0) - dests.reduce((a, d) => a + (Number(grid[it.id]?.[d]?.[size]) || 0), 0);
  const invalid = items.some(it => Object.keys(it.qtys || {}).some(sz => remainder(it, sz) < 0));

  const save = async () => {
    setBusy(true);
    try {
      for (const it of items) {
        const ordered = it.qtys || {};
        const rows: SplitRow[] = [{ locationId: primary.id, qtys: Object.fromEntries(Object.keys(ordered).map(sz => [sz, remainder(it, sz)])) }];
        for (const d of dests) rows.push({ locationId: d, qtys: grid[it.id]?.[d] || {} });
        await saveItemSplit(sb, it.id, ordered, rows);
      }
      const names = dests.map(d => locById.get(d)?.label).filter(Boolean).join(", ");
      logJobActivity(jobId, dests.length ? `Split shipment set: ${primary.label} + ${names}` : "Split shipment cleared");
      onSaved();
    } catch (e) { onError("Split save failed — not saved", e); }
    finally { setBusy(false); }
  };

  const cell: React.CSSProperties = { padding: "3px 6px", textAlign: "right", fontFamily: mono, fontVariantNumeric: "tabular-nums", fontSize: 12.5, whiteSpace: "nowrap" };
  const numIn: React.CSSProperties = { ...INPUT, width: 62, padding: "5px 6px", textAlign: "right", fontFamily: mono, fontSize: 12.5 };

  return (
    <ModalShell onClose={onClose} maxWidth={isMobile ? 520 : 860} dismissable={false}>
      <div style={{ padding: "18px 20px", color: T.text }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Split shipment</div>
        <div style={{ fontSize: 12.5, color: T.muted, marginTop: 3, marginBottom: 14 }}>
          Type what goes to each extra address. Whatever is left goes to <b style={{ color: T.text }}>{primary.label}</b>.
        </div>

        {/* destinations */}
        <div style={{ ...LBL, marginBottom: 6 }}>Extra addresses</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
          {others.map(l => {
            const on = dests.includes(l.id);
            return (
              <button key={l.id} onClick={() => setDests(d => on ? d.filter(x => x !== l.id) : [...d, l.id])}
                style={{ ...BTN, background: on ? T.accent : T.card, color: on ? "#111" : T.text, borderColor: on ? T.accent : T.border }}>
                {l.label}{l.job_id ? " · this project" : ""}
              </button>
            );
          })}
          {!adding && <button style={{ ...LINK, alignSelf: "center" }} onClick={() => setAdding(true)}>+ New address</button>}
        </div>
        {adding && (
          <NewLocationForm clientId={clientId} jobId={jobId} onCancel={() => setAdding(false)}
            onCreated={async (loc) => { setAdding(false); await onLocationsChanged(); setDests(d => [...d, loc.id]); }}
            onError={onError} />
        )}

        {/* grid */}
        {dests.length > 0 && (
          <div style={{ overflowX: "auto", marginTop: 14, border: `1px solid ${T.border}`, borderRadius: 10 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ background: T.surface }}>
                  <th style={{ ...LBL, textAlign: "left", padding: "8px 10px" }}>Item · size</th>
                  <th style={{ ...LBL, ...cell, padding: "8px 10px" }}>Ordered</th>
                  {dests.map(d => <th key={d} style={{ ...LBL, ...cell, padding: "8px 10px" }}>{locById.get(d)?.label}</th>)}
                  <th style={{ ...LBL, ...cell, padding: "8px 10px" }}>{primary.label}</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => {
                  const sizes = sortSizes(Object.keys(it.qtys || {})).filter(sz => (Number(it.qtys?.[sz]) || 0) > 0);
                  const tot = sumQ(it.qtys || {});
                  const totTo = (d: string) => sizes.reduce((a, sz) => a + (Number(grid[it.id]?.[d]?.[sz]) || 0), 0);
                  const totRem = sizes.reduce((a, sz) => a + remainder(it, sz), 0);
                  return (
                    <React.Fragment key={it.id}>
                      <tr style={{ borderTop: `1px solid ${T.border}` }}>
                        <td style={{ padding: "8px 10px 2px", fontWeight: 700, fontSize: 13 }}>{it.name}</td>
                        <td style={{ ...cell, color: T.muted, paddingTop: 8 }}>{tot}</td>
                        {dests.map(d => <td key={d} style={{ ...cell, color: T.muted, paddingTop: 8 }}>{totTo(d)}</td>)}
                        <td style={{ ...cell, color: totRem < 0 ? T.red : T.muted, paddingTop: 8, fontWeight: 700 }}>{totRem}</td>
                      </tr>
                      {sizes.map(sz => {
                        const rem = remainder(it, sz);
                        return (
                          <tr key={sz}>
                            <td style={{ padding: "2px 10px 2px 22px", fontSize: 12.5, color: T.muted, fontFamily: mono }}>{sz}</td>
                            <td style={{ ...cell, color: T.faint }}>{it.qtys?.[sz]}</td>
                            {dests.map(d => (
                              <td key={d} style={cell}>
                                <input id={`split-${it.id}-${d}-${sz}`} type="text" inputMode="numeric" style={numIn}
                                  value={grid[it.id]?.[d]?.[sz] ?? ""} placeholder="0"
                                  onChange={e => set(it.id, d, sz, e.target.value)} />
                              </td>
                            ))}
                            <td style={{ ...cell, color: rem < 0 ? T.red : T.text, fontWeight: 600 }}>{rem}</td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {dests.length === 0 && initialDests.length > 0 && (
          <div style={{ fontSize: 12.5, color: T.amber, marginTop: 12 }}>No extra addresses selected. Saving clears the split — everything goes to {primary.label}.</div>
        )}
        {invalid && <div style={{ fontSize: 12.5, color: T.red, marginTop: 10, fontWeight: 600 }}>A size is over its ordered count (red). Fix it before saving.</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button style={BTN} onClick={onClose} disabled={busy}>Cancel</button>
          <button style={BTN_PRIMARY} onClick={save} disabled={busy || invalid || (dests.length === 0 && initialDests.length === 0)}>{busy ? "Saving…" : "Save split"}</button>
        </div>
      </div>
    </ModalShell>
  );
}
