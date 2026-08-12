"use client";
// DROPS — the ops side of the release pipeline (Jul 21 2026). Magazine
// style like /studio2. Buckets by whose move: Your move (ready to cost/
// schedule + closed drops with numbers in = cuttable), Live now, Building
// (clients assembling — read-only peek), Cut (→ job), Shelved.
// THE CUT lives here: closed/ready + all numbers → one job, items born
// from slots, quantities from the client's numbers.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { H } from "@/components/hub/theme";
import { backwardChain } from "@/lib/portal/drop-chain";

const thumbSrc = (id: string, size = 300) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
const APPROVED = ["final_approved", "pending_prep", "production_ready", "delivered"];
const PURPLE = "#fd3aa3";

const daysTo = (iso?: string | null) => {
  if (!iso) return null;
  return Math.round((new Date(iso + "T00:00").getTime() - new Date(new Date().toISOString().slice(0, 10) + "T00:00").getTime()) / 86400000);
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  building: { label: "Building", color: H.faint },
  ready: { label: "Ready for us", color: H.amber },
  live: { label: "Live", color: PURPLE },
  closed: { label: "Numbers in?", color: H.amber },
  cut: { label: "Cut", color: H.green },
  shelved: { label: "Shelved", color: H.faint },
};

export default function DropsBoard() {
  const supabase = createClient();
  const [rows, setRows] = useState<any[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    const { data: releases } = await supabase.from("releases")
      .select("*, clients(name)")
      .order("created_at", { ascending: false });
    const ids = (releases || []).map((r: any) => r.id);
    let slotsByRelease: Record<string, any[]> = {};
    const briefIds: string[] = [];
    if (ids.length) {
      const { data: slots } = await supabase.from("release_slots")
        .select("*, art_briefs(id, title, state), items(name, pipeline_stage, received_at_hpd, webstore_entered_at, forwarded_at)")
        .in("release_id", ids).order("sort_order");
      for (const s of (slots || []) as any[]) {
        (slotsByRelease[s.release_id] = slotsByRelease[s.release_id] || []).push(s);
        if (s.brief_id) briefIds.push(s.brief_id);
      }
    }
    // one representative image per brief for lineup strips
    if (briefIds.length) {
      const { data: files } = await supabase.from("art_brief_files")
        .select("brief_id, drive_file_id, preview_drive_file_id, mime_type, created_at")
        .in("brief_id", Array.from(new Set(briefIds)))
        .order("created_at", { ascending: false });
      const t: Record<string, string> = {};
      for (const f of (files || []) as any[]) {
        if (t[f.brief_id]) continue;
        if (/pdf/i.test(f.mime_type || "")) continue;
        const id = f.preview_drive_file_id || f.drive_file_id;
        if (id) t[f.brief_id] = id;
      }
      setThumbs(t);
    }
    setRows((releases || []).map((r: any) => ({ ...r, slots: slotsByRelease[r.id] || [] })));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function act(release: any, path: string, method: string, body?: any) {
    setErr(""); setBusy(release.id);
    try {
      const res = await fetch(`/api/drops/${release.id}${path}`, {
        method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(out.error || "Couldn't do that."); return null; }
      await load();
      return out;
    } finally { setBusy(null); }
  }

  const buckets = useMemo(() => {
    const list = rows || [];
    const numbersDone = (r: any) => r.slots.length > 0 && r.slots.every((s: any) =>
      Object.values(s.qtys || {}).reduce((a: number, b: any) => a + (Number(b) || 0), 0) > 0);
    return [
      // Live drops whose window has ENDED are a call, not a status — they
      // jump the queue into Your move ("close the sale").
      { key: "your_move", title: "Your move.", color: H.amber, hint: "submitted drops, ended sale windows, and closed sales ready to cut", list: list.filter((r: any) => r.status === "ready" || r.status === "closed" || (r.status === "live" && daysTo(r.window_close_date) != null && (daysTo(r.window_close_date) as number) <= 0)) },
      { key: "live", title: "Live now.", color: PURPLE, hint: "selling — close the sale when the window ends", list: list.filter((r: any) => r.status === "live" && !(daysTo(r.window_close_date) != null && (daysTo(r.window_close_date) as number) <= 0)) },
      { key: "building", title: "Building.", hint: "clients assembling — watch it take shape", list: list.filter((r: any) => r.status === "building") },
      { key: "cut", title: "Cut.", color: H.green, hint: "born as jobs — the floor has them", list: list.filter((r: any) => r.status === "cut") },
      { key: "shelved", title: "On ice.", hint: "", list: list.filter((r: any) => r.status === "shelved") },
    ].map(b => ({ ...b, numbersDone }));
  }, [rows]);

  return (
    <div style={{ background: H.ink, minHeight: "100vh", margin: -24, padding: 24, color: H.text, fontFamily: H.font }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .dr-card{background:${H.panel};border:1px solid ${H.line};border-radius:16px;padding:16px 18px;cursor:pointer;text-align:left;color:${H.text};font-family:${H.font};width:100%;transition:transform .15s ease,border-color .15s ease;display:block}
        .dr-card:hover{transform:translateY(-2px);border-color:rgba(255,255,255,.3)}
        .dr-back{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:34px 14px;overflow-y:auto}
        .dr-sheet{background:${H.panel};border:1px solid ${H.line};border-radius:20px;max-width:720px;width:100%;overflow:hidden}
        @media(prefers-reduced-motion:reduce){.dr-card,.dr-card:hover{transition:none;transform:none}}
      ` }} />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "26px 0 80px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}>Releases · internal</div>
        <h1 style={{ fontSize: "clamp(34px,5vw,64px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "6px 0 8px" }}>Releases.</h1>
        <div style={{ fontSize: 13.5, color: H.dim, maxWidth: "58ch", lineHeight: 1.6 }}>
          Client-built releases land here. Cost it, take it live, close the sale, and CUT — the drop becomes the job, quantities straight from their numbers.
        </div>
        {err && <div style={{ marginTop: 12, color: H.red, fontSize: 12.5, fontWeight: 700 }}>{err}</div>}

        {rows === null ? (
          <div style={{ color: H.faint, fontSize: 13, padding: "40px 0" }}>Loading releases…</div>
        ) : rows.length === 0 ? (
          <div style={{ color: H.dim, fontSize: 13, padding: "40px 0" }}>No releases yet. When a client builds one in their hub, it lands here.</div>
        ) : buckets.map(b => b.list.length ? (
          <section key={b.key} style={{ marginTop: 40 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: b.color || H.text }}>{b.title}</h2>
              <span style={{ fontSize: 10, fontWeight: 800, color: H.faint, fontFamily: H.mono }}>{b.list.length}</span>
              <span style={{ fontSize: 10.5, color: H.faint }}>{b.hint}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {b.list.map((r: any) => {
                const m = STATUS_META[r.status] || { label: r.status, color: H.faint };
                const nd = b.numbersDone(r);
                return (
                  <button key={r.id} className="dr-card" onClick={() => setOpen(r)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                      <span style={{ display: "flex" }}>
                        {r.slots.slice(0, 4).map((s: any, i: number) => (
                          <span key={s.id} style={{ width: 38, height: 38, borderRadius: 8, overflow: "hidden", background: "#fff", border: `2px solid ${H.panel}`, marginLeft: i ? -10 : 0, display: "inline-flex" }}>
                            {thumbs[s.brief_id] && <img src={thumbSrc(thumbs[s.brief_id], 100)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                          </span>
                        ))}
                      </span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: "block", fontSize: 15, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                        <span style={{ display: "block", fontSize: 10, fontFamily: H.mono, color: H.faint, marginTop: 2 }}>{r.clients?.name} · {r.slots.length} line{r.slots.length === 1 ? "" : "s"}{r.target_live_date ? ` · live ${fmtDate(r.target_live_date)}` : ""}</span>
                      </span>
                      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: (() => {
                          if (r.status !== "live") return m.color;
                          const dd = daysTo(r.window_close_date);
                          return dd != null && dd <= 0 ? H.red : dd != null && dd <= 3 ? H.amber : m.color;
                        })(), whiteSpace: "nowrap" }}>
                        {(() => {
                          if (r.status === "closed") return nd ? "Numbers in — cut it" : "Awaiting numbers";
                          if (r.status === "live" && r.model === "stock") return "Launched";
                          if (r.status === "live") {
                            const dd = daysTo(r.window_close_date);
                            if (dd != null && dd < 0) return `Window ended ${fmtDate(r.window_close_date)} — close it`;
                            if (dd === 0) return "Closes today";
                            if (dd != null && dd <= 3) return `Closing soon · ${dd}d`;
                            if (dd != null) return `Live · closes ${fmtDate(r.window_close_date)}`;
                            return "Live · no close date set";
                          }
                          return m.label;
                        })()}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null)}
      </div>

      {open && (() => {
        const r = (rows || []).find((x: any) => x.id === open.id) || open;
        const numbersDone = r.slots.length > 0 && r.slots.every((s: any) => Object.values(s.qtys || {}).reduce((a: number, x: any) => a + (Number(x) || 0), 0) > 0);
        const totalUnits = r.slots.reduce((a: number, s: any) => a + Object.values(s.qtys || {}).reduce((x: number, y: any) => x + (Number(y) || 0), 0), 0);
        return (
          <div className="dr-back">
            <div className="dr-sheet">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "18px 22px 6px" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint }}>{r.clients?.name}</div>
                  <div style={{ fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", marginTop: 2 }}>{r.title}</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginTop: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: (STATUS_META[r.status] || {}).color }}>{(STATUS_META[r.status] || {}).label}</span>
                    {r.target_live_date && <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint }}>target live {fmtDate(r.target_live_date)}</span>}
                    {totalUnits > 0 && <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.dim }}>{totalUnits.toLocaleString()} pcs</span>}
                    {(() => {
                      const pipe = r.slots.filter((s: any) => s.item_id);
                      if (!pipe.length) return null;
                      const landed = pipe.filter((s: any) => s.items?.webstore_entered_at || s.items?.received_at_hpd || s.items?.forwarded_at).length;
                      return <span style={{ fontSize: 10.5, fontFamily: H.mono, color: landed === pipe.length ? H.green : H.amber, fontWeight: 700 }}>{landed}/{pipe.length} landed</span>;
                    })()}
                  </div>
                </div>
                <button onClick={() => setOpen(null)} aria-label="Close" style={{ background: "none", border: "none", color: H.dim, fontSize: 26, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>

              {r.target_live_date && ["building", "ready", "live"].includes(r.status) && (() => {
                const steps = backwardChain(r.target_live_date);
                const today = new Date().toISOString().slice(0, 10);
                const nextIdx = steps.findIndex((s: any) => s.date >= today);
                return (
                  <div style={{ padding: "12px 22px 0" }}>
                    <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint, marginBottom: 8 }}>Backward chain — to hit {fmtDate(r.target_live_date)}</div>
                    <div style={{ display: "flex", overflowX: "auto", scrollbarWidth: "none" }}>
                      {steps.map((s: any, i: number) => {
                        const past = s.date < today;
                        const next = i === nextIdx;
                        return (
                          <div key={s.key} style={{ flexShrink: 0, padding: "8px 16px 8px 12px", borderLeft: `2px solid ${next ? H.amber : H.line}` }}>
                            <div style={{ fontSize: 12, fontWeight: 900, fontFamily: H.mono, color: past ? H.red : next ? H.amber : H.text }}>{fmtDate(s.date)}</div>
                            <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, marginTop: 3, whiteSpace: "nowrap" }}>{s.label}{past ? " · passed" : ""}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              <div style={{ padding: "12px 22px 4px" }}>
                {r.slots.map((s: any) => {
                  const units = Object.values(s.qtys || {}).reduce((a: number, x: any) => a + (Number(x) || 0), 0);
                  const approved = APPROVED.includes(s.art_briefs?.state);
                  return (
                    <div key={s.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${H.line}`, flexWrap: "wrap" }}>
                      <span style={{ width: 40, height: 40, background: "#fff", borderRadius: 8, overflow: "hidden", flexShrink: 0, display: "inline-flex" }}>
                        {thumbs[s.brief_id] && <img src={thumbSrc(thumbs[s.brief_id], 100)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                      </span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.format || s.items?.name || "Item"}{s.art_briefs?.title ? <span style={{ color: H.faint, fontWeight: 600, textTransform: "none" }}> · {s.art_briefs.title}</span> : s.item_id ? <span style={{ color: H.faint, fontWeight: 600, textTransform: "none" }}> · from the pipeline</span> : null}
                        </span>
                        <span style={{ display: "block", fontSize: 10, fontFamily: H.mono, color: H.dim, marginTop: 2 }}>
                          {s.retail != null ? `$${Number(s.retail)} retail` : "retail TBD"}{s.model ? ` · ${s.model === "preorder" ? "pre-order" : s.model === "not_sure" ? "model TBD" : "fixed run"}` : ""}
                          {units > 0 ? ` · ${units.toLocaleString()} pcs: ${Object.entries(s.qtys).map(([k, v]) => `${k} ${v}`).join("  ")}` : " · no numbers yet"}
                        </span>
                        {s.line_notes && <span style={{ display: "block", fontSize: 11, color: H.dim, marginTop: 3, lineHeight: 1.45 }}>{s.line_notes}</span>}
                      </span>
                      <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: (() => {
                          if (!s.item_id) return approved ? H.green : H.amber;
                          const it = s.items || {};
                          if (it.webstore_entered_at || it.received_at_hpd || it.forwarded_at) return H.green;
                          if (it.pipeline_stage === "shipped") return PURPLE;
                          return H.blue;
                        })(), whiteSpace: "nowrap" }}>{(() => {
                          if (!s.item_id) return approved ? "Design ✓" : "Design pending";
                          const it = s.items || {};
                          if (it.webstore_entered_at) return "In store";
                          if (it.received_at_hpd || it.forwarded_at) return "Landed";
                          if (it.pipeline_stage === "shipped") return "In transit";
                          return "On press";
                        })()}</span>
                    </div>
                  );
                })}
              </div>

              <div style={{ padding: "16px 22px 20px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {r.status === "ready" && (
                  <>
                    <button disabled={busy === r.id} onClick={() => act(r, "", "PATCH", { action: "live" })}
                      style={{ background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "12px 22px", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
                      {r.model === "stock" ? "Mark launched" : "Take it live"}
                    </button>
                    {r.model !== "stock" && <button disabled={busy === r.id || !numbersDone} title={numbersDone ? "" : "Every line needs quantities first (client enters after close, or you can cut a fixed-run drop once numbers exist)"}
                      onClick={async () => { if (confirm(`Cut "${r.title}" into a job now? Items + quantities come from the lineup.`)) { const out = await act(r, "/cut", "POST"); if (out?.jobId) window.location.href = `/jobs/${out.jobId}`; } }}
                      style={{ background: "transparent", color: H.text, border: `1px solid rgba(255,255,255,0.35)`, borderRadius: 999, padding: "12px 20px", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: numbersDone ? "pointer" : "default", opacity: numbersDone ? 1 : 0.4, fontFamily: H.font }}>
                      Cut now (skip sale)
                    </button>}
                  </>
                )}
                {["ready", "live"].includes(r.status) && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint }}>Window closes</span>
                    <input type="date" defaultValue={r.window_close_date || ""}
                      onBlur={e => { if (e.target.value !== (r.window_close_date || "")) act(r, "", "PATCH", { window_close_date: e.target.value || null }); }}
                      style={{ padding: "8px 10px", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 9, outline: "none", color: H.text, fontFamily: H.font, fontSize: 12, colorScheme: "dark" }} />
                  </label>
                )}
                {r.status === "live" && r.model !== "stock" && (
                  <button disabled={busy === r.id} onClick={() => act(r, "", "PATCH", { action: "closed" })}
                    style={{ background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "12px 22px", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
                    Close the sale
                  </button>
                )}
                {r.status === "closed" && (
                  <button disabled={busy === r.id || !numbersDone} title={numbersDone ? "" : "Waiting on the client's production numbers"}
                    onClick={async () => { if (confirm(`CUT "${r.title}"? One job, ${r.slots.length} items, quantities from the entered numbers.`)) { const out = await act(r, "/cut", "POST"); if (out?.jobId) window.location.href = `/jobs/${out.jobId}`; } }}
                    style={{ background: numbersDone ? H.green : "transparent", color: numbersDone ? "#0a0a0a" : H.text, border: numbersDone ? "none" : `1px solid ${H.line}`, borderRadius: 999, padding: "13px 26px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: numbersDone ? "pointer" : "default", opacity: numbersDone ? 1 : 0.4, fontFamily: H.font }}>
                    ✂ Cut the drop
                  </button>
                )}
                {r.status === "cut" && r.job_id && (
                  <a href={`/jobs/${r.job_id}`}
                    style={{ background: "#fff", color: H.ink, borderRadius: 999, padding: "12px 22px", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none", fontFamily: H.font }}>
                    Open the job →
                  </a>
                )}
                {["building", "ready", "live", "closed"].includes(r.status) && (
                  <button disabled={busy === r.id} onClick={() => act(r, "", "PATCH", { action: "shelved" })}
                    style={{ marginLeft: "auto", background: "none", border: "none", color: H.faint, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
                    Shelve
                  </button>
                )}
                {r.status === "shelved" && (
                  <button disabled={busy === r.id} onClick={() => act(r, "", "PATCH", { action: "building" })}
                    style={{ background: "transparent", color: H.text, border: `1px solid rgba(255,255,255,0.35)`, borderRadius: 999, padding: "12px 20px", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
                    Revive → building
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
