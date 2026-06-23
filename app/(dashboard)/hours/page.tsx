"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { useIsMobile } from "@/lib/useIsMobile";

type EntryModal = { id: string | null; contractorId: string; contractorName: string; date: string; timeIn: string; timeOut: string; breakMin: string };

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
  const isMobile = useIsMobile();
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [manageOpen, setManageOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [emailing, setEmailing] = useState<"" | "sending" | "sent" | "error">("");

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  // Add / edit entry modal (shared by Manual + the per-punch edit icon).
  const [entryModal, setEntryModal] = useState<EntryModal | null>(null);

  // Live clock — open shifts (clocked in, not yet out) + today's entries, loaded
  // independently of the week selector so the kiosk always reflects right now.
  const [openShifts, setOpenShifts] = useState<Entry[]>([]);
  const [todayEntries, setTodayEntries] = useState<Entry[]>([]);
  const [, setNowTick] = useState(0); // forces re-render so elapsed times tick

  const load = useCallback(async () => {
    const { data: cs } = await supabase.from("contractors").select("*").order("sort_order").order("name");
    setContractors(cs || []);
    const { data: es } = await supabase.from("contractor_time_entries").select("*")
      .gte("work_date", ymd(weekStart)).lte("work_date", ymd(weekEnd)).order("work_date");
    setEntries(es || []);
  }, [supabase, weekStart, weekEnd]);
  useEffect(() => { load(); }, [load]);

  const loadToday = useCallback(async () => {
    const { data: open } = await supabase.from("contractor_time_entries").select("*").is("time_out", null).not("time_in", "is", null);
    setOpenShifts(open || []);
    const { data: td } = await supabase.from("contractor_time_entries").select("*").eq("work_date", ymd(new Date()));
    setTodayEntries(td || []);
  }, [supabase]);
  useEffect(() => { loadToday(); }, [loadToday]);
  useEffect(() => { const t = setInterval(() => setNowTick(n => n + 1), 30000); return () => clearInterval(t); }, []);

  const activeContractors = contractors.filter(c => c.active);

  // ── Clock in/out (kiosk) ──
  const nowHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const openShiftOf = (cid: string) => openShifts.find(e => e.contractor_id === cid);
  const todayHours = (cid: string) => todayEntries.filter(e => e.contractor_id === cid).reduce((a, e) => a + entryHours(e), 0);
  function elapsedLabel(timeIn: string | null) {
    const start = toMin(timeIn); if (start == null) return "";
    const d = new Date(); let mins = (d.getHours() * 60 + d.getMinutes()) - start; if (mins < 0) mins += 1440;
    const h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  async function clockIn(cid: string) {
    await supabase.from("contractor_time_entries").insert({ contractor_id: cid, work_date: ymd(new Date()), time_in: nowHHMM(), time_out: null, break_minutes: 0 });
    loadToday(); load();
  }
  async function clockOut(id: string) {
    await supabase.from("contractor_time_entries").update({ time_out: nowHHMM() }).eq("id", id);
    loadToday(); load();
  }

  // Entry modal — new (Manual) or edit (per-punch pencil).
  const openNewEntry = (c: Contractor) => {
    const todayStr = ymd(new Date());
    const inWeek = todayStr >= ymd(weekStart) && todayStr <= ymd(weekEnd);
    setEntryModal({ id: null, contractorId: c.id, contractorName: c.name, date: inWeek ? todayStr : ymd(weekStart), timeIn: "", timeOut: "", breakMin: "" });
  };
  const openEditEntry = (c: Contractor, e: Entry) => {
    setEntryModal({ id: e.id, contractorId: c.id, contractorName: c.name, date: e.work_date, timeIn: e.time_in || "", timeOut: e.time_out || "", breakMin: e.break_minutes ? String(e.break_minutes) : "" });
  };
  async function saveEntryModal() {
    const m = entryModal; if (!m || !m.date) return;
    const patch = { work_date: m.date, time_in: m.timeIn || null, time_out: m.timeOut || null, break_minutes: parseInt(m.breakMin) || 0 };
    if (m.id) await supabase.from("contractor_time_entries").update(patch).eq("id", m.id);
    else await supabase.from("contractor_time_entries").insert({ contractor_id: m.contractorId, ...patch });
    setEntryModal(null); load(); loadToday();
  }
  async function delEntry(id: string) { await supabase.from("contractor_time_entries").delete().eq("id", id); setEntryModal(null); load(); loadToday(); }
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

      {/* Unified per-contractor list: clock in/out + manual entry + week's
          punches, all in one card per contractor. */}
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
        const open = openShiftOf(c.id);
        const td = todayHours(c.id);
        const status = open
          ? <>On the clock · since {fmtTime(open.time_in)} · <strong style={{ fontFamily: mono }}>{elapsedLabel(open.time_in)}</strong></>
          : (td > 0 ? <>Clocked out · {fmtHours(td)} hrs today</> : "Not clocked in");
        // Small, de-emphasized — Clock In stays the primary action.
        const manualBtn = () => (
          <button onClick={() => openNewEntry(c)} title="Add a time entry manually"
            style={{ background: "none", border: "none", color: T.muted, padding: "4px 6px", fontSize: 12, fontWeight: 600, fontFamily: font, cursor: "pointer", whiteSpace: "nowrap" }}>
            Manual entry
          </button>
        );
        const clockBtn = (flex: boolean) => open ? (
          <button onClick={() => clockOut(open.id)}
            style={{ flex: flex ? 1 : undefined, background: T.red, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, fontFamily: font, cursor: "pointer", whiteSpace: "nowrap" }}>
            Clock Out
          </button>
        ) : (
          <button onClick={() => clockIn(c.id)}
            style={{ flex: flex ? 1 : undefined, background: T.green, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, fontFamily: font, cursor: "pointer", whiteSpace: "nowrap" }}>
            Clock In
          </button>
        );
        return (
          <div key={c.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
            {/* Header */}
            {isMobile ? (
              <div style={{ padding: "12px 14px", borderBottom: es.length ? `1px solid ${T.border}` : "none" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{c.name}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, fontFamily: mono, color: total > 0 ? T.text : T.faint }}>{fmtHours(total)} <span style={{ fontSize: 11, fontWeight: 600, color: T.muted, fontFamily: font }}>hrs</span></div>
                </div>
                <div style={{ fontSize: 12, color: open ? T.green : T.faint, marginTop: 2 }}>{status}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                  {clockBtn(true)}
                  {manualBtn()}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: es.length ? `1px solid ${T.border}` : "none" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: open ? T.green : T.faint, marginTop: 1 }}>{status}</div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, fontFamily: mono, color: total > 0 ? T.text : T.faint }}>{fmtHours(total)} <span style={{ fontSize: 11, fontWeight: 600, color: T.muted, fontFamily: font }}>hrs</span></div>
                {manualBtn()}
                {clockBtn(false)}
              </div>
            )}

            {/* Punch rows — text + edit/delete (edit opens the modal) */}
            {es.map(e => {
              const openRow = !!e.time_in && !e.time_out;
              return (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: `1px solid ${T.border}55`, fontSize: 13 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: mono, color: T.text }}>
                      {fmtTime(e.time_in)} – {e.time_out ? fmtTime(e.time_out) : <span style={{ color: T.green }}>on the clock</span>}
                    </div>
                    <div style={{ fontSize: 11, color: T.faint, marginTop: 1 }}>{fmtDateLong(e.work_date)}{e.break_minutes ? ` · ${e.break_minutes}m break` : ""}</div>
                  </div>
                  <div style={{ fontFamily: mono, fontWeight: 700, color: openRow ? T.green : T.text }}>{openRow ? "—" : fmtHours(entryHours(e))} <span style={{ fontSize: 10, fontWeight: 600, color: T.muted, fontFamily: font }}>hrs</span></div>
                  <button onClick={() => openEditEntry(c, e)} title="Edit" style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", padding: 6, lineHeight: 0 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  </button>
                  <button onClick={() => delEntry(e.id)} title="Delete" style={{ background: "none", border: "none", color: T.faint, fontSize: 16, cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>×</button>
                </div>
              );
            })}
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

      {/* Add / edit entry modal — larger fields, manual Save */}
      {entryModal && (() => {
        const m = entryModal;
        const hrs = entryHours({ time_in: m.timeIn || null, time_out: m.timeOut || null, break_minutes: parseInt(m.breakMin) || 0 } as Entry);
        const set = (patch: Partial<EntryModal>) => setEntryModal(p => p ? { ...p, ...patch } : p);
        const bigInp = { ...inp, width: "100%", fontFamily: mono, fontSize: 16, padding: "11px 12px" };
        const fld = { display: "block", marginBottom: 12 } as const;
        return (
          <div onClick={() => setEntryModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: isMobile ? "flex-end" : "flex-start", justifyContent: "center", padding: isMobile ? 0 : "8vh 16px", overflowY: "auto" }}>
            <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: isMobile ? "16px 16px 0 0" : 14, padding: 18, width: "100%", maxWidth: isMobile ? "100%" : 420, boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{m.id ? "Edit entry" : "New entry"} · {m.contractorName}</div>
                <button onClick={() => setEntryModal(null)} style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
              <label style={fld}><span style={lbl}>Date</span>
                <input type="date" value={m.date} onChange={e => set({ date: e.target.value })} style={bigInp} /></label>
              <div style={{ display: "flex", gap: 10 }}>
                <label style={{ ...fld, flex: 1 }}><span style={lbl}>Time in</span>
                  <input type="time" value={m.timeIn} onChange={e => set({ timeIn: e.target.value })} style={bigInp} /></label>
                <label style={{ ...fld, flex: 1 }}><span style={lbl}>Time out</span>
                  <input type="time" value={m.timeOut} onChange={e => set({ timeOut: e.target.value })} style={bigInp} /></label>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <label style={{ ...fld, width: 120 }}><span style={lbl}>Break (min)</span>
                  <input type="number" inputMode="numeric" value={m.breakMin} placeholder="0" onChange={e => set({ breakMin: e.target.value })} style={bigInp} /></label>
                <div style={{ flex: 1 }} />
                <div style={{ textAlign: "right", marginBottom: 12 }}>
                  <span style={lbl}>Hours</span>
                  <div style={{ fontSize: 22, fontWeight: 800, fontFamily: mono, color: hrs > 0 ? T.text : T.faint }}>{hrs > 0 ? fmtHours(hrs) : "—"}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                {m.id && <button onClick={() => delEntry(m.id!)} style={{ background: "none", border: "none", color: T.red, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Delete</button>}
                <div style={{ flex: 1 }} />
                <button onClick={() => setEntryModal(null)} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.muted, borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Cancel</button>
                <button onClick={saveEntryModal} disabled={!m.date || !m.timeIn}
                  style={{ background: T.green, color: "#fff", border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 14, fontWeight: 700, fontFamily: font, cursor: (m.date && m.timeIn) ? "pointer" : "default", opacity: (m.date && m.timeIn) ? 1 : 0.5 }}>Save</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
