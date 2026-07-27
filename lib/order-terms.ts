// THE single source for the order Terms & Conditions shown to clients. Both the
// quote PDF footer (app/api/pdf/quote) AND the client-hub approval confirm
// (components/portal/PackageApproval, via OrderExperience) read from here so the
// two never drift — the client agrees to the SAME terms at the click that they
// see on the PDF. Plain text (real & ± " chars); HTML surfaces escape as needed.

export type TermClause = { label: string; text: string };
export type TermsVariant = "default" | "dmd";

export const ORDER_TERMS: Record<TermsVariant, TermClause[]> = {
  default: [
    { label: "Validity", text: "This quote is valid for 30 days from the date of issue." },
    { label: "Payment", text: "Payment terms as agreed. A deposit may be required before production begins." },
    { label: "Production", text: "Lead times begin after approval of quote, receipt of payment, and approval of all artwork/proofs." },
    { label: "Art & Proofs", text: "Client is responsible for reviewing and approving all proofs prior to production. Changes after approval may incur additional charges." },
    { label: "Quantities", text: "Final quantities may vary ±3% from the order due to standard production tolerances, and are billed at the quantity produced." },
    { label: "Shipping", text: "Shipping costs are estimated and may vary. Final shipping charges will appear on the invoice." },
    { label: "Sales Tax", text: "Applicable sales tax will be calculated and added to the final invoice." },
    { label: "Cancellation", text: "Orders cancelled after production begins may be subject to cancellation fees." },
  ],
  dmd: [
    { label: "Validity", text: "This quote is valid for 30 days from the date of issue." },
    { label: "Payment & Deposit", text: "Payment terms as agreed. A deposit is required before production begins; the balance is due prior to shipment unless otherwise agreed in writing." },
    { label: "Pre-Production & Approval", text: "Tech packs, patterns, and pre-production samples must be approved in writing before bulk production. Changes after approval may affect price and lead time." },
    { label: "Materials", text: "Fabric, trim, and component availability can affect lead time, color, and pricing. Equivalent materials may be substituted when a specified material is unavailable." },
    { label: "Production Lead Time", text: "Lead times begin after the approved sample/quote, receipt of payment, and final approval of all specifications and artwork." },
    { label: "Measurements & Fit", text: "Garments are produced to the approved spec and grade. Standard cut-and-sew tolerances apply (typically ±1/2\" on key measurements)." },
    { label: "Color & Dye Lots", text: "Slight variation in color, dye lots, wash, and hand across production runs is inherent to apparel manufacturing and is not grounds for rejection." },
    { label: "Quantities", text: "Final quantities may vary ±3% per standard production tolerances and are billed at the quantity produced." },
    { label: "Shipping & Duties", text: "Shipping, freight, and any applicable import duties are estimated and may vary. Final charges appear on the invoice." },
    { label: "Sales Tax", text: "Applicable sales tax will be calculated and added to the final invoice." },
    { label: "Cancellation", text: "Orders cancelled after materials are sourced or production begins may be subject to fees for work and materials incurred." },
    { label: "Artwork & IP", text: "Client warrants it holds all rights to the designs, trademarks, and artwork provided for production." },
  ],
};

// The one line surfaced in PLAIN view at the approval click — the two clauses
// that actually protect a billing dispute (qty tolerance + estimated ship/tax).
export const TERMS_HIGHLIGHT =
  "Quantities may vary ±3% and are billed as produced. Shipping and sales tax are estimated and finalized on your invoice.";

// Payment-step notice — shown in the hub's invoice view right before the
// client continues to the payment processor. The SECOND consent layer (order
// approval was the first): review the invoice, then explicitly continue to
// pay. Client-safe plain language. Shown wherever a pay redirect happens so
// the wording never forks.
export const PAYMENT_NOTICE = [
  "Review your invoice above. The amount shown is what you'll be charged.",
  "When you continue, you'll be securely redirected to Intuit (QuickBooks Payments), our payment processor, to pay by credit card or bank transfer (ACH).",
  "We never see or store your card or bank details. Your payment is applied to this invoice and your order here updates automatically once it's received.",
  "By continuing to payment, you authorize the charge for the balance shown on this invoice.",
];

export function termsVariantForSlug(slug?: string | null): TermsVariant {
  return slug === "dmd" ? "dmd" : "default";
}
