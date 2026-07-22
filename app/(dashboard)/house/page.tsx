"use client";
// THE HOUSE — the command center rebuilt the client-hub way (Jul 21 2026).
// One feed, magazine-dark, verbs first: what needs this building (from job
// phases, drops, and the studio), what's with clients, what's landing, and
// the wire of client actions. Replaces the old dashboard's KPI-grid idea
// with the hub's presentation — art carries, data captions.
// Legacy /dashboard stays reachable during the transition.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { H } from "@/components/hub/theme";
import { JOB_DIRECTIVES, DROP_DIRECTIVES, STUDIO_DIRECTIVE, HOUSE_EXTRA_DIRECTIVES } from "@/lib/directives";
import { logJobActivity } from "@/components/JobActivityPanel";

const PURPLE = "#fd3aa3";
const thumbSrc = (id: string, size = 300) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
const fmtDate = (iso?: string | null) => iso ? new Date(iso + (iso.includes("T") ? "" : "T00:00")).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
const wt = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString("en-US", { weekday: "short" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", ""); };
const daysSince = (iso?: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;

// Job phase → the operator verb + whose move (same model as the concept mock)
const PHASE_VERB: Record<string, { verb: string; go: string; side: "us" | "them" | "run" }> = {
  intake: { verb: "Cost & quote it", go: "Open costing", side: "us" },
  pending: { verb: "With the client", go: "Nudge", side: "them" },
  ready: { verb: "Order blanks · send POs", go: "Open job", side: "us" },
  production: { verb: "At the presses", go: "", side: "run" },
  shipping: { verb: "Shipping", go: "", side: "run" },
  receiving: { verb: "Landing — receive it", go: "Receiving", side: "us" },
  fulfillment: { verb: "Key it into Shopify", go: "Open job", side: "us" },
};

export default function HousePage() {
  const supabase = createClient();
  const [jobs, setJobs] = useState<any[] | null>(null);
  const [drops, setDrops] = useState<any[]>([]);
  const [briefs, setBriefs] = useState<any[]>([]);
  const [wire, setWire] = useState<any[]>([]);
  const [arrivals, setArrivals] = useState<any[]>([]);
  const [jobArt, setJobArt] = useState<Record<string, string>>({});
  const [overduePay, setOverduePay] = useState<any[]>([]);
  const [openPulls, setOpenPulls] = useState(0);
  const [lateLandings, setLateLandings] = useState<any[]>([]);
  // act-in-place: tapping a plate opens its action sheet instead of leaving
  const [sheet, setSheet] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const todayStr = new Date().toISOString().slice(0, 10);
      const [{ data: j }, { data: r }, { data: act }, { data: ships }, { data: latePay }, { count: pullCount }, { data: lateShips }] = await Promise.all([
        supabase.from("jobs")
          .select("id, job_number, title, phase, target_ship_date, created_at, updated_at, phase_timestamps, type_meta, clients(name), items(id, pipeline_stage, pipeline_timestamps, buy_sheet_lines(qty_ordered))")
          .not("phase", "in", "(complete,cancelled,on_hold)"),
        supabase.from("releases").select("*, clients(name)").not("status", "in", "(cut,shelved)"),
        supabase.from("job_activity").select("message, created_at, jobs(job_number, clients(name))").order("created_at", { ascending: false }).limit(16),
        supabase.from("shipments").select("id, expected_arrival, status, shipment_lines(item_id)").gte("expected_arrival", new Date(Date.now() - 86400000).toISOString().slice(0, 10)).order("expected_arrival").limit(8),
        supabase.from("payment_records").select("id, job_id, amount, status, due_date, invoice_number, jobs!inner(id, job_number, title, phase, type_meta, clients(name))").in("status", ["sent", "viewed", "partial", "overdue"]).lt("due_date", new Date().toISOString().slice(0, 10)).not("jobs.phase", "eq", "cancelled").limit(8),
        supabase.from("pull_requests").select("id", { count: "exact", head: true }).in("status", ["pending", "partial"]),
        // late landings: expected date passed, still not delivered — "where is it"
        supabase.from("shipments")
          .select("id, expected_arrival, status, carrier, tracking_number, carrier_status, shipment_lines(item_id, items(name, jobs(job_number, clients(name))))")
          .lt("expected_arrival", todayStr).in("status", ["pending", "in_transit", "exception"])
          .order("expected_arrival").limit(6),
      ]);
      setJobs(j || []); setDrops(r || []); setWire(act || []); setArrivals(ships || []);
      setOverduePay(latePay || []); setOpenPulls(pullCount || 0); setLateLandings(lateShips || []);
      try {
        const res = await fetch("/api/art-briefs");
        const body = await res.json();
        setBriefs((body.briefs || []).filter((b: any) => !b.client_aborted_at));
      } catch {}
      // hero art for the action jobs (bounded)
      const actionJobs: any[] = ((j || []) as any[]).filter((x: any) => (PHASE_VERB[x.phase] || {}).side === "us" || x.phase === "production").slice(0, 28);
      const itemIds = actionJobs.flatMap((x: any) => (x.items || []).map((i: any) => i.id));
      if (itemIds.length) {
        const { data: files } = await supabase.from("item_files")
          .select("item_id, drive_file_id, mime_type, created_at")
          .in("item_id", itemIds).eq("stage", "mockup").is("superseded_at", null)
          .order("created_at", { ascending: false });
        const byItem: Record<string, string> = {};
        for (const f of (files || []) as any[]) {
          if (byItem[f.item_id] || /pdf/i.test(f.mime_type || "")) continue;
          byItem[f.item_id] = f.drive_file_id;
        }
        const art: Record<string, string> = {};
        for (const x of actionJobs) for (const i of (x.items || [])) { if (!art[x.id] && byItem[i.id]) art[x.id] = byItem[i.id]; }
        setJobArt(art);
      }
    })();
    // eslint-disable-next-line
  }, []);

  const model = useMemo(() => {
    const J = jobs || [];
    const ourJobs = J.filter((x: any) => (PHASE_VERB[x.phase] || {}).side === "us")
      .sort((a: any, b: any) => (a.target_ship_date || "9999").localeCompare(b.target_ship_date || "9999"));
    const theirJobs = J.filter((x: any) => (PHASE_VERB[x.phase] || {}).side === "them");
    const press = J.flatMap((x: any) => x.items || []).filter((i: any) => i.pipeline_stage === "in_production")
      .reduce((a: number, i: any) => a + (i.buy_sheet_lines || []).reduce((s: number, l: any) => s + (Number(l.qty_ordered) || 0), 0), 0);
    // drops calls
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const dropCalls = drops.filter((r: any) => {
      if (r.status === "ready" || r.status === "closed") return true;
      if (r.status === "live" && r.window_close_date && r.window_close_date <= soon) return true;
      return false;
    });
    // Vendor risk, timed off the REAL promises: the PO ship-by chips
    // (po_ship_live > po_ship_dates), falling back to target ship date
    // minus a transit buffer when no promise exists. Late = passed (red);
    // confirm = within 3 days and still on press (amber).
    const soonV = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const vendorRisk = J.filter((x: any) => x.phase === "production" && (x.items || []).some((i: any) => i.pipeline_stage === "in_production"))
      .map((x: any) => {
        const tm = (x.type_meta || {}) as any;
        // real dates only (an ASAP chip is not a promise we can time against)
        const dated: [string, string][] = ([
          ...Object.entries(tm.po_ship_live || {}).map(([k, v]: any) => [k, v?.date]),
          ...Object.entries(tm.po_ship_dates || {}),
        ] as [string, string][]).filter(([, d]) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")));
        dated.sort((a, b) => a[1].localeCompare(b[1]));
        const promise = dated[0]?.[1] || null;
        // the vendor key the ship-by write attaches to (Board's poShipKey rule)
        const vendorKey = dated[0]?.[0]
          || Object.keys(tm.po_ship_dates || {})[0] || Object.keys(tm.po_ship_live || {})[0] || null;
        const fallback = x.target_ship_date
          ? new Date(new Date(x.target_ship_date + "T00:00").getTime() - 7 * 86400000).toISOString().slice(0, 10)
          : null;
        const due = promise || fallback;
        if (!due) return null;
        if (due < today) return { job: x, due, level: "late", promised: !!promise, vendorKey };
        if (due <= soonV) return { job: x, due, level: "confirm", promised: !!promise, vendorKey };
        return null;
      }).filter(Boolean) as any[];
    // studio calls: new ideas + unanswered client words (same rule as studio2)
    const studioCalls = briefs.filter((b: any) => {
      const clientAt = b.last_client_activity?.at || "";
      const hpdAt = [b.last_hpd_activity?.at || "", b.hpd_last_seen_at || ""].sort().pop() || "";
      return b.state === "draft" || (!!clientAt && clientAt > hpdAt);
    });
    const overdue = ourJobs.filter((x: any) => x.target_ship_date && x.target_ship_date < new Date().toISOString().slice(0, 10));
    return { ourJobs, theirJobs, press, dropCalls, studioCalls, overdue, vendorRisk };
  }, [jobs, drops, briefs]);

  // A magazine plate: the work's art is the cover; the directive is the
  // headline written ON it. Actions as education — what, how, done-when.
  // With onOpen the plate acts in place (opens its action sheet); without,
  // it links out to the deep surface.
  const card = (key: string, art: string | null, eyebrow: string, title: string, meta: string, verb: string, verbColor: string, href: string, go: string, directive?: { order: string; done: string }, onOpen?: () => void) => {
    const inner = (
      <>
        {art && <img src={art.replace("size=300", "size=600")} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e: any) => { e.target.style.display = "none"; }} />}
        <span className="veil" />
        <span className="body">
          <span style={{ display: "block", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.65)" }}>{eyebrow} · {title}</span>
          <span style={{ display: "block", fontSize: "clamp(20px,2vw,26px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", lineHeight: 1.05, marginTop: 6, color: verbColor === H.red ? H.red : "#fff", textWrap: "balance" as any }}>{verb}.</span>
          <span style={{ display: "block", fontSize: 10.5, fontFamily: H.mono, color: "rgba(255,255,255,0.7)", marginTop: 7 }}>{meta}</span>
          {directive && (
            <span style={{ display: "block", fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 9, lineHeight: 1.5, maxWidth: "38ch" }}>
              {directive.order}.
              <span style={{ display: "block", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: verbColor === H.red ? H.red : H.amber, marginTop: 5 }}>done when {directive.done}</span>
            </span>
          )}
          {go && <span style={{ display: "inline-block", marginTop: 12, background: "#fff", color: H.ink, borderRadius: 999, padding: "10px 18px", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", width: "max-content" }}>{go} →</span>}
        </span>
      </>
    );
    return onOpen
      ? <button key={key} type="button" onClick={onOpen} className="hs-plate">{inner}</button>
      : <a key={key} href={href} className="hs-plate">{inner}</a>;
  };

  return (
    <div style={{ background: H.ink, minHeight: "100vh", margin: -24, padding: 24, color: H.text, fontFamily: H.font }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .hs-grid{display:grid;grid-template-columns:1fr;gap:16px}
        @media(min-width:760px){.hs-grid{grid-template-columns:repeat(2,1fr)}}
        @media(min-width:1100px){.hs-grid{grid-template-columns:repeat(3,1fr)}}
        .hs-plate{position:relative;border-radius:8px;overflow:hidden;background:#141414;min-height:280px;display:flex;flex-direction:column;justify-content:flex-end;text-decoration:none;color:#fff;transition:transform .16s ease}
        .hs-plate:hover{transform:translateY(-4px)}
        .hs-plate img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.92}
        .hs-plate .veil{position:absolute;inset:0;background:linear-gradient(178deg,rgba(0,0,0,.1) 18%,rgba(0,0,0,.92) 74%)}
        .hs-plate .body{position:relative;padding:18px}
        button.hs-plate{text-align:left;border:0;padding:0;font:inherit;cursor:pointer;width:100%}
        button.hs-plate:focus-visible{outline:2px solid #fff;outline-offset:2px}
        .hs-sheet-wrap{position:fixed;inset:0;z-index:220;background:rgba(0,0,0,.66);display:flex;align-items:flex-end;justify-content:center}
        .hs-sheet{background:#161616;border:1px solid rgba(255,255,255,.13);border-radius:16px 16px 0 0;width:100%;max-width:540px;padding:22px 22px 28px;max-height:88vh;overflow:auto}
        @media(min-width:760px){.hs-sheet-wrap{align-items:center;padding:24px}.hs-sheet{border-radius:16px}}
        @media(prefers-reduced-motion:reduce){.hs-plate,.hs-plate:hover{transition:none;transform:none}}
      ` }} />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "26px 0 80px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <h1 style={{ fontSize: "clamp(34px,5vw,64px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "6px 0 8px" }}>The house.</h1>

        {jobs === null ? (
          <div style={{ color: H.faint, fontSize: 13, padding: "40px 0" }}>Reading the building…</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: "clamp(18px,4vw,48px)", flexWrap: "wrap", borderTop: `1px solid ${H.line}`, borderBottom: `1px solid ${H.line}`, padding: "16px 0", margin: "18px 0 0" }}>
              <div><div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, lineHeight: 1, color: H.amber }}>{model.ourJobs.length + model.dropCalls.length + model.studioCalls.length}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>your move</div></div>
              <div><div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, lineHeight: 1, color: PURPLE }}>{model.theirJobs.length}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>with clients</div></div>
              <div><div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, lineHeight: 1 }}>{model.press.toLocaleString()}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>on presses</div></div>
              <div><div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, lineHeight: 1, color: model.overdue.length ? H.red : H.text }}>{model.overdue.length}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>past ship date</div></div>
              <a href="/the-distro" style={{ textDecoration: "none" }}><div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, lineHeight: 1, color: openPulls ? H.amber : H.text }}>{openPulls}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>open pulls → distro</div></a>
            </div>

            {/* ── YOUR MOVE ── */}
            <section style={{ marginTop: 36 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: H.amber }}>Your move.</h2>
                <span style={{ fontSize: 10.5, color: H.faint }}>every card tells you what, how, and what done looks like — soonest ship first, red means late</span>
              </div>
              <div className="hs-grid">
                {model.dropCalls.map((r: any) => {
                  const today2 = new Date().toISOString().slice(0, 10);
                  const ended = r.status === "live" && r.window_close_date && r.window_close_date <= today2;
                  const closingSoon = r.status === "live" && !ended;
                  const launchOnly = r.model === "stock";
                  const d = ended ? DROP_DIRECTIVES.window_ended
                    : closingSoon ? HOUSE_EXTRA_DIRECTIVES.closing_soon
                    : r.status === "closed" ? DROP_DIRECTIVES.closed
                    : launchOnly ? DROP_DIRECTIVES.ready_launch : DROP_DIRECTIVES.ready_cost;
                  return card(`drop-${r.id}`, null, r.clients?.name || "Drop", r.title,
                    r.target_live_date ? `target live ${fmtDate(r.target_live_date)}` : "release",
                    d.verb, ended ? H.red : H.amber, "/drops", ended ? "Close it here" : "Drops board", d,
                    ended ? () => setSheet({ kind: "drop_close", release: r }) : undefined);
                })}
                {model.studioCalls.slice(0, 5).map((b: any) => {
                  const bt = (b.thumbs || []).find((x: any) => x.preview_drive_file_id || x.drive_file_id);
                  const bArt = bt ? thumbSrc(bt.preview_drive_file_id || bt.drive_file_id) : null;
                  return card(`brief-${b.id}`, bArt, b.clients?.name || "Studio", b.title || "New idea",
                    b.state === "draft" ? "new idea from the hub" : "client words waiting",
                    STUDIO_DIRECTIVE.verb, H.amber, `/studio2?open=${b.id}`, "Answer here", STUDIO_DIRECTIVE,
                    () => setSheet({ kind: "studio", brief: b, art: bArt }));
                })}
                {model.vendorRisk.slice(0, 5).map(({ job: x, due, level, promised, vendorKey }: any) => {
                  const d = level === "late" ? HOUSE_EXTRA_DIRECTIVES.vendor_late : HOUSE_EXTRA_DIRECTIVES.vendor_confirm;
                  const meta = promised ? `vendor promised ${fmtDate(due)}` : `needs to move by ${fmtDate(due)} to make the ship date`;
                  return card(`vr-${x.id}`, jobArt[x.id] ? thumbSrc(jobArt[x.id]) : null,
                    x.clients?.name || "—", (x.type_meta as any)?.qb_invoice_number ? `#${(x.type_meta as any).qb_invoice_number}` : x.job_number,
                    meta, d.verb, level === "late" ? H.red : H.amber, `/jobs/${x.id}`, "Handle it", d,
                    () => setSheet({ kind: "vendor", job: x, due, level, promised, vendorKey, meta, directive: d }));
                })}
                {lateLandings.map((s: any) => {
                  const lines = (s.shipment_lines || []).map((l: any) => l.items).filter(Boolean);
                  const cl = lines[0]?.jobs?.clients?.name || "Inbound";
                  const jn = Array.from(new Set(lines.map((i: any) => i.jobs?.job_number).filter(Boolean))).join(" · ");
                  const state = (s.carrier_status || s.status || "").replace(/_/g, " ");
                  return card(`land-${s.id}`, null, cl, jn || "Shipment",
                    `expected ${fmtDate(s.expected_arrival)} · ${state}${s.tracking_number ? ` · ${s.tracking_number}` : " · no tracking on file"}`,
                    HOUSE_EXTRA_DIRECTIVES.landing_late.verb, H.red, "/receiving2", "Chase it",
                    HOUSE_EXTRA_DIRECTIVES.landing_late,
                    () => setSheet({ kind: "landing", shipment: s, lines }));
                })}
                {overduePay.slice(0, 4).map((p: any) => {
                  const daysLate = daysSince(p.due_date + "T00:00");
                  return card(`pay-${p.id}`, null,
                    p.jobs?.clients?.name || "—", p.invoice_number ? `Invoice #${p.invoice_number}` : p.jobs?.job_number,
                    `$${Number(p.amount).toLocaleString()} · due ${fmtDate(p.due_date)}${daysLate ? ` · ${daysLate}d late` : ""}`,
                    HOUSE_EXTRA_DIRECTIVES.overdue_payment.verb, H.red, `/jobs/${p.jobs?.id || p.job_id}`, "Collect it here", HOUSE_EXTRA_DIRECTIVES.overdue_payment,
                    () => setSheet({ kind: "payment", pay: p }));
                })}
                {model.ourJobs.slice(0, 12).map((x: any) => {
                  const v = PHASE_VERB[x.phase];
                  const late = x.target_ship_date && x.target_ship_date < new Date().toISOString().slice(0, 10);
                  const ref = (x.type_meta as any)?.qb_invoice_number ? `#${(x.type_meta as any).qb_invoice_number}` : x.job_number;
                  const units = (x.items || []).reduce((a: number, i: any) => a + (i.buy_sheet_lines || []).reduce((s: number, l: any) => s + (Number(l.qty_ordered) || 0), 0), 0);
                  const dd = JOB_DIRECTIVES[x.phase];
                  return card(`job-${x.id}`, jobArt[x.id] ? thumbSrc(jobArt[x.id]) : null,
                    x.clients?.name || "—", ref,
                    `${units.toLocaleString()} pcs${x.target_ship_date ? ` · ship ${fmtDate(x.target_ship_date)}` : ""}${(x.type_meta as any)?.source === "client_portal_cart" ? " · CLIENT-BUILT" : ""}`,
                    late ? `${dd.verb} · LATE` : dd.verb, late ? H.red : H.amber,
                    `/jobs/${x.id}`, v.go || "Open", dd);
                })}
                {model.ourJobs.length + model.dropCalls.length + model.studioCalls.length === 0 && (
                  <div style={{ color: H.dim, fontSize: 13, padding: "14px 0" }}>Nothing needs the building. Rare air.</div>
                )}
              </div>
            </section>

            {/* ── LANDING ── */}
            {arrivals.length > 0 && (
              <section style={{ marginTop: 40 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
                  <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>Landing.</h2>
                  <span style={{ fontSize: 10.5, color: H.faint }}>boxes inbound — receiving preps from here</span>
                </div>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                  {arrivals.map((s: any) => (
                    <a key={s.id} href="/receiving2" style={{ textDecoration: "none", color: H.text, borderLeft: `2px solid ${H.line}`, padding: "4px 14px 4px 12px" }}>
                      <div style={{ fontSize: 15, fontWeight: 900, fontFamily: H.mono }}>{fmtDate(s.expected_arrival)}</div>
                      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, marginTop: 3 }}>{(s.shipment_lines || []).length} line{(s.shipment_lines || []).length === 1 ? "" : "s"}</div>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* ── THE WIRE ── */}
            <section style={{ marginTop: 40 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>The wire.</h2>
                <span style={{ fontSize: 10.5, color: H.faint }}>every move on the board, newest first — client actions land here live</span>
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
          </>
        )}
      </div>
      {sheet && (
        <ActionSheet
          sheet={sheet}
          onClose={() => setSheet(null)}
          onShipByLogged={(jobId: string, vendorKey: string, date: string) =>
            setJobs(prev => (prev || []).map((x: any) => x.id === jobId
              ? { ...x, type_meta: { ...(x.type_meta || {}), po_ship_live: { ...((x.type_meta || {}).po_ship_live || {}), [vendorKey]: { date, edited_at: new Date().toISOString() } } } }
              : x))}
          onStudioAnswered={(briefId: string) => setBriefs(prev => prev.filter((b: any) => b.id !== briefId))}
          onSaleClosed={(releaseId: string) => setDrops(prev => prev.map((r: any) => r.id === releaseId ? { ...r, status: "closed" } : r))}
        />
      )}
    </div>
  );
}

// ── THE ACTION SHEET — act in place, the hub's grammar turned inward ──
// A plate opens here instead of navigating away: the card's context on top,
// its one-to-three moves below, done and back to the feed. Deep links
// survive at the bottom for when the real surface is needed.
function ActionSheet({ sheet, onClose, onShipByLogged, onStudioAnswered, onSaleClosed }: {
  sheet: any; onClose: () => void;
  onShipByLogged: (jobId: string, vendorKey: string, date: string) => void;
  onStudioAnswered: (briefId: string) => void;
  onSaleClosed: (releaseId: string) => void;
}) {
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [reply, setReply] = useState("");
  const [nudge, setNudge] = useState<any>(null);
  // payment sheet: resolved recipient (billing contact → primary → first email)
  const [payTo, setPayTo] = useState<{ name: string; email: string } | null | "loading">(
    sheet.kind === "payment" ? "loading" : null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (sheet.kind !== "payment") return;
    (async () => {
      const { data: jcs } = await supabase.from("job_contacts")
        .select("role_on_job, contacts(name, email)")
        .eq("job_id", sheet.pay.jobs?.id || sheet.pay.job_id);
      const list = (jcs || []).map((jc: any) => ({ role: jc.role_on_job, name: jc.contacts?.name || "", email: jc.contacts?.email || "" }))
        .filter(c => c.email);
      const pick = list.find(c => c.role === "billing") || list.find(c => c.role === "primary") || list[0] || null;
      setPayTo(pick ? { name: pick.name, email: pick.email } : null);
    })();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line
  }, []);

  const eyebrowCss: any = { fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" };
  const labelCss: any = { ...eyebrowCss, color: "rgba(255,255,255,0.7)", marginBottom: 8 };
  const inputCss: any = { background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 8, color: "#fff", fontSize: 14, padding: "10px 12px", fontFamily: H.mono, colorScheme: "dark" };
  const goBtn: any = (on: boolean) => ({ background: on ? "#fff" : "rgba(255,255,255,0.18)", color: on ? H.ink : "rgba(255,255,255,0.5)", border: 0, borderRadius: 999, padding: "11px 20px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: on ? "pointer" : "default" });
  const linkCss: any = { fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", textDecoration: "none" };
  const divider = <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "18px 0" }} />;

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

  // The email-the-vendor block, shared by vendor + landing sheets
  const nudgeBlock = (payload: any) => (
    <div>
      <div style={labelCss}>Email the vendor</div>
      {ok ? (
        <div style={{ fontSize: 13, color: H.green, fontWeight: 700 }}>✓ {ok} — it's on the wire.</div>
      ) : !nudge ? (
        <button style={goBtn(busy !== "preview")} disabled={busy === "preview"} onClick={() => nudgePreview(payload)}>
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
    </div>
  );

  async function saveShipBy() {
    const s = sheet;
    if (!date || !s.vendorKey) return;
    setBusy("shipby"); setErr(null);
    try {
      const { data: job } = await supabase.from("jobs").select("type_meta").eq("id", s.job.id).single();
      const tm: any = { ...((job as any)?.type_meta || {}) };
      tm.po_ship_live = { ...(tm.po_ship_live || {}), [s.vendorKey]: { date, edited_at: new Date().toISOString() } };
      const { error } = await (supabase.from("jobs") as any).update({ type_meta: tm }).eq("id", s.job.id);
      if (error) throw new Error(error.message);
      logJobActivity(s.job.id, `Vendor ship-by moved to ${fmtDate(date)} (logged from The House)`);
      onShipByLogged(s.job.id, s.vendorKey, date);
      onClose();
    } catch (e: any) { setErr(e.message); setBusy(null); }
  }

  async function sendReply() {
    if (!reply.trim()) return;
    setBusy("reply"); setErr(null);
    try {
      const res = await fetch("/api/art-briefs/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief_id: sheet.brief.id, message: reply.trim(), visibility: "all" }) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || "Failed");
      onStudioAnswered(sheet.brief.id);
      onClose();
    } catch (e: any) { setErr(e.message); setBusy(null); }
  }

  // ── payment: resend the reminder (existing invoice-reminder pipeline —
  //    PDF attached, Pay Online button, "disregard if paid" hint) ──
  async function sendReminder() {
    if (!payTo || payTo === "loading") return;
    const p = sheet.pay;
    const jobId = p.jobs?.id || p.job_id;
    setBusy("remind"); setErr(null);
    try {
      const qbNum = p.jobs?.type_meta?.qb_invoice_number || p.invoice_number;
      const res = await fetch("/api/email/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "reminder", jobId, recipientEmail: payTo.email,
          subject: [`Invoice reminder${qbNum ? ` · ${qbNum}` : ""} — ${p.jobs?.clients?.name || ""}`, p.jobs?.title].filter(Boolean).join(" · "),
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || "Send failed");
      logJobActivity(jobId, "Invoice reminder sent to client");
      setOk(`Reminder sent to ${payTo.email}`);
    } catch (e: any) { setErr(e.message); }
    setBusy(null);
  }

  async function closeSale() {
    setBusy("close"); setErr(null);
    try {
      const res = await fetch(`/api/drops/${sheet.release.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "closed" }) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || "Failed");
      onSaleClosed(sheet.release.id);
      onClose();
    } catch (e: any) { setErr(e.message); setBusy(null); }
  }

  const head = (eyebrow: string, verb: string, meta: string, color: string) => (
    <div style={{ marginBottom: 18 }}>
      <div style={eyebrowCss}>{eyebrow}</div>
      <div style={{ fontSize: 24, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", lineHeight: 1.05, marginTop: 6, color }}>{verb}.</div>
      {meta && <div style={{ fontSize: 10.5, fontFamily: H.mono, color: "rgba(255,255,255,0.65)", marginTop: 7 }}>{meta}</div>}
    </div>
  );

  return (
    <div className="hs-sheet-wrap" onClick={onClose}>
      <div className="hs-sheet" onClick={e => e.stopPropagation()}>
        {sheet.kind === "vendor" && (
          <>
            {head(`${sheet.job.clients?.name || "—"} · ${sheet.job.job_number}`,
              (sheet.level === "late" ? HOUSE_EXTRA_DIRECTIVES.vendor_late : HOUSE_EXTRA_DIRECTIVES.vendor_confirm).verb,
              sheet.meta, sheet.level === "late" ? H.red : H.amber)}
            {sheet.vendorKey ? (
              <div>
                <div style={labelCss}>Got a real date? Log it — the card clears itself</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inputCss, flex: 1 }} />
                  <button style={goBtn(!!date && busy !== "shipby")} disabled={!date || busy === "shipby"} onClick={saveShipBy}>
                    {busy === "shipby" ? "Logging…" : "Log it"}
                  </button>
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 7 }}>Writes the live ship-by for {sheet.vendorKey} — the PO keeps its original date.</div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>No PO vendor on file to attach a date to — the email below still finds them.</div>
            )}
            {divider}
            {nudgeBlock({ jobId: sheet.job.id })}
            {divider}
            <a href={`/jobs/${sheet.job.id}`} style={linkCss}>Open the job →</a>
          </>
        )}
        {sheet.kind === "landing" && (
          <>
            {head(`${sheet.lines[0]?.jobs?.clients?.name || "Inbound"} · landing late`,
              HOUSE_EXTRA_DIRECTIVES.landing_late.verb,
              `expected ${fmtDate(sheet.shipment.expected_arrival)}${sheet.shipment.tracking_number ? ` · ${[sheet.shipment.carrier, sheet.shipment.tracking_number].filter(Boolean).join(" ")}` : " · no tracking on file"}`,
              H.red)}
            {nudgeBlock({ shipmentId: sheet.shipment.id })}
            {divider}
            <a href="/receiving2" style={linkCss}>Open receiving →</a>
          </>
        )}
        {sheet.kind === "studio" && (
          <>
            {head(`${sheet.brief.clients?.name || "Studio"} · ${sheet.brief.title || "New idea"}`,
              STUDIO_DIRECTIVE.verb,
              sheet.brief.state === "draft" ? "new idea from the hub" : "client words waiting", H.amber)}
            <div style={labelCss}>Reply in the thread — the client sees it</div>
            <textarea value={reply} onChange={e => setReply(e.target.value)} rows={3}
              placeholder="Even a 'love it, sketching soon' keeps the ping-pong alive…"
              style={{ ...inputCss, width: "100%", fontFamily: H.font, resize: "vertical", boxSizing: "border-box" }} />
            <div style={{ marginTop: 12 }}>
              <button style={goBtn(!!reply.trim() && busy !== "reply")} disabled={!reply.trim() || busy === "reply"} onClick={sendReply}>
                {busy === "reply" ? "Sending…" : "Send it"}
              </button>
            </div>
            {divider}
            <a href={`/studio2?open=${sheet.brief.id}`} style={linkCss}>Open it in the Studio →</a>
          </>
        )}
        {sheet.kind === "payment" && (() => {
          const p = sheet.pay;
          const payLink = p.jobs?.type_meta?.qb_payment_link || "";
          const daysLate = daysSince(p.due_date + "T00:00");
          return (
            <>
              {head(`${p.jobs?.clients?.name || "—"} · ${p.invoice_number ? `Invoice #${p.invoice_number}` : p.jobs?.job_number}`,
                HOUSE_EXTRA_DIRECTIVES.overdue_payment.verb,
                `$${Number(p.amount).toLocaleString()} · due ${fmtDate(p.due_date)}${daysLate ? ` · ${daysLate} days late` : ""}`, H.red)}
              <div style={labelCss}>Resend the reminder — invoice PDF + Pay Online button attached</div>
              {ok ? (
                <div style={{ fontSize: 13, color: H.green, fontWeight: 700 }}>✓ {ok} — it's on the wire.</div>
              ) : payTo === "loading" ? (
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Finding the billing contact…</div>
              ) : payTo ? (
                <div>
                  <div style={{ fontSize: 11, fontFamily: H.mono, color: "rgba(255,255,255,0.65)", marginBottom: 10 }}>
                    to {payTo.name ? `${payTo.name} · ` : ""}{payTo.email}
                  </div>
                  <button style={goBtn(busy !== "remind")} disabled={busy === "remind"} onClick={sendReminder}>
                    {busy === "remind" ? "Sending…" : "Send the reminder"}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>No contact with an email on this job — add one on the job page first.</div>
              )}
              {payLink && (
                <>
                  {divider}
                  <div style={labelCss}>Making the call instead? Take the pay link with you</div>
                  <button style={goBtn(true)} onClick={() => { navigator.clipboard?.writeText(payLink); setCopied(true); }}>
                    {copied ? "✓ Copied" : "Copy the pay link"}
                  </button>
                </>
              )}
              {divider}
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>Payments record themselves when QuickBooks sees the money — marking paid by hand lives on the job page, on purpose.</div>
              <a href={`/jobs/${p.jobs?.id || p.job_id}`} style={linkCss}>Open the job →</a>
            </>
          );
        })()}
        {sheet.kind === "drop_close" && (
          <>
            {head(`${sheet.release.clients?.name || "Drop"} · ${sheet.release.title}`,
              DROP_DIRECTIVES.window_ended.verb,
              sheet.release.window_close_date ? `window ended ${fmtDate(sheet.release.window_close_date)}` : "window ended", H.red)}
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.8)", lineHeight: 1.55, marginBottom: 14 }}>
              {DROP_DIRECTIVES.window_ended.order}. Closing flips the client's sheet to production numbers.
            </div>
            <button style={goBtn(busy !== "close")} disabled={busy === "close"} onClick={closeSale}>
              {busy === "close" ? "Closing…" : "Close the sale"}
            </button>
            {divider}
            <a href="/drops" style={linkCss}>Open the drops board →</a>
          </>
        )}
        {err && <div style={{ marginTop: 14, fontSize: 12, color: H.red, fontWeight: 700 }}>{err}</div>}
      </div>
    </div>
  );
}
