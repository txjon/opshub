"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";

// Contractor hours → QuickBooks (billing-gated). Hours are logged rate-blind in
// /hours; here the owner/bookkeeper applies the hourly rate per contractor for a
// week (Mon–Sun) and pushes a QB Bill per contractor. Pushed punches are stamped
// (pay_run_id) so the same hours can't be billed twice.

type Contractor = { id: string; name: string };
type Entry = { id: string; contractor_id: string; work_date: string; time_in: string | null; time_out: string | null; break_minutes: number | null; pay_run_id: string | null };
type Pay = { contractor_id: string; hourly_rate: number; qb_vendor_id: string | null; qb_vendor_name: string | null };
type Run = { id: string; contractor_id: string; period_start: string; hours: number; amount: number; qb_doc_number: string | null };

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lbl = { fontSize: 9.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: T.faint } as const;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function mondayOf(d: Date) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
function entryHours(e: Entry): number {
  if (!e.time_in || !e.time_out) return 0;
  const [ih, im] = e.time_in.split(":").map(Number); const [oh, om] = e.time_out.split(":").map(Number);
  let mins = (oh * 60 + om) - (ih * 60 + im); if (mins < 0) mins += 1440;
  mins -= Number(e.break_minutes || 0);
  return Math.max(0, mins) / 60;
}
const shortDate = (s: string) => { const [y, m, d] = s.split("-"); return `${m}/${d}`; };

export function ContractorHoursView() {
  const supabase = createClient();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pay, setPay] = useState<Record<string, Pay>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [rateEdits, setRateEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState<string | null>(null);
  const [vendorQ, setVendorQ] = useState("");
  const [vendorRes, setVendorRes] = useState<{ id: string; name: string }[]>([]);
  const [searching, setSearching] = useState(false);

  const periodStart = ymd(weekStart);
  const periodEnd = ymd(new Date(weekStart.getTime() + 6 * 86400000));

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: cs }, { data: es }, { data: ps }, { data: rs }] = await Promise.all([
      supabase.from("contractors").select("id, name").eq("active", true).order("sort_order"),
      supabase.from("contractor_time_entries").select("id, contractor_id, work_date, time_in, time_out, break_minutes, pay_run_id").gte("work_date", periodStart).lte("work_date", periodEnd),
      supabase.from("contractor_pay").select("contractor_id, hourly_rate, qb_vendor_id, qb_vendor_name"),
      supabase.from("contractor_pay_runs").select("id, contractor_id, period_start, hours, amount, qb_doc_number").eq("period_start", periodStart),
    ]);
    setContractors((cs as any) || []);
    setEntries((es as any) || []);
    setPay(Object.fromEntries(((ps as any[]) || []).map(p => [p.contractor_id, p])));
    setRuns((rs as any) || []);
    setLoading(false);
  }, [periodStart, periodEnd]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  // QB vendor search (debounced) for the mapping picker
  useEffect(() => {
    if (!mapOpen || vendorQ.trim().length < 2) { setVendorRes([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try { const r = await fetch(`/api/hours/qb-vendors?q=${encodeURIComponent(vendorQ)}`); const j = await r.json(); setVendorRes(j.vendors || []); }
      catch { setVendorRes([]); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [mapOpen, vendorQ]);

  const rows = useMemo(() => contractors.map(c => {
    const mine = entries.filter(e => e.contractor_id === c.id);
    const unpushed = mine.filter(e => !e.pay_run_id && e.time_in && e.time_out);
    const hours = Math.round(unpushed.reduce((s, e) => s + entryHours(e), 0) * 100) / 100;
    const openShift = mine.some(e => e.time_in && !e.time_out);
    const rate = rateEdits[c.id] !== undefined ? parseFloat(rateEdits[c.id]) || 0 : Number(pay[c.id]?.hourly_rate || 0);
    const run = runs.find(r => r.contractor_id === c.id);
    return { c, hours, rate, amount: Math.round(hours * rate * 100) / 100, openShift, run, vendor: pay[c.id]?.qb_vendor_name, vendorId: pay[c.id]?.qb_vendor_id || null };
  }), [contractors, entries, pay, runs, rateEdits]);

  const totalAmount = rows.reduce((s, r) => s + (r.run ? r.run.amount : r.amount), 0);

  async function saveRate(contractorId: string, val: string) {
    const r = parseFloat(val); if (isNaN(r)) return;
    await supabase.from("contractor_pay").upsert({ contractor_id: contractorId, hourly_rate: r, updated_at: new Date().toISOString() });
  }
  async function push(contractorId: string, rate: number) {
    setPushing(contractorId);
    const res = await fetch("/api/hours/push-qb", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contractorId, periodStart, periodEnd, rate }) });
    const j = await res.json();
    setPushing(null);
    if (!res.ok) { alert("Push failed: " + (j.error || res.statusText)); return; }
    await load();
  }
  async function mapVendor(contractorId: string, v: { id: string; name: string }) {
    await supabase.from("contractor_pay").upsert({ contractor_id: contractorId, qb_vendor_id: v.id, qb_vendor_name: v.name, updated_at: new Date().toISOString() });
    setMapOpen(null); setVendorQ(""); setVendorRes([]);
    await load();
  }
  async function unpush(run: Run) {
    if (!confirm(`Un-push these hours? This unlocks them in OpsHub so they can be re-pushed.\n\nIt does NOT touch QuickBooks — void QB bill${run.qb_doc_number ? " #" + run.qb_doc_number : ""} there separately.`)) return;
    await supabase.from("contractor_time_entries").update({ pay_run_id: null }).eq("pay_run_id", run.id);
    await supabase.from("contractor_pay_runs").delete().eq("id", run.id);
    await load();
  }

  return (
    <div>
      {/* Week selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <button onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * 86400000))} style={navBtn}>← Prev</button>
        <div style={{ fontSize: 14, fontWeight: 800, color: T.text, fontFamily: mono }}>{shortDate(periodStart)} – {shortDate(periodEnd)}</div>
        <button onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 86400000))} style={navBtn}>Next →</button>
        <button onClick={() => setWeekStart(mondayOf(new Date()))} style={{ ...navBtn, color: T.muted }}>This week</button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: T.muted }}>week total <strong style={{ fontFamily: mono, color: T.text }}>{money(totalAmount)}</strong></span>
      </div>

      <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 12 }}>Hours are logged in /hours (rate-blind). Apply the rate and push one QB Bill per contractor — posts to the contractor-labor account. Pushed hours lock so they can't be billed twice.</div>

      {loading ? <div style={{ color: T.muted, fontSize: 12, padding: 12 }}>Loading…</div> : (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "visible" }}>
          <div style={{ display: "flex", gap: 12, padding: "8px 16px", background: T.surface, ...lbl }}>
            <span style={{ flex: 1 }}>Contractor</span><span style={{ width: 80, textAlign: "right" }}>Hours</span>
            <span style={{ width: 100, textAlign: "right" }}>Rate</span><span style={{ width: 100, textAlign: "right" }}>Amount</span>
            <span style={{ width: 190 }}>QB Vendor</span><span style={{ width: 120, textAlign: "right" }}>Action</span>
          </div>
          {rows.length === 0 && <div style={{ padding: 14, fontSize: 12, color: T.muted }}>No active contractors.</div>}
          {rows.map(({ c, hours, rate, amount, openShift, run, vendor, vendorId }) => (
            <div key={c.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 16px", borderTop: `1px solid ${T.border}22`, fontSize: 12.5, opacity: run ? 0.7 : 1 }}>
              <span style={{ flex: 1, fontWeight: 600, color: T.text }}>{c.name}</span>
              <span style={{ width: 80, textAlign: "right", fontFamily: mono, color: hours > 0 ? T.text : T.faint }}>{run ? run.hours : hours}{openShift && !run ? " ⏱" : ""}</span>
              <span style={{ width: 100, textAlign: "right" }}>
                {run ? <span style={{ fontFamily: mono, color: T.muted }}>—</span> : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                    <span style={{ color: T.faint }}>$</span>
                    <input value={rateEdits[c.id] !== undefined ? rateEdits[c.id] : (pay[c.id]?.hourly_rate ?? "")} placeholder="0.00" inputMode="decimal"
                      onChange={e => setRateEdits(p => ({ ...p, [c.id]: e.target.value }))} onBlur={e => saveRate(c.id, e.target.value)}
                      style={{ width: 56, padding: "4px 6px", border: `1px solid ${T.border}`, borderRadius: 5, background: T.card, color: T.text, fontSize: 12.5, fontFamily: mono, textAlign: "right", outline: "none" }} />
                  </span>
                )}
              </span>
              <span style={{ width: 100, textAlign: "right", fontFamily: mono, fontWeight: 700, color: T.text }}>{money(run ? run.amount : amount)}</span>
              <span style={{ width: 190, position: "relative" }}>
                {run ? <span style={{ fontSize: 11.5, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{vendor || "—"}</span>
                  : mapOpen === c.id ? (
                    <div style={{ position: "relative" }}>
                      <input autoFocus value={vendorQ} onChange={e => setVendorQ(e.target.value)} placeholder="search QB vendor…" style={{ width: "100%", padding: "5px 8px", border: `1px solid ${T.accent}`, borderRadius: 5, background: T.card, color: T.text, fontSize: 12, fontFamily: font, outline: "none", boxSizing: "border-box" }} />
                      <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, zIndex: 30, background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
                        {searching && <div style={{ padding: "6px 10px", fontSize: 11.5, color: T.faint }}>searching…</div>}
                        {!searching && vendorRes.map(v => <div key={v.id} onClick={() => mapVendor(c.id, v)} style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer", color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.name}</div>)}
                        {!searching && vendorQ.trim().length >= 2 && vendorRes.length === 0 && <div style={{ padding: "6px 10px", fontSize: 11.5, color: T.faint }}>no match in QB</div>}
                        <div onClick={() => { setMapOpen(null); setVendorQ(""); }} style={{ padding: "6px 10px", fontSize: 11, color: T.faint, cursor: "pointer", borderTop: `1px solid ${T.border}33` }}>cancel</div>
                      </div>
                    </div>
                  ) : vendorId ? (
                    <span style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{vendor}</span>
                      <button onClick={() => { setMapOpen(c.id); setVendorQ(""); }} style={{ background: "none", border: "none", color: T.accent, fontSize: 10.5, cursor: "pointer", textDecoration: "underline", flexShrink: 0 }}>change</button>
                    </span>
                  ) : (
                    <button onClick={() => { setMapOpen(c.id); setVendorQ(""); }} style={{ background: T.amberDim, border: `1px solid ${T.amber}55`, color: T.amber, borderRadius: 5, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Map vendor</button>
                  )}
              </span>
              <span style={{ width: 120, textAlign: "right" }}>
                {run ? <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                    <span style={{ color: T.green, fontWeight: 700, fontSize: 12 }}>✓ Pushed{run.qb_doc_number ? ` · #${run.qb_doc_number}` : ""}</span>
                    <button onClick={() => unpush(run)} style={{ background: "none", border: "none", color: T.faint, fontSize: 10, cursor: "pointer", textDecoration: "underline", padding: 0 }}>un-push</button>
                  </span>
                  : <button onClick={() => push(c.id, rate)} disabled={pushing === c.id || hours <= 0 || rate <= 0 || !vendorId}
                      title={!vendorId ? "Map a QB vendor first" : hours <= 0 ? "No hours" : rate <= 0 ? "Set a rate" : ""}
                      style={{ background: hours > 0 && rate > 0 && vendorId ? T.accent : T.surface, color: hours > 0 && rate > 0 && vendorId ? "#fff" : T.faint, border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: hours > 0 && rate > 0 && vendorId ? "pointer" : "default", fontFamily: font }}>
                      {pushing === c.id ? "Pushing…" : "Push to QB"}</button>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
const navBtn = { background: "transparent", border: `1px solid ${T.border}`, color: T.text, borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font } as const;
