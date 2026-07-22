"use client";
// THE DISTRO — the warehouse's front door, House-style (Jul 21 2026).
// Who needs what, when: the receiver sees today's landings and open pulls;
// fulfillment sees what's staged to move; variances surface themselves in
// red. Every plate is a directive — what, how, done-when — so the surface
// trains the team. Legacy /distro, /receiving2, /warehouse stay for depth.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { H } from "@/components/hub/theme";
import { DISTRO_DIRECTIVES, HOUSE_EXTRA_DIRECTIVES } from "@/lib/directives";
import { fulfillPullRequest, resolvePostShopifyPull } from "@/lib/handoff";
import { logJobActivity } from "@/components/JobActivityPanel";

const PURPLE = "#fd3aa3";
const fmtDate = (iso?: string | null) => iso ? new Date(iso + (String(iso).includes("T") ? "" : "T00:00")).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
const wt = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString("en-US", { weekday: "short" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", ""); };
const sum = (o: any) => Object.values(o || {}).reduce((a: number, b: any) => a + (Number(b) || 0), 0);

export default function TheDistroPage() {
  const supabase = createClient();
  const [ships, setShips] = useState<any[] | null>(null);
  const [pulls, setPulls] = useState<any[]>([]);
  const [fulfill, setFulfill] = useState<any[]>([]);
  const [lateLandings, setLateLandings] = useState<any[]>([]);
  const [wire, setWire] = useState<any[]>([]);
  // act-in-place: tapping a plate opens its action sheet instead of leaving
  const [sheet, setSheet] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const today = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const todayStr = new Date().toISOString().slice(0, 10);
      const [{ data: sh }, { data: pr }, { data: fj }, { data: act }, { data: lateShips }] = await Promise.all([
        supabase.from("shipments").select("id, expected_arrival, status, source, shipment_lines(item_id, received)").gte("expected_arrival", today).order("expected_arrival").limit(12),
        supabase.from("pull_requests").select("id, item_id, job_id, kind, qtys, reason, status, requested_by_name, created_at, items(id, name, status, sample_qtys, received_at_hpd, jobs(job_number, clients(name)))").in("status", ["pending", "partial"]).order("created_at").limit(20),
        supabase.from("jobs").select("id, job_number, fulfillment_status, target_ship_date, clients(name), items(id, name, received_at_hpd, webstore_entered_at)").eq("phase", "fulfillment"),
        supabase.from("job_activity").select("message, created_at, jobs(job_number, clients(name))").order("created_at", { ascending: false }).limit(40),
        // late landings: expected date passed, still not delivered — "where is it"
        // (moved here from The House — chasing boxes is dock work; Jon, Jul 22)
        supabase.from("shipments")
          .select("id, expected_arrival, status, carrier, tracking_number, carrier_status, shipment_lines(item_id, items(name, jobs(job_number, clients(name))))")
          .lt("expected_arrival", todayStr).in("status", ["pending", "in_transit", "exception"])
          .order("expected_arrival").limit(6),
      ]);
      setShips(sh || []); setPulls(pr || []); setFulfill(fj || []); setLateLandings(lateShips || []);
      setWire((act || []).filter((a: any) => /receiv|ship|forward|pull|land|deliver/i.test(a.message)).slice(0, 12));
    })();
    // eslint-disable-next-line
  }, []);

  const openPullUnits = useMemo(() => pulls.reduce((a, p) => a + sum(p.qtys), 0), [pulls]);
  const landingsToday = useMemo(() => (ships || []).filter((s: any) => s.expected_arrival <= new Date().toISOString().slice(0, 10)).length, [ships]);
  const pullableNow = pulls.filter((p: any) => p.items?.received_at_hpd);

  // With onOpen the plate acts in place (opens its action sheet); without, it
  // links out to the deep surface — same rule as The House.
  const plate = (key: string, eyebrow: string, title: string, meta: string, d: { verb: string; order: string; done: string }, color: string, href: string, go: string, onOpen?: () => void) => {
    const inner = (
      <span className="body">
        <span style={{ display: "block", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)" }}>{eyebrow}</span>
        <span style={{ display: "block", fontSize: "clamp(19px,1.8vw,24px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", lineHeight: 1.05, marginTop: 6, color: color === H.red ? H.red : "#fff" }}>{d.verb}.</span>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", marginTop: 7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        <span style={{ display: "block", fontSize: 10.5, fontFamily: H.mono, color: H.blue, marginTop: 3 }}>{meta}</span>
        <span style={{ display: "block", fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 9, lineHeight: 1.5, maxWidth: "40ch" }}>
          {d.order}.
          <span style={{ display: "block", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: color === H.red ? H.red : H.amber, marginTop: 5 }}>done when {d.done}</span>
        </span>
        <span style={{ display: "inline-block", marginTop: 12, background: "#fff", color: H.ink, borderRadius: 999, padding: "9px 16px", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", width: "max-content" }}>{go} →</span>
      </span>
    );
    return onOpen
      ? <button key={key} type="button" onClick={onOpen} className="ds-plate">{inner}</button>
      : <a key={key} href={href} className="ds-plate">{inner}</a>;
  };

  return (
    <div style={{ background: H.ink, minHeight: "100vh", margin: -24, padding: 24, color: H.text, fontFamily: H.font }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .ds-grid{display:grid;grid-template-columns:1fr;gap:16px}
        @media(min-width:760px){.ds-grid{grid-template-columns:repeat(2,1fr)}}
        @media(min-width:1100px){.ds-grid{grid-template-columns:repeat(3,1fr)}}
        .ds-plate{position:relative;border-radius:8px;overflow:hidden;background:#141414;border:1px solid ${H.line};display:flex;flex-direction:column;justify-content:flex-end;text-decoration:none;color:#fff;transition:transform .16s ease}
        .ds-plate:hover{transform:translateY(-4px)}
        .ds-plate .body{position:relative;padding:18px}
        button.ds-plate{text-align:left;font:inherit;cursor:pointer;width:100%;padding:0}
        button.ds-plate:focus-visible{outline:2px solid #fff;outline-offset:2px}
        .ds-sheet-wrap{position:fixed;inset:0;z-index:220;background:rgba(0,0,0,.66);display:flex;align-items:flex-end;justify-content:center}
        .ds-sheet{background:#161616;border:1px solid rgba(255,255,255,.13);border-radius:16px 16px 0 0;width:100%;max-width:540px;padding:22px 22px 28px;max-height:88vh;overflow:auto}
        @media(min-width:760px){.ds-sheet-wrap{align-items:center;padding:24px}.ds-sheet{border-radius:16px}}
        @media(prefers-reduced-motion:reduce){.ds-plate,.ds-plate:hover{transition:none;transform:none}}
      ` }} />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "26px 0 80px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}>
          Warehouse · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <h1 style={{ fontSize: "clamp(34px,5vw,64px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "6px 0 8px" }}>The distro.</h1>

        {ships === null ? (
          <div style={{ color: H.faint, fontSize: 13, padding: "40px 0" }}>Reading the dock…</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: "clamp(18px,4vw,48px)", flexWrap: "wrap", borderTop: `1px solid ${H.line}`, borderBottom: `1px solid ${H.line}`, padding: "16px 0", margin: "18px 0 0" }}>
              <div><div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, lineHeight: 1, color: landingsToday ? PURPLE : H.text }}>{landingsToday}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>landing today</div></div>
              <div><div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, lineHeight: 1, color: pulls.length ? H.amber : H.text }}>{pulls.length}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>open pulls · {openPullUnits} pcs</div></div>
              <div><div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, lineHeight: 1 }}>{fulfill.length}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>in fulfillment</div></div>
              <div><div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, lineHeight: 1, color: lateLandings.length ? H.red : H.text }}>{lateLandings.length}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>landing late</div></div>
            </div>

            {/* ── LANDING RAIL ── */}
            {(ships || []).length > 0 && (
              <section style={{ marginTop: 34 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
                  <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>Landing.</h2>
                  <span style={{ fontSize: 10.5, color: H.faint }}>what hits the dock, when — receive from here, not from tracking emails</span>
                </div>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                  {(ships || []).map((s: any) => {
                    const today = s.expected_arrival <= new Date().toISOString().slice(0, 10);
                    return (
                      <a key={s.id} href="/receiving2" style={{ textDecoration: "none", color: H.text, borderLeft: `2px solid ${today ? PURPLE : H.line}`, padding: "4px 16px 4px 12px" }}>
                        <div style={{ fontSize: 17, fontWeight: 900, fontFamily: H.mono, color: today ? PURPLE : H.text }}>{today ? "Today" : fmtDate(s.expected_arrival)}</div>
                        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, marginTop: 3 }}>{(s.shipment_lines || []).length} line{(s.shipment_lines || []).length === 1 ? "" : "s"}{(s.shipment_lines || []).some((l: any) => l.received) ? " · partial in" : ""}</div>
                      </a>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── YOUR MOVE ── */}
            <section style={{ marginTop: 36 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: H.amber }}>Your move.</h2>
                <span style={{ fontSize: 10.5, color: H.faint }}>every card tells you what, how, and what done looks like — red means a box is missing</span>
              </div>
              <div className="ds-grid">
                {lateLandings.map((s: any) => {
                  const lines = (s.shipment_lines || []).map((l: any) => l.items).filter(Boolean);
                  const cl = lines[0]?.jobs?.clients?.name || "Inbound";
                  const jn = Array.from(new Set(lines.map((i: any) => i.jobs?.job_number).filter(Boolean))).join(" · ");
                  const state = (s.carrier_status || s.status || "").replace(/_/g, " ");
                  return plate(`land-${s.id}`, cl, jn || "Shipment",
                    `expected ${fmtDate(s.expected_arrival)} · ${state}${s.tracking_number ? ` · ${s.tracking_number}` : " · no tracking on file"}`,
                    HOUSE_EXTRA_DIRECTIVES.landing_late, H.red, "/receiving2", "Chase it",
                    () => setSheet({ kind: "landing", shipment: s, lines }));
                })}
                {pullableNow.map((p: any) => plate(`pull-${p.id}`,
                  `${p.items?.jobs?.clients?.name || p.requested_by_name || "Pull"} · ${p.items?.jobs?.job_number || ""}`,
                  p.items?.name || "Item",
                  `${sum(p.qtys)} pcs — ${Object.entries(p.qtys || {}).map(([k, v]) => `${k} ${v}`).join("  ")}${p.status === "partial" ? " · partially pulled" : ""}`,
                  DISTRO_DIRECTIVES.pull, H.amber, "/receiving2", "Pull it here",
                  () => setSheet({ kind: "pull", pull: p })))}
                {pulls.filter((p: any) => !p.items?.received_at_hpd).map((p: any) => plate(`pullq-${p.id}`,
                  `${p.items?.jobs?.clients?.name || p.requested_by_name || "Pull"} · queued for landing`,
                  p.items?.name || "Item",
                  `${sum(p.qtys)} pcs — pull at receive`,
                  { ...DISTRO_DIRECTIVES.pull, order: "Goods still inbound — this pull fulfills at receive, keep it on the bench" }, H.faint, "/receiving2", "Receiving board"))}
                {fulfill.map((j: any) => {
                  const its = j.items || [];
                  const entered = its.filter((it: any) => it.webstore_entered_at).length;
                  return plate(`ful-${j.id}`,
                    `${j.clients?.name || ""} · ${j.job_number}`,
                    `${entered}/${its.length} entered in Shopify`,
                    j.target_ship_date ? `ship by ${fmtDate(j.target_ship_date)}` : "landed — end of the OpsHub road",
                    DISTRO_DIRECTIVES.fulfill, H.amber, "/staging2", "See what's left",
                    () => setSheet({ kind: "fulfill", job: j }));
                })}
                {lateLandings.length + pulls.length + fulfill.length === 0 && (
                  <div style={{ color: H.dim, fontSize: 13, padding: "10px 0" }}>The dock is clear. Watch the landing rail.</div>
                )}
              </div>
            </section>

            {/* ── THE WIRE (dock edition) ── */}
            {wire.length > 0 && (
              <section style={{ marginTop: 40 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
                  <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>The wire.</h2>
                  <span style={{ fontSize: 10.5, color: H.faint }}>everything that moved through the dock, newest first</span>
                </div>
                <div style={{ borderTop: `1px solid ${H.line}`, maxWidth: 820 }}>
                  {wire.map((w: any, i: number) => (
                    <div key={i} style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "11px 0", borderBottom: `1px solid ${H.line}` }}>
                      <span style={{ fontSize: 10, fontFamily: H.mono, color: H.faint, whiteSpace: "nowrap", width: 74, flexShrink: 0 }}>{wt(w.created_at)}</span>
                      <span style={{ fontSize: 13, lineHeight: 1.5, minWidth: 0 }}>
                        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, marginRight: 8 }}>{w.jobs?.clients?.name || ""}{w.jobs?.job_number ? ` · ${w.jobs.job_number}` : ""}</span>
                        {w.message}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
      {sheet && (
        <DistroActionSheet
          sheet={sheet}
          onClose={() => setSheet(null)}
          onPullDone={(pullId: string) => setPulls(prev => prev.filter((p: any) => p.id !== pullId))}
        />
      )}
    </div>
  );
}

// ── THE ACTION SHEET — act in place, dock edition ──
// Pulls fulfill here (per-size confirm, post-Shopify rule honored), late
// landings chase the vendor from the plate. The fulfillment sheet tells the
// truth about the road: stage goods END at Shopify entry (the staging board
// owns the per-size entry — that's data entry, so it deep-links). Count
// variances live on The House's post-production block, not here.
function DistroActionSheet({ sheet, onClose, onPullDone }: {
  sheet: any; onClose: () => void;
  onPullDone: (pullId: string) => void;
}) {
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [qtys, setQtys] = useState<Record<string, number>>(() =>
    sheet.kind === "pull" ? { ...(sheet.pull.qtys || {}) } : {});
  const [nudge, setNudge] = useState<any>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line
  }, []);

  const eyebrowCss: any = { fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" };
  const labelCss: any = { ...eyebrowCss, color: "rgba(255,255,255,0.7)", marginBottom: 8 };
  const inputCss: any = { background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 8, color: "#fff", fontSize: 14, padding: "10px 12px", fontFamily: H.mono, colorScheme: "dark" };
  const goBtn: any = (on: boolean) => ({ background: on ? "#fff" : "rgba(255,255,255,0.18)", color: on ? H.ink : "rgba(255,255,255,0.5)", border: 0, borderRadius: 999, padding: "11px 20px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: on ? "pointer" : "default", fontFamily: H.font });
  const linkCss: any = { fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", textDecoration: "none" };
  const divider = <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "18px 0" }} />;

  const head = (eyebrow: string, verb: string, meta: string, color: string) => (
    <div style={{ marginBottom: 18 }}>
      <div style={eyebrowCss}>{eyebrow}</div>
      <div style={{ fontSize: 24, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", lineHeight: 1.05, marginTop: 6, color }}>{verb}.</div>
      {meta && <div style={{ fontSize: 10.5, fontFamily: H.mono, color: H.blue, marginTop: 7 }}>{meta}</div>}
    </div>
  );

  // ── pull: fulfill with per-size confirm; post-Shopify items close by rule ──
  async function markPulled() {
    const p = sheet.pull;
    const total = sum(qtys);
    if (!total) return;
    setBusy("pull"); setErr(null);
    try {
      await fulfillPullRequest(supabase, p, {
        fulfilledQtys: qtys,
        itemName: p.items?.name || null,
        currentSampleQtys: p.items?.sample_qtys || {},
      });
      const why = [p.kind !== "sample" ? p.kind : null, p.reason].filter(Boolean).join(" — ");
      logJobActivity(p.job_id, `${p.items?.name || "Item"} — pull fulfilled: ${total} unit${total === 1 ? "" : "s"}${why ? ` (${why})` : ""}`);
      onPullDone(p.id);
      onClose();
    } catch (e: any) { setErr(e.message || "Failed"); setBusy(null); }
  }
  async function closeShopifyPull(mode: "shopify_order" | "shelf_pull") {
    const p = sheet.pull;
    setBusy(mode); setErr(null);
    try {
      await resolvePostShopifyPull(supabase, p, mode, { itemName: p.items?.name || null });
      logJobActivity(p.job_id, `${p.items?.name || "Item"} — pull closed (${mode === "shopify_order" ? "ran as Shopify order" : "shelf pull, Shopify count adjusted"})`);
      onPullDone(p.id);
      onClose();
    } catch (e: any) { setErr(e.message || "Failed"); setBusy(null); }
  }

  // ── vendor nudge (late landings): write/preview/send, recipients shown first ──
  async function nudgePreview(payload: any) {
    setBusy("preview"); setErr(null);
    try {
      const res = await fetch("/api/house/vendor-nudge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, preview: true }) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || "Failed");
      setNudge({ ...b, payload });
    } catch (e: any) { setErr(e.message); }
    setBusy(null);
  }
  async function nudgeSend() {
    setBusy("send"); setErr(null);
    try {
      const res = await fetch("/api/house/vendor-nudge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nudge.payload) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || "Failed");
      setOk(`Sent to ${b.sentTo.join(", ")}`);
    } catch (e: any) { setErr(e.message); }
    setBusy(null);
  }

  return (
    <div className="ds-sheet-wrap" onClick={onClose}>
      <div className="ds-sheet" onClick={e => e.stopPropagation()}>
        {sheet.kind === "pull" && (
          <>
            {head(`${sheet.pull.items?.jobs?.clients?.name || "Pull"} · ${sheet.pull.items?.jobs?.job_number || ""}`,
              DISTRO_DIRECTIVES.pull.verb,
              `${sheet.pull.items?.name || "Item"}${sheet.pull.reason ? ` · ${sheet.pull.reason}` : ""}`, H.amber)}
            {sheet.pull.items?.status === "in_stock" ? (
              <div>
                <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.8)", lineHeight: 1.55, marginBottom: 14 }}>
                  This item is keyed into Shopify, so Shopify owns the count. Execute the pull there, then close it here.
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button style={goBtn(!busy)} disabled={!!busy} onClick={() => closeShopifyPull("shopify_order")}>
                    {busy === "shopify_order" ? "Closing…" : "Ran it as a Shopify order"}
                  </button>
                  <button style={goBtn(!busy)} disabled={!!busy} onClick={() => closeShopifyPull("shelf_pull")}>
                    {busy === "shelf_pull" ? "Closing…" : "Shelf pull — count adjusted"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div style={labelCss}>Confirm what actually left the shelf</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                  {Object.keys(sheet.pull.qtys || {}).map(sz => (
                    <label key={sz} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>{sz}</span>
                      <input type="text" inputMode="numeric" value={qtys[sz] ?? ""}
                        onFocus={e => e.target.select()}
                        onChange={e => setQtys(prev => ({ ...prev, [sz]: Number(e.target.value.replace(/\D/g, "")) || 0 }))}
                        style={{ ...inputCss, width: 58, textAlign: "center" }} />
                    </label>
                  ))}
                </div>
                <button style={goBtn(sum(qtys) > 0 && busy !== "pull")} disabled={!sum(qtys) || busy === "pull"} onClick={markPulled}>
                  {busy === "pull" ? "Logging…" : `Mark pulled · ${sum(qtys)} pcs`}
                </button>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 7 }}>Creates the held bucket and deducts from the forwardable balance — the client sees it fulfilled.</div>
              </div>
            )}
            {divider}
            <a href="/receiving2" style={linkCss}>Open the receiving board →</a>
          </>
        )}
        {sheet.kind === "landing" && (
          <>
            {head(`${sheet.lines[0]?.jobs?.clients?.name || "Inbound"} · landing late`,
              HOUSE_EXTRA_DIRECTIVES.landing_late.verb,
              `expected ${fmtDate(sheet.shipment.expected_arrival)}${sheet.shipment.tracking_number ? ` · ${[sheet.shipment.carrier, sheet.shipment.tracking_number].filter(Boolean).join(" ")}` : " · no tracking on file"}`, H.red)}
            <div style={labelCss}>Email the vendor — where is it</div>
            {ok ? (
              <div style={{ fontSize: 13, color: H.green, fontWeight: 700 }}>✓ {ok} — it's on the wire.</div>
            ) : !nudge ? (
              <button style={goBtn(busy !== "preview")} disabled={busy === "preview"} onClick={() => nudgePreview({ shipmentId: sheet.shipment.id })}>
                {busy === "preview" ? "Writing it…" : "Write the nudge"}
              </button>
            ) : (
              <div>
                <div style={{ fontSize: 11, fontFamily: H.mono, color: "rgba(255,255,255,0.65)", marginBottom: 8 }}>
                  to {nudge.recipients.map((r: any) => r.email).join(", ")}
                </div>
                <pre style={{ whiteSpace: "pre-wrap", background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: 12, fontSize: 11.5, lineHeight: 1.55, color: "rgba(255,255,255,0.85)", fontFamily: H.mono, maxHeight: 220, overflow: "auto", margin: "0 0 12px" }}>{nudge.body}</pre>
                <button style={goBtn(busy !== "send")} disabled={busy === "send"} onClick={nudgeSend}>
                  {busy === "send" ? "Sending…" : "Send it"}
                </button>
              </div>
            )}
            {divider}
            <a href="/receiving2" style={linkCss}>Open receiving →</a>
          </>
        )}
        {sheet.kind === "fulfill" && (() => {
          const its = sheet.job.items || [];
          const entered = its.filter((it: any) => it.webstore_entered_at).length;
          return (
            <>
              {head(`${sheet.job.clients?.name || ""} · ${sheet.job.job_number}`,
                DISTRO_DIRECTIVES.fulfill.verb,
                `${entered}/${its.length} entered in Shopify`, H.amber)}
              <div style={{ marginBottom: 16 }}>
                {its.map((it: any) => (
                  <div key={it.id} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: it.webstore_entered_at ? H.green : H.amber, flexShrink: 0 }}>
                      {it.webstore_entered_at ? "✓ entered" : "awaiting entry"}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.55, marginBottom: 14 }}>
                Counts go in per size on the staging board. Once the last item is entered, Shopify + ShipStation own the web orders and labels — the job completes itself.
              </div>
              <a href="/staging2" style={{ ...goBtn(true), display: "inline-block", textDecoration: "none" }}>Open the staging board →</a>
            </>
          );
        })()}
        {err && <div style={{ marginTop: 14, fontSize: 12, color: H.red, fontWeight: 700 }}>{err}</div>}
      </div>
    </div>
  );
}
