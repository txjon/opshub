"use client";

// Variances tab — accounting view over the reconciliation data, in the god-mode
// aesthetic. Tracks ACTUAL vs PROJECTED cost (decorator bills + blank purchases)
// per vendor, job, blanks, and month — with margin-erosion ranking, biggest-loser
// jobs, and vendor scorecards. Pure-derived from the billing queue + costing.

import { useEffect, useMemo, useState } from "react";
import { T, font, mono } from "@/lib/theme";
import type { BillingQueue } from "@/lib/billing-queue";
import { computeVarianceSummary, type VarianceJobRow } from "@/lib/variance";
import { shippingVarianceNet, calculatedShipping } from "@/lib/ups-freight";

const money = (n: number) => (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyK = (n: number) => { const a = Math.abs(n); const s = n < 0 ? "−" : ""; return a >= 1000 ? `${s}$${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : `${s}$${a.toFixed(0)}`; };

// Count-up animation for headline numbers.
function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0; const start = performance.now(); const from = 0;
    const tick = (t: number) => { const p = Math.min(1, (t - start) / ms); const e = 1 - Math.pow(1 - p, 3); setV(from + (target - from) * e); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
function Kpi({ i, label, value, sub, accent }: { i: number; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="vx-kpi" style={{ animationDelay: `${i * 55}ms` }}>
      <div className="vx-kpi-label">{label}</div>
      <div className="vx-kpi-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div className="vx-kpi-sub">{sub}</div>}
    </div>
  );
}
function Spark({ data, goodUp }: { data: number[]; goodUp?: boolean }) {
  const max = Math.max(1, ...data.map(Math.abs));
  const pos = goodUp ? T.green : T.red; // for freight, a positive value (margin captured) is good → green
  const neg = goodUp ? T.red : T.green;
  return <div className="vx-spark">{data.map((d, i) => <div key={i} className="vx-spark-bar" style={{ height: `${Math.max(8, (Math.abs(d) / max) * 100)}%`, background: d > 0 ? pos : d < 0 ? neg : T.border, opacity: Math.abs(d) > 0 ? 0.9 : 0.3 }} />)}</div>;
}

type JobRow = VarianceJobRow;

export function VarianceView({ queue, jobsRaw, items, printers, freightEntries = [] }: { queue: BillingQueue; jobsRaw: Record<string, any>; items: any[]; printers: Record<string, any>; freightEntries?: any[] }) {
  const [cut, setCut] = useState<"vendor" | "job" | "blanks" | "month" | "freight">("job");
  const [drillJob, setDrillJob] = useState<JobRow | null>(null);
  const [drillVendor, setDrillVendor] = useState<string | null>(null);

  const data = useMemo(() => computeVarianceSummary({ queue, jobsRaw, items, printers }), [queue, jobsRaw, items, printers]);
  const shipNet = useMemo(() => shippingVarianceNet(freightEntries, jobsRaw), [freightEntries, jobsRaw]);
  const totalNet = data.netVar + shipNet; // decorator-bill variance + inbound-freight variance

  // Freight margin captured = UPS-costed baseline (calc) − actual (negotiated LTL),
  // per job, less general non-job freight. Positive = margin we keep. = −shipNet.
  const freightData = useMemo(() => {
    const byJob: Record<string, number> = {}; let pool = 0;
    for (const e of (freightEntries || [])) {
      if ((e as any).status === "ignored") continue;
      if (e.not_job_specific) { pool += Number(e.amount || 0); continue; }
      if (!e.job_id) continue;
      byJob[e.job_id] = (byJob[e.job_id] || 0) + Number(e.amount || 0);
    }
    const rows = Object.entries(byJob).map(([jid, actual]) => {
      const job = jobsRaw[jid];
      const cl = job ? (Array.isArray(job.clients) ? job.clients[0]?.name : job.clients?.name) : "";
      const calc = job ? calculatedShipping(job.costing_data) : 0;
      return { jobNumber: job?.job_number || jid, client: cl || "", actual: Math.round(actual * 100) / 100, calc, margin: Math.round((calc - actual) * 100) / 100 };
    }).sort((a, b) => b.margin - a.margin);
    const captured = Math.round((rows.reduce((s, r) => s + r.margin, 0) - pool) * 100) / 100;
    return { rows, pool, captured };
  }, [freightEntries, jobsRaw]);

  const net = useCountUp(totalNet);
  const over = useCountUp(data.totalOver);
  const under = useCountUp(data.totalUnder);

  // sparkline previews per nav card
  const vendorSpark = data.vendors.slice(0, 12).map(v => v.variance);
  const jobMovers = data.byJob.filter(r => r.totalVar !== 0); // matched (0-variance) jobs aren't "movers"
  const jobSpark = jobMovers.slice(0, 14).map(r => r.totalVar);
  const blankSpark = data.blanks.slice(0, 14).map(r => r.blankVar);
  const monthSpark = data.months.map(m => m.v);

  const drillVendorJobs = drillVendor ? data.byJob.filter(r => r.vendors.some(v => v.name === drillVendor)).map(r => ({ r, v: r.vendors.find(v => v.name === drillVendor)! })) : [];

  return (
    <div style={{ ["--card" as any]: T.card, ["--border" as any]: T.border, ["--surface" as any]: T.surface, ["--text" as any]: T.text, ["--muted" as any]: T.muted, ["--faint" as any]: T.faint, ["--red" as any]: T.red, ["--green" as any]: T.green, ["--amber" as any]: T.amber, ["--mono" as any]: mono, fontFamily: font }}>
      <style>{`
        .vx-kpis { display: grid; grid-template-columns: 3fr 1fr; gap: 12px; margin: 18px 0 26px; }
        @media (max-width:700px){ .vx-kpis{ grid-template-columns: 1fr;} }
        @media (max-width:1100px){ .vx-kpis{ grid-template-columns: repeat(3,1fr);} }
        @media (max-width:600px){ .vx-kpis{ grid-template-columns: repeat(2,1fr);} }
        .vx-kpi { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 15px 16px 14px; opacity: 0; animation: vx-rise .55s cubic-bezier(.2,.7,.2,1) forwards; }
        .vx-kpi-label { font-size: 9.5px; letter-spacing:.09em; text-transform:uppercase; font-weight:700; color: var(--faint); margin-bottom: 9px; }
        .vx-kpi-value { font-size: 25px; font-weight: 800; font-family: var(--mono); letter-spacing:-.02em; line-height:1; color: var(--text); }
        .vx-kpi-sub { font-size: 11px; color: var(--muted); margin-top: 7px; }
        .vx-nav-grid { display: grid; grid-template-columns: repeat(5,1fr); gap: 12px; margin-bottom: 24px; }
        @media (max-width:900px){ .vx-nav-grid{ grid-template-columns: repeat(2,1fr);} }
        .vx-nav { text-align:left; background: var(--card); border:1px solid var(--border); border-radius:14px; padding:14px 15px; cursor:pointer; font-family:${font}; display:flex; flex-direction:column; gap:9px; transition: transform .14s, box-shadow .14s, border-color .14s; }
        .vx-nav:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(16,18,32,.10); }
        .vx-nav.active { border-color: var(--nav); box-shadow: 0 0 0 1px var(--nav), 0 8px 20px rgba(16,18,32,.10); }
        .vx-nav-title { font-size: 12px; font-weight: 700; color: var(--text); display:flex; align-items:center; gap:7px; }
        .vx-nav-title::before { content:""; width:8px; height:8px; border-radius:3px; background: var(--nav); flex-shrink:0; }
        .vx-nav-value { font-size: 21px; font-weight:800; font-family: var(--mono); letter-spacing:-.02em; line-height:1; }
        .vx-nav-sub { font-size: 11px; color: var(--muted); }
        .vx-spark { display:flex; align-items:flex-end; gap:2px; height: 24px; }
        .vx-spark-bar { flex:1; border-radius: 2px 2px 0 0; min-height: 2px; }
        .vx-card { background: var(--card); border:1px solid var(--border); border-radius:14px; overflow:hidden; }
        .vx-row { display:flex; align-items:center; gap:12px; padding:10px 16px; border-top:1px solid color-mix(in srgb, var(--border) 50%, transparent); cursor:pointer; transition: background .12s; }
        .vx-row:hover { background: var(--surface); }
        .vx-bartrack { flex:1; height:8px; background: var(--surface); border-radius:5px; overflow:hidden; position:relative; }
        .vx-barfill { height:100%; border-radius:5px; transform-origin:left; animation: vx-stretch .6s cubic-bezier(.2,.8,.2,1) both; }
        .vx-sectitle { font-size: 13px; font-weight: 800; letter-spacing:-.01em; color: var(--text); margin: 0 0 10px; }
        .vx-modal-bd { position:fixed; inset:0; background: rgba(16,18,32,.55); backdrop-filter: blur(3px); z-index:1000; display:flex; align-items:center; justify-content:center; padding:24px; animation: vx-fade .18s ease; }
        .vx-modal { background: var(--card); border:1px solid var(--border); border-radius:16px; max-width:760px; width:100%; max-height:84vh; overflow:auto; box-shadow:0 24px 70px rgba(16,18,32,.3); animation: vx-pop .2s cubic-bezier(.2,.8,.2,1); }
        @keyframes vx-rise { from{opacity:0; transform:translateY(8px);} to{opacity:1; transform:none;} }
        @keyframes vx-stretch { from{transform:scaleX(0);} to{transform:scaleX(1);} }
        @keyframes vx-fade { from{opacity:0;} to{opacity:1;} }
        @keyframes vx-pop { from{opacity:0; transform:scale(.97);} to{opacity:1; transform:none;} }
      `}</style>

      {/* Hero KPIs */}
      <div className="vx-kpis">
        <Kpi i={0} label="Net cost vs plan" value={money(net)} accent={totalNet > 0 ? T.red : T.green}
          sub={`${totalNet > 0 ? "over" : "under"} projection · ${money(over)} over (${data.jobsOver}) · ${money(under)} under (${data.jobsUnder}) · incl. freight`} />
        <Kpi i={1} label="Jobs reconciled" value={String(data.rows.length)} sub="with actual cost" />
      </div>

      {/* Nav cards */}
      <div className="vx-nav-grid">
        {([
          { k: "job", title: "By Job", accent: T.red, value: `${data.jobsOver} over`, sub: "margin-erosion ranking", spark: jobSpark },
          { k: "freight", title: "Freight margin", accent: T.green, value: money(freightData.captured), sub: "captured via LTL", spark: freightData.rows.slice(0, 14).map(r => r.margin), goodUp: true },
          { k: "vendor", title: "Vendor Scorecards", accent: T.blue || "#3b82f6", value: `${data.vendors.length}`, sub: "vendors · accuracy", spark: vendorSpark },
          { k: "blanks", title: "Blanks", accent: T.amber, value: moneyK(data.blanks.reduce((s, r) => s + r.blankVar, 0)), sub: `${data.blanks.length} jobs ordered`, spark: blankSpark },
          { k: "month", title: "By Month", accent: T.green, value: `${data.months.length} mo`, sub: "variance trend", spark: monthSpark },
        ] as const).map((c) => (
          <button key={c.k} className={`vx-nav${cut === c.k ? " active" : ""}`} style={{ ["--nav" as any]: c.accent }} onClick={() => setCut(c.k as any)}>
            <div className="vx-nav-title">{c.title}</div>
            <div className="vx-nav-value">{c.value}</div>
            <Spark data={c.spark.length ? c.spark : [0]} goodUp={(c as any).goodUp} />
            <div className="vx-nav-sub">{c.sub}</div>
          </button>
        ))}
      </div>

      {/* Detail panel */}
      {cut === "job" && <JobCut rows={jobMovers} onDrill={setDrillJob} />}
      {cut === "vendor" && <VendorCut vendors={data.vendors} onDrill={setDrillVendor} />}
      {cut === "blanks" && <BlanksCut rows={data.blanks} onDrill={setDrillJob} />}
      {cut === "month" && <MonthCut months={data.months} />}
      {cut === "freight" && <FreightCut data={freightData} />}

      {/* Drill: job → line detail */}
      {drillJob && (
        <div className="vx-modal-bd" onClick={() => setDrillJob(null)}>
          <div className="vx-modal" onClick={e => e.stopPropagation()} style={{ padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div><div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{drillJob.jobNumber}</div><div style={{ fontSize: 12, color: T.muted }}>{drillJob.client}</div></div>
              <div style={{ textAlign: "right" }}><div style={{ fontSize: 9.5, letterSpacing: ".09em", textTransform: "uppercase", fontWeight: 700, color: T.faint }}>Total variance</div><div style={{ fontSize: 22, fontWeight: 800, fontFamily: mono, color: drillJob.totalVar > 0 ? T.red : T.green }}>{money(drillJob.totalVar)}</div></div>
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="vx-sectitle">Decorator</div>
              {drillJob.vendors.length === 0 ? <div style={{ fontSize: 12, color: T.faint }}>No billed decorator lines.</div> : drillJob.vendors.map((v, i) => (
                <div key={i} style={{ display: "flex", gap: 12, fontSize: 12.5, padding: "5px 0", borderTop: i ? `1px solid ${T.border}33` : "none" }}>
                  <span style={{ flex: 1, color: T.text }}>{v.name}</span>
                  <span style={{ fontFamily: mono, color: T.muted, width: 100, textAlign: "right" }}>{money(v.expected)}</span>
                  <span style={{ fontFamily: mono, color: T.text, width: 100, textAlign: "right" }}>{money(v.billed)}</span>
                  <span style={{ fontFamily: mono, fontWeight: 700, width: 90, textAlign: "right", color: v.variance > 0 ? T.red : v.variance < 0 ? T.green : T.faint }}>{v.variance === 0 ? "✓" : money(v.variance)}</span>
                </div>
              ))}
              {drillJob.blankOrdered && <>
                <div className="vx-sectitle" style={{ marginTop: 14 }}>Blanks</div>
                <div style={{ display: "flex", gap: 12, fontSize: 12.5, padding: "5px 0" }}>
                  <span style={{ flex: 1, color: T.text }}>Blank cost</span>
                  <span style={{ fontFamily: mono, color: T.muted, width: 100, textAlign: "right" }}>{money(drillJob.blankCalc)}</span>
                  <span style={{ fontFamily: mono, color: T.text, width: 100, textAlign: "right" }}>{money(drillJob.blankActual)}</span>
                  <span style={{ fontFamily: mono, fontWeight: 700, width: 90, textAlign: "right", color: drillJob.blankVar > 0 ? T.red : drillJob.blankVar < 0 ? T.green : T.faint }}>{drillJob.blankVar === 0 ? "✓" : money(drillJob.blankVar)}</span>
                </div>
              </>}
              <div style={{ display: "flex", gap: 12, fontSize: 10, color: T.faint, marginTop: 8, textTransform: "uppercase", letterSpacing: ".08em" }}><span style={{ flex: 1 }} /><span style={{ width: 100, textAlign: "right" }}>projected</span><span style={{ width: 100, textAlign: "right" }}>actual</span><span style={{ width: 90, textAlign: "right" }}>variance</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Drill: vendor → jobs */}
      {drillVendor && (
        <div className="vx-modal-bd" onClick={() => setDrillVendor(null)}>
          <div className="vx-modal" onClick={e => e.stopPropagation()} style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.text, marginBottom: 12 }}>{drillVendor} — by job</div>
            {drillVendorJobs.map(({ r, v }, i) => (
              <div key={r.id} className="vx-row" style={{ borderTop: i ? undefined : "none", cursor: "default" }}>
                <span style={{ width: 130, fontFamily: mono, fontSize: 12, color: T.text }}>{r.jobNumber}</span>
                <span style={{ flex: 1, fontSize: 12, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.client}</span>
                <span style={{ fontFamily: mono, fontSize: 12, color: T.muted, width: 100, textAlign: "right" }}>{money(v.expected)}</span>
                <span style={{ fontFamily: mono, fontSize: 12, color: T.text, width: 100, textAlign: "right" }}>{money(v.billed)}</span>
                <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, width: 90, textAlign: "right", color: v.variance > 0 ? T.red : v.variance < 0 ? T.green : T.faint }}>{v.variance === 0 ? "✓" : money(v.variance)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detail cuts ──
function maxAbs(ns: number[]) { return Math.max(1, ...ns.map(Math.abs)); }

function JobCut({ rows, onDrill }: { rows: JobRow[]; onDrill: (r: JobRow) => void }) {
  const mx = maxAbs(rows.map(r => r.totalVar));
  return (
    <div className="vx-card">
      <div style={{ padding: "12px 16px 4px" }}><div className="vx-sectitle">Biggest margin movers — actual vs projected cost</div></div>
      {rows.slice(0, 40).map((r) => (
        <div key={r.id} className="vx-row" onClick={() => onDrill(r)}>
          <span style={{ width: 120, fontFamily: mono, fontSize: 12, color: T.text }}>{r.jobNumber}</span>
          <span style={{ width: 150, fontSize: 11.5, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.client}</span>
          <div className="vx-bartrack"><div className="vx-barfill" style={{ width: `${(Math.abs(r.totalVar) / mx) * 100}%`, marginLeft: r.totalVar < 0 ? "auto" : 0, background: r.totalVar > 0 ? T.red : T.green }} /></div>
          <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 700, width: 100, textAlign: "right", color: r.totalVar > 0 ? T.red : r.totalVar < 0 ? T.green : T.faint }}>{r.totalVar === 0 ? "✓ match" : money(r.totalVar)}</span>
        </div>
      ))}
    </div>
  );
}
function VendorCut({ vendors, onDrill }: { vendors: any[]; onDrill: (name: string) => void }) {
  return (
    <div className="vx-card">
      <div style={{ padding: "12px 16px 4px" }}><div className="vx-sectitle">Vendor scorecards — billed vs projected & accuracy</div></div>
      <div style={{ display: "flex", gap: 12, fontSize: 9.5, color: T.faint, padding: "2px 16px 6px", textTransform: "uppercase", letterSpacing: ".08em" }}>
        <span style={{ flex: 1 }}>Vendor</span><span style={{ width: 110, textAlign: "right" }}>Projected</span><span style={{ width: 110, textAlign: "right" }}>Billed</span><span style={{ width: 100, textAlign: "right" }}>Variance</span><span style={{ width: 90, textAlign: "right" }}>Accuracy</span>
      </div>
      {vendors.map((v) => (
        <div key={v.name} className="vx-row" onClick={() => onDrill(v.name)}>
          <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.name}</span>
          <span style={{ width: 110, textAlign: "right", fontFamily: mono, fontSize: 12, color: T.muted }}>{money(v.exp)}</span>
          <span style={{ width: 110, textAlign: "right", fontFamily: mono, fontSize: 12, color: T.text }}>{money(v.billed)}</span>
          <span style={{ width: 100, textAlign: "right", fontFamily: mono, fontSize: 12, fontWeight: 700, color: v.variance > 0 ? T.red : v.variance < 0 ? T.green : T.faint }}>{v.variance === 0 ? "✓" : money(v.variance)}</span>
          <span style={{ width: 90, textAlign: "right", fontFamily: mono, fontSize: 12, color: v.accuracy >= 90 ? T.green : v.accuracy >= 70 ? T.amber : T.red }}>{v.accuracy}%</span>
        </div>
      ))}
    </div>
  );
}
function BlanksCut({ rows, onDrill }: { rows: JobRow[]; onDrill: (r: JobRow) => void }) {
  const mx = maxAbs(rows.map(r => r.blankVar));
  return (
    <div className="vx-card">
      <div style={{ padding: "12px 16px 4px" }}><div className="vx-sectitle">Blanks — calculated vs actual (S&S)</div></div>
      {rows.map((r) => (
        <div key={r.id} className="vx-row" onClick={() => onDrill(r)}>
          <span style={{ width: 120, fontFamily: mono, fontSize: 12, color: T.text }}>{r.jobNumber}</span>
          <span style={{ width: 150, fontSize: 11.5, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.client}</span>
          <div className="vx-bartrack"><div className="vx-barfill" style={{ width: `${(Math.abs(r.blankVar) / mx) * 100}%`, marginLeft: r.blankVar < 0 ? "auto" : 0, background: r.blankVar > 0 ? T.red : T.green }} /></div>
          <span style={{ fontFamily: mono, fontSize: 11, color: T.faint, width: 180, textAlign: "right" }}>{money(r.blankCalc)} → {money(r.blankActual)}</span>
          <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 700, width: 90, textAlign: "right", color: r.blankVar > 0 ? T.red : r.blankVar < 0 ? T.green : T.faint }}>{r.blankVar === 0 ? "✓" : money(r.blankVar)}</span>
        </div>
      ))}
    </div>
  );
}
function MonthCut({ months }: { months: { month: string; v: number }[] }) {
  const mx = maxAbs(months.map(m => m.v));
  return (
    <div className="vx-card" style={{ padding: "16px 20px" }}>
      <div className="vx-sectitle">Cost variance by month</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 200, marginTop: 16, paddingBottom: 24, position: "relative" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: "50%", borderTop: `1px dashed ${T.border}` }} />
        {months.map((m, i) => {
          const h = (Math.abs(m.v) / mx) * 80;
          return (
            <div key={m.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: m.v >= 0 ? "flex-end" : "flex-start", height: "100%", position: "relative" }}>
              <div style={{ position: "absolute", top: "50%", transform: m.v >= 0 ? "translateY(-100%)" : "none", width: "70%", maxWidth: 48 }}>
                <div title={money(m.v)} className="vx-barfill" style={{ height: `${Math.max(3, h)}px`, background: m.v > 0 ? T.red : T.green, borderRadius: m.v >= 0 ? "4px 4px 0 0" : "0 0 4px 4px", transformOrigin: m.v >= 0 ? "bottom" : "top", animationDelay: `${i * 40}ms` }} />
              </div>
              <div style={{ position: "absolute", bottom: -22, fontSize: 10.5, color: T.muted, whiteSpace: "nowrap" }}>{m.month}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: T.faint, marginTop: 8 }}>Red = billed over projection · green = under. Hover a bar for the amount.</div>
    </div>
  );
}
function FreightCut({ data }: { data: { rows: { jobNumber: string; client: string; actual: number; calc: number; margin: number }[]; pool: number; captured: number } }) {
  return (
    <div className="vx-card">
      <div style={{ padding: "12px 16px 4px" }}><div className="vx-sectitle">Freight margin captured — UPS-costed baseline vs actual (negotiated LTL)</div></div>
      <div style={{ display: "flex", gap: 12, fontSize: 9.5, color: T.faint, padding: "2px 16px 6px", textTransform: "uppercase", letterSpacing: ".08em" }}>
        <span style={{ width: 120 }}>Job</span><span style={{ flex: 1 }}>Client</span><span style={{ width: 100, textAlign: "right" }}>Baseline</span><span style={{ width: 100, textAlign: "right" }}>Actual</span><span style={{ width: 110, textAlign: "right" }}>Margin</span>
      </div>
      {data.rows.map((r, i) => (
        <div key={r.jobNumber + i} className="vx-row" style={{ cursor: "default" }}>
          <span style={{ width: 120, fontFamily: mono, fontSize: 12, color: T.text }}>{r.jobNumber}</span>
          <span style={{ flex: 1, fontSize: 11.5, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.client}</span>
          <span style={{ width: 100, textAlign: "right", fontFamily: mono, fontSize: 12, color: T.muted }}>{money(r.calc)}</span>
          <span style={{ width: 100, textAlign: "right", fontFamily: mono, fontSize: 12, color: T.text }}>{money(r.actual)}</span>
          <span style={{ width: 110, textAlign: "right", fontFamily: mono, fontSize: 12.5, fontWeight: 700, color: r.margin > 0 ? T.green : r.margin < 0 ? T.red : T.faint }}>{r.margin >= 0 ? "+" : ""}{money(r.margin)}</span>
        </div>
      ))}
      {data.pool ? (
        <div className="vx-row" style={{ cursor: "default" }}>
          <span style={{ width: 120, fontSize: 12, color: T.muted }}>—</span>
          <span style={{ flex: 1, fontSize: 11.5, color: T.muted }}>General freight (not job-specific)</span>
          <span style={{ width: 100, textAlign: "right", fontFamily: mono, fontSize: 12, color: T.faint }}>—</span>
          <span style={{ width: 100, textAlign: "right", fontFamily: mono, fontSize: 12, color: T.text }}>{money(data.pool)}</span>
          <span style={{ width: 110, textAlign: "right", fontFamily: mono, fontSize: 12.5, fontWeight: 700, color: T.red }}>−{money(data.pool)}</span>
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 12, padding: "11px 16px", borderTop: `2px solid ${T.border}`, alignItems: "center" }}>
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 800, color: T.text }}>Net freight margin captured</span>
        <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 800, color: data.captured >= 0 ? T.green : T.red }}>{data.captured >= 0 ? "+" : ""}{money(data.captured)}</span>
      </div>
      <div style={{ fontSize: 11, color: T.faint, padding: "0 16px 12px" }}>Baseline = the UPS rate costed into the job. Actual = what we paid via our negotiated network. Green margin = freight savings we keep.</div>
    </div>
  );
}
