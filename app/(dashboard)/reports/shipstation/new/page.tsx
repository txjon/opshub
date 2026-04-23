"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { groupLineItems, type Group } from "@/lib/shipstation-group";

// ── CSV row shape ────────────────────────────────────────────────────────────
// ShipStation product-sales export: Store, SKU, Description, Category, QtySold, TotalSales
// Only SKU / Description / QtySold / TotalSales are used. Refund rows come
// through with no SKU and a negative TotalSales — we flag but still include
// them in the selection UI so Jon decides.
type ParsedRow = {
  idx: number;
  sku: string;
  description: string;
  qty_sold: number;
  product_sales: number;
  included: boolean;
};

const fmtD = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (n: number) => Number(n || 0).toLocaleString("en-US");

// Unit costs are typed in but often copy-pasted from Excel — so the raw
// string can include currency symbols, thousands commas, whitespace, or
// a stray trailing newline. parseFloat silently returns NaN on any of
// those and the real values get dropped on save. Strip the noise first.
function parseMoney(raw: unknown): number {
  if (raw == null) return 0;
  const cleaned = String(raw).replace(/[\$,\s]/g, "").trim();
  if (!cleaned) return 0;
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

// Tiny CSV parser. Handles quoted fields w/ embedded commas + the BOM
// prefix ShipStation adds. Not RFC 4180-strict but covers these exports.
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

type Client = { id: string; name: string; hpd_fee_pct: number | null };

export default function NewShipstationReportPage() {
  const router = useRouter();
  const supabase = createClient();

  const [stage, setStage] = useState<1 | 2 | 3 | 4>(1);

  // Stage 1
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const [periodLabel, setPeriodLabel] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  });
  const [rawRows, setRawRows] = useState<ParsedRow[]>([]);
  const [csvError, setCsvError] = useState("");
  const [mergedCount, setMergedCount] = useState(0); // how many duplicate-SKU rows were merged on parse

  // Stage 3
  const [unitCosts, setUnitCosts] = useState<Record<string, string>>({}); // sku → string (raw input)
  const [savedCosts, setSavedCosts] = useState<Record<string, number>>({}); // sku → number from DB

  // Stage 4
  const [feePct, setFeePct] = useState<string>("0.20");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const client = clients.find(c => c.id === clientId) || null;

  // Load clients. v1: all clients — Jon will grow into this over time.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, name, hpd_fee_pct")
        .order("name");
      setClients(data || []);
      // Default to Forward Observations Group if present (only fulfillment client today)
      const fog = (data || []).find(c => c.name.toLowerCase().includes("forward observations"));
      if (fog) setClientId(fog.id);
    })();
  }, []);

  // Pull persisted unit costs + client fee when we know the client.
  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data } = await supabase
        .from("shipstation_sku_costs")
        .select("sku, unit_cost")
        .eq("client_id", clientId);
      const map: Record<string, number> = {};
      (data || []).forEach((r: any) => { map[r.sku] = Number(r.unit_cost); });
      setSavedCosts(map);
      const c = clients.find(c => c.id === clientId);
      if (c?.hpd_fee_pct != null) setFeePct(String(c.hpd_fee_pct));
    })();
  }, [clientId, clients]);

  async function onCsvFile(file: File) {
    setCsvError("");
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length < 2) throw new Error("CSV looks empty");
      const header = parsed[0].map(h => h.trim().toLowerCase());
      const skuIdx = header.findIndex(h => h === "sku");
      const descIdx = header.findIndex(h => h === "description");
      const qtyIdx = header.findIndex(h => h === "qtysold" || h === "qty sold" || h === "qty");
      const salesIdx = header.findIndex(h => h === "totalsales" || h === "total sales" || h === "sales");
      if (skuIdx < 0 || qtyIdx < 0 || salesIdx < 0) {
        throw new Error("CSV is missing required columns (SKU, QtySold, TotalSales)");
      }
      // ShipStation sometimes emits the same SKU on multiple rows (e.g., a
      // product description was edited mid-period, so the catalog has two
      // entries). Economically those are one item — aggregate qty + sales
      // and keep the longer description. Blank-SKU rows (refunds) are kept
      // individually since each is its own line.
      const byKey = new Map<string, ParsedRow>();
      const blankSkuRows: ParsedRow[] = [];
      let merged = 0;
      for (let i = 1; i < parsed.length; i++) {
        const r = parsed[i];
        if (!r || r.every(c => !c || !c.trim())) continue;
        const sku = (r[skuIdx] || "").trim();
        const description = descIdx >= 0 ? (r[descIdx] || "").trim() : "";
        const qty_sold = parseMoney(r[qtyIdx]);
        const product_sales = parseMoney(r[salesIdx]);
        if (!sku) {
          blankSkuRows.push({ idx: 0, sku, description, qty_sold, product_sales, included: true });
          continue;
        }
        const existing = byKey.get(sku);
        if (existing) {
          existing.qty_sold += qty_sold;
          existing.product_sales += product_sales;
          if (description.length > existing.description.length) existing.description = description;
          merged++;
        } else {
          byKey.set(sku, { idx: 0, sku, description, qty_sold, product_sales, included: true });
        }
      }
      const rows: ParsedRow[] = [...byKey.values(), ...blankSkuRows].map((r, idx) => ({ ...r, idx }));
      if (rows.length === 0) throw new Error("No data rows found");
      setRawRows(rows);
      setMergedCount(merged);
    } catch (e: any) {
      setCsvError(e.message || "Failed to parse CSV");
      setRawRows([]);
    }
  }

  // Selected rows (stage 2) → feed stage 3.
  const selectedRows = useMemo(() => rawRows.filter(r => r.included), [rawRows]);

  // Stage 3 / 4 present groups (one row per product, size variants collapsed
  // into a "Sizes: …" subtitle). Each group shares a single unit-cost input
  // that applies to every variant SKU — Jon confirmed costs don't vary by
  // size. Groups are keyed by a stable (SKU root + description root).
  const groups = useMemo(() => {
    const raw = selectedRows.map(r => ({
      sku: r.sku,
      description: r.description,
      qty_sold: r.qty_sold,
      product_sales: r.product_sales,
      unit_cost: parseMoney(unitCosts[r.sku]),
    }));
    return groupLineItems(raw);
  }, [selectedRows, unitCosts]);

  // Live totals (stage 3 + stage 4) — uses current unitCosts map.
  const totals = useMemo(() => {
    const feeRate = parseMoney(feePct);
    let qty = 0, sales = 0, cost = 0;
    for (const r of selectedRows) {
      const uc = parseMoney(unitCosts[r.sku]);
      qty += r.qty_sold;
      sales += r.product_sales;
      cost += uc * r.qty_sold;
    }
    const net = sales - cost;
    const fee = net * feeRate;
    const profit = net - fee;
    return { qty, sales, cost, net, fee, profit };
  }, [selectedRows, unitCosts, feePct]);

  // Anchor for shift-click range selection. Stores the last row index the
  // user clicked (without shift). Shift-click between anchor and target
  // applies the anchor row's new state to the whole range.
  const lastClickedIdxRef = useRef<number | null>(null);
  const toggleRow = useCallback((idx: number, shiftKey: boolean) => {
    setRawRows(rs => {
      const target = rs.find(r => r.idx === idx);
      if (!target) return rs;
      const newState = !target.included;
      if (shiftKey && lastClickedIdxRef.current != null && lastClickedIdxRef.current !== idx) {
        const [from, to] = [lastClickedIdxRef.current, idx].sort((a, b) => a - b);
        return rs.map(r => (r.idx >= from && r.idx <= to) ? { ...r, included: newState } : r);
      }
      return rs.map(r => r.idx === idx ? { ...r, included: newState } : r);
    });
    if (!shiftKey) lastClickedIdxRef.current = idx;
  }, []);
  const selectAll = useCallback(() => setRawRows(rs => rs.map(r => ({ ...r, included: true }))), []);
  const clearAll = useCallback(() => setRawRows(rs => rs.map(r => ({ ...r, included: false }))), []);

  // When we enter stage 3, seed unitCosts from savedCosts for any SKU we haven't touched.
  useEffect(() => {
    if (stage !== 3) return;
    setUnitCosts(cur => {
      const next = { ...cur };
      for (const r of selectedRows) {
        if (next[r.sku] !== undefined) continue;
        if (savedCosts[r.sku] !== undefined) next[r.sku] = String(savedCosts[r.sku]);
      }
      return next;
    });
  }, [stage, selectedRows, savedCosts]);

  async function generate() {
    setSaving(true);
    setSaveError("");
    try {
      const feeRate = parseMoney(feePct);

      // 1. Upsert per-SKU unit costs so next month pre-fills. De-dupe by
      // sku (keeping the last entry wins) so Postgres doesn't reject the
      // batch with "ON CONFLICT DO UPDATE command cannot affect row a
      // second time" if any duplicates slipped through parse aggregation.
      const upsertsMap = new Map<string, any>();
      for (const r of selectedRows) {
        if (!r.sku) continue; // blank-SKU refund rows never persist
        upsertsMap.set(r.sku, {
          client_id: clientId,
          sku: r.sku,
          description: r.description || null,
          unit_cost: parseMoney(unitCosts[r.sku]),
          updated_at: new Date().toISOString(),
        });
      }
      const upserts = Array.from(upsertsMap.values());
      if (upserts.length) {
        const { error: upErr } = await (supabase as any)
          .from("shipstation_sku_costs")
          .upsert(upserts, { onConflict: "client_id,sku" });
        if (upErr) throw upErr;
      }

      // 2. If the client's saved fee rate has changed, write it back.
      if (client && (client.hpd_fee_pct == null || Math.abs(client.hpd_fee_pct - feeRate) > 1e-9)) {
        await (supabase as any).from("clients").update({ hpd_fee_pct: feeRate }).eq("id", clientId);
      }

      // 3. Insert the report.
      const line_items = selectedRows.map(r => ({
        sku: r.sku,
        description: r.description,
        qty_sold: r.qty_sold,
        product_sales: r.product_sales,
        unit_cost: parseMoney(unitCosts[r.sku]),
      }));
      const source_rows = rawRows.map(r => ({
        sku: r.sku,
        description: r.description,
        qty_sold: r.qty_sold,
        product_sales: r.product_sales,
        included: r.included,
      }));

      const { data: user } = await supabase.auth.getUser();
      const { data: inserted, error: insErr } = await (supabase as any)
        .from("shipstation_reports")
        .insert({
          client_id: clientId,
          period_label: periodLabel,
          hpd_fee_pct: feeRate,
          line_items,
          source_rows,
          totals,
          created_by: user.user?.id || null,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;

      router.push(`/reports/shipstation/${inserted.id}`);
    } catch (e: any) {
      setSaveError(e.message || "Generate failed");
      setSaving(false);
    }
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px" };
  const input: React.CSSProperties = { padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, outline: "none", fontFamily: font, boxSizing: "border-box" };
  const btnPrimary: React.CSSProperties = { background: T.accent, color: "#0a0e1a", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontFamily: font, fontWeight: 700, cursor: "pointer" };
  const btnGhost: React.CSSProperties = { background: T.surface, color: T.muted, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: "pointer" };
  const thStyle: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}` };
  const tdStyle: React.CSSProperties = { padding: "6px 10px", fontSize: 12, borderBottom: `1px solid ${T.border}`, fontFamily: mono };

  const stagePill = (n: number, label: string, active: boolean, done: boolean) => (
    <div key={n} style={{
      display: "flex", alignItems: "center", gap: 8, flex: 1,
      padding: "8px 12px", borderRadius: 8,
      background: active ? T.accent + "22" : done ? T.surface : "transparent",
      border: `1px solid ${active ? T.accent : done ? T.border : T.border}`,
    }}>
      <span style={{ width: 22, height: 22, borderRadius: 11, background: active ? T.accent : done ? T.green : T.surface, color: active || done ? "#0a0e1a" : T.muted, fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center", fontFamily: mono }}>
        {done ? "✓" : n}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color: active ? T.text : T.muted }}>{label}</span>
    </div>
  );

  const canNextFrom1 = clientId && periodLabel.trim() && rawRows.length > 0 && !csvError;
  const canNextFrom2 = selectedRows.length > 0;
  const canNextFrom3 = selectedRows.every(r => unitCosts[r.sku] !== undefined && unitCosts[r.sku] !== "");

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, color: T.muted, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Reports · ShipStation</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Create Sales Report</h1>
      </div>

      {/* Stage pills */}
      <div style={{ display: "flex", gap: 8 }}>
        {stagePill(1, "Upload", stage === 1, stage > 1)}
        {stagePill(2, "Select rows", stage === 2, stage > 2)}
        {stagePill(3, "Unit costs", stage === 3, stage > 3)}
        {stagePill(4, "Review + generate", stage === 4, false)}
      </div>

      {/* ── Stage 1 — Upload ── */}
      {stage === 1 && (
        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "block" }}>Client</label>
              <select value={clientId} onChange={e => setClientId(e.target.value)} style={input}>
                <option value="">— select client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "block" }}>Period</label>
              <input value={periodLabel} onChange={e => setPeriodLabel(e.target.value)} placeholder="e.g. April 2026" style={input} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "block" }}>ShipStation CSV</label>
            <div style={{ border: `1px dashed ${T.border}`, borderRadius: 10, padding: "18px 16px", background: T.surface, display: "flex", alignItems: "center", gap: 12 }}>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={e => e.target.files?.[0] && onCsvFile(e.target.files[0])}
                style={{ fontSize: 12, color: T.muted, fontFamily: font }}
              />
              {rawRows.length > 0 && (
                <span style={{ fontSize: 12, color: T.green, fontFamily: mono }}>
                  ✓ {rawRows.length} rows parsed
                </span>
              )}
            </div>
            {csvError && <div style={{ fontSize: 12, color: T.red, marginTop: 8 }}>{csvError}</div>}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button disabled={!canNextFrom1} onClick={() => setStage(2)} style={{ ...btnPrimary, opacity: canNextFrom1 ? 1 : 0.4, cursor: canNextFrom1 ? "pointer" : "not-allowed" }}>
              Next →
            </button>
          </div>
        </div>
      )}

      {/* ── Stage 2 — Select rows ── */}
      {stage === 2 && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: T.muted }}>
              <span style={{ fontWeight: 700, color: T.text }}>{selectedRows.length}</span> of {rawRows.length} rows included
              <span style={{ marginLeft: 10, fontSize: 11, color: T.faint }}>Shift-click to select a range</span>
              {mergedCount > 0 && (
                <span style={{ marginLeft: 10, fontSize: 11, color: T.amber }}>
                  · Merged {mergedCount} duplicate-SKU row{mergedCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={selectAll} style={btnGhost}>Select all</button>
              <button onClick={clearAll} style={btnGhost}>Clear all</button>
            </div>
          </div>

          <div style={{ maxHeight: 500, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: T.card, zIndex: 1 }}>
                <tr>
                  <th style={{ ...thStyle, width: 40 }}></th>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Description</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Qty Sold</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Product Sales</th>
                </tr>
              </thead>
              <tbody>
                {rawRows.map(r => {
                  const flagNegative = r.product_sales < 0;
                  const flagNoSku = !r.sku;
                  const flag = flagNegative || flagNoSku;
                  return (
                    <tr key={r.idx} style={{ background: flag ? "rgba(245,158,11,0.06)" : "transparent", opacity: r.included ? 1 : 0.45 }}>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={r.included}
                          onChange={() => {}} /* state mutation handled on click so we get shiftKey */
                          onClick={(e) => toggleRow(r.idx, e.shiftKey)}
                          style={{ cursor: "pointer" }}
                        />
                      </td>
                      <td style={{ ...tdStyle, color: flagNoSku ? T.amber : T.text, fontWeight: 600 }}>{r.sku || "(no SKU)"}</td>
                      <td style={{ ...tdStyle, fontFamily: font, color: T.muted }}>{r.description || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtN(r.qty_sold)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", color: flagNegative ? T.amber : T.text }}>{fmtD(r.product_sales)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            <button onClick={() => setStage(1)} style={btnGhost}>← Back</button>
            <button disabled={!canNextFrom2} onClick={() => setStage(3)} style={{ ...btnPrimary, opacity: canNextFrom2 ? 1 : 0.4, cursor: canNextFrom2 ? "pointer" : "not-allowed" }}>Next →</button>
          </div>
        </div>
      )}

      {/* ── Stage 3 — Unit costs (per product, applied to every size variant) ── */}
      {stage === 3 && (
        <>
          <LiveTotalsStrip totals={totals} />
          <div style={card}>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>
              One unit cost per product. Variants with different sizes share the same cost. Costs save per client so next month pre-fills.
            </div>
            <div style={{ maxHeight: 540, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: T.card, zIndex: 1 }}>
                  <tr>
                    <th style={thStyle}>Product</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Qty</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Sales</th>
                    <th style={{ ...thStyle, width: 120, textAlign: "right" }}>Unit Cost</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Total Cost</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(g => {
                    // Represent the group's cost by the first variant's entry
                    // (all variants share one cost). The input writes to every
                    // variant SKU so saved data stays per-SKU.
                    const primarySku = g.variants[0]?.sku || "";
                    const raw = unitCosts[primarySku] ?? "";
                    const uc = parseMoney(raw);
                    const totalCost = uc * g.qty_sold;
                    const net = g.product_sales - totalCost;
                    const fromSaved = primarySku && savedCosts[primarySku] !== undefined;
                    const setCostForGroup = (val: string) => {
                      setUnitCosts(c => {
                        const next = { ...c };
                        for (const v of g.variants) next[v.sku] = val;
                        return next;
                      });
                    };
                    const sizesLabel = g.variants
                      .filter(v => v.size || v.qty_sold > 0)
                      .map(v => `${v.size || v.sku}: ${fmtN(v.qty_sold)}`)
                      .join("  ·  ");
                    return (
                      <tr key={g.key}>
                        <td style={{ ...tdStyle, fontFamily: font, verticalAlign: "top" }}>
                          <div style={{ fontWeight: 600, color: T.text }}>{g.root_description}</div>
                          <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, marginTop: 2 }}>{g.root_sku || "(no SKU)"}</div>
                          {g.variants.length > 1 && (
                            <div style={{ fontSize: 10, color: T.muted, marginTop: 4, fontFamily: mono }}>{sizesLabel}</div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", verticalAlign: "top" }}>{fmtN(g.qty_sold)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", verticalAlign: "top" }}>{fmtD(g.product_sales)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", padding: "4px 6px", verticalAlign: "top" }}>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={raw}
                            onChange={e => setCostForGroup(e.target.value)}
                            onFocus={e => e.target.select()}
                            onBlur={e => {
                              const v = e.target.value;
                              if (!v.trim()) return;
                              const n = parseMoney(v);
                              const normalized = n === 0 ? "" : String(n);
                              if (normalized !== v) setCostForGroup(normalized);
                            }}
                            placeholder="0.00"
                            title={fromSaved ? `Saved from last run: ${fmtD(savedCosts[primarySku])}` : undefined}
                            style={{ ...input, padding: "4px 8px", fontSize: 12, fontFamily: mono, textAlign: "right", width: "100%", borderColor: uc === 0 && raw.trim() ? T.red : fromSaved ? T.green + "55" : T.border }}
                          />
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", color: uc > 0 ? T.text : T.faint, verticalAlign: "top" }}>{uc > 0 ? fmtD(totalCost) : "—"}</td>
                        <td style={{ ...tdStyle, textAlign: "right", color: net >= 0 ? T.green : T.red, verticalAlign: "top" }}>{uc > 0 ? fmtD(net) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
              <button onClick={() => setStage(2)} style={btnGhost}>← Back</button>
              <button disabled={!canNextFrom3} onClick={() => setStage(4)} style={{ ...btnPrimary, opacity: canNextFrom3 ? 1 : 0.4, cursor: canNextFrom3 ? "pointer" : "not-allowed" }}>Next →</button>
            </div>
            {!canNextFrom3 && <div style={{ fontSize: 11, color: T.amber, marginTop: 8 }}>Every product needs a unit cost (enter 0 if it's free).</div>}
          </div>
        </>
      )}

      {/* ── Stage 4 — Review + generate ── */}
      {stage === 4 && (
        <>
          <LiveTotalsStrip totals={totals} />
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Client</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{client?.name || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Period</div>
                <input value={periodLabel} onChange={e => setPeriodLabel(e.target.value)} style={{ ...input, fontSize: 13, fontWeight: 700 }} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>HPD Fee</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="text" inputMode="decimal"
                    value={feePct}
                    onChange={e => setFeePct(e.target.value)}
                    onFocus={e => e.target.select()}
                    style={{ ...input, fontSize: 13, fontWeight: 700, width: 90, fontFamily: mono, textAlign: "right" }}
                  />
                  <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>({(parseMoney(feePct) * 100).toFixed(1)}%)</span>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 11, color: T.muted }}>
              {groups.length} product{groups.length === 1 ? "" : "s"} ({selectedRows.length} variant{selectedRows.length === 1 ? "" : "s"}) · {fmtN(totals.qty)} units · {fmtD(totals.sales)} in sales · {fmtD(totals.profit)} net to client
            </div>

            {saveError && <div style={{ fontSize: 12, color: T.red, background: T.red + "11", padding: "8px 12px", borderRadius: 6 }}>{saveError}</div>}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button onClick={() => setStage(3)} style={btnGhost} disabled={saving}>← Back</button>
              <button onClick={generate} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
                {saving ? "Generating..." : "Generate Report"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LiveTotalsStrip({ totals }: { totals: { qty: number; sales: number; cost: number; net: number; fee: number; profit: number } }) {
  const fmt = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const items: { label: string; value: string; color?: string }[] = [
    { label: "Qty", value: Number(totals.qty).toLocaleString() },
    { label: "Product Sales", value: fmt(totals.sales) },
    { label: "Total Cost", value: fmt(totals.cost), color: T.muted },
    { label: "Product Net", value: fmt(totals.net) },
    { label: "HPD Fee", value: fmt(totals.fee), color: T.amber },
    { label: "Net Profit", value: fmt(totals.profit), color: T.green },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
      {items.map(i => (
        <div key={i.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>{i.label}</div>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: mono, color: i.color || T.text }}>{i.value}</div>
        </div>
      ))}
    </div>
  );
}
