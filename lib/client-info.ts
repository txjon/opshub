// The client info form (Oct 13 2026) — clients keep their own company info,
// contacts, ship-to addresses and resale certificates current from their hub
// (/portal/client/[token]/company). ONE module for prefill, apply and review.
//
// Rules (Jon, Oct 13):
//   - company info, contacts and addresses APPLY on submit (logged in
//     client_info_submissions.applied — reversible by hand);
//   - tax certificates WAIT for staff review. Approving one is the only thing
//     that marks the QuickBooks customer exempt (QB = the tax switch, mig 198);
//     OpsHub's tax flag then mirrors QB (lib/client-tax-sync).
//   - the client never renames themselves: clients.name is HPD's handle.

import { setCustomerTaxExempt, getCustomerById } from "./quickbooks";
import { BILL_ADDR_COLS, EMPTY_ADDR, LOC_ADDR_COLS, addrProblem, billAddr, billAddrCols, cleanAddr, formatAddress, fromQbAddr, locAddr, locAddrCols, parseAddressText, type Addr } from "./address";
import { syncClientTaxFromQB } from "./client-tax-sync";
import { uploadFile } from "./google-drive";
import { getDriveToken, getPrivateDocFolder } from "./drive-token";

type Db = any;
export const CERT_BUCKET = "client-docs";

export { US_STATES } from "./address";   // one list (lib/address)

// Resale certificates are filed as "<Client> - Resale Cert" (Jon, Oct 13) —
// the client's upload name ("scan_0042.pdf") meant nothing in Drive. Keeps the
// extension; a state suffix only when one submission files several.
export function resaleCertFileName(client: string, original: string | null | undefined, state?: string): string {
  const ext = (String(original || "").match(/\.[A-Za-z0-9]{1,5}$/) || [""])[0].toLowerCase();
  const who = String(client || "Client").replace(/[\/\\:*?"<>|]+/g, " ").trim();
  return `${who} - Resale Cert${state ? ` ${state}` : ""}${ext}`;
}

export type InfoContact = { id?: string; name: string; email: string; phone: string; role: string; isPrimary: boolean; getsInvoices: boolean; remove?: boolean };
// addresses are PARTS (mig 200). onFile = the old one-line text of an address
// that was never split, shown to the client so they can re-enter it.
export type InfoLocation = { id?: string; label: string; addr: Addr; onFile?: string; contactName: string; contactPhone: string; deliveryNotes: string; isDefault: boolean; remove?: boolean };
export type InfoCert = { state: string; permitNumber: string; issuedOn: string; uploadPath: string; fileName: string; existingFileId?: string };
export type InfoPayload = {
  // no EIN: clients paying us owe us no tax ID (Jon, Oct 13); clients.ein stays staff-only
  company: { legalName: string; website: string; billing: Addr; billingOnFile?: string; invoicePoRequired: boolean };
  contacts: InfoContact[];
  locations: InfoLocation[];
  tax: { claimsExempt: boolean; certificates: InfoCert[] };
  signer: { name: string; title: string; email: string; certified: boolean };
  original?: { company: InfoPayload["company"]; contacts: InfoContact[]; locations: InfoLocation[]; blankOnFile?: Record<string, boolean> };   // the version they opened
};

const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

// ── prefill: what OpsHub already knows, so clients confirm instead of retype ──
export async function loadClientInfo(db: Db, clientId: string) {
  // Contacts: hide removed ones (["none"]) but KEEP null routing — NULL means
  // "receives everything", and a bare NOT(cs) silently drops NULL rows.
  const [{ data: c }, { data: contacts }, { data: locs }, { data: certs }, { data: taxDocs }, { data: lastSub }] = await Promise.all([
    db.from("clients").select(`id, name, legal_name, website, billing_address, invoice_po_required, tax_exempt, qb_resale_num, qb_customer_id, ${BILL_ADDR_COLS}`).eq("id", clientId).single(),
    db.from("contacts").select("id, name, email, phone, role_label, is_primary, doc_routing").eq("client_id", clientId).or("doc_routing.is.null,doc_routing.not.cs.{none}").order("is_primary", { ascending: false }).order("name"),
    db.from("client_locations").select(`id, label, address, contact_name, contact_phone, delivery_notes, is_default, ${LOC_ADDR_COLS}`).eq("client_id", clientId).is("job_id", null).eq("active", true).order("is_default", { ascending: false }),
    db.from("client_tax_certificates").select("id, state, permit_number, issued_on, status, created_at").eq("client_id", clientId).order("created_at", { ascending: false }),
    // tax documents already on file (uploaded by staff before the form existed)
    db.from("client_files").select("id, file_name, created_at").eq("client_id", clientId).eq("kind", "tax_exempt").order("created_at", { ascending: false }),
    // shown on the form so a second person knows someone already updated it
    db.from("client_info_submissions").select("signer_name, submitted_at").eq("client_id", clientId).order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!c) throw new Error("Client not found");
  // What each contact ACTUALLY receives (lib/recipients): explicit routing as
  // set; a no-routing contact gets invoices only while no contact WITH AN
  // EMAIL is explicitly assigned invoices.
  const invoicesAssigned = ((contacts || []) as any[]).some(x => (x.email || "").includes("@") && Array.isArray(x.doc_routing) && x.doc_routing.includes("invoices"));
  const getsInvoices = (r: any) => (Array.isArray(r) && r.length) ? r.includes("invoices") : !invoicesAssigned;

  // Blanks fill from the QuickBooks customer (OpsHub's own data always wins).
  // Prefill only: a QB hiccup just means fewer prefilled fields.
  let qb: any = null;
  if (c.qb_customer_id) { try { qb = await getCustomerById(c.qb_customer_id); } catch {} }
  const qbShip = fromQbAddr(qb?.ShipAddr);
  // not split yet (mig 200): read the old text so the client can just confirm it
  const readOld = (txt: string | null) => { const r = parseAddressText(txt || ""); return r.ok ? r.a : EMPTY_ADDR; };
  const locations: InfoLocation[] = ((locs || []) as any[]).map(l => ({ id: l.id, label: l.label || "", addr: l.addr_line1 ? locAddr(l) : readOld(l.address), ...(l.addr_line1 ? {} : { onFile: l.address || "" }), contactName: l.contact_name || "", contactPhone: l.contact_phone || "", deliveryNotes: l.delivery_notes || "", isDefault: !!l.is_default }));
  if (!locations.length && qbShip && !addrProblem(qbShip)) locations.push({ label: "Main", addr: qbShip, contactName: "", contactPhone: qb?.PrimaryPhone?.FreeFormNumber || "", deliveryNotes: "", isDefault: true });
  const qbBill = fromQbAddr(qb?.BillAddr);
  return {
    clientName: c.name,
    company: {
      legalName: c.legal_name || qb?.CompanyName || "",
      website: c.website || qb?.WebAddr?.URI || "",
      // QB fills billing only when OpsHub has none; OpsHub's own unsplit text wins (shown as "on file")
      billing: c.bill_line1 ? billAddr(c) : c.billing_address ? readOld(c.billing_address) : (qbBill && !addrProblem(qbBill) ? qbBill : EMPTY_ADDR),
      ...(c.billing_address && !c.bill_line1 ? { billingOnFile: c.billing_address } : {}),
      invoicePoRequired: !!c.invoice_po_required,
    },
    taxExempt: !!c.tax_exempt, resaleNum: c.qb_resale_num || null,
    contacts: ((contacts || []) as any[]).map(x => ({ id: x.id, name: x.name || "", email: x.email || "", phone: x.phone || "", role: x.role_label || "", isPrimary: !!x.is_primary, getsInvoices: getsInvoices(x.doc_routing) })),
    locations,
    certificates: ((certs || []) as any[]).map(r => ({ id: r.id, state: r.state, permitNumber: r.permit_number, issuedOn: r.issued_on, status: r.status })),
    taxDocs: ((taxDocs || []) as any[]).map(d => ({ id: d.id, fileName: d.file_name, uploadedOn: String(d.created_at || "").slice(0, 10) })),
    // which company fields were EMPTY in OpsHub when the form was opened (a
    // prefill from QuickBooks only saves into a field that was blank then)
    blankOnFile: { legalName: !c.legal_name, website: !c.website, billingAddress: !c.bill_line1 },
    lastSubmission: lastSub ? { signerName: (lastSub as any).signer_name, submittedAt: (lastSub as any).submitted_at } : null,
  };
}

// ── apply a submission ──
export async function applyClientInfo(db: Db, clientId: string, p: InfoPayload): Promise<{ submissionId: string; applied: string[]; certsPending: number }> {
  if (!p?.signer?.certified) throw new Error("Please confirm the information is accurate.");
  const signerName = clip(p.signer.name, 120);
  if (!signerName) throw new Error("Please enter your name.");
  // a form opened before addresses were split sends text, which would be dropped silently
  if ((p.locations || []).some((l: any) => !l.addr && typeof l.address === "string") || (p.company && !(p.company as any).billing && typeof (p.company as any).billingAddress === "string"))
    throw new Error("Please reload this page and try again. The form was updated while you had it open.");
  const before = await loadClientInfo(db, clientId);
  // addresses must be complete — checked before ANY write (and before certificate files are filed) so a bad one never leaves a half-applied form
  for (const l of p.locations || []) {
    const a = cleanAddr(l.addr || EMPTY_ADDR);
    if (!l.remove && a.line1 && addrProblem(a)) throw new Error(`Please finish the address "${clip(l.label, 80) || "Ship-to"}": ${addrProblem(a)}.`);
  }
  { const b = cleanAddr(p.company?.billing || EMPTY_ADDR); if (b.line1 && addrProblem(b)) throw new Error(`Please finish the billing address: ${addrProblem(b)}.`); }
  const applied: string[] = [];

  // A tax-exempt claim needs paper: a certificate with this submission, or an
  // approved one already on file. Checked before anything is written.
  if (p.tax?.claimsExempt) {
    const hasNew = (p.tax.certificates || []).slice(0, 20).some(c => clip(c.state, 5) && clip(c.permitNumber, 60) && (c.uploadPath || c.existingFileId));
    const hasApproved = before.certificates.some(c => c.status === "approved");
    if (!hasNew && !hasApproved) throw new Error("Please upload your resale certificate, or untick tax exempt if you're not.");
  }

  // Certificate FILES first, before a single row changes: a Drive failure must
  // not leave half a save that a retry then duplicates. Temp uploads are only
  // removed once everything has saved.
  const certsIn = p.tax?.claimsExempt ? (p.tax.certificates || []).slice(0, 20) : [];
  const existing: { state: string; permit: string; issuedOn: string | null; fileId: string }[] = [];
  const filed: { state: string; permit: string; issuedOn: string | null; driveFileId: string; webViewLink: string; name: string; mime: string | null; size: number | null; tmp: string }[] = [];
  if (certsIn.length) {
    const { data: cl } = await db.from("clients").select("name").eq("id", clientId).single();
    let folderId: string | null = null;
    for (const cert of certsIn) {
      const state = clip(cert.state, 5).toUpperCase(), permit = clip(cert.permitNumber, 60);
      if (!state || !permit) continue;
      // "Use the certificate we already have" — must be THIS client's tax document.
      if (cert.existingFileId && !cert.uploadPath) {
        const doc = (before.taxDocs || []).find(d => d.id === cert.existingFileId);
        if (!doc) throw new Error(`Please choose or upload the certificate for ${state}.`);
        existing.push({ state, permit, issuedOn: /^\d{4}-\d{2}-\d{2}$/.test(cert.issuedOn || "") ? cert.issuedOn : null, fileId: doc.id });
        continue;
      }
      const path = String(cert.uploadPath || "");
      if (!path.startsWith(`${clientId}/`) || path.includes("..")) throw new Error(`Please upload the certificate for ${state}.`);
      const { data: blob, error: dErr } = await db.storage.from(CERT_BUCKET).download(path);
      if (dErr || !blob) throw new Error(`Couldn't read the certificate for ${state}. Please upload it again.`);
      if (!folderId) folderId = await getPrivateDocFolder(await getDriveToken(), [cl?.name || "Unknown", "Tax Documents"]);
      const name = resaleCertFileName(cl?.name || "Client", cert.fileName, certsIn.length > 1 ? state : undefined);
      const up = await uploadFile(folderId, name, (blob as any).type || "application/octet-stream", Buffer.from(await blob.arrayBuffer()), { public: false });
      filed.push({ state, permit, issuedOn: /^\d{4}-\d{2}-\d{2}$/.test(cert.issuedOn || "") ? cert.issuedOn : null, driveFileId: up.fileId, webViewLink: up.webViewLink, name, mime: (blob as any).type || null, size: (blob as any).size || null, tmp: path });
    }
  }

  // ── CHANGE-ONLY apply (Oct 13: two contacts, one link) ──
  // Each submission applies only what THIS person changed from the version
  // they opened (p.original) — never what they left untouched — so a second
  // person can't undo the first one's fixes, resurrect a removed contact or
  // duplicate a new one. Without p.original (older open forms) the baseline
  // is what's on file now (previous behavior).
  const orig = p.original || { company: before.company, contacts: before.contacts, locations: before.locations };

  // company: a field applies if they changed it, or if it fills a blank on file
  // (accepting a QuickBooks prefill must still save; filling a blank clobbers no one)
  const co = p.company || ({} as InfoPayload["company"]);
  const { data: stored } = await db.from("clients").select(`legal_name, website, billing_address, invoice_po_required, ${BILL_ADDR_COLS}`).eq("id", clientId).single();
  const patch: any = {};
  // fill-a-blank only if it was blank when THEY opened it — never refill a
  // field someone cleared after they opened the form
  const wasBlank = (k: string) => p.original ? !!p.original.blankOnFile?.[k] : true;
  const take = (col: string, k: string, label: string, next: string, was: string, onFile: string) => {
    if (next === onFile) return;
    if (next !== was || (!onFile && next && wasBlank(k))) { patch[col] = next || null; applied.push(`${label} updated`); }
  };
  take("legal_name", "legalName", "Legal name", clip(co.legalName, 200), clip(orig.company?.legalName, 200), stored?.legal_name || "");
  take("website", "website", "Website", clip(co.website, 200), clip(orig.company?.website, 200), stored?.website || "");
  // billing address: compared as a whole (formatted parts), same rules
  {
    const nextA = cleanAddr(co.billing || EMPTY_ADDR), next = formatAddress(nextA);
    const was = formatAddress(cleanAddr(orig.company?.billing || EMPTY_ADDR));
    const onFile = stored?.bill_line1 ? formatAddress(billAddr(stored)) : "";
    if (next !== onFile && (next !== was || (!onFile && next && wasBlank("billingAddress")))) {
      if (next && addrProblem(nextA)) throw new Error(`Please finish the billing address: ${addrProblem(nextA)}.`);
      Object.assign(patch, next ? billAddrCols(nextA) : { ...billAddrCols(EMPTY_ADDR), billing_address: null });
      applied.push("Billing address updated");
    }
  }
  if (!!co.invoicePoRequired !== !!orig.company?.invoicePoRequired && !!co.invoicePoRequired !== !!stored?.invoice_po_required) {
    patch.invoice_po_required = !!co.invoicePoRequired; applied.push(`Invoices ${co.invoicePoRequired ? "now need" : "no longer need"} a PO number`);
  }
  if (Object.keys(patch).length) {
    const { error } = await db.from("clients").update(patch).eq("id", clientId);
    if (error) throw new Error(`company: ${error.message}`);
  }

  // contacts — ROUTING (lib/recipients): a contact with no routing receives a
  // category only while no contact with an email is assigned it. Convert each
  // such contact to exactly what it gets TODAY, then edits only add/remove
  // "invoices" — who gets what never changes unless that box was toggled.
  const { data: rawContacts } = await db.from("contacts").select("id, email, doc_routing").eq("client_id", clientId);
  const routingOf = new Map<string, string[]>();
  const assigned = new Set<string>();
  for (const rc of (rawContacts || []) as any[]) if ((rc.email || "").includes("@")) for (const k of (Array.isArray(rc.doc_routing) ? rc.doc_routing : [])) assigned.add(k);
  for (const rc of (rawContacts || []) as any[]) {
    let r: string[] = Array.isArray(rc.doc_routing) ? rc.doc_routing : [];
    if (!r.length) {
      const today = ["approvals", "invoices", "shipping"].filter(k => !assigned.has(k));
      if (today.length) { r = today; await db.from("contacts").update({ doc_routing: r }).eq("id", rc.id); }
    }
    routingOf.set(rc.id, r);
  }
  const current = new Map(before.contacts.map(c => [c.id as string, c]));
  const opened = new Map((orig.contacts || []).filter(c => c.id).map(c => [c.id as string, c]));
  const idByEmail = new Map(before.contacts.filter(c => c.email).map(c => [c.email.toLowerCase(), c.id as string]));
  // removed contacts (["none"], kept for past orders): re-adding one revives that row
  const removedByEmail = new Map(((rawContacts || []) as any[]).filter(rc => (rc.email || "").includes("@") && Array.isArray(rc.doc_routing) && rc.doc_routing.includes("none")).map(rc => [String(rc.email).toLowerCase(), rc.id as string]));
  // a new row can take "main contact" only if nobody is main, or this person
  // moved it off the old one (a pre-ticked blank row isn't a choice)
  const primaryFree = !before.contacts.some(c => c.isPrimary) || (p.contacts || []).some(ct => ct.id && opened.get(ct.id)?.isPrimary && (!ct.isPrimary || ct.remove));
  let primaryId: string | null = null;
  let clearPrimaryOf: string | null = null;
  for (const ct of (p.contacts || []).slice(0, 30)) {
    const v = { name: clip(ct.name, 120), email: clip(ct.email, 200).toLowerCase(), phone: clip(ct.phone, 40), role: clip(ct.role, 60) };
    if (ct.id) {
      const cur = current.get(ct.id);
      if (!cur) continue;   // removed since they opened the form — stays removed
      const was = opened.get(ct.id) || cur;
      if (ct.remove) {
        const { count } = await db.from("job_contacts").select("id", { count: "exact", head: true }).eq("contact_id", ct.id);
        if (count) { await db.from("contacts").update({ doc_routing: ["none"], is_primary: false }).eq("id", ct.id); applied.push(`${cur.name || "Contact"} removed from emails (kept on past orders)`); }
        else { await db.from("contacts").delete().eq("id", ct.id).eq("client_id", clientId); applied.push(`${cur.name || "Contact"} removed`); }
        continue;
      }
      // field by field: theirs where they changed it, otherwise what's on file now
      const wasV = { name: clip(was.name, 120), email: clip(was.email, 200).toLowerCase(), phone: clip(was.phone, 40), role: clip(was.role, 60) };
      const pick = (k: "name" | "email" | "phone" | "role") => v[k] !== wasV[k] ? v[k] : (cur as any)[k];
      const merged = { name: pick("name"), email: pick("email"), phone: pick("phone"), role: pick("role") };
      const invChanged = !!ct.getsInvoices !== !!was.getsInvoices;
      const primChanged = !!ct.isPrimary !== !!was.isPrimary;
      if (primChanged) { if (ct.isPrimary) primaryId = ct.id; else clearPrimaryOf = ct.id; }
      const upd: any = {};
      if (merged.name !== cur.name) upd.name = merged.name;
      if (merged.email !== cur.email) upd.email = merged.email || null;
      if (merged.phone !== cur.phone) upd.phone = merged.phone || null;
      if (merged.role !== cur.role) upd.role_label = merged.role || null;
      if (invChanged && !!ct.getsInvoices !== !!cur.getsInvoices) {
        const r = routingOf.get(ct.id) || [];
        upd.doc_routing = ct.getsInvoices ? Array.from(new Set([...r, "invoices"])) : r.filter(x => x !== "invoices");
      }
      if (Object.keys(upd).length) {
        await db.from("contacts").update(upd).eq("id", ct.id).eq("client_id", clientId);
        applied.push(`Contact ${merged.name || cur.name} updated`);
      }
    } else if (!ct.remove && (v.name || v.email)) {
      const routing = ct.getsInvoices ? ["approvals", "invoices", "shipping"] : ["approvals", "shipping"];
      const existing = v.email ? idByEmail.get(v.email) : undefined;
      if (existing) {   // already on file (someone else added them) — no duplicate
        if (ct.isPrimary && primaryFree) primaryId = existing;
        applied.push(`Contact ${v.name || v.email} was already on file`);
        continue;
      }
      const revive = v.email ? removedByEmail.get(v.email) : undefined;
      let newId: string | undefined;
      if (revive) {
        await db.from("contacts").update({ name: v.name || v.email, phone: v.phone || null, role_label: v.role || null, doc_routing: routing }).eq("id", revive).eq("client_id", clientId);
        newId = revive; removedByEmail.delete(v.email);
      } else {
        const { data: nc } = await db.from("contacts").insert({ client_id: clientId, name: v.name || v.email, email: v.email || null, phone: v.phone || null, role_label: v.role || null, is_primary: false, doc_routing: routing }).select("id").single();
        newId = nc?.id;
      }
      if (v.email && newId) idByEmail.set(v.email, newId);
      if (ct.isPrimary && primaryFree && newId) primaryId = newId;
      applied.push(`Contact ${v.name || v.email} added`);
    }
  }
  if (primaryId) await db.from("contacts").update({ is_primary: false }).eq("client_id", clientId).neq("id", primaryId);
  if (primaryId) await db.from("contacts").update({ is_primary: true }).eq("id", primaryId).eq("client_id", clientId);
  else if (clearPrimaryOf) await db.from("contacts").update({ is_primary: false }).eq("id", clearPrimaryOf).eq("client_id", clientId);

  // ship-to addresses — same rules (client address book; job-specific untouched)
  const curLoc = new Map(before.locations.filter(l => l.id).map(l => [l.id as string, l]));
  const openedLoc = new Map((orig.locations || []).filter(l => l.id).map(l => [l.id as string, l]));
  const norm = (a: string) => String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // dedupe new addresses by street + ZIP (split rows) or inside the old text (unsplit rows)
  const keyOf = (a: Addr) => norm(a.line1) + "|" + norm(a.zip);
  const addrOnFile = new Set(before.locations.filter(l => l.id && l.addr.line1).map(l => keyOf(l.addr)));
  const oldTexts = before.locations.filter(l => l.id && !l.addr.line1).map(l => norm(l.onFile || ""));
  const alreadyOnFile = (a: Addr) => addrOnFile.has(keyOf(a)) || oldTexts.some(tx => tx.includes(norm(a.line1)) && tx.includes(norm(a.zip)));
  let defaultTo: string | null = null;
  const defaultFree = !before.locations.some(l => l.id && l.isDefault) || (p.locations || []).some(l => l.id && openedLoc.get(l.id)?.isDefault && (!l.isDefault || l.remove));
  for (const l of (p.locations || []).slice(0, 40)) {
    const v = { label: clip(l.label, 80) || "Ship-to", contactName: clip(l.contactName, 120), contactPhone: clip(l.contactPhone, 40), deliveryNotes: clip(l.deliveryNotes, 500) };
    const vA = cleanAddr(l.addr || EMPTY_ADDR);
    if (l.id) {
      const cur = curLoc.get(l.id);
      if (!cur) continue;   // removed since they opened the form — stays removed
      const was = openedLoc.get(l.id) || cur;
      if (l.remove) { await db.from("client_locations").update({ active: false, is_default: false }).eq("id", l.id).eq("client_id", clientId); applied.push(`Address "${cur.label}" removed`); continue; }
      const wasV = { label: clip(was.label, 80) || "Ship-to", contactName: clip(was.contactName, 120), contactPhone: clip(was.contactPhone, 40), deliveryNotes: clip(was.deliveryNotes, 500) };
      const pick = (k: "label" | "contactName" | "contactPhone" | "deliveryNotes") => v[k] !== wasV[k] ? v[k] : (cur as any)[k];
      const m = { label: pick("label"), contactName: pick("contactName"), contactPhone: pick("contactPhone"), deliveryNotes: pick("deliveryNotes") };
      // a row still stored as old text (onFile) is saved as parts once they confirm or edit it
      const addrChanged = (cur.onFile !== undefined && !!vA.line1) || (formatAddress(vA) !== formatAddress(cleanAddr(was.addr || EMPTY_ADDR)) && formatAddress(vA) !== formatAddress(cur.addr));
      const upd: any = {};
      if (m.label !== cur.label && m.label !== wasV.label) upd.label = m.label;
      if (addrChanged && vA.line1) {
        if (addrProblem(vA)) throw new Error(`Please finish the address "${m.label}": ${addrProblem(vA)}.`);
        Object.assign(upd, locAddrCols(vA));   // the text copy is built by the DB trigger
      }
      if (m.contactName !== cur.contactName) upd.contact_name = m.contactName || null;
      if (m.contactPhone !== cur.contactPhone) upd.contact_phone = m.contactPhone || null;
      if (m.deliveryNotes !== cur.deliveryNotes) upd.delivery_notes = m.deliveryNotes || null;
      if (!!l.isDefault !== !!was.isDefault && l.isDefault) defaultTo = l.id;
      if (Object.keys(upd).length) { await db.from("client_locations").update(upd).eq("id", l.id).eq("client_id", clientId); applied.push(`Address "${m.label}" updated`); }
    } else if (!l.remove && vA.line1) {
      if (addrProblem(vA)) throw new Error(`Please finish the address "${v.label}": ${addrProblem(vA)}.`);
      if (alreadyOnFile(vA)) { applied.push(`Address "${v.label}" was already on file`); continue; }
      const { data: nl } = await db.from("client_locations").insert({ client_id: clientId, job_id: null, active: true, label: v.label, ...locAddrCols(vA), contact_name: v.contactName || null, contact_phone: v.contactPhone || null, delivery_notes: v.deliveryNotes || null, is_default: false }).select("id").single();
      addrOnFile.add(keyOf(vA));
      if (l.isDefault && defaultFree && nl?.id) defaultTo = nl.id;
      applied.push(`Address "${v.label}" added`);
    }
  }
  if (defaultTo) {
    await db.from("client_locations").update({ is_default: false }).eq("client_id", clientId).is("job_id", null);
    await db.from("client_locations").update({ is_default: true }).eq("id", defaultTo).eq("client_id", clientId);
  } else {
    // never leave the book with no default when it has addresses
    const { data: act } = await db.from("client_locations").select("id, is_default").eq("client_id", clientId).is("job_id", null).eq("active", true);
    if ((act || []).length && !(act || []).some((x: any) => x.is_default)) await db.from("client_locations").update({ is_default: true }).eq("id", (act as any[])[0].id);
  }

  // Tax is never pre-ticked: an exempt client must re-confirm deliberately.
  // Not confirming changes nothing (only an approved certificate grants or
  // keeps QB exemption) — but staff must know.
  if (before.taxExempt && !p.tax?.claimsExempt) applied.push("Tax exemption NOT confirmed (QuickBooks still has them exempt; no new certificate)");
  else if (before.taxExempt && p.tax?.claimsExempt && !filed.length && !existing.length) applied.push("Tax exemption confirmed, but no certificate uploaded");

  // the submission record (certificates hang off it)
  const { data: sub, error: sErr } = await db.from("client_info_submissions").insert({
    client_id: clientId, signer_name: signerName, signer_title: clip(p.signer.title, 120) || null, signer_email: clip(p.signer.email, 200) || null,
    payload: p, applied, tax_review: "none",
  }).select("id").single();
  if (sErr) throw new Error(`submission: ${sErr.message}`);

  // certificates (files already in Drive, above) → staff-only Tax Documents + a pending review row each
  let certsPending = 0;
  for (const f of filed) {
    const { data: cf, error: fErr } = await db.from("client_files").insert({
      client_id: clientId, file_name: f.name, drive_file_id: f.driveFileId, drive_link: f.webViewLink, mime_type: f.mime,
      file_size: f.size, kind: "tax_exempt", notes: `${f.state} resale permit ${f.permit}${f.issuedOn ? `, issued ${f.issuedOn}` : ""} (client info form)`, uploaded_by: null,
    }).select("id").single();
    if (fErr) throw new Error(`certificate file: ${fErr.message}`);
    await db.from("client_tax_certificates").insert({ client_id: clientId, submission_id: sub.id, state: f.state, permit_number: f.permit, issued_on: f.issuedOn, client_file_id: cf.id, status: "pending" });
    certsPending++;
  }
  for (const e of existing) {
    await db.from("client_tax_certificates").insert({ client_id: clientId, submission_id: sub.id, state: e.state, permit_number: e.permit, issued_on: e.issuedOn, client_file_id: e.fileId, status: "pending" });
    certsPending++;
  }
  if (certsPending) {
    applied.push(`${certsPending} resale certificate${certsPending === 1 ? "" : "s"} sent for review`);
    await db.from("client_info_submissions").update({ tax_review: "pending", applied }).eq("id", sub.id);
  }
  if (filed.length) await db.storage.from(CERT_BUCKET).remove(filed.map(f => f.tmp)).catch(() => {});
  return { submissionId: sub.id, applied, certsPending };
}

// ── staff review ──
export async function reviewCertificate(db: Db, certId: string, action: "approve" | "reject", reviewerId: string, note?: string): Promise<{ qb: string }> {
  const { data: cert } = await db.from("client_tax_certificates").select("id, client_id, state, permit_number, issued_on, status, submission_id, clients(qb_customer_id, name)").eq("id", certId).single();
  if (!cert) throw new Error("Certificate not found");
  if (cert.status !== "pending") throw new Error(`Already ${cert.status}`);
  let qb = "QuickBooks unchanged";
  if (action === "approve") {
    const qbId = cert.clients?.qb_customer_id;
    if (!qbId) throw new Error("This client isn't linked to QuickBooks yet. Push an invoice or link the customer first.");
    // QB's ResaleNum holds 16 characters: send it compacted (no dashes or
    // spaces, e.g. SUT-0000-3640-0557 → SUT000036400557). OpsHub keeps the
    // permit exactly as written.
    const qbResale = String(cert.permit_number).replace(/[\s\-./]/g, "");
    if (qbResale.length > 16) throw new Error(`QuickBooks only holds 16 characters for a resale number and this one is ${qbResale.length} even without dashes. Mark the customer exempt in QuickBooks by hand, then approve here.`);
    await setCustomerTaxExempt(qbId, qbResale);   // throws → nothing marked approved
    qb = `QuickBooks customer marked tax exempt (resale ${qbResale})`;
  }
  await db.from("client_tax_certificates").update({ status: action === "approve" ? "approved" : "rejected", reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), review_note: clip(note, 500) || null }).eq("id", certId);
  if (cert.submission_id) {
    const { count } = await db.from("client_tax_certificates").select("id", { count: "exact", head: true }).eq("submission_id", cert.submission_id).eq("status", "pending");
    if (!count) await db.from("client_info_submissions").update({ tax_review: "done" }).eq("id", cert.submission_id);
  }
  if (action === "approve") { try { await syncClientTaxFromQB(db, { clientIds: [cert.client_id] }); } catch (e: any) { console.error("[client-info] mirror after approve failed:", e?.message || e); } }
  return { qb };
}

// ── the ask: email a client a link to their prefilled form ──
// Goes to the client's invoice people (lib/recipients — the same routing
// invoices use), unless staff picked who (toOverride — each address must be
// one of THIS client's contacts). Client copy: no em-dashes (standing rule).
export async function sendInfoRequest(db: Db, clientId: string, baseUrl: string, toOverride?: string[]): Promise<{ to: string[] }> {
  const { resolveRecipientEmails } = await import("./recipients");
  const { resendForSlug } = await import("./resend-client");
  const { data: c } = await db.from("clients").select("id, name, portal_token, client_hub_enabled").eq("id", clientId).single();
  if (!c) throw new Error("Client not found");
  if (!c.portal_token || !c.client_hub_enabled) throw new Error(`${c.name} has no client hub link`);
  const { data: contacts } = await db.from("contacts").select("name, email, is_primary, doc_routing").eq("client_id", clientId);
  let to = resolveRecipientEmails("invoices", (contacts || []) as any[]);
  if (toOverride) {
    const mine = new Set(((contacts || []) as any[]).filter(x => !(Array.isArray(x.doc_routing) && x.doc_routing.includes("none"))).map(x => String(x.email || "").trim().toLowerCase()).filter(e => e.includes("@")));
    const picked = Array.from(new Set(toOverride.map(e => String(e || "").trim().toLowerCase())));
    const stray = picked.filter(e => !mine.has(e));
    if (stray.length) throw new Error(`Not a contact of ${c.name}: ${stray.join(", ")}`);
    to = picked;
  }
  if (!to.length) throw new Error(`${c.name} has no contact with an email`);
  const first = (((contacts || []) as any[]).find(x => to.includes(String(x.email || "").toLowerCase()))?.name || "").split(" ")[0];
  const link = `${baseUrl}/portal/client/${c.portal_token}/company`;
  const subject = "Please confirm your company info with House Party Distro";
  const text = `Hi ${first || "there"},

We're updating our records so your invoices, shipments and sales tax are right. Please take two minutes to confirm your company info, who should receive invoices and your ship-to addresses. If you buy from us for resale, you can upload your resale certificate there too.

Review your info: ${link}

It's filled in with what we have on file, so you only need to change what's different. The form is open for the next 30 days.

Thanks,
House Party Distro`;
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111;max-width:560px">
<p>Hi ${first || "there"},</p>
<p>We're updating our records so your invoices, shipments and sales tax are right. Please take two minutes to confirm your company info, who should receive invoices and your ship-to addresses. If you buy from us for resale, you can upload your resale certificate there too.</p>
<p style="margin:26px 0"><a href="${link}" style="background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700;font-size:14px">Review your info</a></p>
<p>It's filled in with what we have on file, so you only need to change what's different. The form is open for the next 30 days.</p>
<p>Thanks,<br/>House Party Distro</p></div>`;
  const resend = resendForSlug("hpd");
  // From billing@ — the same sender account statements use (companies
  // .from_email_billing); replies land in billing too.
  const { data: co } = await db.from("companies").select("from_email_billing, from_email_quotes").eq("slug", "hpd").single();
  const fromAddr = co?.from_email_billing || co?.from_email_quotes || process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";
  // The log row is what OPENS the hub form for 30 days (lib/hub-client
  // infoFormEditable), so it's written first and checked: no row, no email
  // promising a form that won't open. A failed send removes it again.
  const { data: logRow, error: logErr } = await db.from("mail_log").insert({ kind: "client_info_request", to_addrs: to, subject, job_id: null, meta: { client: c.name, client_id: c.id } }).select("id").single();
  if (logErr || !logRow) throw new Error(`Couldn't open the form for ${c.name}: ${logErr?.message || "no log row"}`);
  const r: any = await resend.emails.send({ from: `House Party Distro <${fromAddr}>`, replyTo: fromAddr, to, subject, text, html });
  if (r?.error) {
    await db.from("mail_log").delete().eq("id", (logRow as any).id);
    throw new Error(`Email failed for ${c.name}: ${r.error.message || r.error}`);
  }
  return { to };
}
