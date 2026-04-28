"use client";
import { T, font, mono } from "@/lib/theme";

type Step = {
  id: string;
  label: string;
  done: boolean;
  active: boolean;
  detail?: string;
  inProgress?: boolean;
};

export function ProjectProgress({ job, items, payments, proofStatus, onTabClick, activeTab }: {
  job: any;
  items: any[];
  payments: any[];
  proofStatus: Record<string, { allApproved: boolean }>;
  onTabClick: (tab: string) => void;
  activeTab: string;
}) {
  const hasItems = items.length > 0;
  // Keep aligned with lib/pricing.ts + BlanksTab.jsx + CostingTab.jsx +
  // jobs/page.tsx. Anything in this list isn't a real garment blank —
  // it's priced via custom-cost lines and should be excluded from the
  // blanks denominator and from the "needs a blank" gate.
  const NON_GARMENT = ["accessory","patch","sticker","poster","pin","koozie","banner","flag","lighter","towel","water_bottle","samples","custom","key_chain","woven_labels","bandana","socks","tote","custom_bag","pillow","rug","pens","napkins","balloons","stencils"];
  const itemReady = (it: any) => {
    const hasBlank = it.blank_vendor || NON_GARMENT.includes(it.garment_type);
    const qty = it.totalQty || Object.values(it.qtys || {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0);
    return hasBlank && qty > 0;
  };
  const builderComplete = hasItems && items.every(itemReady);
  const hasCosting = items.some(it => it.decorator);
  const costingLocked = !!(job.type_meta as any)?.costing_locked;
  const quoteApproved = job.quote_approved;
  const allProofsApproved = items.length > 0 && items.every(it => proofStatus[it.id]?.allApproved || it.artwork_status === "approved");
  const hasProofs = items.some(it => (it as any).hasFiles);

  const terms = job.payment_terms || "";
  const isNetTerms = terms === "net_15" || terms === "net_30";
  let paymentMet = false;
  if (!terms) paymentMet = false;
  else if (isNetTerms) paymentMet = true;
  else if (terms === "prepaid") paymentMet = payments.filter((p: any) => p.status === "paid").reduce((a: number, p: any) => a + p.amount, 0) > 0;
  else if (terms === "deposit_balance") paymentMet = payments.some((p: any) => p.status === "paid" || p.status === "partial");
  else paymentMet = false;

  // Match BlanksTab's filter — only real garments count toward the blanks
  // denominator. Filtering on just "accessory" missed patches, stickers,
  // pins, etc., so a job with 2 garments + 4 accessories displayed 2/6
  // here while the in-tab summary correctly showed 2/2.
  const apparelItems = items.filter(it => !NON_GARMENT.includes(it.garment_type));
  const blanksOrdered = apparelItems.filter(it => (it.blanks_order_cost ?? 0) > 0).length;
  const allBlanksOrdered = items.length > 0 && (apparelItems.length === 0 || blanksOrdered === apparelItems.length);
  const poSentVendors = job.type_meta?.po_sent_vendors || [];
  const costProds = job.costing_data?.costProds || [];
  const vendors = [...new Set(costProds.map((cp: any) => cp.printVendor).filter(Boolean))] as string[];
  const allPosSent = vendors.length > 0 && vendors.every((v: string) => poSentVendors.includes(v));
  const atDecorator = items.some(it => it.pipeline_stage === "in_production");
  const allShipped = items.length > 0 && items.every(it => it.pipeline_stage === "shipped");

  const isArchived = job.phase === "complete" || job.phase === "cancelled";

  // Working-flow steps — hidden on complete/cancelled so the header stays clean
  const workingSteps: Step[] = [
    { id: "builder", label: "Product Builder", done: hasItems && builderComplete, active: !hasItems || !builderComplete, inProgress: hasItems && !builderComplete, detail: hasItems ? `${items.length}` : undefined },
    { id: "costing", label: "Costing", done: costingLocked, active: hasItems && !costingLocked, inProgress: hasCosting && !costingLocked },
    { id: "quote", label: "Quote", done: quoteApproved, active: costingLocked && !quoteApproved },
    { id: "proofs", label: "Proofs & Invoice", done: paymentMet && allProofsApproved, active: quoteApproved && (!paymentMet || !allProofsApproved) },
    { id: "blanks", label: "Blanks", done: allBlanksOrdered, active: paymentMet && allProofsApproved && !allBlanksOrdered, detail: apparelItems.length > 0 && blanksOrdered > 0 ? `${blanksOrdered}/${apparelItems.length}` : undefined },
    { id: "po", label: "PO", done: allPosSent, active: allBlanksOrdered && !allPosSent },
  ];

  const steps: Step[] = isArchived
    ? [
        { id: "overview", label: "Overview", done: true, active: false },
        { id: "documents", label: "Documents", done: true, active: false },
      ]
    : [
        { id: "overview", label: "Overview", done: true, active: false },
        ...workingSteps,
        { id: "documents", label: "Documents", done: true, active: false },
      ];

  const completedCount = steps.filter(s => s.done).length;
  const denom = Math.max(1, steps.length - 2); // exclude Overview + Documents from progress calc
  const pct = isArchived ? 100 : Math.round(((completedCount - 2) / denom) * 100);

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
      {/* Progress bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ flex: 1, height: 4, background: T.surface, borderRadius: 2 }}>
          <div style={{ height: "100%", width: pct + "%", background: pct === 100 ? T.green : T.accent, borderRadius: 2, transition: "width 0.3s" }} />
        </div>
        <span style={{ fontSize: 10, fontFamily: mono, color: pct === 100 ? T.green : T.muted, fontWeight: 600 }}>{pct}%</span>
      </div>

      {/* Nav steps */}
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
        {steps.map((step, i) => {
          const isCurrent = activeTab === step.id || (step.id === "quote" && activeTab === "quote");
          const nextIdx = steps.findIndex(s => !s.done);
          const isNext = i === nextIdx;
          return (
            <button
              key={i}
              onClick={() => onTabClick(step.id)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "6px 16px", borderRadius: 99, fontSize: 12,
                fontFamily: font, fontWeight: isCurrent ? 700 : isNext ? 600 : step.done ? 500 : 400,
                cursor: "pointer", border: isCurrent ? `2px solid ${T.accent}` : "2px solid transparent",
                background: isCurrent ? T.accent : step.done ? T.greenDim : step.inProgress ? T.amberDim : isNext ? T.accentDim : "transparent",
                color: isCurrent ? "#fff" : step.done ? T.green : step.inProgress ? T.amber : isNext ? T.accent : T.faint,
                transition: "all 0.15s",
              }}
            >
              {!isCurrent && <span style={{ fontSize: 8 }}>{step.done ? "✓" : isNext ? "→" : "○"}</span>}
              {step.label}
              {step.detail && !isCurrent && <span style={{ fontFamily: mono, fontSize: 9, opacity: 0.7 }}>{step.detail}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
