"use client";
// V2 job detail — the job's HOME. Reuses deriveProjectStage (same model as the
// /projects board) so the list and detail share one status-bar language.
// Increment 1: the hub — header + status bar (gates + tail half-fills) + the
// "what's in this job" overview. Gate/tab clicks deep-link to the existing
// /jobs/[id] tabs for now; native surfaces (Invoice, etc.) land in later passes.
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { deriveProjectStage, PROJ_MILESTONES, ROUTE_DEAD } from "@/lib/project-stage";
import { loadJobPhasesBatch } from "@/lib/item-state";

const ROUTE_LABEL: Record<string, string> = { drop_ship: "drop-ship", ship_through: "ship-through", stage: "stage" };
const TERMS_LABEL: Record<string, string> = { net_15: "Net 15", net_30: "Net 30", net_45: "Net 45", net_60: "Net 60", prepaid: "Prepaid", deposit_balance: "Deposit" };
const HATCH = "repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(58,154,34,0.5) 3px,rgba(58,154,34,0.5) 4px)";
const GCOLORS = ["#243b6b", "#3a9a22", "#9a9aa2", "#c0392b", "#d4930f", "#1a1a1a", "#3a97ad", "#7b4fb5"];
const gcolor = (s: string) => GCOLORS[(s || "x").split("").reduce((a, c) => a + c.charCodeAt(0), 0) % GCOLORS.length];
const money = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;

const ZONES: { label: string; keys: string[]; blue?: boolean }[] = [
  { label: "Sign-off & money", keys: ["quote_sent", "quote_appr", "invoice", "paid"] },
  { label: "Build & execution", keys: ["order", "production"] },
  { label: "Fulfillment", keys: ["receiving", "shipping", "fulfillment"], blue: true },
];

export default function ProjectDetail() {
  const id = String(useParams().id);
  const router = useRouter();
  const supabase = createClient();
  const [job, setJob] = useState<any>(null);
  const [pv, setPv] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await supabase.from("jobs")
        .select("id, job_number, title, phase, shipping_route, payment_terms, quote_approved, quote_approved_at, type_meta, costing_summary, clients(name), payment_records(amount, status, paid_date), items(id, name, garment_type, sell_per_unit, pipeline_stage, blanks_order_cost, blanks_order_number, received_at_hpd, forwarded_at, webstore_entered_at, buy_sheet_lines(qty_ordered))")
        .eq("id", id).single();
      if (!live) return;
      setJob(data);
      if (data && data.phase !== "complete") {
        try { const m = await loadJobPhasesBatch(supabase, [data.id]); if (live) setPv(m.get(data.id)); } catch { }
      }
      setLoading(false);
    })();
    return () => { live = false; };
  }, [id]); // eslint-disable-line

  if (loading) return <div style={{ padding: 40, color: T.muted, fontFamily: font }}>Loading…</div>;
  if (!job) return <div style={{ padding: 40, color: T.muted, fontFamily: font }}>Job not found.</div>;

  const items = (job.items || []) as any[];
  const stage = deriveProjectStage(job, pv, items, job.payment_records || []);
  const dead = ROUTE_DEAD[stage.route] || [];
  const bars = PROJ_MILESTONES.filter(m => !dead.includes(m.k));
  const cur = bars.findIndex(m => m.k === stage.milestone);
  const N = bars.length;

  const nItems = items.length;
  const shipped = items.filter(it => it.pipeline_stage && it.pipeline_stage !== "in_production").length;
  const received = items.filter(it => it.received_at_hpd).length;
  const forwarded = items.filter(it => it.forwarded_at).length;
  const entered = items.filter(it => it.webstore_entered_at).length;
  const tailFrac: Record<string, number> = nItems ? { production: shipped / nItems, receiving: received / nItems, shipping: forwarded / nItems, fulfillment: entered / nItems } : {};

  const tm = job.type_meta || {}; const cs = job.costing_summary || {};
  const paidColor = stage.paidState === "paid" ? T.green : stage.paidState === "onaccount" ? T.blue : T.amber;
  const paidAmt = (job.payment_records || []).filter((p: any) => p.status === "paid").reduce((a: number, p: any) => a + (+p.amount || 0), 0);
  const invTotal = tm.qb_total_with_tax || cs.grossRev || 0;
  const invNo = tm.qb_invoice_number || job.job_number;
  const client = (job.clients as any)?.name || "—";
  const termsLabel = TERMS_LABEL[job.payment_terms as string] || "—";

  const HREF: Record<string, string> = {
    quote_sent: `/jobs/${id}?tab=quote`, quote_appr: `/jobs/${id}?tab=proofs`, invoice: `/jobs/${id}?tab=quote`,
    paid: `/jobs/${id}?tab=proofs`, order: `/jobs/${id}?tab=po`, production: `/production`,
    receiving: `/receiving`, shipping: `/shipping`, fulfillment: `/staging2`,
  };

  const qtyOf = (it: any) => ((it.buy_sheet_lines || []) as any[]).reduce((a, b) => a + (+b.qty_ordered || 0), 0);
  const totalUnits = items.reduce((a, it) => a + qtyOf(it), 0);
  const itemStatus = (it: any) => {
    if (it.forwarded_at) return { s: "Forwarded", c: T.green };
    if (it.received_at_hpd) return { s: "Received", c: T.green };
    if (it.pipeline_stage === "shipped") return { s: "Shipped from vendor", c: T.blue };
    if (it.pipeline_stage === "in_production") return { s: "In production", c: T.amber };
    if (it.blanks_order_cost != null || it.blanks_order_number) return { s: "Blanks ordered", c: T.muted };
    return { s: "In setup", c: T.faint };
  };

  const seg = (m: any, i: number) => {
    const base: any = { position: "absolute", left: `${(i / N) * 100}%`, top: 0, bottom: 0, width: `${100 / N}%` };
    const tf = tailFrac[m.k];
    if (tf !== undefined) {
      const reached = i <= cur || tf > 0;
      return <div key={m.k} style={{ ...base, background: reached ? HATCH : "transparent", overflow: "hidden" }}>
        {tf > 0 && <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${Math.round(tf * 100)}%`, background: T.green }} />}
      </div>;
    }
    if (m.k === "paid" && cur >= 0 && i <= cur) return <div key={m.k} style={{ ...base, background: paidColor }} />;
    if (cur >= 0 && i < cur) return <div key={m.k} style={{ ...base, background: T.green }} />;
    if (i === cur) {
      const c = stage.signal === "late" ? T.red : stage.signal === "act" ? T.amber : T.surface;
      const ring = stage.signal === "wait" ? `inset 0 0 0 1.5px ${T.faint}` : undefined;
      return <div key={m.k} style={{ ...base, background: c, boxShadow: ring }} />;
    }
    return null;
  };

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "18px 20px 80px", fontFamily: font, color: T.text }}>
      <button onClick={() => router.push("/projects")} style={{ background: "none", border: "none", color: T.muted, fontFamily: font, fontSize: 12, cursor: "pointer", padding: 0, marginBottom: 10 }}>← Projects</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: T.muted }}>{invNo}</div>
          <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.15 }}>{job.title}</div>
          <div style={{ fontSize: 12.5, color: T.muted, marginTop: 2 }}><b style={{ color: T.text }}>{client}</b> · <span style={{ color: stage.paidState === "onaccount" ? T.blue : T.muted }}>{termsLabel}</span> · {ROUTE_LABEL[stage.route] || stage.route}</div>
        </div>
        <button onClick={() => router.push(`/jobs/${id}`)} style={{ border: `1px solid ${T.border}`, background: T.card, color: T.muted, borderRadius: 9, padding: "8px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Open full job page →</button>
      </div>

      {/* status bar spine */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: "16px 18px 12px", marginTop: 16 }}>
        <div style={{ fontSize: 11, color: T.faint, marginBottom: 10 }}>The flow — click a gate to act on it.</div>
        <div style={{ position: "relative", height: 15, borderRadius: 8, background: T.surface, overflow: "hidden", margin: "0 4px" }}>
          {bars.map((m, i) => seg(m, i))}
          {bars.map((m, i) => i > 0 ? <div key={"t" + m.k} style={{ position: "absolute", left: `${(i / N) * 100}%`, top: 2, bottom: 2, width: 1, zIndex: 2, background: ((i - 1) < cur || ((i - 1) === cur && stage.signal !== "wait")) ? "rgba(255,255,255,.85)" : T.faint }} /> : null)}
        </div>
        <div style={{ display: "flex", marginTop: 8 }}>
          {ZONES.map(z => { const n = z.keys.filter(k => bars.some(b => b.k === k)).length; if (!n) return null; return <div key={z.label} style={{ flex: n, textAlign: "center", fontSize: 8.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: z.blue ? T.blue : T.faint, borderTop: `2px solid ${z.blue ? T.blue : T.border}`, paddingTop: 4, margin: "0 3px" }}>{z.label}</div>; })}
        </div>
        <div style={{ display: "flex", marginTop: 2 }}>
          {bars.map(m => {
            const tail = tailFrac[m.k] !== undefined;
            return <button key={m.k} onClick={() => router.push(HREF[m.k] || `/jobs/${id}`)} style={{ flex: 1, minWidth: 0, textAlign: "center", padding: "6px 2px", borderRadius: 7, background: "transparent", border: "none", cursor: "pointer", fontFamily: font }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", color: tail ? T.blue : T.muted, lineHeight: 1.15, wordBreak: "break-word" }}>{m.label}</div>
            </button>;
          })}
        </div>
      </div>

      {/* build tabs */}
      <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: T.faint }}>Build</span>
        {[["builder", "Product Builder"], ["costing", "Costing"], ["po", "PO / Blanks"]].map(([k, l]) =>
          <button key={k} onClick={() => router.push(`/jobs/${id}?tab=${k}`)} style={{ border: `1px solid ${T.border}`, background: T.card, color: T.muted, borderRadius: 9, padding: "8px 15px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: font }}>{l}</button>)}
      </div>

      {/* overview */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: "18px 20px", marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>What&apos;s in this job</div>
          <div style={{ fontSize: 12, color: T.muted }}>{nItems} item{nItems !== 1 ? "s" : ""} · {totalUnits} units</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12, marginBottom: 18 }}>
          {items.map(it => {
            const st = itemStatus(it); const gc = gcolor(it.garment_type || it.name);
            return <div key={it.id} onClick={() => router.push(`/jobs/${id}?tab=builder`)} style={{ border: `1px solid ${T.border}`, borderRadius: 11, overflow: "hidden", background: T.card, cursor: "pointer" }}>
              <div style={{ aspectRatio: "1", background: "#f2f2f4", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ width: "62%", height: "62%", borderRadius: 14, background: gc, boxShadow: "0 2px 8px rgba(0,0,0,.12)" }} />
              </div>
              <div style={{ padding: "9px 11px 11px" }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name || "Untitled"}</div>
                <div style={{ fontSize: 10.5, color: T.muted, marginTop: 3, fontFamily: mono }}>{qtyOf(it)} · {it.sell_per_unit ? money(it.sell_per_unit) : "—"}/unit</div>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: st.c, marginTop: 3 }}>{st.s}</div>
              </div>
            </div>;
          })}
          {!items.length && <div style={{ color: T.muted, fontSize: 13 }}>No items yet.</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 11, padding: "13px 15px" }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: T.faint, marginBottom: 8 }}>Money</div>
            {([["Quote", cs.grossRev ? money(cs.grossRev) : "—"], ["Invoice", tm.qb_invoice_number ? `#${tm.qb_invoice_number} · ${money(invTotal)}` : "not invoiced"], ["Terms", termsLabel + (stage.paidState === "onaccount" ? " · on account" : "")], ["Paid / balance", `${money(paidAmt)} / ${money(Math.max(0, invTotal - paidAmt))}`]] as [string, string][]).map(([k, v]) =>
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}><span style={{ color: T.muted }}>{k}</span><span style={{ fontWeight: 700 }}>{v}</span></div>)}
          </div>
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 11, padding: "13px 15px" }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: T.faint, marginBottom: 8 }}>Client · ship</div>
            {([["Client", client], ["Route", ROUTE_LABEL[stage.route] || stage.route], ["In-hands", tm.in_hands_date || "—"]] as [string, string][]).map(([k, v]) =>
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}><span style={{ color: T.muted }}>{k}</span><span style={{ fontWeight: 700 }}>{v}</span></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
