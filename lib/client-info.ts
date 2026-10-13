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
import { syncClientTaxFromQB } from "./client-tax-sync";
import { uploadFile } from "./google-drive";
import { getDriveToken, getPrivateDocFolder } from "./drive-token";

type Db = any;
export const CERT_BUCKET = "client-docs";

export const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

export type InfoContact = { id?: string; name: string; email: string; phone: string; role: string; isPrimary: boolean; getsInvoices: boolean; remove?: boolean };
export type InfoLocation = { id?: string; label: string; address: string; contactName: string; contactPhone: string; deliveryNotes: string; isDefault: boolean; remove?: boolean };
export type InfoCert = { state: string; permitNumber: string; expiresOn: string; uploadPath: string; fileName: string; existingFileId?: string };
export type InfoPayload = {
  company: { legalName: string; ein: string; website: string; billingAddress: string; invoicePoRequired: boolean };
  contacts: InfoContact[];
  locations: InfoLocation[];
  tax: { claimsExempt: boolean; certificates: InfoCert[] };
  signer: { name: string; title: string; email: string; certified: boolean };
};

const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

// ── prefill: what OpsHub already knows, so clients confirm instead of retype ──
export async function loadClientInfo(db: Db, clientId: string) {
  // Contacts: hide removed ones (["none"]) but KEEP null routing — NULL means
  // "receives everything", and a bare NOT(cs) silently drops NULL rows.
  const [{ data: c }, { data: contacts }, { data: locs }, { data: certs }, { data: taxDocs }] = await Promise.all([
    db.from("clients").select("id, name, legal_name, ein, website, billing_address, invoice_po_required, tax_exempt, qb_resale_num, qb_customer_id").eq("id", clientId).single(),
    db.from("contacts").select("id, name, email, phone, role_label, is_primary, doc_routing").eq("client_id", clientId).or("doc_routing.is.null,doc_routing.not.cs.{none}").order("is_primary", { ascending: false }).order("name"),
    db.from("client_locations").select("id, label, address, contact_name, contact_phone, delivery_notes, is_default").eq("client_id", clientId).is("job_id", null).eq("active", true).order("is_default", { ascending: false }),
    db.from("client_tax_certificates").select("id, state, permit_number, expires_on, status, created_at").eq("client_id", clientId).order("created_at", { ascending: false }),
    // tax documents already on file (uploaded by staff before the form existed)
    db.from("client_files").select("id, file_name, created_at").eq("client_id", clientId).eq("kind", "tax_exempt").order("created_at", { ascending: false }),
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
  const qbAddr = (a: any) => !a ? "" : [a.Line1, a.Line2, a.Line3, [a.City, a.CountrySubDivisionCode].filter(Boolean).join(", ") + (a.PostalCode ? ` ${a.PostalCode}` : "")].filter(x => x && String(x).trim()).join("\n");
  const qbShip = qbAddr(qb?.ShipAddr);
  const locations = ((locs || []) as any[]).map(l => ({ id: l.id, label: l.label || "", address: l.address || "", contactName: l.contact_name || "", contactPhone: l.contact_phone || "", deliveryNotes: l.delivery_notes || "", isDefault: !!l.is_default }));
  if (!locations.length && qbShip) locations.push({ id: undefined as any, label: "Main", address: qbShip, contactName: "", contactPhone: qb?.PrimaryPhone?.FreeFormNumber || "", deliveryNotes: "", isDefault: true });
  return {
    clientName: c.name,
    company: {
      legalName: c.legal_name || qb?.CompanyName || "",
      ein: c.ein || "",
      website: c.website || qb?.WebAddr?.URI || "",
      billingAddress: c.billing_address || qbAddr(qb?.BillAddr),
      invoicePoRequired: !!c.invoice_po_required,
    },
    taxExempt: !!c.tax_exempt, resaleNum: c.qb_resale_num || null,
    contacts: ((contacts || []) as any[]).map(x => ({ id: x.id, name: x.name || "", email: x.email || "", phone: x.phone || "", role: x.role_label || "", isPrimary: !!x.is_primary, getsInvoices: getsInvoices(x.doc_routing) })),
    locations,
    certificates: ((certs || []) as any[]).map(r => ({ id: r.id, state: r.state, permitNumber: r.permit_number, expiresOn: r.expires_on, status: r.status })),
    taxDocs: ((taxDocs || []) as any[]).map(d => ({ id: d.id, fileName: d.file_name, uploadedOn: String(d.created_at || "").slice(0, 10) })),
  };
}

// ── apply a submission ──
export async function applyClientInfo(db: Db, clientId: string, p: InfoPayload): Promise<{ submissionId: string; applied: string[]; certsPending: number }> {
  if (!p?.signer?.certified) throw new Error("Please confirm the information is accurate.");
  const signerName = clip(p.signer.name, 120);
  if (!signerName) throw new Error("Please enter your name.");
  const before = await loadClientInfo(db, clientId);
  const applied: string[] = [];

  // A tax-exempt claim needs paper: a certificate with this submission, or an
  // approved one already on file. Checked before anything is written.
  if (p.tax?.claimsExempt) {
    const hasNew = (p.tax.certificates || []).some(c => clip(c.state, 5) && clip(c.permitNumber, 60) && (c.uploadPath || c.existingFileId));
    const hasApproved = before.certificates.some(c => c.status === "approved");
    if (!hasNew && !hasApproved) throw new Error("Please upload your resale certificate, or untick tax exempt if you're not.");
  }

  // Certificate FILES first, before a single row changes: a Drive failure must
  // not leave half a save that a retry then duplicates. Temp uploads are only
  // removed once everything has saved.
  const certsIn = p.tax?.claimsExempt ? (p.tax.certificates || []).slice(0, 20) : [];
  const existing: { state: string; permit: string; expiresOn: string | null; fileId: string }[] = [];
  const filed: { state: string; permit: string; expiresOn: string | null; driveFileId: string; webViewLink: string; name: string; mime: string | null; size: number | null; tmp: string }[] = [];
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
        existing.push({ state, permit, expiresOn: /^\d{4}-\d{2}-\d{2}$/.test(cert.expiresOn || "") ? cert.expiresOn : null, fileId: doc.id });
        continue;
      }
      const path = String(cert.uploadPath || "");
      if (!path.startsWith(`${clientId}/`) || path.includes("..")) throw new Error(`Please upload the certificate for ${state}.`);
      const { data: blob, error: dErr } = await db.storage.from(CERT_BUCKET).download(path);
      if (dErr || !blob) throw new Error(`Couldn't read the certificate for ${state}. Please upload it again.`);
      if (!folderId) folderId = await getPrivateDocFolder(await getDriveToken(), [cl?.name || "Unknown", "Tax Documents"]);
      const name = clip(cert.fileName, 140) || `${state} resale certificate`;
      const up = await uploadFile(folderId, `${state} ${permit} - ${name}`, (blob as any).type || "application/octet-stream", Buffer.from(await blob.arrayBuffer()), { public: false });
      filed.push({ state, permit, expiresOn: /^\d{4}-\d{2}-\d{2}$/.test(cert.expiresOn || "") ? cert.expiresOn : null, driveFileId: up.fileId, webViewLink: up.webViewLink, name, mime: (blob as any).type || null, size: (blob as any).size || null, tmp: path });
    }
  }

  // company — compared with what OpsHub actually STORES (the prefill also
  // carries QuickBooks values for blanks; a confirmed QB value must save).
  const co = p.company || ({} as InfoPayload["company"]);
  const { data: stored } = await db.from("clients").select("legal_name, ein, website, billing_address").eq("id", clientId).single();
  const patch: any = {};
  const setIf = (col: string, label: string, next: any, prev: any) => { if ((next ?? "") !== (prev ?? "")) { patch[col] = next === "" ? null : next; applied.push(`${label} updated`); } };
  setIf("legal_name", "Legal name", clip(co.legalName, 200), stored?.legal_name || "");
  setIf("ein", "EIN", clip(co.ein, 20), stored?.ein || "");
  setIf("website", "Website", clip(co.website, 200), stored?.website || "");
  setIf("billing_address", "Billing address", clip(co.billingAddress, 600), stored?.billing_address || "");
  if (!!co.invoicePoRequired !== before.company.invoicePoRequired) { patch.invoice_po_required = !!co.invoicePoRequired; applied.push(`Invoices ${co.invoicePoRequired ? "now need" : "no longer need"} a PO number`); }
  if (Object.keys(patch).length) {
    const { error } = await db.from("clients").update(patch).eq("id", clientId);
    if (error) throw new Error(`company: ${error.message}`);
  }

  // contacts — edit / add / remove (a contact on past jobs is kept, just un-routed).
  // ROUTING (lib/recipients): a contact with no routing receives everything,
  // but only while nobody is explicitly assigned. So first make every such
  // "everything" contact explicit (who gets what doesn't change), then edits
  // only add/remove "invoices" and never touch routing staff set by hand.
  const { data: rawContacts } = await db.from("contacts").select("id, email, doc_routing").eq("client_id", clientId);
  const routingOf = new Map<string, string[]>();
  // An "everything" contact receives a category only while NOBODY is explicitly
  // assigned it (lib/recipients). Convert each to exactly what it gets TODAY —
  // no one gains or loses a single email.
  const assigned = new Set<string>();
  // only contacts WITH an email count as assigned — lib/recipients ignores the rest
  for (const rc of (rawContacts || []) as any[]) if ((rc.email || "").includes("@")) for (const k of (Array.isArray(rc.doc_routing) ? rc.doc_routing : [])) assigned.add(k);
  for (const rc of (rawContacts || []) as any[]) {
    let r: string[] = Array.isArray(rc.doc_routing) ? rc.doc_routing : [];
    if (!r.length) {
      const today = ["approvals", "invoices", "shipping"].filter(k => !assigned.has(k));
      if (today.length) { r = today; await db.from("contacts").update({ doc_routing: r }).eq("id", rc.id); }
    }
    routingOf.set(rc.id, r);
  }
  const known = new Map(before.contacts.map(c => [c.id, c]));
  let primaryId: string | null = null;   // the ONE main contact, applied after the loop
  for (const ct of (p.contacts || []).slice(0, 30)) {
    const name = clip(ct.name, 120), email = clip(ct.email, 200).toLowerCase(), phone = clip(ct.phone, 40), role = clip(ct.role, 60);
    if (ct.id && known.has(ct.id)) {
      const cur = routingOf.get(ct.id) || [];
      const routing = ct.getsInvoices ? Array.from(new Set([...cur, "invoices"])) : cur.filter(x => x !== "invoices");
      if (ct.remove) {
        const { count } = await db.from("job_contacts").select("id", { count: "exact", head: true }).eq("contact_id", ct.id);
        if (count) { await db.from("contacts").update({ doc_routing: ["none"], is_primary: false }).eq("id", ct.id); applied.push(`${name || "Contact"} removed from emails (kept on past orders)`); }
        else { await db.from("contacts").delete().eq("id", ct.id).eq("client_id", clientId); applied.push(`${name || "Contact"} removed`); }
        continue;
      }
      const prev = known.get(ct.id)!;
      if (ct.isPrimary) primaryId = ct.id;
      if (prev.name !== name || prev.email !== email || prev.phone !== phone || prev.role !== role || prev.isPrimary !== !!ct.isPrimary || prev.getsInvoices !== !!ct.getsInvoices) {
        await db.from("contacts").update({ name, email: email || null, phone: phone || null, role_label: role || null, is_primary: !!ct.isPrimary, doc_routing: routing }).eq("id", ct.id).eq("client_id", clientId);
        applied.push(`Contact ${name} updated`);
      }
    } else if (!ct.remove && (name || email)) {
      const routing = ct.getsInvoices ? ["approvals", "invoices", "shipping"] : ["approvals", "shipping"];
      const { data: nc } = await db.from("contacts").insert({ client_id: clientId, name: name || email, email: email || null, phone: phone || null, role_label: role || null, is_primary: !!ct.isPrimary, doc_routing: routing }).select("id").single();
      if (ct.isPrimary && nc?.id) primaryId = nc.id;
      applied.push(`Contact ${name || email} added`);
    }
  }

  if (primaryId) await db.from("contacts").update({ is_primary: false }).eq("client_id", clientId).neq("id", primaryId);

  // ship-to addresses — client address book (job-specific ones untouched)
  const knownLoc = new Map(before.locations.map(l => [l.id, l]));
  const locs = (p.locations || []).slice(0, 40);
  const wantsDefault = locs.some(l => l.isDefault && !l.remove && (l.id ? knownLoc.has(l.id) : !!clip(l.address, 600)));
  if (wantsDefault) await db.from("client_locations").update({ is_default: false }).eq("client_id", clientId).is("job_id", null);
  for (const l of locs) {
    const row = { label: clip(l.label, 80) || "Ship-to", address: clip(l.address, 600), contact_name: clip(l.contactName, 120) || null, contact_phone: clip(l.contactPhone, 40) || null, delivery_notes: clip(l.deliveryNotes, 500) || null, is_default: !!l.isDefault };
    if (l.id && knownLoc.has(l.id)) {
      if (l.remove) { await db.from("client_locations").update({ active: false, is_default: false }).eq("id", l.id).eq("client_id", clientId); applied.push(`Address "${row.label}" removed`); continue; }
      const prev = knownLoc.get(l.id)!;
      await db.from("client_locations").update(row).eq("id", l.id).eq("client_id", clientId);
      if (prev.label !== row.label || prev.address !== row.address || prev.contactName !== (row.contact_name || "") || prev.contactPhone !== (row.contact_phone || "") || prev.deliveryNotes !== (row.delivery_notes || "") || prev.isDefault !== row.is_default) applied.push(`Address "${row.label}" updated`);
    } else if (!l.remove && row.address) {
      await db.from("client_locations").insert({ client_id: clientId, job_id: null, active: true, ...row });
      applied.push(`Address "${row.label}" added`);
    }
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
      file_size: f.size, kind: "tax_exempt", notes: `${f.state} resale permit ${f.permit}${f.expiresOn ? `, expires ${f.expiresOn}` : ""} (client info form)`, uploaded_by: null,
    }).select("id").single();
    if (fErr) throw new Error(`certificate file: ${fErr.message}`);
    await db.from("client_tax_certificates").insert({ client_id: clientId, submission_id: sub.id, state: f.state, permit_number: f.permit, expires_on: f.expiresOn, client_file_id: cf.id, status: "pending" });
    certsPending++;
  }
  for (const e of existing) {
    await db.from("client_tax_certificates").insert({ client_id: clientId, submission_id: sub.id, state: e.state, permit_number: e.permit, expires_on: e.expiresOn, client_file_id: e.fileId, status: "pending" });
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
  const { data: cert } = await db.from("client_tax_certificates").select("id, client_id, state, permit_number, status, submission_id, clients(qb_customer_id, name)").eq("id", certId).single();
  if (!cert) throw new Error("Certificate not found");
  if (cert.status !== "pending") throw new Error(`Already ${cert.status}`);
  let qb = "QuickBooks unchanged";
  if (action === "approve") {
    const qbId = cert.clients?.qb_customer_id;
    if (!qbId) throw new Error("This client isn't linked to QuickBooks yet. Push an invoice or link the customer first.");
    if (String(cert.permit_number).length > 16) throw new Error(`QuickBooks only holds 16 characters for a resale number and this one is ${String(cert.permit_number).length}. Mark the customer exempt in QuickBooks by hand, then approve here.`);
    await setCustomerTaxExempt(qbId, cert.permit_number);   // throws → nothing marked approved
    qb = `QuickBooks customer marked tax exempt (resale ${cert.permit_number})`;
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
// invoices use). Client copy: no em-dashes (standing rule).
export async function sendInfoRequest(db: Db, clientId: string, baseUrl: string): Promise<{ to: string[] }> {
  const { resolveRecipientEmails } = await import("./recipients");
  const { resendForSlug } = await import("./resend-client");
  const { data: c } = await db.from("clients").select("id, name, portal_token, client_hub_enabled").eq("id", clientId).single();
  if (!c) throw new Error("Client not found");
  if (!c.portal_token || !c.client_hub_enabled) throw new Error(`${c.name} has no client hub link`);
  const { data: contacts } = await db.from("contacts").select("name, email, is_primary, doc_routing").eq("client_id", clientId);
  const to = resolveRecipientEmails("invoices", (contacts || []) as any[]);
  if (!to.length) throw new Error(`${c.name} has no contact with an email`);
  const first = (((contacts || []) as any[]).find(x => to.includes(String(x.email || "").toLowerCase()))?.name || "").split(" ")[0];
  const link = `${baseUrl}/portal/client/${c.portal_token}/company`;
  const subject = "Please confirm your company info with House Party Distro";
  const text = `Hi ${first || "there"},

We're updating our records so your invoices, shipments and sales tax are right. Please take two minutes to confirm your company info, who should receive invoices and your ship-to addresses. If you buy from us for resale, you can upload your resale certificate there too.

Review your info: ${link}

It's filled in with what we have on file, so you only need to change what's different.

Thanks,
House Party Distro`;
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111;max-width:560px">
<p>Hi ${first || "there"},</p>
<p>We're updating our records so your invoices, shipments and sales tax are right. Please take two minutes to confirm your company info, who should receive invoices and your ship-to addresses. If you buy from us for resale, you can upload your resale certificate there too.</p>
<p style="margin:26px 0"><a href="${link}" style="background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700;font-size:14px">Review your info</a></p>
<p>It's filled in with what we have on file, so you only need to change what's different.</p>
<p>Thanks,<br/>House Party Distro</p></div>`;
  const resend = resendForSlug("hpd");
  // From billing@ — the same sender account statements use (companies
  // .from_email_billing); replies land in billing too.
  const { data: co } = await db.from("companies").select("from_email_billing, from_email_quotes").eq("slug", "hpd").single();
  const fromAddr = co?.from_email_billing || co?.from_email_quotes || process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";
  const r: any = await resend.emails.send({ from: `House Party Distro <${fromAddr}>`, replyTo: fromAddr, to, subject, text, html });
  if (r?.error) throw new Error(`Email failed for ${c.name}: ${r.error.message || r.error}`);
  try { await db.from("mail_log").insert({ kind: "client_info_request", to_addrs: to, subject, job_id: null, meta: { client: c.name, client_id: c.id } }); } catch {}
  return { to };
}
