// resolveRecipients — THE one door for client-facing email recipients
// (Aug 3 2026, from the Jun-11 parked routing design, Jon's 3-category cut).
//
//   Approvals  → quote & proofs, proof revised
//   Invoices   → invoice/revised, reminders, receipts, fulfillment reports
//   Shipping   → shipped notifications (drop-ship, from-HPD, outside)
//
// Rules: a contact's doc_routing lists the categories they receive.
// NULL/empty doc_routing = ADMIN — receives everything (the zero-config
// default; every pre-routing contact behaves as before). A category with
// nobody assigned falls back to the admins; no admins → primary → anyone
// with an email. Manual send dialogs use this to PRE-CHECK (still editable);
// auto-sends follow it strictly.
export type DocCategory = "approvals" | "invoices" | "shipping";

export type RoutableContact = {
  email?: string | null;
  doc_routing?: string[] | null;
  is_primary?: boolean | null;      // client-level contacts
  role_on_job?: string | null;      // job-level contacts ("primary"/"billing"/…)
};

const isAdmin = (c: RoutableContact) => !c.doc_routing || c.doc_routing.length === 0;

export function resolveRecipients(category: DocCategory, contacts: RoutableContact[]): RoutableContact[] {
  const withEmail = (contacts || []).filter(c => (c.email || "").includes("@"));
  if (!withEmail.length) return [];
  const assigned = withEmail.filter(c => (c.doc_routing || []).includes(category));
  if (assigned.length) return assigned;
  const admins = withEmail.filter(isAdmin);
  if (admins.length) return admins;
  const primary = withEmail.find(c => c.is_primary || c.role_on_job === "primary");
  return primary ? [primary] : [withEmail[0]];
}

export function resolveRecipientEmails(category: DocCategory, contacts: RoutableContact[]): string[] {
  return Array.from(new Set(resolveRecipients(category, contacts).map(c => String(c.email).trim().toLowerCase())));
}
