"use client";
// Job-detail header: the shared status bar (status ONLY — same render + hover peek
// as the /projects list, navigate=false) over a FLAT button nav. The bar shows
// where the job is; the buttons are the only navigation. One map each — no more
// two competing navs. See [[jon-clean-architecture-standard]].
import { T, font } from "@/lib/theme";
import { deriveProjectStage } from "@/lib/project-stage";
import { JobStatusBar } from "@/components/JobStatusBar";

// The single nav: Overview · money/sign-off surfaces · build tools. Flat, one row.
// Ordered to follow the actual workflow / status-bar flow: build → cost →
// quote+proofs → invoice → blanks → PO.
const NAV: [string, string][] = [
  ["overview", "Overview"],
  ["builder", "Product Builder"],
  ["costing", "Costing"],
  ["quote", "Quote + Proofs"],
  ["invoice", "Invoice"],
  ["blanks", "Blanks"],
  ["po", "Purchase Order"],
];

export function JobFlowBar({ job, items, payments, phaseView, activeTab, onBuild }: {
  job: any; items: any[]; payments: any[]; phaseView: any; activeTab: string;
  onBuild: (tabKey: string) => void;
}) {
  const stage = deriveProjectStage(job, phaseView, items || [], payments || []);
  return (
    <>
      {/* Status bar — status only, identical to the /projects list (hover peek + ▲ caption). */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: "18px 20px 26px", margin: "6px 0 0", display: "flex" }}>
        <JobStatusBar job={job} stage={stage} items={items} payments={payments} showLabels tailNav />
      </div>

      {/* Flat button nav — the one and only navigation. */}
      <div style={{ display: "flex", gap: 8, margin: "16px 0", alignItems: "center", flexWrap: "wrap" }}>
        {NAV.map(([k, l]) => {
          const active = activeTab === k;
          return (
            <button key={k} onClick={() => onBuild(k)}
              style={{ border: `1px solid ${active ? T.accent : T.border}`, background: active ? T.accent : T.card, color: active ? "#fff" : T.muted, borderRadius: 9, padding: "8px 15px", fontSize: 13, fontWeight: active ? 800 : 700, cursor: "pointer", fontFamily: font }}>
              {l}
            </button>
          );
        })}
      </div>
    </>
  );
}
