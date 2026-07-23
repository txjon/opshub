"use client";
// Job-detail header: the shared status bar (status ONLY — same render + hover peek
// as the /projects list, navigate=false) over a FLAT button nav. The bar shows
// where the job is; the buttons are the only navigation. One map each — no more
// two competing navs. See [[jon-clean-architecture-standard]].
import type { ReactNode } from "react";
import { T, font } from "@/lib/theme";
import { deriveProjectStage, type ProjStage } from "@/lib/project-stage";
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

// THE CALL TO ACTION (Jon, Jul 22: "I land in overview... there's no call to
// action, it's missing the client hub skin and feel"). The hub speaks to the
// client in verbs; this is the same grammar pointed at whoever's running the
// job. Derived ENTIRELY from the stage the status bar already computed
// (deriveProjectStage) so the headline can never drift from the spine — same
// signal, same milestone, one source. Eyebrow names WHO owns the move; the
// door is bold (white pill) only when it's ours to make, quiet (outline) when
// we're waiting on someone. Shown on Overview only — once you're on a working
// tab, the bar + nav is enough.
type JobCta = {
  tone: "act" | "wait" | "late";
  eyebrow: string; verb: string; line: string; done?: string;
  tab?: string;   // in-page tab (onBuild)
  href?: string;  // external board (warehouse tail)
  go: string;
};

function jobCta(stage: ProjStage, job: any, items: any[]): JobCta | null {
  if (stage.complete) return null;
  const jn = encodeURIComponent(job.job_number || "");
  const sig = stage.signal;

  if (stage.preQuote) {
    // Sizes + blanks are assigned in the Product Builder (Jon's question, take
    // three: "at what phase do we do that?"). So the pre-quote move splits:
    // no items → build one; items that still have zero units → finish the
    // build (that's where sizes live); everything sized → cost & quote.
    const qtyOf = (it: any) => it.totalQty || Object.values(it.qtys || {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0);
    if (!items.length)
      return { tone: "act", eyebrow: "Your move", verb: "Build it out", line: "Add each product, give it a blank and its sizes. This is where a design becomes something you can price and sell.", done: "every item has a blank + sizes", tab: "builder", go: "Open the builder" };
    if (items.some(it => qtyOf(it) === 0))
      return { tone: "act", eyebrow: "Your move", verb: "Finish the build", line: "Some items still need their sizes (and a blank, if it's apparel). Set both in the Product Builder, then cost it.", done: "every item has its sizes in", tab: "builder", go: "Open the builder" };
    return { tone: "act", eyebrow: "Your move", verb: "Cost & quote it", line: "Price each item in Costing. The quote builds itself from your margins, then send it.", done: "quote sent, approval opens in their hub", tab: "costing", go: "Open costing" };
  }

  switch (stage.milestone) {
    case "quote_appr":
      if (!job.quote_approved) {
        return sig === "late"
          ? { tone: "late", eyebrow: "Approval overdue", verb: "Nudge the quote", line: `The quote's been out with no word (${stage.reason || "a few days"}). A quick check-in keeps it warm.`, done: "they approve or ask for changes", tab: "quote", go: "Open the quote" }
          : { tone: "wait", eyebrow: "With the client", verb: "Quote's with them", line: "They're reviewing it in their hub. Give it a nudge if it sits more than a couple days.", done: "they approve or ask for changes", tab: "quote", go: "Open the quote" };
      }
      // approved, proofs still pending
      return { tone: "wait", eyebrow: "Proofs out", verb: "Waiting on sign-off", line: `The quote's approved${stage.proofs ? ` and ${stage.proofs.approved} of ${stage.proofs.total} proofs are signed off` : ""}. Send any still pending, they approve the whole set in one tap.`, done: "all proofs approved", tab: "quote", go: "Open proofs" };
    case "invoice":
      return { tone: "act", eyebrow: "Your move", verb: "Send the invoice", line: "They approved the package. Send the invoice so the money clock starts.", done: "invoice sent", tab: "invoice", go: "Open invoice" };
    case "paid":
      return { tone: "wait", eyebrow: "With the client", verb: "Waiting on payment", line: "Invoice is out on prepaid or deposit terms. Production holds until their payment lands.", done: "payment recorded", tab: "invoice", go: "Open invoice" };
    case "order":
      return stage.reason === "Send POs"
        ? { tone: "act", eyebrow: "Your move", verb: "Fire the POs", line: "Blanks are ordered. Send each vendor their PO with the print-ready links.", done: "every vendor marked sent", tab: "po", go: "Open the PO" }
        : { tone: "act", eyebrow: "Your move", verb: "Order the blanks", line: "Every gate is green. Order blanks per item, then log the order number and cost.", done: "every apparel item has an order in", tab: "blanks", go: "Open blanks" };
    case "production":
      return sig === "late"
        ? { tone: "late", eyebrow: "Vendor running late", verb: "Chase the vendor", line: "The ship-by date passed and nothing's moving. Call for a real date and log it on the PO.", done: "tracking enters or a new ship-by is logged", href: `/production2?q=${jn}`, go: "Open the board" }
        : { tone: "wait", eyebrow: "At the presses", verb: "In production", line: "Nothing to do here. The House watches the vendor clocks, and the dock takes it at landing.", done: "tracking enters", href: `/production2?q=${jn}`, go: "See the board" };
    case "receiving":
      return { tone: "act", eyebrow: "At the dock", verb: "Receive it", line: "Boxes are landing. Confirm the quantities per size as they come in.", done: "every item received", href: `/receiving2?q=${jn}`, go: "Open receiving" };
    case "shipping":
      return { tone: "act", eyebrow: "At the dock", verb: "Send it on", line: "It landed for a ship-through. Enter outbound tracking and mark it shipped.", done: "tracking entered, the job completes itself", href: `/shipping2?q=${jn}`, go: "Open shipping" };
    case "fulfillment":
      return { tone: "act", eyebrow: "On the shelf", verb: "Key it into Shopify", line: "Goods are staged. Enter the counts into Shopify; it and ShipStation own the web orders from there.", done: "every item entered, the job completes itself", href: `/staging2?q=${jn}`, go: "Open staging" };
  }
  return null;
}

export function JobFlowBar({ job, items, payments, phaseView, activeTab, onBuild, rightSlot, proofStatus }: {
  job: any; items: any[]; payments: any[]; phaseView: any; activeTab: string;
  onBuild: (tabKey: string) => void;
  rightSlot?: ReactNode;
  proofStatus?: Record<string, { allApproved: boolean }>; // per-item proof approvals — gates the Approved milestone
}) {
  const stage = deriveProjectStage(job, phaseView, items || [], payments || [], proofStatus);
  // The directive hero — only where you land (Overview), never on a working tab.
  const cta = activeTab === "overview" ? jobCta(stage, job, items || []) : null;
  const doorBase = { borderRadius: 999, padding: "11px 22px", fontSize: 11, fontWeight: 800 as const, letterSpacing: "0.06em", textTransform: "uppercase" as const, cursor: "pointer", fontFamily: font, marginTop: 15, display: "inline-block", textDecoration: "none" };
  const doorSkin = cta && cta.tone === "wait"
    ? { background: "transparent", color: T.text, border: `1px solid ${T.border}` }
    : { background: T.accent, color: "#0a0a0a", border: "none" };
  return (
    <>
      {cta && (
        <div style={{ background: T.card, border: `1px solid ${cta.tone === "late" ? "rgba(255,90,110,0.42)" : T.border}`, borderRadius: 14, padding: "20px 22px", margin: "6px 0 0" }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: cta.tone === "late" ? T.red : cta.tone === "wait" ? T.blue : T.amber }}>{cta.eyebrow}</div>
          <div style={{ fontSize: "clamp(21px,2.6vw,29px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", lineHeight: 1.04, margin: "6px 0 8px", color: T.text }}>{cta.verb}.</div>
          <div style={{ fontSize: 13.5, color: T.muted, lineHeight: 1.55, maxWidth: "60ch" }}>{cta.line}</div>
          {cta.done && <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: cta.tone === "late" ? T.red : cta.tone === "wait" ? T.faint : T.amber, marginTop: 8 }}>done when {cta.done}</div>}
          {cta.tab
            ? <button onClick={() => onBuild(cta.tab!)} style={{ ...doorBase, ...doorSkin }}>{cta.go} →</button>
            : <a href={cta.href} style={{ ...doorBase, ...doorSkin }}>{cta.go} →</a>}
        </div>
      )}

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
              style={{ border: `1px solid ${active ? T.accent : T.border}`, background: active ? T.accent : T.card, color: active ? "#0a0a0a" : T.muted, borderRadius: 9, padding: "8px 15px", fontSize: 13, fontWeight: active ? 800 : 700, cursor: "pointer", fontFamily: font }}>
              {l}
            </button>
          );
        })}
        {/* Far-right slot — pricing-lock status chip (job-level). */}
        {rightSlot && <div style={{ marginLeft: "auto" }}>{rightSlot}</div>}
      </div>
    </>
  );
}
