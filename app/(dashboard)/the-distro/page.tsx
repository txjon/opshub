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

  useEffect(() => {
    (async () => {
      const today = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const [{ data: sh }, { data: pr }, { data: fj }, { data: act }] = await Promise.all([
        supabase.from("shipments").select("id, expected_arrival, status, source, shipment_lines(item_id, received)").gte("expected_arrival", today).order("expected_arrival").limit(12),
        supabase.from("pull_requests").select("id, kind, qtys, reason, status, requested_by_name, created_at, items(name, received_at_hpd, jobs(job_number, clients(name)))").in("status", ["pending", "partial"]).order("created_at").limit(20),
        supabase.from("jobs").select("id, job_number, fulfillment_status, target_ship_date, clients(name), items(id)").eq("phase", "fulfillment"),
        supabase.from("job_activity").select("message, created_at, jobs(job_number, clients(name))").order("created_at", { ascending: false }).limit(40),
      ]);
      setShips(sh || []); setPulls(pr || []); setFulfill(fj || []);
      setWire((act || []).filter((a: any) => /receiv|ship|forward|pull|land|deliver/i.test(a.message)).slice(0, 12));
      // variance: recently-received items whose received != shipped
      const { data: recv } = await supabase.from("items")
        .select("id, name, ship_qtys, received_qtys, received_at_hpd_at, jobs!inner(job_number, phase, clients(name))")
        .eq("received_at_hpd", true)
        .not("jobs.phase", "in", "(complete,cancelled)")
        .order("received_at_hpd_at", { ascending: false }).limit(60);
      setVariances((recv || []).filter((it: any) => {
        const s = sum(it.ship_qtys), r = sum(it.received_qtys);
        return s > 0 && r > 0 && r !== s;
      }).slice(0, 6));
    })();
    // eslint-disable-next-line
  }, []);

  const openPullUnits = useMemo(() => pulls.reduce((a, p) => a + sum(p.qtys), 0), [pulls]);
  const landingsToday = useMemo(() => (ships || []).filter((s: any) => s.expected_arrival <= new Date().toISOString().slice(0, 10)).length, [ships]);
  const pullableNow = pulls.filter((p: any) => p.items?.received_at_hpd);

  const plate = (key: string, eyebrow: string, title: string, meta: string, d: { verb: string; order: string; done: string }, color: string, href: string, go: string) => (
    <a key={key} href={href} className="ds-plate">
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
    </a>
  );

  return (
    <div style={{ background: H.ink, minHeight: "100vh", margin: -24, padding: 24, color: H.text, fontFamily: H.font }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .ds-grid{display:grid;grid-template-columns:1fr;gap:16px}
        @media(min-width:760px){.ds-grid{grid-template-columns:repeat(2,1fr)}}
        @media(min-width:1100px){.ds-grid{grid-template-columns:repeat(3,1fr)}}
        .ds-plate{position:relative;border-radius:8px;overflow:hidden;background:#141414;border:1px solid ${H.line};display:flex;flex-direction:column;justify-content:flex-end;text-decoration:none;color:#fff;transition:transform .16s ease}
        .ds-plate:hover{transform:translateY(-4px)}
        .ds-plate .body{position:relative;padding:18px}
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
                  DISTRO_DIRECTIVES.variance, H.red, "/receiving2", "Receiving"))}
                {pullableNow.map((p: any) => plate(`pull-${p.id}`,
                  `${p.items?.jobs?.clients?.name || p.requested_by_name || "Pull"} · ${p.items?.jobs?.job_number || ""}`,
                  p.items?.name || "Item",
                  `${sum(p.qtys)} pcs — ${Object.entries(p.qtys || {}).map(([k, v]) => `${k} ${v}`).join("  ")}${p.status === "partial" ? " · partially pulled" : ""}`,
                  DISTRO_DIRECTIVES.pull, H.amber, "/warehouse", "Pulls queue"))}
                {pulls.filter((p: any) => !p.items?.received_at_hpd).map((p: any) => plate(`pullq-${p.id}`,
                  `${p.items?.jobs?.clients?.name || p.requested_by_name || "Pull"} · queued for landing`,
                  p.items?.name || "Item",
                  `${sum(p.qtys)} pcs — pull at receive`,
                  { ...DISTRO_DIRECTIVES.pull, order: "Goods still inbound — this pull fulfills at receive, keep it on the bench" }, H.faint, "/warehouse", "Pulls queue"))}
                {fulfill.map((j: any) => plate(`ful-${j.id}`,
                  `${j.clients?.name || ""} · ${j.job_number}`,
                  j.fulfillment_status ? `status: ${j.fulfillment_status}` : `${(j.items || []).length} items staged`,
                  j.target_ship_date ? `ship by ${fmtDate(j.target_ship_date)}` : "no ship date set",
                  DISTRO_DIRECTIVES.fulfill, H.amber, "/warehouse", "Fulfillment"))}
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
    </div>
  );
}
