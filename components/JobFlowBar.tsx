"use client";
// The shared job status-bar nav — the /projects board's model rendered as the
// job-detail navigation. Gate clicks emit the milestone key (parent maps to a tab
// or a warehouse page); build clicks emit the tab key. The parent MUST route these
// through switchTab so the costing save contract is preserved — this component
// never touches state or saves.
import { T, font } from "@/lib/theme";
import { deriveProjectStage, PROJ_MILESTONES, ROUTE_DEAD } from "@/lib/project-stage";

const HATCH = "repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(58,154,34,0.5) 3px,rgba(58,154,34,0.5) 4px)";
const ZONES: { label: string; keys: string[]; blue?: boolean }[] = [
  { label: "Sign-off & money", keys: ["quote_sent", "quote_appr", "invoice", "paid"] },
  { label: "Build & execution", keys: ["order", "production"] },
  { label: "Fulfillment", keys: ["receiving", "shipping", "fulfillment"], blue: true },
];
const BUILD: [string, string][] = [["builder", "Product Builder"], ["costing", "Costing"], ["blanks", "Blanks"], ["po", "Purchase Order"]];

export function JobFlowBar({ job, items, payments, phaseView, activeTab, onGate, onBuild }: {
  job: any; items: any[]; payments: any[]; phaseView: any; activeTab: string;
  onGate: (milestoneKey: string) => void; onBuild: (tabKey: string) => void;
}) {
  const its = items || [];
  const stage = deriveProjectStage(job, phaseView, its, payments || []);
  const dead = ROUTE_DEAD[stage.route] || [];
  const bars = PROJ_MILESTONES.filter(m => !dead.includes(m.k));
  const cur = bars.findIndex(m => m.k === stage.milestone);
  const N = bars.length;

  const nItems = its.length;
  const shipped = its.filter((it: any) => it.pipeline_stage && it.pipeline_stage !== "in_production").length;
  const received = its.filter((it: any) => it.received_at_hpd).length;
  const forwarded = its.filter((it: any) => it.forwarded_at).length;
  const entered = its.filter((it: any) => it.webstore_entered_at).length;
  const tailFrac: Record<string, number> = nItems ? { production: shipped / nItems, receiving: received / nItems, shipping: forwarded / nItems, fulfillment: entered / nItems } : {};
  const paidColor = stage.paidState === "paid" ? T.green : stage.paidState === "onaccount" ? T.blue : T.amber;

  const seg = (m: any, i: number) => {
    const base: any = { position: "absolute", left: `${(i / N) * 100}%`, top: 0, bottom: 0, width: `${100 / N}%` };
    const tf = tailFrac[m.k];
    if (tf !== undefined) {
      const reached = i <= cur || tf > 0;
      return <div key={m.k} style={{ ...base, background: reached ? HATCH : "transparent", overflow: "hidden" }}>{tf > 0 && <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${Math.round(tf * 100)}%`, background: T.green }} />}</div>;
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
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: "16px 18px 12px", margin: "8px 0 4px" }}>
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
          return <button key={m.k} onClick={() => onGate(m.k)} style={{ flex: 1, minWidth: 0, textAlign: "center", padding: "6px 2px", borderRadius: 7, background: "transparent", border: "none", cursor: "pointer", fontFamily: font }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", color: tail ? T.blue : T.muted, lineHeight: 1.15, wordBreak: "break-word" }}>{m.label}</div>
          </button>;
        })}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => onBuild("overview")} style={{ border: `1px solid ${activeTab === "overview" ? T.accent : T.border}`, background: activeTab === "overview" ? T.accent : T.card, color: activeTab === "overview" ? "#fff" : T.text, borderRadius: 9, padding: "7px 15px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: font }}>Overview</button>
        <span style={{ width: 1, alignSelf: "stretch", background: T.border, margin: "2px 4px" }} />
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: T.faint }}>Build</span>
        {BUILD.map(([k, l]) => <button key={k} onClick={() => onBuild(k)} style={{ border: `1px solid ${activeTab === k ? T.accent : T.border}`, background: activeTab === k ? T.accent : T.card, color: activeTab === k ? "#fff" : T.muted, borderRadius: 9, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: font }}>{l}</button>)}
      </div>
    </div>
  );
}
