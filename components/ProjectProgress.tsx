"use client";
import { T, font, mono } from "@/lib/theme";

type Step = {
  id: string;
  label: string;
  done: boolean;
  active: boolean;
  detail?: string;
};

export function ProjectProgress({ job, items, payments, proofStatus, onTabClick }: {
  job: any;
  items: any[];
  payments: any[];
  proofStatus: Record<string, { allApproved: boolean }>;
  onTabClick: (tab: string) => void;
}) {
  const hasItems = items.length > 0;
  const hasCosting = items.some(it => it.decorator);
  const quoteSent = true; // We don't track this explicitly yet
  const quoteApproved = job.quote_approved;
  const allProofsApproved = items.length > 0 && items.every(it => proofStatus[it.id]?.allApproved);
  const hasProofs = items.some(it => proofStatus[it.id]);

  const terms = job.payment_terms || "";
  const isNetTerms = terms === "net_15" || terms === "net_30";
  let paymentMet = isNetTerms;
  if (!isNetTerms) {
    if (terms === "prepaid") paymentMet = payments.filter((p: any) => p.status === "paid").reduce((a: number, p: any) => a + p.amount, 0) > 0;
    else if (terms === "deposit_balance") paymentMet = payments.some((p: any) => p.status === "paid" || p.status === "partial");
    else paymentMet = true;
  }

  const blanksOrdered = items.filter(it => it.blanks_order_number).length;
  const allBlanksOrdered = items.length > 0 && blanksOrdered === items.length;
  const poSentVendors = job.type_meta?.po_sent_vendors || [];
  const costProds = job.costing_data?.costProds || [];
  const vendors = [...new Set(costProds.map((cp: any) => cp.printVendor).filter(Boolean))] as string[];
  const allPosSent = vendors.length > 0 && vendors.every((v: string) => poSentVendors.includes(v));
  const atDecorator = items.some(it => it.pipeline_stage === "in_production");
  const allShipped = items.length > 0 && items.every(it => it.pipeline_stage === "shipped");

  const steps: Step[] = [
    { id: "buysheet", label: "Buy Sheet", done: hasItems, active: !hasItems, detail: hasItems ? `${items.length} items` : undefined },
    { id: "costing", label: "Costing", done: hasCosting, active: hasItems && !hasCosting },
    { id: "quote", label: "Quote Approved", done: quoteApproved, active: hasCosting && !quoteApproved },
    { id: "art", label: "Art Files", done: hasProofs, active: hasItems && !hasProofs },
    { id: "approvals", label: "Proofs Approved", done: allProofsApproved, active: quoteApproved && !allProofsApproved, detail: allProofsApproved ? undefined : `${items.filter(it => proofStatus[it.id]?.allApproved).length}/${items.length}` },
    { id: "approvals", label: "Payment", done: paymentMet, active: quoteApproved && !paymentMet, detail: isNetTerms ? "Net terms" : undefined },
    { id: "blanks", label: "Blanks Ordered", done: allBlanksOrdered, active: paymentMet && allProofsApproved && !allBlanksOrdered, detail: blanksOrdered > 0 ? `${blanksOrdered}/${items.length}` : undefined },
    { id: "po", label: "POs Sent", done: allPosSent, active: allBlanksOrdered && !allPosSent, detail: allPosSent ? undefined : vendors.length > 0 ? `${poSentVendors.length}/${vendors.length}` : undefined },
    { id: "production", label: "Production", done: allShipped, active: atDecorator && !allShipped },
  ];

  // Find the first incomplete step
  const nextIdx = steps.findIndex(s => !s.done);
  const completedCount = steps.filter(s => s.done).length;
  const pct = Math.round((completedCount / steps.length) * 100);

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
      {/* Progress bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ flex: 1, height: 4, background: T.surface, borderRadius: 2 }}>
          <div style={{ height: "100%", width: pct + "%", background: pct === 100 ? T.green : T.accent, borderRadius: 2, transition: "width 0.3s" }} />
        </div>
        <span style={{ fontSize: 10, fontFamily: mono, color: pct === 100 ? T.green : T.muted, fontWeight: 600 }}>{pct}%</span>
      </div>

      {/* Steps */}
      <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
        {steps.map((step, i) => {
          const isNext = i === nextIdx;
          return (
            <button
              key={i}
              onClick={() => onTabClick(step.id)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "3px 10px", borderRadius: 99, fontSize: 10,
                fontFamily: font, fontWeight: isNext ? 700 : step.done ? 500 : 400,
                cursor: "pointer", border: "none",
                background: step.done ? T.greenDim : isNext ? T.accentDim : "transparent",
                color: step.done ? T.green : isNext ? T.accent : T.faint,
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: 8 }}>{step.done ? "✓" : isNext ? "→" : "○"}</span>
              {step.label}
              {step.detail && <span style={{ fontFamily: mono, fontSize: 9, opacity: 0.7 }}>{step.detail}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
