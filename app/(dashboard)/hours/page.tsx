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

  // Live clock — open shifts (clocked in, not yet out) + today's entries, loaded
  // independently of the week selector so the kiosk always reflects right now.
  const [openShifts, setOpenShifts] = useState<Entry[]>([]);
  const [todayEntries, setTodayEntries] = useState<Entry[]>([]);
  const [, setNowTick] = useState(0); // forces re-render so elapsed times tick
  const [manualFor, setManualFor] = useState<string | null>(null); // contractor whose manual-entry row is open

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

  async function addEntry(cid: string) {
    if (!cid || !form.date) return;
    await supabase.from("contractor_time_entries").insert({
      contractor_id: cid, work_date: form.date,
      time_in: form.timeIn || null, time_out: form.timeOut || null,
      break_minutes: parseInt(form.breakMin) || 0,
    });
    setManualFor(null);
    load(); loadToday();
  }
  const openManual = (cid: string) => {
    const todayStr = ymd(new Date());
    const inWeek = todayStr >= ymd(weekStart) && todayStr <= ymd(weekEnd);
    setForm({ contractorId: "", date: inWeek ? todayStr : ymd(weekStart), timeIn: "", timeOut: "", breakMin: "" });
    setManualFor(cid);
  };
  async function delEntry(id: string) { await supabase.from("contractor_time_entries").delete().eq("id", id); load(); loadToday(); }
  // Inline edit of a logged punch — optimistic local update, then persist.
  const patchLocal = (id: string, patch: Partial<Entry>) => setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  async function saveEntry(id: string, patch: Partial<Entry>) {
    patchLocal(id, patch);
    await supabase.from("contractor_time_entries").update(patch).eq("id", id);
    loadToday();
  }
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
        const isManual = manualFor === c.id;
        return (
          <div key={c.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
            {/* Header: name + today's clock status · weekly total · Manual · Clock In/Out */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: (es.length || isManual) ? `1px solid ${T.border}` : "none" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: open ? T.green : T.faint, marginTop: 1 }}>
                  {open
                    ? <>On the clock · since {fmtTime(open.time_in)} · <strong style={{ fontFamily: mono }}>{elapsedLabel(open.time_in)}</strong></>
                    : (td > 0 ? <>Clocked out · {fmtHours(td)} hrs today</> : "Not clocked in")}
                </div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, fontFamily: mono, color: total > 0 ? T.text : T.faint }}>{fmtHours(total)} <span style={{ fontSize: 11, fontWeight: 600, color: T.muted, fontFamily: font }}>hrs</span></div>
              <button onClick={() => isManual ? setManualFor(null) : openManual(c.id)}
                title="Add or correct a time entry"
                style={{ background: isManual ? T.accent : "transparent", color: isManual ? "#fff" : T.muted, border: `1px solid ${isManual ? T.accent : T.border}`, borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 700, fontFamily: font, cursor: "pointer" }}>
                Manual
              </button>
              {open ? (
                <button onClick={() => clockOut(open.id)}
                  style={{ background: T.red, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, fontFamily: font, cursor: "pointer", whiteSpace: "nowrap" }}>
                  Clock Out
                </button>
              ) : (
                <button onClick={() => clockIn(c.id)}
                  style={{ background: T.green, color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 700, fontFamily: font, cursor: "pointer", whiteSpace: "nowrap" }}>
                  Clock In
                </button>
              )}
            </div>

            {/* Inline manual entry / correction for this contractor */}
            {isManual && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", padding: "10px 14px", borderBottom: es.length ? `1px solid ${T.border}` : "none", background: T.surface + "66" }}>
                <div style={{ width: 140 }}>
                  <label style={lbl}>Date</label>
                  <input type="date" min={ymd(weekStart)} max={ymd(weekEnd)} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ ...inp, width: "100%", fontFamily: mono }} />
                </div>
                <div style={{ width: 104 }}>
                  <label style={lbl}>Time in</label>
                  <input type="time" value={form.timeIn} onChange={e => setForm(f => ({ ...f, timeIn: e.target.value }))} style={{ ...inp, width: "100%", fontFamily: mono }} />
                </div>
                <div style={{ width: 104 }}>
                  <label style={lbl}>Time out</label>
                  <input type="time" value={form.timeOut} onChange={e => setForm(f => ({ ...f, timeOut: e.target.value }))} style={{ ...inp, width: "100%", fontFamily: mono }} />
                </div>
                <div style={{ width: 78 }}>
                  <label style={lbl}>Break</label>
                  <input type="number" inputMode="numeric" value={form.breakMin} onChange={e => setForm(f => ({ ...f, breakMin: e.target.value }))} placeholder="0" style={{ ...inp, width: "100%", fontFamily: mono }} />
                </div>
                <div style={{ width: 50, textAlign: "right" }}>
                  <label style={lbl}>Hrs</label>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: mono, color: previewHours > 0 ? T.text : T.faint, padding: "6px 0" }}>{previewHours > 0 ? fmtHours(previewHours) : "—"}</div>
                </div>
                <div style={{ flex: 1 }} />
                <button onClick={() => addEntry(c.id)}
                  style={{ background: T.green, color: "#fff", border: "none", borderRadius: 7, padding: "9px 18px", fontSize: 13, fontWeight: 700, fontFamily: font, cursor: "pointer" }}>
                  Add
                </button>
                <button onClick={() => setManualFor(null)} style={{ background: "none", border: "none", color: T.faint, fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>×</button>
              </div>
            )}

            {es.map(e => {
              const eInp = { ...inp, padding: "4px 6px", fontFamily: mono, fontSize: 12 } as const;
              const openRow = !!e.time_in && !e.time_out;
              return (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", borderBottom: `1px solid ${T.border}55`, fontSize: 12 }}>
                <div style={{ width: 120, flexShrink: 0, color: T.muted }}>{fmtDateLong(e.work_date)}</div>
                <input type="time" value={e.time_in || ""} onChange={ev => saveEntry(e.id, { time_in: ev.target.value || null })} style={{ ...eInp, width: 92 }} />
                <span style={{ color: T.faint }}>–</span>
                <input type="time" value={e.time_out || ""} onChange={ev => saveEntry(e.id, { time_out: ev.target.value || null })} title={openRow ? "On the clock — set a time to close the shift" : ""} style={{ ...eInp, width: 92, borderColor: openRow ? T.green : T.border }} />
                <input type="number" inputMode="numeric" value={e.break_minutes || ""} placeholder="0"
                  onChange={ev => patchLocal(e.id, { break_minutes: parseInt(ev.target.value) || 0 })}
                  onBlur={ev => saveEntry(e.id, { break_minutes: parseInt(ev.target.value) || 0 })}
                  title="Break minutes" style={{ ...eInp, width: 50, textAlign: "center" }} />
                <span style={{ color: T.faint, fontSize: 11 }}>min</span>
                <div style={{ flex: 1 }} />
                <div style={{ width: 56, textAlign: "right", fontFamily: mono, fontWeight: 700, color: openRow ? T.green : T.text }}>{openRow ? "on clock" : fmtHours(entryHours(e))}</div>
                <button onClick={() => delEntry(e.id)} title="Delete" style={{ background: "none", border: "none", color: T.faint, fontSize: 15, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
            ); })}
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
