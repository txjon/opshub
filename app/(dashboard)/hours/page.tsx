"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";

type Contractor = { id: string; name: string; active: boolean; sort_order: number };
type Entry = { id: string; contractor_id: string; work_date: string; time_in: string | null; time_out: string | null; break_minutes: number; notes: string | null };

// ── date helpers (local, no TZ drift) ──
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Mon=0 … Sun=6
  x.setDate(x.getDate() - dow);
  return x;
}
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtMD = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
function fmtDateLong(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }

// ── hours math ──
const toMin = (t: string | null) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
function entryHours(e: Entry): number {
  const a = toMin(e.time_in), b = toMin(e.time_out);
  if (a == null || b == null) return 0;
  let mins = b - a; if (mins < 0) mins += 24 * 60; // tolerate an overnight shift
  mins -= (e.break_minutes || 0);
  return Math.max(0, mins) / 60;
}
const fmtHours = (h: number) => (Math.round(h * 100) / 100).toString();
function fmtTime(t: string | null) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ap = h < 12 ? "a" : "p"; const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${ap}`;
}

export default function HoursPage() {
  const supabase = createClient();
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [manageOpen, setManageOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [emailing, setEmailing] = useState<"" | "sending" | "sent" | "error">("");

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  // Add-entry form
  const [form, setForm] = useState({ contractorId: "", date: ymd(new Date()), timeIn: "", timeOut: "", breakMin: "" });

  const load = useCallback(async () => {
    const { data: cs } = await supabase.from("contractors").select("*").order("sort_order").order("name");
    setContractors(cs || []);
    const { data: es } = await supabase.from("contractor_time_entries").select("*")
      .gte("work_date", ymd(weekStart)).lte("work_date", ymd(weekEnd)).order("work_date");
    setEntries(es || []);
  }, [supabase, weekStart, weekEnd]);
  useEffect(() => { load(); }, [load]);

  const activeContractors = contractors.filter(c => c.active);

  async function addEntry() {
    if (!form.contractorId || !form.date) return;
    await supabase.from("contractor_time_entries").insert({
      contractor_id: form.contractorId, work_date: form.date,
      time_in: form.timeIn || null, time_out: form.timeOut || null,
      break_minutes: parseInt(form.breakMin) || 0,
    });
    setForm(f => ({ ...f, timeIn: "", timeOut: "", breakMin: "" }));
    load();
  }
  async function delEntry(id: string) { await supabase.from("contractor_time_entries").delete().eq("id", id); load(); }
  async function addContractor() {
    const name = newName.trim(); if (!name) return;
    const sort = Math.max(0, ...contractors.map(c => c.sort_order)) + 1;
    await supabase.from("contractors").insert({ name, sort_order: sort });
    setNewName(""); load();
  }
  async function emailSummary() {
    if (!window.confirm(`Submit hours for ${fmtMD(weekStart)}–${fmtMD(weekEnd)} (${fmtHours(grandTotal)} hrs total)? A breakdown will be emailed to you.`)) return;
    setEmailing("sending");
    try {
      const res = await fetch("/api/hours/email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: ymd(weekStart), weekEnd: ymd(weekEnd) }),
      });
      if (!res.ok) throw new Error();
      setEmailing("sent"); setTimeout(() => setEmailing(""), 2500);
    } catch { setEmailing("error"); setTimeout(() => setEmailing(""), 3000); }
  }
  async function renameContractor(id: string, name: string) { await supabase.from("contractors").update({ name }).eq("id", id); setContractors(p => p.map(c => c.id === id ? { ...c, name } : c)); }
  async function toggleActive(id: string, active: boolean) { await supabase.from("contractors").update({ active }).eq("id", id); load(); }

  const previewHours = entryHours({ time_in: form.timeIn || null, time_out: form.timeOut || null, break_minutes: parseInt(form.breakMin) || 0 } as Entry);
  const entriesByContractor = (cid: string) => entries.filter(e => e.contractor_id === cid).sort((a, b) => a.work_date.localeCompare(b.work_date));
  const contractorTotal = (cid: string) => entriesByContractor(cid).reduce((a, e) => a + entryHours(e), 0);
  const grandTotal = entries.reduce((a, e) => a + entryHours(e), 0);

  const inp = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontFamily: font, fontSize: 13, padding: "7px 10px", outline: "none", boxSizing: "border-box" as const };
  const lbl = { fontSize: 10, color: T.faint, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 3, display: "block" };

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16, maxWidth: 1000 }}>
      {/* Header + week selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Hours</h1>
        <button onClick={emailSummary} disabled={emailing === "sending" || grandTotal === 0}
          style={{ background: emailing === "sent" ? T.greenDim : T.accent, color: emailing === "sent" ? T.green : "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, fontFamily: font, cursor: (emailing === "sending" || grandTotal === 0) ? "default" : "pointer", opacity: grandTotal === 0 ? 0.5 : 1 }}>
          {emailing === "sending" ? "Submitting…" : emailing === "sent" ? "✓ Submitted" : emailing === "error" ? "Failed — retry" : "Submit Hours"}
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} style={{ ...inp, cursor: "pointer", padding: "6px 12px", fontWeight: 700 }}>←</button>
          <div style={{ fontSize: 13, fontWeight: 600, minWidth: 130, textAlign: "center" }}>{fmtMD(weekStart)} – {fmtMD(weekEnd)}</div>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} style={{ ...inp, cursor: "pointer", padding: "6px 12px", fontWeight: 700 }}>→</button>
          <button onClick={() => setWeekStart(mondayOf(new Date()))} style={{ ...inp, cursor: "pointer", padding: "6px 12px", fontSize: 12, color: T.muted }}>This week</button>
        </div>
      </div>

      {/* Add entry */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 160px", minWidth: 0 }}>
            <label style={lbl}>Contractor</label>
            <select value={form.contractorId} onChange={e => setForm(f => ({ ...f, contractorId: e.target.value }))} style={{ ...inp, width: "100%", cursor: "pointer" }}>
              <option value="">— select —</option>
              {activeContractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ width: 140 }}>
            <label style={lbl}>Date</label>
            <input type="date" min={ymd(weekStart)} max={ymd(weekEnd)} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ ...inp, width: "100%", fontFamily: mono }} />
          </div>
          <div style={{ width: 110 }}>
            <label style={lbl}>Time in</label>
            <input type="time" value={form.timeIn} onChange={e => setForm(f => ({ ...f, timeIn: e.target.value }))} style={{ ...inp, width: "100%", fontFamily: mono }} />
          </div>
          <div style={{ width: 110 }}>
            <label style={lbl}>Time out</label>
            <input type="time" value={form.timeOut} onChange={e => setForm(f => ({ ...f, timeOut: e.target.value }))} style={{ ...inp, width: "100%", fontFamily: mono }} />
          </div>
          <div style={{ width: 90 }}>
            <label style={lbl}>Break (min)</label>
            <input type="number" inputMode="numeric" value={form.breakMin} onChange={e => setForm(f => ({ ...f, breakMin: e.target.value }))} placeholder="0" style={{ ...inp, width: "100%", fontFamily: mono }} />
          </div>
          <div style={{ width: 64, textAlign: "right" }}>
            <label style={lbl}>Hours</label>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: mono, color: previewHours > 0 ? T.text : T.faint, padding: "6px 0" }}>{previewHours > 0 ? fmtHours(previewHours) : "—"}</div>
          </div>
          <button onClick={addEntry} disabled={!form.contractorId}
            style={{ background: T.green, color: "#fff", border: "none", borderRadius: 7, padding: "9px 18px", fontSize: 13, fontWeight: 700, fontFamily: font, cursor: form.contractorId ? "pointer" : "default", opacity: form.contractorId ? 1 : 0.5 }}>
            Add
          </button>
        </div>
      </div>

      {/* Weekly rollup */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h2 style={{ fontSize: 11, fontWeight: 800, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>This week</h2>
        <span style={{ fontSize: 12, color: T.muted }}>Total <strong style={{ color: T.text, fontFamily: mono }}>{fmtHours(grandTotal)}</strong> hrs</span>
      </div>

      {activeContractors.length === 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "2rem", textAlign: "center", color: T.faint, fontSize: 13 }}>
          No contractors yet — add one below to start logging.
        </div>
      )}

      {activeContractors.map(c => {
        const es = entriesByContractor(c.id);
        const total = contractorTotal(c.id);
        return (
          <div key={c.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: es.length ? `1px solid ${T.border}` : "none" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{c.name}</div>
              <div style={{ fontSize: 15, fontWeight: 800, fontFamily: mono, color: total > 0 ? T.text : T.faint }}>{fmtHours(total)} <span style={{ fontSize: 11, fontWeight: 600, color: T.muted, fontFamily: font }}>hrs</span></div>
            </div>
            {es.map(e => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderBottom: `1px solid ${T.border}55`, fontSize: 12 }}>
                <div style={{ width: 130, flexShrink: 0, color: T.muted }}>{fmtDateLong(e.work_date)}</div>
                <div style={{ width: 150, flexShrink: 0, fontFamily: mono, color: T.muted }}>{fmtTime(e.time_in)} – {fmtTime(e.time_out)}</div>
                <div style={{ width: 90, flexShrink: 0, color: T.faint, fontSize: 11 }}>{e.break_minutes ? `${e.break_minutes}m break` : ""}</div>
                <div style={{ flex: 1 }} />
                <div style={{ width: 56, textAlign: "right", fontFamily: mono, fontWeight: 700 }}>{fmtHours(entryHours(e))}</div>
                <button onClick={() => delEntry(e.id)} title="Delete" style={{ background: "none", border: "none", color: T.faint, fontSize: 15, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
            ))}
          </div>
        );
      })}

      {/* Manage contractors */}
      <div style={{ marginTop: 8 }}>
        <button onClick={() => setManageOpen(v => !v)} style={{ background: "none", border: "none", color: T.muted, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font, padding: 0 }}>
          {manageOpen ? "▾" : "▸"} Manage contractors
        </button>
        {manageOpen && (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            {contractors.map(c => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, opacity: c.active ? 1 : 0.5 }}>
                <input value={c.name} onChange={e => renameContractor(c.id, e.target.value)} style={{ ...inp, flex: 1 }} />
                <button onClick={() => toggleActive(c.id, !c.active)} style={{ ...inp, cursor: "pointer", color: T.muted, fontSize: 11, padding: "6px 12px" }}>
                  {c.active ? "Archive" : "Restore"}
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addContractor()} placeholder="New contractor name" style={{ ...inp, flex: 1 }} />
              <button onClick={addContractor} disabled={!newName.trim()} style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 12, fontWeight: 700, fontFamily: font, cursor: newName.trim() ? "pointer" : "default", opacity: newName.trim() ? 1 : 0.5 }}>Add</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
