"use client";
// DROPS — the ops side of the release pipeline (Jul 21 2026). Magazine
// style like /studio2. Buckets by whose move: Your move (ready to cost/
// schedule + closed drops with numbers in = cuttable), Live now, Building
// (clients assembling — read-only peek), Cut (→ job), Shelved.
// THE CUT lives here: closed/ready + all numbers → one job, items born
// from slots, quantities from the client's numbers.
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { H } from "@/components/hub/theme";
import { backwardChain } from "@/lib/portal/drop-chain";
import { isPipelineSlot, isRerunSlot, lineupIsPipelineOnly, lineUnits, lineState, lineLanded, LINE_LABELS, releaseNumbersDone, buildLedger, suggestNextBuy, lineCovered, sumQtys, type LineTone, type Ledger } from "@/lib/release-lanes";
import { fmtDay as fmtDate, daysUntilDay as daysTo } from "@/lib/dates";
import { parseSalesCsv, matchSalesToSlots } from "@/lib/shopify-sales-import";
import { sortSizes } from "@/lib/theme";

// A line's runs for the ledger: attached buys, plus the slot's own linked
// run for TRUE pipeline lines (that item IS a run of the product — a
// re-run's pre-cut item is the PAST campaign and never counts).
const runsOf = (s: any): any[] => {
  const runs = [...(s._buys || [])];
  if (isPipelineSlot(s) && s.items && !runs.some((b: any) => b.id === s.item_id)) {
    runs.push({ id: s.item_id, name: s.items.name, received_qtys: s.items.received_qtys, buy_sheet_lines: s.items.buy_sheet_lines, jobs: null });
  }
  return runs;
};
const ledgerOf = (s: any): Ledger => buildLedger(s.sold_qtys, runsOf(s));
const hasLedger = (s: any): boolean => runsOf(s).length > 0 || sumQtys(s.sold_qtys) > 0;

const thumbSrc = (id: string, size = 300) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
const PURPLE = "#fd3aa3";
const TONE: Record<LineTone, string> = { green: H.green, amber: H.amber, blue: H.blue, purple: PURPLE };

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
  const [itemThumbs, setItemThumbs] = useState<Record<string, string>>({});
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
      // items!release_slots_item_id_fkey — mig 162 added a SECOND items↔
      // release_slots relationship (items.release_slot_id, the buy-run
      // pointer), so the embed must name the slot→item FK explicitly or
      // PostgREST refuses the whole query.
      const { data: slots, error: slotsErr } = await supabase.from("release_slots")
        .select("*, art_briefs(id, title, state), items!release_slots_item_id_fkey(id, name, pipeline_stage, received_at_hpd, webstore_entered_at, forwarded_at, received_qtys, buy_sheet_lines(size, qty_ordered), jobs(id, job_number, phase))")
        .in("release_id", ids).order("sort_order");
      if (slotsErr) setErr(`Couldn't load release lines: ${slotsErr.message}`);
      for (const s of (slots || []) as any[]) {
        (slotsByRelease[s.release_id] = slotsByRelease[s.release_id] || []).push(s);
        if (s.brief_id) briefIds.push(s.brief_id);
      }
      // Item-sourced lines (pipeline/re-run) have no brief — their face is
      // the item's newest mockup/proof/print-ready (the hub items rule).
      const itemIds = Array.from(new Set((slots || []).map((s: any) => s.item_id).filter(Boolean)));
      if (itemIds.length) {
        const { data: ifiles } = await supabase.from("item_files")
          .select("item_id, stage, drive_file_id, created_at")
          .in("item_id", itemIds)
          .in("stage", ["mockup", "proof", "print_ready"])
          .is("superseded_at", null)
          .not("drive_file_id", "is", null)
          .order("created_at", { ascending: false });
        const rank: Record<string, number> = { mockup: 3, proof: 2, print_ready: 1 };
        const bestRank: Record<string, number> = {};
        const t: Record<string, string> = {};
        for (const f of (ifiles || []) as any[]) {
          const rk = rank[f.stage] || 0;
          if (rk > (bestRank[f.item_id] || 0)) { bestRank[f.item_id] = rk; t[f.item_id] = f.drive_file_id; }
        }
        setItemThumbs(t);
      }
      // Buy runs per line (Phase 4): every item pointing home via
      // release_slot_id — bought/delivered aggregate from these.
      const slotIds = (slots || []).map((s: any) => s.id);
      if (slotIds.length) {
        const { data: buys } = await supabase.from("items")
          .select("id, name, release_slot_id, received_qtys, buy_sheet_lines(size, qty_ordered), jobs!inner(id, job_number, phase)")
          .in("release_slot_id", slotIds);
        const bySlot: Record<string, any[]> = {};
        for (const b of (buys || []) as any[]) (bySlot[b.release_slot_id] ||= []).push(b);
        for (const list of Object.values(slotsByRelease)) for (const s of list) s._buys = bySlot[s.id] || [];
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
  // Stale-panel guard: refetch when the tab regains focus so an open board
  // never shows yesterday's statuses.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    /* eslint-disable-next-line */
  }, []);

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
  // Slot ops — full parity with the client's hub verbs (add/remove/spec/
  // numbers), via /api/drops/[id]/slots. Every save persists then reloads.
  async function slotAct(release: any, method: string, body?: any, qs = "") {
    setErr("");
    const res = await fetch(`/api/drops/${release.id}/slots${qs}`, {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(out.error || "Couldn't do that."); return false; }
    await load();
    return true;
  }

  const buckets = useMemo(() => {
    const list = rows || [];
    // Numbers gate = every line the cut will BIRTH has qtys (pipeline slots
    // ride along and never block; shared with the cut route's own gate).
    const numbersDone = (r: any) => releaseNumbersDone(r.slots);
    return [
      // Live drops whose window has ENDED are a call, not a status — they
      // jump the queue into Your move ("close the sale").
      { key: "your_move", title: "Your move.", color: H.amber, hint: "submitted drops, ended sale windows, and closed sales ready to cut", list: list.filter((r: any) => r.status === "ready" || r.status === "closed" || (r.status === "live" && daysTo(r.window_close_date) != null && (daysTo(r.window_close_date) as number) <= 0)) },
      { key: "live", title: "Live now.", color: PURPLE, hint: "selling — close the sale when the window ends", list: list.filter((r: any) => r.status === "live" && !(daysTo(r.window_close_date) != null && (daysTo(r.window_close_date) as number) <= 0)) },
      { key: "building", title: "Building.", hint: "being assembled — by the client or by us, same powers", list: list.filter((r: any) => r.status === "building") },
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
                  <button key={r.id} className="dr-card" onClick={() => { setOpen(r); load(); }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                      <span style={{ display: "flex" }}>
                        {r.slots.slice(0, 4).map((s: any, i: number) => (
                          <span key={s.id} style={{ width: 38, height: 38, borderRadius: 8, overflow: "hidden", background: "#fff", border: `2px solid ${H.panel}`, marginLeft: i ? -10 : 0, display: "inline-flex" }}>
                            {(thumbs[s.brief_id] || itemThumbs[s.item_id]) && <img src={thumbSrc(thumbs[s.brief_id] || itemThumbs[s.item_id], 100)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
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
                          if (r.status === "live" && lineupIsPipelineOnly(r.slots)) return "Launched";
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
        const cut = r.status === "cut";
        const numbersDone = releaseNumbersDone(r.slots);
        const totalUnits = r.slots.reduce((a: number, s: any) => a + lineUnits(s, s.items, cut).total, 0);
        // Drop value: retail × run qty per line; unpriced/unquantified lines
        // counted out loud.
        let dropValue = 0, valueGaps = 0, soldValue = 0;
        for (const sl of r.slots) {
          const qty = lineUnits(sl, sl.items, cut).total;
          const retail = sl.retail != null ? Number(sl.retail) : null;
          if (qty > 0 && retail != null) dropValue += qty * retail;
          else valueGaps++;
          const sold = Number(sl.sold_units) || 0;
          if (sold > 0 && retail != null) soldValue += sold * retail;
        }
        return (
          <div className="dr-back">
            <div className="dr-sheet">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "18px 22px 6px" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint }}>{r.clients?.name}</div>
                  {!cut ? (
                    <TitleEdit key={`t-${r.id}-${r.title}`} value={r.title} onSave={(t) => act(r, "", "PATCH", { title: t })} />
                  ) : (
                    <div style={{ fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", marginTop: 2 }}>{r.title}</div>
                  )}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: (STATUS_META[r.status] || {}).color }}>{(STATUS_META[r.status] || {}).label}</span>
                    {!cut ? (
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint }}>Target live</span>
                        <input type="date" defaultValue={r.target_live_date || ""}
                          onBlur={e => { if (e.target.value !== (r.target_live_date || "")) act(r, "", "PATCH", { target_live_date: e.target.value || null }); }}
                          style={{ padding: "6px 8px", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 8, outline: "none", color: H.text, fontFamily: H.font, fontSize: 11.5, colorScheme: "dark" }} />
                      </label>
                    ) : r.target_live_date ? (
                      <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint }}>target live {fmtDate(r.target_live_date)}</span>
                    ) : null}
                    {r.window_close_date && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: H.amber }}>◆ Pre-order · closes {fmtDate(r.window_close_date)}</span>}
                    {totalUnits > 0 && <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.dim }}>{totalUnits.toLocaleString()} pcs</span>}
                    {dropValue > 0 && <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.dim }}>~${Math.round(dropValue).toLocaleString()} at retail{valueGaps > 0 ? ` · ${valueGaps} unpriced` : ""}</span>}
                    {soldValue > 0 && <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.green, fontWeight: 700 }}>${Math.round(soldValue).toLocaleString()} sold</span>}
                    {(() => {
                      const pipe = r.slots.filter(isPipelineSlot);
                      if (!pipe.length) return null;
                      const landed = pipe.filter((s: any) => lineLanded(lineState(s, s.items, { releaseCut: cut, briefState: s.art_briefs?.state }))).length;
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
                  const lu = lineUnits(s, s.items, cut);
                  const st = lineState(s, s.items, { releaseCut: cut, briefState: s.art_briefs?.state });
                  const meta = LINE_LABELS.internal[st];
                  return (
                    <div key={s.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${H.line}`, flexWrap: "wrap" }}>
                      <span style={{ width: 40, height: 40, background: "#fff", borderRadius: 8, overflow: "hidden", flexShrink: 0, display: "inline-flex" }}>
                        {(thumbs[s.brief_id] || itemThumbs[s.item_id]) && <img src={thumbSrc(thumbs[s.brief_id] || itemThumbs[s.item_id], 100)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                      </span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.format || s.items?.name || "Item"}{s.art_briefs?.title ? <span style={{ color: H.faint, fontWeight: 600, textTransform: "none" }}> · {s.art_briefs.title}</span> : isRerunSlot(s) ? <span style={{ color: H.faint, fontWeight: 600, textTransform: "none" }}> · catalog re-run</span> : s.item_id ? <span style={{ color: H.faint, fontWeight: 600, textTransform: "none" }}> · from the pipeline</span> : null}
                        </span>
                        <span style={{ display: "block", fontSize: 10, fontFamily: H.mono, color: H.dim, marginTop: 2 }}>
                          {s.retail != null ? `$${Number(s.retail)} retail` : "retail TBD"}{s.model ? ` · ${s.model === "preorder" ? "pre-order" : s.model === "not_sure" ? "model TBD" : "fixed run"}` : ""}
                          {lu.total > 0 ? ` · ${lu.total.toLocaleString()} pcs: ${lu.sizes.map(x => `${x.size} ${x.qty}`).join("  ")}` : " · no numbers yet"}
                        </span>
                        {hasLedger(s) && (() => {
                          const led = ledgerOf(s);
                          const delta = led.totals.delivered - led.totals.sold;
                          const ok = led.totals.sold > 0 && lineCovered(led);
                          return (
                            <span style={{ display: "block", fontSize: 10, fontFamily: H.mono, marginTop: 3, color: ok ? H.green : H.amber }}>
                              sold {led.totals.sold.toLocaleString()} · bought {led.totals.bought.toLocaleString()} · landed {led.totals.delivered.toLocaleString()}{led.totals.sold > 0 ? ` · ${delta >= 0 ? "+" : ""}${delta.toLocaleString()}` : ""}
                            </span>
                          );
                        })()}
                        {s.line_notes && <span style={{ display: "block", fontSize: 11, color: H.dim, marginTop: 3, lineHeight: 1.45 }}>{s.line_notes}</span>}
                      </span>
                      <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: TONE[meta.tone], whiteSpace: "nowrap" }}>{meta.label}</span>
                      {/* Spec (format/retail) is release-level pricing — every
                          line gets it. Numbers stays non-pipeline only: a
                          pipeline line's quantities ARE its run's curve. */}
                      {!cut && (
                        <OpsSpec key={`sp-${s.id}-${s.format}-${s.retail}`} slot={s}
                          onSave={(patch) => slotAct(r, "PATCH", { slotId: s.id, ...patch })} />
                      )}
                      {!cut && !isPipelineSlot(s) && (
                        <OpsNumbers key={`nu-${s.id}-${JSON.stringify(s.qtys || {})}`} slot={s}
                          onSave={(q) => slotAct(r, "PATCH", { slotId: s.id, qtys: q })} />
                      )}
                      {!cut && (
                        <button onClick={() => slotAct(r, "DELETE", undefined, `?slotId=${s.id}`)} aria-label="Remove line"
                          style={{ background: "none", border: "none", color: H.faint, fontSize: 16, cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>×</button>
                      )}
                    </div>
                  );
                })}
                {!cut && <AddLines releaseId={r.id} onAdd={(body) => slotAct(r, "POST", body)} />}
              </div>
              {!cut && (r.window_close_date || r.slots.some(hasLedger)) && (
                <PreorderLedger key={`led-${r.id}-${r.updated_at}`} r={r}
                  onSlotPatch={(body: any) => slotAct(r, "PATCH", body)}
                  onRefresh={load} setTopErr={setErr} />
              )}

              <div style={{ padding: "16px 22px 20px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {r.status === "ready" && (
                  <>
                    <button disabled={busy === r.id} onClick={() => act(r, "", "PATCH", { action: "live" })}
                      style={{ background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "12px 22px", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
                      {lineupIsPipelineOnly(r.slots) ? "Mark launched" : "Take it live"}
                    </button>
                    {!lineupIsPipelineOnly(r.slots) && <button disabled={busy === r.id || !numbersDone} title={numbersDone ? "" : "Every line needs quantities first (client enters after close, or you can cut a fixed-run drop once numbers exist)"}
                      onClick={async () => { if (confirm(`Cut "${r.title}" into a job now? Items + quantities come from the lineup.`)) { const out = await act(r, "/cut", "POST"); if (out?.jobId) window.location.href = `/jobs/${out.jobId}`; } }}
                      style={{ background: "transparent", color: H.text, border: `1px solid rgba(255,255,255,0.35)`, borderRadius: 999, padding: "12px 20px", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: numbersDone ? "pointer" : "default", opacity: numbersDone ? 1 : 0.4, fontFamily: H.font }}>
                      Cut now (skip sale)
                    </button>}
                  </>
                )}
                {r.status === "building" && (
                  <button disabled={busy === r.id} onClick={() => act(r, "", "PATCH", { action: "ready" })}
                    style={{ background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "12px 22px", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
                    Mark ready →
                  </button>
                )}
                {!cut && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint }}>Window closes</span>
                    <input type="date" defaultValue={r.window_close_date || ""}
                      onBlur={e => { if (e.target.value !== (r.window_close_date || "")) act(r, "", "PATCH", { window_close_date: e.target.value || null }); }}
                      style={{ padding: "8px 10px", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 9, outline: "none", color: H.text, fontFamily: H.font, fontSize: 12, colorScheme: "dark" }} />
                  </label>
                )}
                {r.status === "live" && !lineupIsPipelineOnly(r.slots) && (
                  <button disabled={busy === r.id} onClick={() => act(r, "", "PATCH", { action: "closed" })}
                    style={{ background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "12px 22px", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
                    Close the sale
                  </button>
                )}
                {r.status === "closed" && (
                  <button disabled={busy === r.id || !numbersDone} title={numbersDone ? "" : "Waiting on the client's production numbers"}
                    onClick={async () => { const n = r.slots.filter((s: any) => !isPipelineSlot(s)).length; if (confirm(`CUT "${r.title}"? One job, ${n} item${n === 1 ? "" : "s"}, quantities from the entered numbers.`)) { const out = await act(r, "/cut", "POST"); if (out?.jobId) window.location.href = `/jobs/${out.jobId}`; } }}
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

// ── Ops parity widgets (Aug 20 2026) — mirror the hub's client verbs with
//    the board's palette. Every save persists server-side then reloads; no
//    input survives only in component state. ─────────────────────────────

function TitleEdit({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <input value={v} onChange={e => setV(e.target.value)} title="Click to rename"
      onBlur={() => { const t = v.trim(); if (t && t !== value) onSave(t); }}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setV(value); }}
      style={{ fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", marginTop: 2, background: "transparent", border: "none", borderBottom: "1px dotted rgba(255,255,255,.3)", outline: "none", color: H.text, width: "100%", fontFamily: H.font, padding: 0 }} />
  );
}

function OpsSpec({ slot, onSave }: { slot: any; onSave: (patch: { format?: string; retail?: string | null }) => void }) {
  const [openSpec, setOpenSpec] = useState(false);
  const [format, setFormat] = useState<string>(slot.format || "");
  const [retail, setRetail] = useState<string>(slot.retail != null ? String(slot.retail) : "");
  if (!openSpec) {
    return (
      <button onClick={() => setOpenSpec(true)}
        style={{ background: "none", border: `1px solid ${H.line}`, borderRadius: 999, padding: "7px 12px", fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: H.dim, cursor: "pointer", fontFamily: H.font }}>✎ Spec</button>
    );
  }
  return (
    <span style={{ flexBasis: "100%", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", paddingTop: 8 }}>
      <input value={format} onChange={e => setFormat(e.target.value)} placeholder="Tee, Hoodie…"
        style={{ flex: 2, minWidth: 140, padding: "8px 10px", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 8, color: H.text, fontSize: 12, outline: "none", fontFamily: H.font }} />
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: H.mono, color: H.dim, fontSize: 12 }}>$
        <input value={retail} onChange={e => setRetail(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="retail" inputMode="decimal"
          style={{ width: 76, padding: "8px 10px", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 8, color: H.text, fontSize: 12, outline: "none", fontFamily: H.mono }} />
      </span>
      <button onClick={() => { onSave({ format: format.trim(), retail: retail.trim() === "" ? null : retail.trim() }); setOpenSpec(false); }}
        style={{ background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "8px 16px", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>Save</button>
      <button onClick={() => setOpenSpec(false)} style={{ background: "none", border: "none", color: H.faint, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>Cancel</button>
    </span>
  );
}

const OPS_SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
function OpsNumbers({ slot, onSave }: { slot: any; onSave: (q: Record<string, number>) => void }) {
  const [openEntry, setOpenEntry] = useState(false);
  const [q, setQ] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const s of Array.from(new Set([...OPS_SIZES, ...Object.keys(slot.qtys || {})]))) out[s] = slot.qtys?.[s] != null ? String(slot.qtys[s]) : "";
    return out;
  });
  if (!openEntry) {
    const has = Object.keys(slot.qtys || {}).length > 0;
    return (
      <button onClick={() => setOpenEntry(true)}
        style={{ background: has ? "none" : "#fff", color: has ? H.dim : H.ink, border: has ? `1px solid ${H.line}` : "none", borderRadius: 999, padding: "7px 12px", fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
        {has ? "Edit numbers" : "Enter numbers"}
      </button>
    );
  }
  return (
    <span style={{ flexBasis: "100%", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", paddingTop: 8 }}>
      {Object.keys(q).map(sz => (
        <label key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: H.faint, fontFamily: H.mono }}>{sz}</span>
          <input type="text" inputMode="numeric" value={q[sz]} placeholder="0"
            onFocus={e => e.currentTarget.select()}
            onChange={e => setQ(p => ({ ...p, [sz]: e.target.value.replace(/[^0-9]/g, "") }))}
            style={{ width: 48, padding: "8px 0", textAlign: "center", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 8, color: H.text, fontFamily: H.mono, fontSize: 12.5, fontWeight: 700, outline: "none" }} />
        </label>
      ))}
      <button onClick={() => { const out: Record<string, number> = {}; for (const [k, v] of Object.entries(q)) { const n = Math.round(Number(v) || 0); if (n > 0) out[k] = n; } onSave(out); setOpenEntry(false); }}
        style={{ background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "9px 16px", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>Save</button>
      <button onClick={() => setOpenEntry(false)} style={{ background: "none", border: "none", color: H.faint, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>Cancel</button>
    </span>
  );
}

function AddLines({ releaseId, onAdd }: { releaseId: string; onAdd: (body: any) => Promise<boolean> }) {
  const [openAdd, setOpenAdd] = useState(false);
  const [cands, setCands] = useState<{ briefs: any[]; pipeItems: any[]; rerunItems: any[]; products?: any[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  async function loadCands() {
    try { setCands(await fetch(`/api/drops/${releaseId}/slots`).then(r => r.json())); }
    catch { setCands({ briefs: [], pipeItems: [], rerunItems: [], products: [] }); }
  }
  async function add(id: string, body: any) {
    setBusyId(id);
    try { if (await onAdd(body)) await loadCands(); } finally { setBusyId(null); }
  }
  if (!openAdd) {
    return (
      <div style={{ padding: "12px 0 4px" }}>
        <button onClick={() => { setOpenAdd(true); loadCands(); }}
          style={{ borderRadius: 999, border: `1px solid ${H.line}`, background: "transparent", color: H.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", padding: "9px 16px", cursor: "pointer", fontFamily: H.font }}>+ Add lines</button>
      </div>
    );
  }
  const group = (label: string) => (
    <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint, padding: "8px 0 2px" }}>{label}</div>
  );
  const row = (id: string, body: any, thumbId: string | null, name: string, hint: string) => (
    <button key={id} disabled={busyId === id} onClick={() => add(id, body)}
      style={{ display: "flex", gap: 10, alignItems: "center", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 10, padding: "8px 10px", cursor: "pointer", textAlign: "left", fontFamily: H.font, color: H.text, width: "100%", opacity: busyId === id ? 0.5 : 1 }}>
      <span style={{ width: 30, height: 30, background: "#fff", borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
        {thumbId && <img src={thumbSrc(thumbId, 100)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
      </span>
      <span style={{ minWidth: 0, flex: 1, fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      <span style={{ fontSize: 9.5, fontFamily: H.mono, color: H.faint, whiteSpace: "nowrap" }}>{hint}</span>
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: H.text }}>+ Add</span>
    </button>
  );
  return (
    <div style={{ padding: "12px 0 4px", display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
      {cands === null ? (
        <div style={{ fontSize: 11.5, color: H.faint }}>Loading their studio + pipeline…</div>
      ) : !cands.briefs.length && !cands.pipeItems.length && !cands.rerunItems.length && !(cands.products || []).length ? (
        <div style={{ fontSize: 11.5, color: H.faint }}>Nothing left to pull — everything is on a release, ordered, or in production.</div>
      ) : (
        <>
          {cands.pipeItems.length > 0 && group("From their pipeline")}
          {cands.pipeItems.map((it: any) => row(it.id, { itemId: it.id }, null, it.name, it.qty ? `${it.qty.toLocaleString()} pcs` : ""))}
          {cands.rerunItems.length > 0 && group("From their catalog · run it back")}
          {cands.rerunItems.map((it: any) => row(it.id, { itemId: it.id, rerun: true }, null, it.name, it.qty ? `last run ${it.qty.toLocaleString()} pcs` : "past run"))}
          {(cands.products || []).length > 0 && group("From their catalog · never run")}
          {(cands.products || []).map((p: any) => row(p.id, { productId: p.id }, p.thumbId, p.title, p.format || "mockup"))}
          {cands.briefs.length > 0 && group("From the studio · not yet ordered")}
          {cands.briefs.map((b: any) => row(b.id, { briefId: b.id }, b.thumbId, b.title || "Untitled", b.state === "approved" ? "approved" : "in the works"))}
        </>
      )}
      <button onClick={() => setOpenAdd(false)} style={{ alignSelf: "flex-start", background: "none", border: "none", color: H.faint, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, padding: "4px 0" }}>Done</button>
    </div>
  );
}

// ── THE PRE-ORDER LEDGER (Phase 4, Aug 20 2026) — per line: sold (the one
//    human number) · bought (Σ run curves) · landed (Σ receiving). Suggest-
//    next-buy = round(sold×(1+overage%))−bought, verified against the
//    Pre-Order Master sheet. One buy job carries every included line
//    through the hard naming gate. ─────────────────────────────────────

function PreorderLedger({ r, onSlotPatch, onRefresh, setTopErr }: {
  r: any; onSlotPatch: (body: any) => Promise<boolean>; onRefresh: () => Promise<void>; setTopErr: (e: string) => void;
}) {
  const lines = r.slots.filter((s: any) => !isRerunSlot(s) || hasLedger(s) || true); // every line can carry a ledger
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const label = { fontSize: 8.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: H.faint };
  return (
    <div style={{ margin: "14px 22px 4px", border: `1px solid ${H.line}`, borderRadius: 14, padding: "13px 15px", background: "rgba(244,178,43,.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ ...label, color: H.amber }}>◆ Pre-order ledger</span>
        <span style={{ fontSize: 10, fontFamily: H.mono, color: H.faint }}>sold is the only number you type — bought + landed track the runs</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <a href={`/api/pdf/release-ledger/${r.id}?download=1`}
            style={{ display: "inline-block", background: "none", border: `1px solid ${H.line}`, borderRadius: 999, padding: "8px 14px", fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: H.dim, textDecoration: "none", fontFamily: H.font }}>Export PDF</a>
          <button onClick={() => { setImportOpen(v => !v); setBuyOpen(false); }}
            style={{ background: "none", border: `1px solid ${H.line}`, borderRadius: 999, padding: "8px 14px", fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: H.dim, cursor: "pointer", fontFamily: H.font }}>Import sold counts</button>
          <button onClick={() => { setBuyOpen(v => !v); setImportOpen(false); }}
            style={{ background: H.green, border: "none", borderRadius: 999, padding: "8px 16px", fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "#08210a", cursor: "pointer", fontFamily: H.font }}>Next buy →</button>
        </span>
      </div>

      {importOpen && <SoldImport releaseId={r.id} slots={r.slots} onDone={async () => { setImportOpen(false); await onRefresh(); }} />}
      {buyOpen && <BuyPanel r={r} onDone={async () => { setBuyOpen(false); await onRefresh(); }} setTopErr={setTopErr} />}

      <div style={{ marginTop: 10 }}>
        {lines.map((s: any) => {
          const led = ledgerOf(s);
          const name = s.format || s.items?.name || "Line";
          const openMe = openLine === s.id;
          const suggest = suggestNextBuy(led, Number(s.overage_pct) || 0);
          const needTotal = Object.values(suggest).reduce((a, b) => a + b, 0);
          return (
            <div key={s.id} style={{ borderTop: `1px solid ${H.line}`, padding: "8px 0" }}>
              <button onClick={() => setOpenLine(openMe ? null : s.id)}
                style={{ display: "flex", gap: 10, alignItems: "baseline", width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: H.font, color: H.text, padding: 0 }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: H.mono, whiteSpace: "nowrap", color: led.totals.sold > 0 && lineCovered(led) ? H.green : H.amber }}>
                  sold {led.totals.sold.toLocaleString()} · bought {led.totals.bought.toLocaleString()} · landed {led.totals.delivered.toLocaleString()}{needTotal > 0 ? ` · buy ${needTotal.toLocaleString()}` : ""}
                </span>
                <span style={{ fontSize: 10, color: H.faint }}>{openMe ? "▾" : "▸"}</span>
              </button>
              {openMe && <LedgerLine slot={s} led={led} onSlotPatch={onSlotPatch} clientId={r.client_id} onRefresh={onRefresh} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LedgerLine({ slot, led, onSlotPatch, clientId, onRefresh }: {
  slot: any; led: Ledger; onSlotPatch: (body: any) => Promise<boolean>; clientId: string; onRefresh: () => Promise<void>;
}) {
  const sizes = sortSizes(Array.from(new Set([...led.sizes, ...OPS_SIZES])));
  const [sold, setSold] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const s of sizes) out[s] = led.sold[s] != null ? String(led.sold[s]) : "";
    return out;
  });
  const [ov, setOv] = useState<string>(String(Number(slot.overage_pct) || 0));
  const [attachOpen, setAttachOpen] = useState(false);
  const [cands, setCands] = useState<any[] | null>(null);
  const supabase = createClient();
  const cell = { fontSize: 11.5, fontFamily: H.mono, textAlign: "center" as const, padding: "5px 2px" };
  async function loadAttach() {
    const { data } = await supabase.from("items")
      .select("id, name, jobs!inner(job_number, client_id)")
      .eq("jobs.client_id", clientId).is("release_slot_id", null)
      .order("created_at", { ascending: false }).limit(40);
    setCands((data || []) as any[]);
  }
  return (
    <div style={{ padding: "8px 0 4px" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 320 }}>
          <thead><tr>
            <th style={{ ...cell, color: H.faint, fontSize: 9, textAlign: "left", paddingRight: 10 }}></th>
            {sizes.map(sz => <th key={sz} style={{ ...cell, color: H.faint, fontSize: 9.5 }}>{sz}</th>)}
            <th style={{ ...cell, color: H.faint, fontSize: 9.5 }}>TOTAL</th>
          </tr></thead>
          <tbody>
            <tr>
              <td style={{ ...cell, textAlign: "left", color: H.dim, fontSize: 10 }}>SOLD</td>
              {sizes.map(sz => (
                <td key={sz} style={cell}>
                  <input value={sold[sz] || ""} placeholder="·" inputMode="numeric"
                    onFocus={e => e.currentTarget.select()}
                    onChange={e => setSold(p => ({ ...p, [sz]: e.target.value.replace(/[^0-9]/g, "") }))}
                    style={{ width: 44, padding: "6px 0", textAlign: "center", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 7, color: H.text, fontFamily: H.mono, fontSize: 11.5, outline: "none" }} />
                </td>
              ))}
              <td style={{ ...cell, color: H.text, fontWeight: 700 }}>{Object.values(sold).reduce((a, v) => a + (Math.round(Number(v)) || 0), 0).toLocaleString()}</td>
            </tr>
            <tr>
              <td style={{ ...cell, textAlign: "left", color: H.dim, fontSize: 10 }}>BOUGHT</td>
              {sizes.map(sz => <td key={sz} style={{ ...cell, color: H.dim }}>{led.bought[sz] || "·"}</td>)}
              <td style={{ ...cell, color: H.dim, fontWeight: 700 }}>{led.totals.bought.toLocaleString()}</td>
            </tr>
            <tr>
              <td style={{ ...cell, textAlign: "left", color: H.dim, fontSize: 10 }}>LANDED</td>
              {sizes.map(sz => <td key={sz} style={{ ...cell, color: H.dim }}>{led.delivered[sz] || "·"}</td>)}
              <td style={{ ...cell, color: H.dim, fontWeight: 700 }}>{led.totals.delivered.toLocaleString()}</td>
            </tr>
            <tr>
              <td style={{ ...cell, textAlign: "left", color: H.faint, fontSize: 10 }}>+/−</td>
              {sizes.map(sz => { const d = (led.delivered[sz] || 0) - (led.sold[sz] || 0); return <td key={sz} style={{ ...cell, color: !led.sold[sz] ? H.faint : d >= 0 ? H.green : H.red }}>{led.sold[sz] || led.delivered[sz] ? d : "·"}</td>; })}
              {(() => { const d = led.totals.delivered - led.totals.sold; return <td style={{ ...cell, fontWeight: 700, color: led.totals.sold ? (d >= 0 ? H.green : H.red) : H.faint }}>{led.totals.sold ? d : "·"}</td>; })()}
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <button onClick={() => { const out: Record<string, number> = {}; for (const [k, v] of Object.entries(sold)) { const n = Math.round(Number(v) || 0); if (n > 0) out[k] = n; } onSlotPatch({ slotId: slot.id, soldQtys: out }); }}
          style={{ background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "8px 16px", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>Save sold</button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, fontFamily: H.mono, color: H.dim }}>
          overage
          <input value={ov} inputMode="decimal" onChange={e => setOv(e.target.value.replace(/[^0-9.]/g, ""))}
            onBlur={() => { if (Number(ov) !== Number(slot.overage_pct)) onSlotPatch({ slotId: slot.id, overagePct: Number(ov) || 0 }); }}
            style={{ width: 44, padding: "6px 0", textAlign: "center", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 7, color: H.text, fontFamily: H.mono, fontSize: 11, outline: "none" }} />%
        </label>
        {slot.sold_updated_at && <span style={{ fontSize: 9.5, fontFamily: H.mono, color: H.faint }}>sold updated {fmtDate(slot.sold_updated_at)}</span>}
        <button onClick={() => { setAttachOpen(v => !v); if (!cands) loadAttach(); }}
          style={{ marginLeft: "auto", background: "none", border: "none", color: H.blue, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>+ Attach a run</button>
      </div>
      {(() => {
        // The line's runs = the slot's own linked item (pipeline lines — in
        // the ledger via runsOf but linked by slot.item_id, not the buy
        // pointer) + every attached buy. The linked run can't detach.
        const linked = isPipelineSlot(slot) && slot.items
          ? [{ id: slot.item_id, name: slot.items.name, received_qtys: slot.items.received_qtys, buy_sheet_lines: slot.items.buy_sheet_lines, jobs: slot.items.jobs, _linked: true }]
          : [];
        const runList = [...linked, ...(slot._buys || []).filter((b: any) => !linked.some(l => l.id === b.id))];
        return runList.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {runList.map((b: any) => (
            <div key={b.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 10.5, fontFamily: H.mono, color: H.dim }}>
              <span style={{ color: H.text, fontWeight: 700 }}>{b.jobs?.job_number || "—"}</span>
              <span>{b.jobs?.phase || ""}</span>
              <span>ordered {(b.buy_sheet_lines || []).reduce((a: number, l: any) => a + (Number(l.qty_ordered) || 0), 0).toLocaleString()}</span>
              <span>landed {Object.values(b.received_qtys || {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0).toLocaleString()}</span>
              {b.jobs?.id && <a href={`/jobs/${b.jobs.id}`} target="_blank" rel="noreferrer" style={{ color: H.blue, textDecoration: "none" }}>open ↗</a>}
              {b._linked ? (
                <span style={{ marginLeft: "auto", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: H.faint }}>On the release</span>
              ) : (
                <button onClick={() => onSlotPatch({ slotId: slot.id, detachItemId: b.id })} aria-label="Detach run"
                  style={{ background: "none", border: "none", color: H.faint, fontSize: 13, cursor: "pointer", lineHeight: 1, marginLeft: "auto" }}>×</button>
              )}
            </div>
          ))}
        </div>
      ); })()}
      {attachOpen && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
          {cands === null ? <span style={{ fontSize: 10.5, color: H.faint }}>Loading unattached runs…</span> :
            !cands.length ? <span style={{ fontSize: 10.5, color: H.faint }}>No unattached runs for this client.</span> :
            cands.map((it: any) => (
              <button key={it.id} onClick={async () => { if (await onSlotPatch({ slotId: slot.id, attachItemId: it.id })) { setAttachOpen(false); setCands(null); } }}
                style={{ display: "flex", gap: 10, alignItems: "center", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", textAlign: "left", fontFamily: H.font, color: H.text, fontSize: 11 }}>
                <span style={{ fontFamily: H.mono, color: H.faint }}>{it.jobs?.job_number}</span>
                <span style={{ fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>Attach</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function BuyPanel({ r, onDone, setTopErr }: { r: any; onDone: () => Promise<void>; setTopErr: (e: string) => void }) {
  // Every line with a positive suggestion, prefilled — names must be
  // confirmed (the naming gate); qtys editable per size.
  const initial = r.slots
    .map((s: any) => ({ s, led: ledgerOf(s), suggest: suggestNextBuy(ledgerOf(s), Number(s.overage_pct) || 0) }))
    .filter((x: any) => Object.values(x.suggest).reduce((a: number, b: any) => a + b, 0) > 0);
  type BuyRow = { slotId: string; include: boolean; finalName: string; pct: string; qtys: Record<string, string> };
  const [rows, setRows] = useState<BuyRow[]>(() => initial.map((x: any): BuyRow => ({
    slotId: x.s.id, include: true,
    finalName: String(x.s.format || x.s.items?.name || "").trim(),
    pct: String(Number(x.s.overage_pct) || 0),
    qtys: Object.fromEntries(Object.entries(x.suggest).map(([k, v]) => [k, String(v)])) as Record<string, string>,
  })));
  // Buffer control lives here, where the buy decision happens (Jon, Aug 23:
  // "didn't see anywhere to add a buffer"). Changing it re-suggests that
  // row's sizes from the ledger and persists the per-line policy.
  function setPct(i: number, pct: string) {
    setRows(p => p.map((y, j) => {
      if (j !== i) return y;
      const led = initial.find((x: any) => x.s.id === y.slotId)?.led;
      const suggest = led ? suggestNextBuy(led, Number(pct) || 0) : {};
      return { ...y, pct, qtys: Object.fromEntries(Object.entries(suggest).map(([k, v]) => [k, String(v)])) };
    }));
  }
  async function persistPct(row: BuyRow) {
    await fetch(`/api/drops/${r.id}/slots`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slotId: row.slotId, overagePct: Number(row.pct) || 0 }) }).catch(() => {});
  }
  const [busyBuy, setBusyBuy] = useState(false);
  const [jobLink, setJobLink] = useState<{ id: string; number: string } | null>(null);
  if (jobLink) {
    return (
      <div style={{ marginTop: 10, fontSize: 12, color: H.green, fontWeight: 700 }}>
        ✓ Buy cut — <a href={`/jobs/${jobLink.id}`} target="_blank" rel="noreferrer" style={{ color: H.green }}>{jobLink.number} ↗</a> is in intake with the curves loaded.
      </div>
    );
  }
  if (!rows.length) return <div style={{ marginTop: 10, fontSize: 11.5, color: H.faint }}>Nothing to buy — every sold size is covered at the current overage. Refresh sold counts first if the store has moved.</div>;
  async function cutBuy() {
    setBusyBuy(true); setTopErr("");
    try {
      const buys = rows.filter(x => x.include).map(x => ({
        slotId: x.slotId, finalName: x.finalName.trim(),
        qtys: Object.fromEntries(Object.entries(x.qtys).map(([k, v]) => [k, Math.round(Number(v) || 0)]).filter(([, v]) => (v as number) > 0)),
      }));
      if (!buys.length) return;
      const res = await fetch(`/api/drops/${r.id}/buy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buys }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setTopErr(out.error || "Couldn't cut the buy."); return; }
      setJobLink({ id: out.jobId, number: out.jobNumber });
      await onDone();
    } finally { setBusyBuy(false); }
  }
  const missingName = rows.some(x => x.include && !x.finalName.trim());
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10.5, color: H.dim, lineHeight: 1.5 }}>
        One job, every included line. <b style={{ color: H.text }}>Final product name is required</b> — it must match the Shopify listing exactly (it's the join key for sold imports and fulfillment).
      </div>
      {rows.map((x, i) => (
        <div key={x.slotId} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="checkbox" checked={x.include} onChange={e => setRows(p => p.map((y, j) => j === i ? { ...y, include: e.target.checked } : y))} />
          <input value={x.finalName} placeholder="Final Shopify product name"
            onChange={e => setRows(p => p.map((y, j) => j === i ? { ...y, finalName: e.target.value } : y))}
            style={{ flex: 1, minWidth: 180, padding: "8px 10px", background: H.surface, border: `1px solid ${x.include && !x.finalName.trim() ? H.red : H.line}`, borderRadius: 8, color: H.text, fontSize: 12, outline: "none", fontFamily: H.font }} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, fontFamily: H.mono, color: H.dim }} title="Buffer: buy = sold × (1 + overage%) − bought. Changing it re-suggests the sizes.">
            +<input value={x.pct} inputMode="decimal"
              onChange={e => setPct(i, e.target.value.replace(/[^0-9.]/g, ""))}
              onBlur={() => persistPct(x)}
              style={{ width: 36, padding: "7px 0", textAlign: "center", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 7, color: H.amber, fontFamily: H.mono, fontSize: 11, fontWeight: 700, outline: "none" }} />%
          </label>
          {sortSizes(Object.keys(x.qtys)).map(sz => (
            <label key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <span style={{ fontSize: 8.5, fontWeight: 800, color: H.faint, fontFamily: H.mono }}>{sz}</span>
              <input value={x.qtys[sz]} inputMode="numeric" onFocus={e => e.currentTarget.select()}
                onChange={e => setRows(p => p.map((y, j) => j === i ? { ...y, qtys: { ...y.qtys, [sz]: e.target.value.replace(/[^0-9]/g, "") } } : y))}
                style={{ width: 42, padding: "6px 0", textAlign: "center", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 7, color: H.text, fontFamily: H.mono, fontSize: 11.5, outline: "none" }} />
            </label>
          ))}
        </div>
      ))}
      <div>
        <button disabled={busyBuy || missingName} onClick={cutBuy} title={missingName ? "Every included line needs its final Shopify name" : ""}
          style={{ background: H.green, color: "#08210a", border: "none", borderRadius: 999, padding: "11px 22px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: missingName ? "default" : "pointer", opacity: busyBuy || missingName ? 0.5 : 1, fontFamily: H.font }}>
          {busyBuy ? "Cutting…" : "Cut the buy job →"}
        </button>
      </div>
    </div>
  );
}
function SoldImport({ releaseId, slots, onDone }: { releaseId: string; slots: any[]; onDone: () => Promise<void> }) {
  // File-first (the CsvPdfTool pattern Jon knows): pick or drop the Shopify
  // export → instant client-side preview via the SAME lib the server uses →
  // confirm per line → apply only the checked subset. Paste stays as the
  // fallback door.
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<null | {
    lines: { slotId: string; name: string; include: boolean; qtys: Record<string, number>; total: number; prevTotal: number }[];
    unmatched: { product: string; variant: string; qty: number }[];
  }>(null);
  const [busyImp, setBusyImp] = useState(false);
  const [impErr, setImpErr] = useState("");
  const [done, setDone] = useState<{ applied: number } | null>(null);
  const fileIn = useRef<HTMLInputElement | null>(null);

  function buildPreview(text: string) {
    setImpErr(""); setDone(null);
    const parsed = parseSalesCsv(text);
    if (parsed.error) { setPreview(null); setImpErr(parsed.error); return; }
    const named = slots.map((s: any) => ({ id: s.id, name: String(s.format || s.items?.name || "").trim(), slot: s }))
      .filter((s: any) => s.name);
    const { bySlot, unmatched } = matchSalesToSlots(parsed.rows, named);
    const lines = named.filter((s: any) => bySlot[s.id]).map((s: any) => ({
      slotId: s.id, name: s.name, include: true,
      qtys: bySlot[s.id],
      total: Object.values(bySlot[s.id]).reduce((a: number, b: any) => a + b, 0),
      prevTotal: sumQtys(s.slot.sold_qtys),
    }));
    if (!lines.length) { setPreview(null); setImpErr("No rows matched this release's lines — check the product names match the lineup."); return; }
    setPreview({ lines, unmatched: unmatched as any[] });
  }
  function onFile(f: File | null) {
    if (!f) return;
    setFileName(f.name);
    const rd = new FileReader();
    rd.onload = () => buildPreview(String(rd.result || ""));
    rd.onerror = () => setImpErr("Couldn't read that file.");
    rd.readAsText(f);
  }
  async function apply() {
    if (!preview) return;
    setBusyImp(true); setImpErr("");
    try {
      const applyMap: Record<string, Record<string, number>> = {};
      for (const l of preview.lines) if (l.include) applyMap[l.slotId] = l.qtys;
      if (!Object.keys(applyMap).length) return;
      const res = await fetch(`/api/drops/${releaseId}/sold-import`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apply: applyMap }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setImpErr(out.error || "Import failed."); return; }
      setDone({ applied: (out.applied || []).length });
      setPreview(null);
      await onDone();
    } finally { setBusyImp(false); }
  }

  if (done) return <div style={{ marginTop: 10, fontSize: 12, color: H.green, fontWeight: 700 }}>✓ Sold counts applied to {done.applied} line{done.applied === 1 ? "" : "s"}.</div>;

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
      {!preview && (
        <>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0] || null); }}
            onClick={() => fileIn.current?.click()}
            style={{ border: `1.5px dashed ${dragOver ? H.amber : H.line}`, borderRadius: 12, padding: "22px 16px", textAlign: "center", cursor: "pointer", background: dragOver ? "rgba(244,178,43,.06)" : "transparent" }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: H.text }}>{fileName || "Drop the Shopify CSV here — or click to choose"}</div>
            <div style={{ fontSize: 10.5, color: H.faint, marginTop: 4, lineHeight: 1.5 }}>
              Sales by product variant, exported for the sell window's dates. Sales report only — never an inventory export.
            </div>
            <input ref={fileIn} type="file" accept=".csv,text/csv" style={{ display: "none" }}
              onChange={e => { onFile(e.target.files?.[0] || null); if (fileIn.current) fileIn.current.value = ""; }} />
          </div>
          <button onClick={() => setPasteOpen(v => !v)} style={{ alignSelf: "flex-start", background: "none", border: "none", color: H.faint, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, padding: 0 }}>or paste the CSV</button>
          {pasteOpen && (
            <>
              <textarea value={csvText} onChange={e => setCsvText(e.target.value)} rows={4} placeholder="Product title,Product variant title,Net quantity…"
                style={{ width: "100%", boxSizing: "border-box", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 10, color: H.text, fontSize: 11.5, fontFamily: H.mono, padding: "10px 12px", outline: "none", resize: "vertical" }} />
              <button disabled={!csvText.trim()} onClick={() => buildPreview(csvText)}
                style={{ alignSelf: "flex-start", background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "9px 18px", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", opacity: csvText.trim() ? 1 : 0.5, fontFamily: H.font }}>Preview</button>
            </>
          )}
        </>
      )}
      {impErr && <div style={{ fontSize: 11.5, color: H.red, fontWeight: 700 }}>{impErr}</div>}
      {preview && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 10.5, color: H.dim }}>Check the lines to import — sold counts REPLACE what's on each line.</div>
          {preview.lines.map((l, i) => (
            <label key={l.slotId} style={{ display: "flex", gap: 10, alignItems: "baseline", cursor: "pointer", padding: "7px 0", borderBottom: `1px solid ${H.line}` }}>
              <input type="checkbox" checked={l.include}
                onChange={e => setPreview(p => p && ({ ...p, lines: p.lines.map((y, j) => j === i ? { ...y, include: e.target.checked } : y) }))} />
              <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
              <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.dim, whiteSpace: "nowrap" }}>{sortSizes(Object.keys(l.qtys)).map(sz => `${sz} ${l.qtys[sz]}`).join("  ")}</span>
              <span style={{ marginLeft: "auto", fontSize: 10.5, fontFamily: H.mono, whiteSpace: "nowrap", color: H.text }}>
                {l.prevTotal > 0 && <span style={{ color: H.faint }}>{l.prevTotal.toLocaleString()} → </span>}<b>{l.total.toLocaleString()}</b> sold
              </span>
            </label>
          ))}
          {preview.unmatched.length > 0 && (
            <div style={{ fontSize: 10.5, color: H.faint, lineHeight: 1.55 }}>
              {preview.unmatched.length} row{preview.unmatched.length === 1 ? "" : "s"} not on this release (skipped): {preview.unmatched.slice(0, 5).map(u => u.product).join(", ")}{preview.unmatched.length > 5 ? ` +${preview.unmatched.length - 5} more` : ""}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button disabled={busyImp || !preview.lines.some(l => l.include)} onClick={apply}
              style={{ background: H.green, color: "#08210a", border: "none", borderRadius: 999, padding: "11px 22px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", opacity: busyImp ? 0.6 : 1, fontFamily: H.font }}>
              {busyImp ? "Applying…" : `Import ${preview.lines.filter(l => l.include).length} line${preview.lines.filter(l => l.include).length === 1 ? "" : "s"} →`}
            </button>
            <button onClick={() => { setPreview(null); setFileName(""); }} style={{ background: "none", border: "none", color: H.faint, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>Start over</button>
          </div>
        </div>
      )}
    </div>
  );
}
