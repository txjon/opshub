"use client";
// Client Hub — Company info (Oct 13 2026). The client keeps their own
// company details, contacts, ship-to addresses and resale certificates
// current. Prefilled from OpsHub (confirm, don't retype). Company, contacts
// and addresses apply on submit; resale certificates go to HPD for review
// (lib/client-info). Emailed out as the "confirm your info" ask, and lives
// in the hub for anytime updates. Client copy: no em-dashes.
import { useEffect, useState } from "react";
import { useClientPortal } from "../_shared/context";
import { H } from "@/components/hub/theme";
import { createClient } from "@/lib/supabase/client";
import { AddressFields } from "@/components/AddressFields";
import { EMPTY_ADDR, addrProblem, type Addr } from "@/lib/address";

type Contact = { id?: string; name: string; email: string; phone: string; role: string; isPrimary: boolean; getsInvoices: boolean; remove?: boolean };
type Loc = { id?: string; _k?: string; label: string; addr: Addr; onFile?: string; contactName: string; contactPhone: string; deliveryNotes: string; isDefault: boolean; remove?: boolean };
type Cert = { state: string; permitNumber: string; expiresOn: string; uploadPath: string; fileName: string; existingFileId?: string; uploading?: boolean; err?: string };

const box: React.CSSProperties = { background: H.card, border: `1px solid ${H.line}`, borderRadius: 16, padding: "18px 18px 20px", marginTop: 16 };
const lab: React.CSSProperties = { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: H.faint, margin: "12px 0 6px" };
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 16, fontFamily: H.font, outline: "none" };
const ghost: React.CSSProperties = { background: "transparent", color: H.dim, border: `1px solid ${H.line}`, borderRadius: 999, padding: "9px 16px", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font };
const H2 = ({ n, t, hint }: { n: string; t: string; hint?: string }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
    <span style={{ fontFamily: H.mono, fontSize: 12, color: H.faint }}>{n}</span>
    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{t}</h2>
    {hint && <span style={{ fontSize: 12, color: H.faint }}>{hint}</span>}
  </div>
);
const check = (on: boolean, set: (v: boolean) => void, label: string) => (
  <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, color: H.text, cursor: "pointer", marginTop: 12 }}>
    <input type="checkbox" checked={on} onChange={e => set(e.target.checked)} style={{ width: 18, height: 18, accentColor: "#fff" }} />{label}
  </label>
);

export default function CompanyInfoPage() {
  const { token } = useClientPortal() as any;
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [states, setStates] = useState<string[]>([]);
  const [company, setCompany] = useState<{ legalName: string; ein: string; website: string; billing: Addr; billingOnFile?: string; invoicePoRequired: boolean }>({ legalName: "", ein: "", website: "", billing: EMPTY_ADDR, invoicePoRequired: false });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [locs, setLocs] = useState<Loc[]>([]);
  const [taxExempt, setTaxExempt] = useState(false);       // NEVER prefilled — deliberate confirmation (Jon, Oct 13)
  const [exemptOnFile, setExemptOnFile] = useState(false);
  const [taxDocs, setTaxDocs] = useState<{ id: string; fileName: string; uploadedOn: string }[]>([]);
  const [onFile, setOnFile] = useState<{ state: string; permitNumber: string; expiresOn: string | null; status: string }[]>([]);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [signer, setSigner] = useState({ name: "", title: "", email: "", certified: false });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ applied: string[]; certsPending: number } | null>(null);
  // the version this person opened: the server applies only what they change
  // from it, so two people on one link can't undo each other (Oct 13)
  const [original, setOriginal] = useState<any>(null);
  const [lastSub, setLastSub] = useState<{ signerName: string; submittedAt: string } | null>(null);

  useEffect(() => {
    fetch(`/api/portal/client/${token}/company`).then(r => r.json()).then(d => {
      if (d.error) { setErr(d.error); return; }
      setClientName(d.clientName); setStates(d.states || []); setCompany(d.company);
      setContacts(d.contacts.length ? d.contacts : [{ name: "", email: "", phone: "", role: "", isPrimary: true, getsInvoices: true }]);
      setLocs(d.locations.length ? d.locations : [{ _k: "n0", label: "Main", addr: EMPTY_ADDR, contactName: "", contactPhone: "", deliveryNotes: "", isDefault: true }]);
      setExemptOnFile(!!d.taxExempt); setOnFile(d.certificates || []); setTaxDocs(d.taxDocs || []);
      setOriginal({ company: d.company, contacts: d.contacts, locations: d.locations, blankOnFile: d.blankOnFile }); setLastSub(d.lastSubmission || null);
      setLoaded(true);
    }).catch(() => setErr("Couldn't load your info. Please refresh."));
  }, [token]);

  const upContact = (i: number, k: keyof Contact, v: any) => setContacts(cs => cs.map((c, j) => j === i ? { ...c, [k]: v } : (k === "isPrimary" && v ? { ...c, isPrimary: false } : c)));
  const upLoc = (i: number, k: keyof Loc, v: any) => setLocs(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : (k === "isDefault" && v ? { ...l, isDefault: false } : l)));
  const upCert = (i: number, patch: Partial<Cert>) => setCerts(cs => cs.map((c, j) => j === i ? { ...c, ...patch } : c));

  async function attach(i: number, file: File) {
    upCert(i, { uploading: true, err: undefined });
    try {
      const r = await fetch(`/api/portal/client/${token}/company/upload`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, size: file.size, type: file.type }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Upload failed");
      const { error } = await createClient().storage.from("client-docs").uploadToSignedUrl(d.path, d.token, file, { contentType: file.type || "application/octet-stream" });
      if (error) throw new Error(error.message);
      upCert(i, { uploading: false, uploadPath: d.path, fileName: file.name });
    } catch (e: any) { upCert(i, { uploading: false, err: e.message || "Upload failed", uploadPath: "", fileName: "" }); }
  }

  const live = contacts.filter(c => !c.remove);
  const problems: string[] = [];
  if (!live.some(c => c.email.includes("@"))) problems.push("Add at least one contact with an email.");
  if (addrProblem(company.billing)) problems.push(`Billing address: ${addrProblem(company.billing)}.`);
  locs.forEach(l => { if (!l.remove && addrProblem(l.addr)) problems.push(`Ship-to "${l.label || "address"}": ${addrProblem(l.addr)}.`); });
  const hasFile = (c: Cert) => !!(c.uploadPath || c.existingFileId);
  if (taxExempt && certs.some(c => c.state || c.permitNumber || hasFile(c)) && certs.some(c => (c.state || c.permitNumber || hasFile(c)) && !(c.state && c.permitNumber && hasFile(c)))) problems.push("Each certificate needs a state, a permit number and the file.");
  // Ticking "tax exempt" is a claim that needs paper: at least one complete
  // certificate, unless an approved one is already on file (Jon, Oct 13).
  if (taxExempt && !onFile.some(c => c.status === "approved") && !certs.some(c => c.state && c.permitNumber && hasFile(c))) problems.push("Upload your resale certificate, or untick tax exempt if you're not.");
  if (certs.some(c => c.uploading)) problems.push("Wait for the certificate upload to finish.");
  if (!signer.name.trim()) problems.push("Enter your name to sign.");
  if (!signer.certified) problems.push("Check the box to confirm the information is accurate.");

  async function submit() {
    if (problems.length) return;
    setBusy(true); setErr(null);
    try {
      const body = { company, contacts, locations: locs, tax: { claimsExempt: taxExempt, certificates: certs.filter(c => c.state && c.permitNumber && hasFile(c)).map(({ uploading, err, ...c }) => c) }, signer, original };
      const r = await fetch(`/api/portal/client/${token}/company`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't save");
      setDone({ applied: d.applied || [], certsPending: d.certsPending || 0 });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) { setErr(e.message || "Couldn't save"); } finally { setBusy(false); }
  }

  if (err && !loaded) return <div style={{ padding: 40, color: H.red, fontFamily: H.font }}>{err}</div>;
  if (!loaded) return <div style={{ padding: 40, color: H.faint, fontFamily: H.font }}>Loading your info…</div>;

  if (done) return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px 80px", fontFamily: H.font, color: H.text }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.green }}>Saved</div>
      <h1 style={{ fontSize: "clamp(28px,6vw,44px)", fontWeight: 900, textTransform: "uppercase", lineHeight: 1, margin: "8px 0 0" }}>Thank you.</h1>
      <p style={{ color: H.dim, fontSize: 15, lineHeight: 1.55, marginTop: 14 }}>
        Your info is up to date{done.applied.filter(a => !/certificate/.test(a)).length ? " and the changes are already in our system" : ""}.
        {done.certsPending ? ` We received your resale certificate${done.certsPending === 1 ? "" : "s"} and will review ${done.certsPending === 1 ? "it" : "them"} shortly. Sales tax comes off once it's approved.` : ""}
      </p>
      <p style={{ color: H.faint, fontSize: 13, marginTop: 18 }}>You can come back to this page anytime to make changes.</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "26px 16px 120px", fontFamily: H.font, color: H.text }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint }}>{clientName}</div>
      <h1 style={{ fontSize: "clamp(30px,6vw,52px)", fontWeight: 900, textTransform: "uppercase", lineHeight: 0.98, letterSpacing: "-0.02em", margin: "8px 0 0" }}>Company info</h1>
      <p style={{ color: H.dim, fontSize: 14.5, lineHeight: 1.55, marginTop: 12 }}>This is what we have on file. Change anything that's different, then sign at the bottom.</p>
      {lastSub && <p style={{ color: H.faint, fontSize: 13, margin: "6px 0 0" }}>Last updated {new Date(lastSub.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} by {lastSub.signerName}. Their changes are already shown here.</p>}

      <div style={box}>
        <H2 n="1" t="Company" />
        <span style={lab}>Legal company name</span><input style={inp} value={company.legalName} onChange={e => setCompany({ ...company, legalName: e.target.value })} placeholder="As it appears on your resale certificate" />
        <span style={lab}>EIN (federal tax ID)</span><input style={inp} value={company.ein} onChange={e => setCompany({ ...company, ein: e.target.value })} placeholder="12-3456789" inputMode="numeric" />
        <span style={lab}>Website</span><input style={inp} value={company.website} onChange={e => setCompany({ ...company, website: e.target.value })} placeholder="yourbrand.com" />
        <span style={lab}>Billing address</span>
        {company.billingOnFile && !company.billing.line1 && <p style={{ color: H.dim, fontSize: 13.5, lineHeight: 1.5, margin: "0 0 8px", whiteSpace: "pre-line" }}>We have this on file. Please enter it in the boxes below:{"\n"}{company.billingOnFile}</p>}
        <AddressFields idPrefix="bill" value={company.billing} onChange={a => setCompany({ ...company, billing: a })} inp={inp} lab={lab} nameHint="Company name as it should appear on invoices" warn={H.amber} />
        {check(company.invoicePoRequired, v => setCompany({ ...company, invoicePoRequired: v }), "Our invoices need our PO number on them")}
      </div>

      <div style={box}>
        <H2 n="2" t="Contacts" hint="who we talk to, and who gets invoices" />
        {contacts.map((c, i) => c.remove ? null : (
          <div key={i} style={{ borderTop: i ? `1px solid ${H.line}` : "none", marginTop: i ? 16 : 0, paddingTop: i ? 6 : 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
              <div><span style={lab}>Name</span><input style={inp} value={c.name} onChange={e => upContact(i, "name", e.target.value)} /></div>
              <div><span style={lab}>Email</span><input style={inp} type="email" value={c.email} onChange={e => upContact(i, "email", e.target.value)} /></div>
              <div><span style={lab}>Phone</span><input style={inp} type="tel" value={c.phone} onChange={e => upContact(i, "phone", e.target.value)} /></div>
              <div><span style={lab}>Role</span><input style={inp} value={c.role} onChange={e => upContact(i, "role", e.target.value)} placeholder="Owner, Accounts payable…" /></div>
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
              {check(c.getsInvoices, v => upContact(i, "getsInvoices", v), "Gets invoices")}
              {check(c.isPrimary, v => upContact(i, "isPrimary", v), "Main contact")}
              <button onClick={() => c.id ? upContact(i, "remove", true) : setContacts(cs => cs.filter((_, j) => j !== i))} style={{ ...ghost, marginTop: 12, marginLeft: "auto", padding: "6px 12px" }}>Remove</button>
            </div>
          </div>
        ))}
        <button onClick={() => setContacts(cs => [...cs, { name: "", email: "", phone: "", role: "", isPrimary: false, getsInvoices: false }])} style={{ ...ghost, marginTop: 16 }}>+ Add a contact</button>
      </div>

      <div style={box}>
        <H2 n="3" t="Ship-to addresses" hint="add every place we ship to" />
        {locs.map((l, i) => l.remove ? null : (
          <div key={l.id || (l as any)._k || i} style={{ borderTop: i ? `1px solid ${H.line}` : "none", marginTop: i ? 16 : 0, paddingTop: i ? 6 : 0 }}>
            <span style={lab}>Name for this address</span><input style={inp} value={l.label} onChange={e => upLoc(i, "label", e.target.value)} placeholder="Warehouse, Store, Office…" />
            {l.onFile && !l.addr.line1 && <p style={{ color: H.dim, fontSize: 13.5, lineHeight: 1.5, margin: "12px 0 0", whiteSpace: "pre-line" }}>We have this on file. Please enter it in the boxes below:{"\n"}{l.onFile}</p>}
            <AddressFields idPrefix={`loc-${i}`} value={l.addr} onChange={a => upLoc(i, "addr", a)} inp={inp} lab={lab} warn={H.amber} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
              <div><span style={lab}>Attention</span><input style={inp} value={l.contactName} onChange={e => upLoc(i, "contactName", e.target.value)} placeholder="Who receives it" /></div>
              <div><span style={lab}>Phone for the carrier</span><input style={inp} type="tel" value={l.contactPhone} onChange={e => upLoc(i, "contactPhone", e.target.value)} /></div>
            </div>
            <span style={lab}>Delivery notes</span><input style={inp} value={l.deliveryNotes} onChange={e => upLoc(i, "deliveryNotes", e.target.value)} placeholder="Dock hours, gate code, residential…" />
            <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
              {check(l.isDefault, v => upLoc(i, "isDefault", v), "Our usual ship-to")}
              <button onClick={() => l.id ? upLoc(i, "remove", true) : setLocs(ls => ls.filter((_, j) => j !== i))} style={{ ...ghost, marginTop: 12, marginLeft: "auto", padding: "6px 12px" }}>Remove</button>
            </div>
          </div>
        ))}
        <button onClick={() => setLocs(ls => [...ls, { _k: `n${Date.now()}`, label: "", addr: EMPTY_ADDR, contactName: "", contactPhone: "", deliveryNotes: "", isDefault: false }])} style={{ ...ghost, marginTop: 16 }}>+ Add an address</button>
      </div>

      <div style={box}>
        <H2 n="4" t="Sales tax" />
        {exemptOnFile && <p style={{ color: H.dim, fontSize: 13.5, lineHeight: 1.5, margin: "10px 0 0" }}>Our records show your account as tax exempt. Please confirm it below and upload your current resale certificate so we have it on file.</p>}
        {check(taxExempt, v => { setTaxExempt(v); if (v && !certs.length) setCerts([{ state: "", permitNumber: "", expiresOn: "", uploadPath: "", fileName: "" }]); }, "We buy for resale and are sales tax exempt")}
        {taxExempt && (
          <>
            <p style={{ color: H.dim, fontSize: 13.5, lineHeight: 1.5, margin: "12px 0 0" }}>Add a resale certificate for each state you hold one in. We'll review it, and sales tax comes off your invoices once it's approved.</p>
            {onFile.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <span style={lab}>On file</span>
                {onFile.map((c, i) => (
                  <div key={i} style={{ fontSize: 13.5, padding: "5px 0", display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <b>{c.state}</b><span style={{ fontFamily: H.mono }}>{c.permitNumber}</span>
                    {c.expiresOn && <span style={{ color: H.faint }}>expires {c.expiresOn}</span>}
                    <span style={{ color: c.status === "approved" ? H.green : c.status === "rejected" ? H.red : H.amber, fontWeight: 800, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>{c.status === "pending" ? "in review" : c.status}</span>
                  </div>
                ))}
              </div>
            )}
            {certs.map((c, i) => (
              <div key={i} style={{ borderTop: `1px solid ${H.line}`, marginTop: 16, paddingTop: 6 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0 12px" }}>
                  <div><span style={lab}>State</span>
                    <select style={inp} value={c.state} onChange={e => upCert(i, { state: e.target.value })}>
                      <option value="">Choose…</option>
                      <option value="MULTI">Multistate (MTC / SST)</option>
                      {states.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div><span style={lab}>Permit number</span><input style={inp} value={c.permitNumber} onChange={e => upCert(i, { permitNumber: e.target.value })} /></div>
                  <div><span style={lab}>Expiration date (leave blank if it doesn't expire)</span><input style={inp} type="date" value={c.expiresOn} onChange={e => upCert(i, { expiresOn: e.target.value })} /></div>
                </div>
                <span style={lab}>Certificate</span>
                {taxDocs.length > 0 && !c.uploadPath && (
                  <select style={{ ...inp, marginBottom: 10 }} value={c.existingFileId || ""} onChange={e => upCert(i, { existingFileId: e.target.value || undefined })}>
                    <option value="">Upload a new certificate</option>
                    {taxDocs.map(d => <option key={d.id} value={d.id}>Use the one we already have: {d.fileName}{d.uploadedOn ? ` (on file since ${d.uploadedOn})` : ""}</option>)}
                  </select>
                )}
                {!c.existingFileId && <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ ...ghost, display: "inline-flex", alignItems: "center" }}>
                    {c.uploading ? "Uploading…" : c.uploadPath ? "Replace file" : "Upload PDF or photo"}
                    <input type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) attach(i, f); e.target.value = ""; }} />
                  </label>
                  {c.uploadPath && <span style={{ fontSize: 13, color: H.green }}>✓ {c.fileName}</span>}
                  {c.err && <span style={{ fontSize: 13, color: H.red }}>{c.err}</span>}
                  <button onClick={() => setCerts(cs => cs.filter((_, j) => j !== i))} style={{ ...ghost, marginLeft: "auto", padding: "6px 12px" }}>Remove</button>
                </div>}
                {c.existingFileId && <button onClick={() => setCerts(cs => cs.filter((_, j) => j !== i))} style={{ ...ghost, padding: "6px 12px" }}>Remove</button>}
              </div>
            ))}
            <button onClick={() => setCerts(cs => [...cs, { state: "", permitNumber: "", expiresOn: "", uploadPath: "", fileName: "" }])} style={{ ...ghost, marginTop: 16 }}>+ Add another state</button>
            <p style={{ color: H.faint, fontSize: 12, marginTop: 12 }}>Files are private. Only the House Party Distro team can see them.</p>
          </>
        )}
      </div>

      <div style={box}>
        <H2 n="5" t="Sign and send" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
          <div><span style={lab}>Your name</span><input style={inp} value={signer.name} onChange={e => setSigner({ ...signer, name: e.target.value })} /></div>
          <div><span style={lab}>Title</span><input style={inp} value={signer.title} onChange={e => setSigner({ ...signer, title: e.target.value })} /></div>
          <div><span style={lab}>Email</span><input style={inp} type="email" value={signer.email} onChange={e => setSigner({ ...signer, email: e.target.value })} /></div>
        </div>
        {check(signer.certified, v => setSigner({ ...signer, certified: v }), taxExempt ? "I certify this information is accurate and that purchases are for resale." : "I certify this information is accurate.")}
        {problems.length > 0 && <div style={{ marginTop: 14, fontSize: 13, color: H.faint, lineHeight: 1.6 }}>{problems.map(p => <div key={p}>· {p}</div>)}</div>}
        {err && <div style={{ marginTop: 12, fontSize: 13.5, color: H.red }}>{err}</div>}
        <button onClick={submit} disabled={busy || problems.length > 0}
          style={{ marginTop: 18, width: "100%", background: "#fff", color: H.ink, border: 0, borderRadius: 999, padding: "15px 22px", fontSize: 13, fontWeight: 900, letterSpacing: "0.07em", textTransform: "uppercase", cursor: busy || problems.length ? "default" : "pointer", opacity: busy || problems.length ? 0.45 : 1, fontFamily: H.font }}>
          {busy ? "Saving…" : "Save my info"}
        </button>
      </div>
    </div>
  );
}
