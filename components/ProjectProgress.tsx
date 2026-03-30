"use client";
import { T, font, mono } from "@/lib/theme";

type Step = {
  id: string;
  label: string;
  done: boolean;
  active: boolean;
  detail?: string;
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
  const hasCosting = items.some(it => it.decorator);
  const quoteApproved = job.quote_approved;
  const allProofsApproved = items.length > 0 && items.every(it => proofStatus[it.id]?.allApproved || it.artwork_status === "approved");
  const hasProofs = items.some(it => (it as any).hasFiles);

  const terms = job.payment_terms || "";
  const isNetTerms = terms === "net_15" || terms === "net_30";
  let paymentMet = isNetTerms;
  if (!isNetTerms) {
    if (terms === "prepaid") paymentMet = payments.filter((p: any) => p.status === "paid").reduce((a: number, p: any) => a + p.amount, 0) > 0;
    else if (terms === "deposit_balance") paymentMet = payments.some((p: any) => p.status === "paid" || p.status === "partial");
    else paymentMet = true;
  }

  const apparelItems = items.filter(it => it.garment_type !== "accessory");
  const blanksOrdered = apparelItems.filter(it => it.blanks_order_number).length;
  const allBlanksOrdered = apparelItems.length === 0 || blanksOrdered === apparelItems.length;
  const poSentVendors = job.type_meta?.po_sent_vendors || [];
  const costProds = job.costing_data?.costProds || [];
  const vendors = [...new Set(costProds.map((cp: any) => cp.printVendor).filter(Boolean))] as string[];
  const allPosSent = vendors.length > 0 && vendors.every((v: string) => poSentVendors.includes(v));
  const atDecorator = items.some(it => it.pipeline_stage === "in_production");
  const allShipped = items.length > 0 && items.every(it => it.pipeline_stage === "shipped");

  const steps: Step[] = [
    { id: "overview", label: "Overview", done: true, active: false },
    { id: "buysheet", label: "Buy Sheet", done: hasItems, active: !hasItems, detail: hasItems ? `${items.length}` : undefined },
    { id: "costing", label: "Costing", done: hasCosting, active: hasItems && !hasCosting },
    { id: "quote", label: "Quote", done: quoteApproved, active: hasCosting && !quoteApproved },
    { id: "art", label: "Art Files", done: hasProofs, active: hasItems && !hasProofs },
    { id: "approvals", label: "Approvals", done: allProofsApproved && paymentMet, active: quoteApproved && (!allProofsApproved || !paymentMet) },
    { id: "blanks", label: "Blanks", done: allBlanksOrdered, active: paymentMet && allProofsApproved && !allBlanksOrdered, detail: apparelItems.length > 0 && blanksOrdered > 0 ? `${blanksOrdered}/${apparelItems.length}` : undefined },
    { id: "po", label: "PO", done: allPosSent, active: allBlanksOrdered && !allPosSent },
    { id: "production", label: "Production", done: allShipped, active: atDecorator && !allShipped },
  ];

  const completedCount = steps.filter(s => s.done).length;
  const pct = Math.round(((completedCount - 1) / (steps.length - 1)) * 100); // -1 to exclude Overview which is always done

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
                background: isCurrent ? T.accent : step.done ? T.greenDim : isNext ? T.accentDim : "transparent",
                color: isCurrent ? "#fff" : step.done ? T.green : isNext ? T.accent : T.faint,
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
