// Blank orders emailed to a supplier rep (mig 183). Some blank purchases go
// to a rep by email (S&S) instead of a credit-card checkout. The draft is built
// from the buy sheet here — one place decides what the email says — sent
// through the production inbox (the existing /api/email/compose path), then
// recorded so the Purchasing block shows which items went that way.
//
// Logic only. The view is components/BlankRepOrderModal.tsx.

import { sortSizes } from "./theme";

type Sb = any;
export type SizeQtys = Record<string, number>;

// items.blank_vendor holds the STYLE ("Comfort Colors 1717"), items.blank_sku the
// COLOR ("Burnt Orange"); the supplier (S&S, AS Colour…) is costing's `supplier`
// and is not always set — the modal lets the sender pick it.
export type RepOrderItem = {
  itemId: string; letter: string; name: string;
  style: string | null; color: string | null; supplier: string | null;
  qtys: SizeQtys;
};
export const SUPPLIERS = ["S&S", "AS Colour", "LA Apparel", "Cotton Collective"];
// The suppliers to offer = the ones the picker recorded on the selected items
// (items.blank_supplier). Only when none is known, fall back to the full list.
export function supplierChoices(items: RepOrderItem[]): string[] {
  const known = Array.from(new Set(items.map(i => i.supplier).filter(Boolean))) as string[];
  return known.length ? known : SUPPLIERS;
}
// Best guess: the most common known supplier among the selected items.
export function suggestSupplier(items: RepOrderItem[]): string {
  const cnt = new Map<string, number>();
  for (const it of items) if (it.supplier) cnt.set(it.supplier, (cnt.get(it.supplier) || 0) + 1);
  return Array.from(cnt.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || SUPPLIERS[0];
}
// Our PO number for a set of items = invoice number (job number pre-invoice) +
// the items' letters — the same number the vendor PO prints (e.g. 4511ABCDEF).
export const poNumber = (jobNumber: string, invoiceNumber: string | null, letters: string[]) => `${invoiceNumber || jobNumber}${letters.join("")}`;
export type ShipToOption = { key: string; label: string; address: string };

export type SupplierContact = { supplier: string; rep_name: string | null; rep_email: string; cc_emails: string[] };
export type BlankRepOrder = {
  id: string; job_id: string; supplier: string; to_email: string; cc_emails: string[];
  subject: string; ship_to: string | null; items: any[]; sent_at: string;
};

const sumQ = (q: SizeQtys) => Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);
export const sizesLine = (q: SizeQtys) =>
  sortSizes(Object.keys(q || {})).filter(s => (q[s] || 0) > 0).map(s => `${s} ${q[s]}`).join(" · ");

// The email, as plain text lines (the compose route wraps each line in a <p>).
export function draftBlankOrderEmail(args: {
  repName: string | null; clientName: string; jobNumber: string; invoiceNumber: string | null;
  items: RepOrderItem[]; shipTo: string; note: string; senderName: string | null;
}): { subject: string; body: string } {
  // Reference = OUR PO number + letters (what the vendor PO prints), never the
  // internal job number. Each item is its own order at the supplier, so each
  // line carries its own ATTN: PO<number><letter>.
  const base = args.invoiceNumber || args.jobNumber;
  const po = poNumber(args.jobNumber, args.invoiceNumber, args.items.map(i => i.letter));
  // The rep needs the ATTN, the blank style, the color and the size counts —
  // no client name, no in-house item names (Jon, Sep 21).
  const subject = `Blank order · PO ${po}`;
  const total = args.items.reduce((a, it) => a + sumQ(it.qtys), 0);
  const lines: string[] = [];
  lines.push(`Hi ${args.repName?.trim() || "there"},`);
  lines.push("");
  lines.push(`Please place the following blank orders under PO ${po}. Each block is its own order; please reference the ATTN on each.`);
  lines.push("");
  for (const it of args.items) {
    lines.push(`ATTN: PO${base}${it.letter}`);
    lines.push([it.style, it.color].filter(Boolean).join(" · ") || "Blank not assigned");
    lines.push(`${sizesLine(it.qtys)}  =  ${sumQ(it.qtys)}`);
    lines.push("");
  }
  lines.push(`Total: ${total.toLocaleString()} units`);
  lines.push("");
  lines.push("Ship to:");
  for (const l of args.shipTo.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) lines.push(`    ${l}`);
  if (args.note.trim()) { lines.push(""); lines.push(args.note.trim()); }
  lines.push("");
  lines.push("Please reply with the order confirmation and tracking once it ships.");
  lines.push("");
  lines.push("Thanks,");
  lines.push(args.senderName?.trim() || "House Party Distro");
  return { subject, body: lines.join("\n") };
}

// ── server reads/writes (browser client) ──

export async function loadSupplierContact(sb: Sb, supplier: string): Promise<SupplierContact | null> {
  const { data } = await sb.from("blank_supplier_contacts").select("supplier, rep_name, rep_email, cc_emails").eq("supplier", supplier).maybeSingle();
  return (data as SupplierContact) || null;
}

export async function loadBlankRepOrders(sb: Sb, jobId: string): Promise<BlankRepOrder[]> {
  const { data } = await sb.from("blank_rep_orders").select("id, job_id, supplier, to_email, cc_emails, subject, ship_to, items, sent_at")
    .eq("job_id", jobId).order("sent_at", { ascending: false });
  return (data || []) as BlankRepOrder[];
}

// Ship-to choices for the blanks: the decorators printing these items, and the
// tenant's warehouse. Addresses are free text here — it's an email.
export async function loadShipToOptions(sb: Sb, decoratorIds: string[]): Promise<ShipToOption[]> {
  const out: ShipToOption[] = [];
  if (decoratorIds.length) {
    const { data: decs } = await sb.from("decorators").select("id, name, address, city, state, zip, ship_from_address, ship_from_city, ship_from_state, ship_from_zip").in("id", decoratorIds);
    for (const d of decs || []) {
      // Blanks are DELIVERED to the vendor: use their main (receiving) address.
      // ship_from_* is where their goods leave, not where ours arrive (Icon's
      // Grove Ave ship-from vs Eckhoff receiving, Jon Sep 21). Ship-from is
      // only a fallback when no main address exists. The block stays editable.
      const useMain = !!(d.address || "").trim();
      const street = ((useMain ? d.address : d.ship_from_address) || "").trim();
      const city = useMain ? d.city : d.ship_from_city;
      const state = useMain ? d.state : d.ship_from_state;
      const zip = useMain ? d.zip : d.ship_from_zip;
      const cityLine = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      out.push({ key: `dec:${d.id}`, label: d.name, address: [d.name, street, cityLine].filter(Boolean).join("\n") });
    }
  }
  const { data: co } = await sb.from("companies").select("name, warehouse_address").eq("slug", "hpd").maybeSingle();
  if (co?.warehouse_address) out.push({ key: "hpd", label: `${co.name || "HPD"} warehouse`, address: `${co.name || "House Party Distro"}\n${co.warehouse_address}` });
  return out;
}

// Send through the production inbox (existing compose path: Resend +
// email_messages + activity), then record the rep order and remember the rep.
export async function sendBlankRepOrder(sb: Sb, args: {
  jobId: string; supplier: string; repName: string | null; toEmail: string; ccEmails: string[];
  subject: string; body: string; shipTo: string; items: RepOrderItem[];
}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/email/compose", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: args.jobId, toEmail: args.toEmail.trim(), ccEmails: args.ccEmails, subject: args.subject, body: args.body, channel: "production" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) return { ok: false, error: data?.error || `Send failed (${res.status})` };
  const { error } = await sb.from("blank_rep_orders").insert({
    job_id: args.jobId, supplier: args.supplier, to_email: args.toEmail.trim(), cc_emails: args.ccEmails,
    subject: args.subject, body: args.body, ship_to: args.shipTo, resend_message_id: data.id || null,
    items: args.items.map(it => ({ item_id: it.itemId, letter: it.letter, name: it.name, style: it.style, color: it.color, qtys: it.qtys, total: sumQ(it.qtys) })),
  });
  if (error) return { ok: false, error: `Sent, but the record failed: ${error.message}` };
  await sb.from("blank_supplier_contacts").upsert(
    { supplier: args.supplier, rep_name: args.repName?.trim() || null, rep_email: args.toEmail.trim(), cc_emails: args.ccEmails, updated_at: new Date().toISOString() },
    { onConflict: "company_id,supplier" },
  );
  return { ok: true };
}
