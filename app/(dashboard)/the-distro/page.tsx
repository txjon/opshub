"use client";
// THE DISTRO — the warehouse's front door, House-style (Jul 21 2026).
// Who needs what, when: the receiver sees today's landings and open pulls;
// fulfillment sees what's staged to move; variances surface themselves in
// red. Every plate is a directive — what, how, done-when — so the surface
// trains the team. Legacy /distro, /receiving2, /warehouse stay for depth.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { H } from "@/components/hub/theme";
import { DISTRO_DIRECTIVES } from "@/lib/directives";
import { fulfillPullRequest, resolvePostShopifyPull } from "@/lib/handoff";
import { FULFILLMENT_STAGES } from "@/lib/use-warehouse";
import { recalcJobPhase } from "@/lib/job-phase-recalc";
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
  const [variances, setVariances] = useState<any[]>([]);
  const [wire, setWire] = useState<any[]>([]);
  // act-in-place: tapping a plate opens its action sheet instead of leaving
  const [sheet, setSheet] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const today = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const [{ data: sh }, { data: pr }, { data: fj }, { data: act }] = await Promise.all([
        supabase.from("shipments").select("id, expected_arrival, status, source, shipment_lines(item_id, received)").gte("expected_arrival", today).order("expected_arrival").limit(12),
        supabase.from("pull_requests").select("id, item_id, job_id, kind, qtys, reason, status, requested_by_name, created_at, items(id, name, status, sample_qtys, received_at_hpd, jobs(job_number, clients(name)))").in("status", ["pending", "partial"]).order("created_at").limit(20),
        supabase.from("jobs").select("id, job_number, fulfillment_status, fulfillment_tracking, target_ship_date, clients(name), items(id)").eq("phase", "fulfillment"),
        supabase.from("job_activity").select("message, created_at, jobs(job_number, clients(name))").order("created_at", { ascending: false }).limit(40),
      ]);
      setShips(sh || []); setPulls(pr || []); setFulfill(fj || []);
      setWire((act || []).filter((a: any) => /receiv|ship|forward|pull|land|deliver/i.test(a.message)).slice(0, 12));
      // variance: recently-received items whose received != shipped
      const { data: recv } = await supabase.from("items")
        .select("id, name, ship_qtys, received_qtys, received_at_hpd_at, variance_resolved, jobs!inner(id, job_number, phase, clients(name))")
        .eq("received_at_hpd", true)
        .not("jobs.phase", "in", "(complete,cancelled)")
        .order("received_at_hpd_at", { ascending: false }).limit(60);
      setVariances((recv || []).filter((it: any) => {
        const s = sum(it.ship_qtys), r = sum(it.received_qtys);
        if (!(s > 0 && r > 0 && r !== s)) return false;
        // resolved only while the snapshot still matches the live counts — a
        // later correction invalidates the dismissal and the card resurfaces
        const vr = it.variance_resolved;
        if (vr && Number(vr.ship_total) === s && Number(vr.recv_total) === r) return false;
        return true;
      }).slice(0, 6));
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
        <span style={{ display: "block", fontSize: 10.5, fontFamily: H.mono, color: "rgba(255,255,255,0.65)", marginTop: 3 }}>{meta}</span>
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
              <div><div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, lineHeight: 1, color: variances.length ? H.red : H.text }}>{variances.length}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>counts off</div></div>
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
                <span style={{ fontSize: 10.5, color: H.faint }}>every card tells you what, how, and what done looks like — red means the count's off</span>
              </div>
              <div className="ds-grid">
                {variances.map((it: any) => plate(`var-${it.id}`,
                  `${it.jobs?.clients?.name || ""} · ${it.jobs?.job_number || ""}`, it.name,
                  `shipped ${sum(it.ship_qtys)} · received ${sum(it.received_qtys)}`,
                  DISTRO_DIRECTIVES.variance, H.red, "/receiving2", "Handle it",
                  () => setSheet({ kind: "variance", item: it })))}
                {pullableNow.map((p: any) => plate(`pull-${p.id}`,
                  `${p.items?.jobs?.clients?.name || p.requested_by_name || "Pull"} · ${p.items?.jobs?.job_number || ""}`,
                  p.items?.name || "Item",
                  `${sum(p.qtys)} pcs — ${Object.entries(p.qtys || {}).map(([k, v]) => `${k} ${v}`).join("  ")}${p.status === "partial" ? " · partially pulled" : ""}`,
                  DISTRO_DIRECTIVES.pull, H.amber, "/warehouse", "Pull it here",
                  () => setSheet({ kind: "pull", pull: p })))}
                {pulls.filter((p: any) => !p.items?.received_at_hpd).map((p: any) => plate(`pullq-${p.id}`,
                  `${p.items?.jobs?.clients?.name || p.requested_by_name || "Pull"} · queued for landing`,
                  p.items?.name || "Item",
                  `${sum(p.qtys)} pcs — pull at receive`,
                  { ...DISTRO_DIRECTIVES.pull, order: "Goods still inbound — this pull fulfills at receive, keep it on the bench" }, H.faint, "/warehouse", "Pulls queue"))}
                {fulfill.map((j: any) => plate(`ful-${j.id}`,
                  `${j.clients?.name || ""} · ${j.job_number}`,
                  j.fulfillment_status ? `status: ${j.fulfillment_status}` : `${(j.items || []).length} items staged`,
                  j.target_ship_date ? `ship by ${fmtDate(j.target_ship_date)}` : "no ship date set",
                  DISTRO_DIRECTIVES.fulfill, H.amber, "/warehouse", "Move it along",
                  () => setSheet({ kind: "fulfill", job: j })))}
                {variances.length + pulls.length + fulfill.length === 0 && (
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
          onVarianceResolved={(itemId: string) => setVariances(prev => prev.filter((it: any) => it.id !== itemId))}
          onFulfillUpdated={(jobId: string, status: string) =>
            setFulfill(prev => status === "shipped"
              ? prev.filter((j: any) => j.id !== jobId)
              : prev.map((j: any) => j.id === jobId ? { ...j, fulfillment_status: status } : j))}
        />
      )}
    </div>
  );
}

// ── THE ACTION SHEET — act in place, dock edition ──
// Pulls fulfill here (per-size confirm, post-Shopify rule honored), variances
// flag the vendor with the counts written for you, fulfillment advances
// staged → packing → shipped with tracking at the door. Deep links survive
// at the bottom for the full warehouse surfaces.
function DistroActionSheet({ sheet, onClose, onPullDone, onFulfillUpdated, onVarianceResolved }: {
  sheet: any; onClose: () => void;
  onPullDone: (pullId: string) => void;
  onFulfillUpdated: (jobId: string, status: string) => void;
  onVarianceResolved: (itemId: string) => void;
}) {
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [qtys, setQtys] = useState<Record<string, number>>(() =>
    sheet.kind === "pull" ? { ...(sheet.pull.qtys || {}) } : {});
  const [tracking, setTracking] = useState<string>(sheet.kind === "fulfill" ? sheet.job.fulfillment_tracking || "" : "");
  const [nudge, setNudge] = useState<any>(null);
  const [resolveNote, setResolveNote] = useState("");

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
      {meta && <div style={{ fontSize: 10.5, fontFamily: H.mono, color: "rgba(255,255,255,0.65)", marginTop: 7 }}>{meta}</div>}
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

  // ── variance: email the vendor with the counts written for you ──
  async function nudgePreview() {
    setBusy("preview"); setErr(null);
    try {
      const res = await fetch("/api/house/vendor-nudge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: sheet.item.id, preview: true }) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || "Failed");
      setNudge(b);
    } catch (e: any) { setErr(e.message); }
    setBusy(null);
  }
  async function nudgeSend() {
    setBusy("send"); setErr(null);
    try {
      const res = await fetch("/api/house/vendor-nudge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: sheet.item.id }) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || "Failed");
      setOk(`Sent to ${b.sentTo.join(", ")}`);
    } catch (e: any) { setErr(e.message); }
    setBusy(null);
  }

  // ── variance: mark resolved — snapshots the counts so a later correction
  //    invalidates the dismissal and the card resurfaces on its own ──
  async function markResolved() {
    const it = sheet.item;
    setBusy("resolve"); setErr(null);
    try {
      const { data: { user } = { user: null } } = await supabase.auth.getUser();
      const shipT = sum(it.ship_qtys), recvT = sum(it.received_qtys);
      const { error } = await (supabase.from("items") as any).update({
        variance_resolved: {
          at: new Date().toISOString(), by: user?.email || null,
          note: resolveNote.trim() || null, ship_total: shipT, recv_total: recvT,
        },
      }).eq("id", it.id);
      if (error) throw new Error(error.message);
      logJobActivity(it.jobs?.id, `${it.name} — count variance resolved (shipped ${shipT} vs received ${recvT})${resolveNote.trim() ? `: ${resolveNote.trim()}` : ""}`);
      onVarianceResolved(it.id);
      onClose();
    } catch (e: any) { setErr(e.message || "Failed"); setBusy(null); }
  }

  // ── fulfillment: staged → packing → shipped, tracking at the door ──
  async function advanceFulfillment(status: string) {
    const j = sheet.job;
    setBusy(status); setErr(null);
    try {
      const updates: any = { fulfillment_status: status };
      if (status === "shipped") updates.fulfillment_tracking = tracking.trim() || null;
      const { error } = await (supabase.from("jobs") as any).update(updates).eq("id", j.id);
      if (error) throw new Error(error.message);
      if (status === "shipped") logJobActivity(j.id, "Fulfillment complete — order shipped to client");
      else logJobActivity(j.id, `Fulfillment moved to ${status}`);
      await recalcJobPhase(supabase, j.id);
      onFulfillUpdated(j.id, status);
      onClose();
    } catch (e: any) { setErr(e.message || "Failed"); setBusy(null); }
  }

  const curIdx = sheet.kind === "fulfill" ? FULFILLMENT_STAGES.findIndex(s => s.id === sheet.job.fulfillment_status) : -1;
  const nextStage = sheet.kind === "fulfill" ? FULFILLMENT_STAGES[curIdx + 1] || null : null;

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
            <a href="/warehouse" style={linkCss}>Open the pulls queue →</a>
          </>
        )}
        {sheet.kind === "variance" && (
          <>
            {head(`${sheet.item.jobs?.clients?.name || ""} · ${sheet.item.jobs?.job_number || ""}`,
              DISTRO_DIRECTIVES.variance.verb,
              `${sheet.item.name} · shipped ${sum(sheet.item.ship_qtys)} vs received ${sum(sheet.item.received_qtys)}`, H.red)}
            <div style={{ marginBottom: 16 }}>
              <div style={labelCss}>Size by size</div>
              {Array.from(new Set([...Object.keys(sheet.item.ship_qtys || {}), ...Object.keys(sheet.item.received_qtys || {})])).map(sz => {
                const s = Number((sheet.item.ship_qtys || {})[sz]) || 0;
                const r = Number((sheet.item.received_qtys || {})[sz]) || 0;
                return (
                  <div key={sz} style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                    <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", width: 44 }}>{sz}</span>
                    <span style={{ fontSize: 11.5, fontFamily: H.mono, color: "rgba(255,255,255,0.65)" }}>shipped {s}</span>
                    <span style={{ fontSize: 11.5, fontFamily: H.mono, color: s !== r ? H.red : "rgba(255,255,255,0.65)", fontWeight: s !== r ? 800 : 400 }}>received {r}</span>
                  </div>
                );
              })}
            </div>
            <div style={labelCss}>Recounted and it still doesn't match? Flag the vendor</div>
            {ok ? (
              <div style={{ fontSize: 13, color: H.green, fontWeight: 700 }}>✓ {ok} — it's on the wire.</div>
            ) : !nudge ? (
              <button style={goBtn(busy !== "preview")} disabled={busy === "preview"} onClick={nudgePreview}>
                {busy === "preview" ? "Writing it…" : "Write the vendor email"}
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
            <div style={labelCss}>Settled? Resolve it — the card comes back on its own if the counts change again</div>
            <input type="text" value={resolveNote} onChange={e => setResolveNote(e.target.value)}
              placeholder="How it settled — 'vendor shorted 2, credited on PO'…"
              style={{ ...inputCss, width: "100%", boxSizing: "border-box", fontFamily: H.font, marginBottom: 12 }} />
            <button style={goBtn(busy !== "resolve")} disabled={busy === "resolve"} onClick={markResolved}>
              {busy === "resolve" ? "Resolving…" : "Mark resolved"}
            </button>
            {divider}
            <a href="/receiving2" style={linkCss}>Open receiving to recount →</a>
          </>
        )}
        {sheet.kind === "fulfill" && (
          <>
            {head(`${sheet.job.clients?.name || ""} · ${sheet.job.job_number}`,
              DISTRO_DIRECTIVES.fulfill.verb,
              `now: ${sheet.job.fulfillment_status || "staged"}${sheet.job.target_ship_date ? ` · ship by ${fmtDate(sheet.job.target_ship_date)}` : ""}`, H.amber)}
            {nextStage ? (
              <div>
                {nextStage.id === "shipped" && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={labelCss}>Outbound tracking</div>
                    <input type="text" value={tracking} onChange={e => setTracking(e.target.value)}
                      placeholder="Tracking number…" style={{ ...inputCss, width: "100%", boxSizing: "border-box" }} />
                  </div>
                )}
                <button style={goBtn(!busy && (nextStage.id !== "shipped" || !!tracking.trim()))}
                  disabled={!!busy || (nextStage.id === "shipped" && !tracking.trim())}
                  onClick={() => advanceFulfillment(nextStage.id)}>
                  {busy ? "Moving…" : nextStage.id === "shipped" ? "Mark shipped" : `Move to ${nextStage.label}`}
                </button>
                {nextStage.id === "shipped" && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 7 }}>Shipping completes the job on its own.</div>}
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.7)" }}>Already shipped — nothing left to move.</div>
            )}
            {divider}
            <a href="/warehouse" style={linkCss}>Open fulfillment →</a>
          </>
        )}
        {err && <div style={{ marginTop: 14, fontSize: 12, color: H.red, fontWeight: 700 }}>{err}</div>}
      </div>
    </div>
  );
}
