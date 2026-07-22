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

  useEffect(() => {
    (async () => {
      const [{ data: j }, { data: r }, { data: act }, { data: ships }] = await Promise.all([
        supabase.from("jobs")
          .select("id, job_number, title, phase, target_ship_date, created_at, updated_at, phase_timestamps, type_meta, clients(name), items(id, pipeline_stage, buy_sheet_lines(qty_ordered))")
          .not("phase", "in", "(complete,cancelled,on_hold)"),
        supabase.from("releases").select("*, clients(name)").not("status", "in", "(cut,shelved)"),
        supabase.from("job_activity").select("message, created_at, jobs(job_number, clients(name))").order("created_at", { ascending: false }).limit(16),
        supabase.from("shipments").select("id, expected_arrival, status, shipment_lines(item_id)").gte("expected_arrival", new Date(Date.now() - 86400000).toISOString().slice(0, 10)).order("expected_arrival").limit(8),
      ]);
      setJobs(j || []); setDrops(r || []); setWire(act || []); setArrivals(ships || []);
      try {
        const res = await fetch("/api/art-briefs");
        const body = await res.json();
        setBriefs((body.briefs || []).filter((b: any) => !b.client_aborted_at));
      } catch {}
      // hero art for the action jobs (bounded)
      const actionJobs: any[] = ((j || []) as any[]).filter((x: any) => (PHASE_VERB[x.phase] || {}).side === "us").slice(0, 16);
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
    const dropCalls = drops.filter((r: any) => {
      if (r.status === "ready" || r.status === "closed") return true;
      if (r.status === "live" && r.window_close_date && r.window_close_date <= new Date().toISOString().slice(0, 10)) return true;
      return false;
    });
    // studio calls: new ideas + unanswered client words (same rule as studio2)
    const studioCalls = briefs.filter((b: any) => {
      const clientAt = b.last_client_activity?.at || "";
      const hpdAt = [b.last_hpd_activity?.at || "", b.hpd_last_seen_at || ""].sort().pop() || "";
      return b.state === "draft" || (!!clientAt && clientAt > hpdAt);
    });
    const overdue = ourJobs.filter((x: any) => x.target_ship_date && x.target_ship_date < new Date().toISOString().slice(0, 10));
    return { ourJobs, theirJobs, press, dropCalls, studioCalls, overdue };
  }, [jobs, drops, briefs]);

  const card = (key: string, art: string | null, eyebrow: string, title: string, meta: string, verb: string, verbColor: string, href: string, go: string) => (
    <a key={key} href={href} style={{ display: "block", background: H.panel, border: `1px solid ${H.line}`, borderRadius: 16, overflow: "hidden", textDecoration: "none", color: H.text, fontFamily: H.font }}
      className="fl-card">
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px" }}>
        <span style={{ width: 46, height: 46, borderRadius: 10, overflow: "hidden", background: art ? "#fff" : H.surface, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          {art ? <img src={art} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
            : <span style={{ fontSize: 13, fontWeight: 900, color: H.faint }}>{(title || "?").slice(0, 1)}</span>}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: "block", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint }}>{eyebrow}</span>
          <span style={{ display: "block", fontSize: 14, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{title}</span>
          <span style={{ display: "block", fontSize: 10, fontFamily: H.mono, color: H.dim, marginTop: 2 }}>{meta}</span>
        </span>
        <span style={{ textAlign: "right", flexShrink: 0 }}>
          <span style={{ display: "block", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: verbColor }}>{verb}</span>
          {go && <span style={{ display: "inline-block", marginTop: 6, background: "#fff", color: H.ink, borderRadius: 999, padding: "7px 14px", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>{go}</span>}
        </span>
      </div>
    </a>
  );

  return (
    <div style={{ background: H.ink, minHeight: "100vh", margin: -24, padding: 24, color: H.text, fontFamily: H.font }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .fl-card{transition:transform .15s ease,border-color .15s ease}
        .fl-card:hover{transform:translateY(-2px);border-color:rgba(255,255,255,.3)}
        @media(prefers-reduced-motion:reduce){.fl-card,.fl-card:hover{transition:none;transform:none}}
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
            </div>

            {/* ── YOUR MOVE ── */}
            <section style={{ marginTop: 36 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: H.amber }}>Your move.</h2>
                <span style={{ fontSize: 10.5, color: H.faint }}>client responses, submissions, and lifecycle calls — soonest ship first</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {model.dropCalls.map((r: any) => {
                  const ended = r.status === "live";
                  return card(`drop-${r.id}`, null, r.clients?.name || "Drop", r.title,
                    r.target_live_date ? `target live ${fmtDate(r.target_live_date)}` : "release",
                    ended ? `Window ended — close it` : r.status === "closed" ? "Numbers / cut" : "Cost & schedule",
                    ended ? H.red : H.amber, "/drops", "Drops board");
                })}
                {model.studioCalls.slice(0, 5).map((b: any) =>
                  card(`brief-${b.id}`, null, b.clients?.name || "Studio", b.title || "New idea",
                    b.state === "draft" ? "new idea from the hub" : "client words waiting",
                    "Answer it", H.amber, "/studio2", "Studio"))}
                {model.ourJobs.slice(0, 12).map((x: any) => {
                  const v = PHASE_VERB[x.phase];
                  const late = x.target_ship_date && x.target_ship_date < new Date().toISOString().slice(0, 10);
                  const ref = (x.type_meta as any)?.qb_invoice_number ? `#${(x.type_meta as any).qb_invoice_number}` : x.job_number;
                  const units = (x.items || []).reduce((a: number, i: any) => a + (i.buy_sheet_lines || []).reduce((s: number, l: any) => s + (Number(l.qty_ordered) || 0), 0), 0);
                  return card(`job-${x.id}`, jobArt[x.id] ? thumbSrc(jobArt[x.id]) : null,
                    x.clients?.name || "—", ref,
                    `${units.toLocaleString()} pcs${x.target_ship_date ? ` · ship ${fmtDate(x.target_ship_date)}` : ""}${(x.type_meta as any)?.source === "client_portal_cart" ? " · CLIENT-BUILT" : ""}`,
                    late ? `${v.verb} · LATE` : v.verb, late ? H.red : H.amber,
                    `/jobs/${x.id}`, v.go || "Open");
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
