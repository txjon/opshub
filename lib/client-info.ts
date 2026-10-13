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

import { setCustomerTaxExempt } from "./quickbooks";
import { syncClientTaxFromQB } from "./client-tax-sync";
import { uploadFile } from "./google-drive";
import { getDriveToken, getPrivateDocFolder } from "./drive-token";

type Db = any;
export const CERT_BUCKET = "client-docs";

export const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

export type InfoContact = { id?: string; name: string; email: string; phone: string; role: string; isPrimary: boolean; getsInvoices: boolean; remove?: boolean };
export type InfoLocation = { id?: string; label: string; address: string; contactName: string; contactPhone: string; deliveryNotes: string; isDefault: boolean; remove?: boolean };
export type InfoCert = { state: string; permitNumber: string; expiresOn: string; uploadPath: string; fileName: string };
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
  const [{ data: c }, { data: contacts }, { data: locs }, { data: certs }] = await Promise.all([
    db.from("clients").select("id, name, legal_name, ein, website, billing_address, invoice_po_required, tax_exempt, qb_resale_num, qb_customer_id").eq("id", clientId).single(),
    db.from("contacts").select("id, name, email, phone, role_label, is_primary, doc_routing").eq("client_id", clientId).order("is_primary", { ascending: false }).order("name"),
    db.from("client_locations").select("id, label, address, contact_name, contact_phone, delivery_notes, is_default").eq("client_id", clientId).is("job_id", null).eq("active", true).order("is_default", { ascending: false }),
    db.from("client_tax_certificates").select("id, state, permit_number, expires_on, status, created_at").eq("client_id", clientId).order("created_at", { ascending: false }),
  ]);
  if (!c) throw new Error("Client not found");
  const getsInvoices = (r: any) => !r || !Array.isArray(r) || r.length === 0 || r.includes("invoices");   // empty = admin = everything
  return {
    clientName: c.name,
    company: { legalName: c.legal_name || "", ein: c.ein || "", website: c.website || "", billingAddress: c.billing_address || "", invoicePoRequired: !!c.invoice_po_required },
    taxExempt: !!c.tax_exempt, resaleNum: c.qb_resale_num || null,
    contacts: ((contacts || []) as any[]).map(x => ({ id: x.id, name: x.name || "", email: x.email || "", phone: x.phone || "", role: x.role_label || "", isPrimary: !!x.is_primary, getsInvoices: getsInvoices(x.doc_routing) })),
    locations: ((locs || []) as any[]).map(l => ({ id: l.id, label: l.label || "", address: l.address || "", contactName: l.contact_name || "", contactPhone: l.contact_phone || "", deliveryNotes: l.delivery_notes || "", isDefault: !!l.is_default })),
    certificates: ((certs || []) as any[]).map(r => ({ id: r.id, state: r.state, permitNumber: r.permit_number, expiresOn: r.expires_on, status: r.status })),
  };
}

// ── apply a submission ──
export async function applyClientInfo(db: Db, clientId: string, p: InfoPayload): Promise<{ submissionId: string; applied: string[]; certsPending: number }> {
  if (!p?.signer?.certified) throw new Error("Please confirm the information is accurate.");
  const signerName = clip(p.signer.name, 120);
  if (!signerName) throw new Error("Please enter your name.");
  const before = await loadClientInfo(db, clientId);
  const applied: string[] = [];

  // company
  const co = p.company || ({} as InfoPayload["company"]);
  const patch: any = {};
  const setIf = (col: string, label: string, next: any, prev: any) => { if ((next ?? "") !== (prev ?? "")) { patch[col] = next === "" ? null : next; applied.push(`${label} updated`); } };
  setIf("legal_name", "Legal name", clip(co.legalName, 200), before.company.legalName);
  setIf("ein", "EIN", clip(co.ein, 20), before.company.ein);
  setIf("website", "Website", clip(co.website, 200), before.company.website);
  setIf("billing_address", "Billing address", clip(co.billingAddress, 600), before.company.billingAddress);
  if (!!co.invoicePoRequired !== before.company.invoicePoRequired) { patch.invoice_po_required = !!co.invoicePoRequired; applied.push(`Invoices ${co.invoicePoRequired ? "now need" : "no longer need"} a PO number`); }
  if (Object.keys(patch).length) {
    const { error } = await db.from("clients").update(patch).eq("id", clientId);
    if (error) throw new Error(`company: ${error.message}`);
  }

  // contacts — edit / add / remove (a contact on past jobs is kept, just un-routed)
  const known = new Map(before.contacts.map(c => [c.id, c]));
  for (const ct of (p.contacts || []).slice(0, 30)) {
    const name = clip(ct.name, 120), email = clip(ct.email, 200).toLowerCase(), phone = clip(ct.phone, 40), role = clip(ct.role, 60);
    const routing = ct.getsInvoices ? ["approvals", "invoices", "shipping"] : ["approvals", "shipping"];
    if (ct.id && known.has(ct.id)) {
      if (ct.remove) {
        const { count } = await db.from("job_contacts").select("id", { count: "exact", head: true }).eq("contact_id", ct.id);
        if (count) { await db.from("contacts").update({ doc_routing: ["none"] }).eq("id", ct.id); applied.push(`${name || "Contact"} removed from emails (kept on past orders)`); }
        else { await db.from("contacts").delete().eq("id", ct.id).eq("client_id", clientId); applied.push(`${name || "Contact"} removed`); }
        continue;
      }
      const prev = known.get(ct.id)!;
      if (prev.name !== name || prev.email !== email || prev.phone !== phone || prev.role !== role || prev.isPrimary !== !!ct.isPrimary || prev.getsInvoices !== !!ct.getsInvoices) {
        await db.from("contacts").update({ name, email: email || null, phone: phone || null, role_label: role || null, is_primary: !!ct.isPrimary, doc_routing: routing }).eq("id", ct.id).eq("client_id", clientId);
        applied.push(`Contact ${name} updated`);
      }
    } else if (!ct.remove && (name || email)) {
      await db.from("contacts").insert({ client_id: clientId, name: name || email, email: email || null, phone: phone || null, role_label: role || null, is_primary: !!ct.isPrimary, doc_routing: routing });
      applied.push(`Contact ${name || email} added`);
    }
  }

  // ship-to addresses — client address book (job-specific ones untouched)
  const knownLoc = new Map(before.locations.map(l => [l.id, l]));
  const locs = (p.locations || []).slice(0, 40);
  const wantsDefault = locs.some(l => l.isDefault && !l.remove);
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

  // the submission record (certificates hang off it)
  const { data: sub, error: sErr } = await db.from("client_info_submissions").insert({
    client_id: clientId, signer_name: signerName, signer_title: clip(p.signer.title, 120) || null, signer_email: clip(p.signer.email, 200) || null,
    payload: p, applied, tax_review: "none",
  }).select("id").single();
  if (sErr) throw new Error(`submission: ${sErr.message}`);

  // certificates → Drive (staff-only Tax Documents) + a pending review row each
  let certsPending = 0;
  if (p.tax?.claimsExempt) {
    const { data: cl } = await db.from("clients").select("name").eq("id", clientId).single();
    for (const cert of (p.tax.certificates || []).slice(0, 20)) {
      const state = clip(cert.state, 5).toUpperCase(), permit = clip(cert.permitNumber, 60);
      if (!state || !permit) continue;
      let fileId: string | null = null;
      if (cert.uploadPath && cert.uploadPath.startsWith(`${clientId}/`)) {
        const { data: blob, error: dErr } = await db.storage.from(CERT_BUCKET).download(cert.uploadPath);
        if (dErr || !blob) throw new Error(`Couldn't read the certificate for ${state}. Please upload it again.`);
        const token = await getDriveToken();
        const folderId = await getPrivateDocFolder(token, [cl?.name || "Unknown", "Tax Documents"]);
        const name = clip(cert.fileName, 140) || `${state} resale certificate`;
        const up = await uploadFile(folderId, `${state} ${permit} - ${name}`, (blob as any).type || "application/octet-stream", Buffer.from(await blob.arrayBuffer()), { public: false });
        const { data: cf, error: fErr } = await db.from("client_files").insert({
          client_id: clientId, file_name: name, drive_file_id: up.fileId, drive_link: up.webViewLink, mime_type: (blob as any).type || null,
          file_size: (blob as any).size || null, kind: "tax_exempt", notes: `${state} resale permit ${permit}${cert.expiresOn ? `, expires ${cert.expiresOn}` : ""} (client info form)`, uploaded_by: null,
        }).select("id").single();
        if (fErr) throw new Error(`certificate file: ${fErr.message}`);
        fileId = cf.id;
        await db.storage.from(CERT_BUCKET).remove([cert.uploadPath]).catch(() => {});
      }
      await db.from("client_tax_certificates").insert({
        client_id: clientId, submission_id: sub.id, state, permit_number: permit,
        expires_on: /^\d{4}-\d{2}-\d{2}$/.test(cert.expiresOn || "") ? cert.expiresOn : null, client_file_id: fileId, status: "pending",
      });
      certsPending++;
    }
    if (certsPending) {
      await db.from("client_info_submissions").update({ tax_review: "pending" }).eq("id", sub.id);
      applied.push(`${certsPending} resale certificate${certsPending === 1 ? "" : "s"} sent for review`);
      await db.from("client_info_submissions").update({ applied }).eq("id", sub.id);
    }
  }
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
    await setCustomerTaxExempt(qbId, cert.permit_number);   // throws → nothing marked approved
    qb = `QuickBooks customer marked tax exempt (resale ${cert.permit_number})`;
  }
  await db.from("client_tax_certificates").update({ status: action === "approve" ? "approved" : "rejected", reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), review_note: clip(note, 500) || null }).eq("id", certId);
  if (cert.submission_id) {
    const { count } = await db.from("client_tax_certificates").select("id", { count: "exact", head: true }).eq("submission_id", cert.submission_id).eq("status", "pending");
    if (!count) await db.from("client_info_submissions").update({ tax_review: "done" }).eq("id", cert.submission_id);
  }
  if (action === "approve") { try { await syncClientTaxFromQB(db); } catch (e: any) { console.error("[client-info] mirror after approve failed:", e?.message || e); } }
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
  const from = `House Party Distro <${process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com"}>`;
  const r: any = await resend.emails.send({ from, to, subject, text, html });
  if (r?.error) throw new Error(`Email failed for ${c.name}: ${r.error.message || r.error}`);
  try { await db.from("mail_log").insert({ kind: "client_info_request", to_addrs: to, subject, job_id: null, meta: { client: c.name, client_id: c.id } }); } catch {}
  return { to };
}
