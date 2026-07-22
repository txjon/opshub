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
  fulfillment: { verb: "Stage & ship", go: "Fulfillment", side: "us" },
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

  useEffect(() => {
    (async () => {
      const [{ data: j }, { data: r }, { data: act }, { data: ships }, { data: latePay }, { count: pullCount }] = await Promise.all([
        supabase.from("jobs")
          .select("id, job_number, title, phase, target_ship_date, created_at, updated_at, phase_timestamps, type_meta, clients(name), items(id, pipeline_stage, pipeline_timestamps, buy_sheet_lines(qty_ordered))")
          .not("phase", "in", "(complete,cancelled,on_hold)"),
        supabase.from("releases").select("*, clients(name)").not("status", "in", "(cut,shelved)"),
        supabase.from("job_activity").select("message, created_at, jobs(job_number, clients(name))").order("created_at", { ascending: false }).limit(16),
        supabase.from("shipments").select("id, expected_arrival, status, shipment_lines(item_id)").gte("expected_arrival", new Date(Date.now() - 86400000).toISOString().slice(0, 10)).order("expected_arrival").limit(8),
        supabase.from("payment_records").select("id, job_id, amount, status, due_date, invoice_number, jobs!inner(id, job_number, phase, clients(name))").in("status", ["sent", "viewed", "partial", "overdue"]).lt("due_date", new Date().toISOString().slice(0, 10)).not("jobs.phase", "eq", "cancelled").limit(8),
        supabase.from("pull_requests").select("id", { count: "exact", head: true }).in("status", ["pending", "partial"]),
      ]);
      setJobs(j || []); setDrops(r || []); setWire(act || []); setArrivals(ships || []);
      setOverduePay(latePay || []); setOpenPulls(pullCount || 0);
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
        const promises: string[] = [
          ...Object.values(tm.po_ship_live || {}).map((v: any) => v?.date).filter(Boolean),
          ...Object.values(tm.po_ship_dates || {}).filter(Boolean),
        ] as string[];
        const promise = promises.sort()[0] || null;
        const fallback = x.target_ship_date
          ? new Date(new Date(x.target_ship_date + "T00:00").getTime() - 7 * 86400000).toISOString().slice(0, 10)
          : null;
        const due = promise || fallback;
        if (!due) return null;
        if (due < today) return { job: x, due, level: "late", promised: !!promise };
        if (due <= soonV) return { job: x, due, level: "confirm", promised: !!promise };
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
  const card = (key: string, art: string | null, eyebrow: string, title: string, meta: string, verb: string, verbColor: string, href: string, go: string, directive?: { order: string; done: string }) => (
    <a key={key} href={href} className="hs-plate">
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
    </a>
  );

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
                    d.verb, ended ? H.red : H.amber, "/drops", "Drops board", d);
                })}
                {model.studioCalls.slice(0, 5).map((b: any) => {
                  const bt = (b.thumbs || []).find((x: any) => x.preview_drive_file_id || x.drive_file_id);
                  const bArt = bt ? thumbSrc(bt.preview_drive_file_id || bt.drive_file_id) : null;
                  return card(`brief-${b.id}`, bArt, b.clients?.name || "Studio", b.title || "New idea",
                    b.state === "draft" ? "new idea from the hub" : "client words waiting",
                    STUDIO_DIRECTIVE.verb, H.amber, "/studio2", "Studio", STUDIO_DIRECTIVE);
                })}
                {model.vendorRisk.slice(0, 5).map(({ job: x, due, level, promised }: any) => {
                  const d = level === "late" ? HOUSE_EXTRA_DIRECTIVES.vendor_late : HOUSE_EXTRA_DIRECTIVES.vendor_confirm;
                  return card(`vr-${x.id}`, jobArt[x.id] ? thumbSrc(jobArt[x.id]) : null,
                    x.clients?.name || "—", (x.type_meta as any)?.qb_invoice_number ? `#${(x.type_meta as any).qb_invoice_number}` : x.job_number,
                    promised ? `vendor promised ${fmtDate(due)}` : `needs to move by ${fmtDate(due)} to make the ship date`,
                    d.verb, level === "late" ? H.red : H.amber, `/jobs/${x.id}`, "Open job", d);
                })}
                {overduePay.slice(0, 4).map((p: any) =>
                  card(`pay-${p.id}`, null,
                    p.jobs?.clients?.name || "—", p.invoice_number ? `Invoice #${p.invoice_number}` : p.jobs?.job_number,
                    `$${Number(p.amount).toLocaleString()} · due ${fmtDate(p.due_date)}`,
                    HOUSE_EXTRA_DIRECTIVES.overdue_payment.verb, H.red, `/jobs/${p.jobs?.id || p.job_id}`, "Open job", HOUSE_EXTRA_DIRECTIVES.overdue_payment))}
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
    </div>
  );
}
