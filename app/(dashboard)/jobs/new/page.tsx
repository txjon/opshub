"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { T, font, mono } from "@/lib/theme";
import { useIsMobile } from "@/lib/useIsMobile";

type ClientOption = { id: string; name: string; default_terms: string | null; };

export default function NewJobPage() {
  const router = useRouter();
  const supabase = createClient();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    job_type: "corporate",
    phase: "intake",
    priority: "normal",
    shipping_route: "ship_through",
    payment_terms: "",
    payment_method: "quickbooks",
    notes: "",
  });

  // Client selection
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientOption | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientList, setShowClientList] = useState(false);
  const clientRef = useRef<HTMLDivElement>(null);

  // New client modal
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [nc, setNc] = useState({
    company: "", contactName: "", email: "", phone: "", website: "",
    billingAddress: "", shippingAddress: "", sameAsBilling: true,
    taxExempt: false, defaultTerms: "prepaid", notes: "",
    extraContacts: [] as { name: string; email: string; phone: string }[],
  });
  const [savingClient, setSavingClient] = useState(false);

  useEffect(() => {
    supabase.from("clients").select("id, name, default_terms").order("name").then(({ data }) => {
      setClients(data || []);
    });
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (clientRef.current && !clientRef.current.contains(e.target as Node)) setShowClientList(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredClients = clientSearch.trim()
    ? clients.filter(c => c.name.toLowerCase().includes(clientSearch.trim().toLowerCase()))
    : clients;

  const selectClient = (c: ClientOption) => {
    setSelectedClient(c);
    setForm(f => ({ ...f, payment_terms: c.default_terms || f.payment_terms }));
    setShowClientList(false);
    setClientSearch("");
  };

  const clearClient = () => { setSelectedClient(null); setClientSearch(""); };
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const openNewClientModal = () => {
    setNc({
      company: "", contactName: "", email: "", phone: "", website: "",
      billingAddress: "", shippingAddress: "", sameAsBilling: true,
      taxExempt: false, defaultTerms: "prepaid", notes: "",
      extraContacts: [],
    });
    setShowNewClientModal(true);
  };

  const addExtraContact = () => setNc(p => ({ ...p, extraContacts: [...p.extraContacts, { name: "", email: "", phone: "" }] }));
  const updateExtraContact = (idx: number, field: string, value: string) => setNc(p => ({ ...p, extraContacts: p.extraContacts.map((c, i) => i === idx ? { ...c, [field]: value } : c) }));
  const removeExtraContact = (idx: number) => setNc(p => ({ ...p, extraContacts: p.extraContacts.filter((_, i) => i !== idx) }));

  const saveNewClient = async () => {
    if (!nc.company.trim()) return;
    setSavingClient(true);
    const insertData: any = {
      name: nc.company.trim(),
      default_terms: nc.defaultTerms || null,
      notes: nc.notes || null,
    };
    // New profile fields — only include if non-empty (graceful if columns don't exist yet)
    if (nc.website.trim()) insertData.website = nc.website.trim();
    if (nc.billingAddress.trim()) insertData.billing_address = nc.billingAddress.trim();
    const shipAddr = nc.sameAsBilling ? nc.billingAddress.trim() : nc.shippingAddress.trim();
    if (shipAddr) insertData.shipping_address = shipAddr;
    if (nc.taxExempt) insertData.tax_exempt = true;

    let { data, error: err } = await supabase.from("clients").insert(insertData).select("id, name, default_terms").single();
    // Retry without new fields if columns don't exist yet
    if (err && err.message?.includes("column")) {
      const fallback = { name: nc.company.trim(), default_terms: nc.defaultTerms || null, notes: nc.notes || null };
      const retry = await supabase.from("clients").insert(fallback).select("id, name, default_terms").single();
      data = retry.data; err = retry.error;
    }
    if (err || !data) { setSavingClient(false); setError(err?.message || "Failed to create client"); return; }

    // Create primary contact
    if (nc.contactName.trim() || nc.email.trim()) {
      await supabase.from("contacts").insert({
        client_id: data.id,
        name: nc.contactName.trim() || nc.email.trim(),
        email: nc.email.trim() || null,
        phone: nc.phone.trim() || null,
        is_primary: true,
      });
    }
    // Create extra contacts
    const extras = nc.extraContacts.filter(c => c.name.trim() || c.email.trim());
    if (extras.length > 0) {
      await supabase.from("contacts").insert(extras.map(c => ({
        client_id: data.id,
        name: c.name.trim() || c.email.trim(),
        email: c.email.trim() || null,
        phone: c.phone.trim() || null,
        is_primary: false,
      })));
    }

    setSavingClient(false);
    const newClient = { id: data.id, name: data.name, default_terms: data.default_terms };
    setClients(prev => [...prev, newClient].sort((a, b) => a.name.localeCompare(b.name)));
    selectClient(newClient);
    setShowNewClientModal(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) { setError("Please select or create a client"); return; }
    setLoading(true);
    setError("");

    try {
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          title: form.title,
          job_type: form.job_type,
          phase: form.phase,
          priority: form.priority,
          shipping_route: form.shipping_route,
          payment_terms: form.payment_terms || null,
          type_meta: { payment_method: form.payment_method || null },
          notes: form.notes || null,
          client_id: selectedClient.id,
          job_number: "",
        })
        .select("id")
        .single();

      if (jobError) throw jobError;

      const { data: clientContacts } = await supabase
        .from("contacts").select("id, is_primary").eq("client_id", selectedClient.id);
      if (clientContacts?.length) {
        await supabase.from("job_contacts").insert(
          clientContacts.map(c => ({ job_id: job.id, contact_id: c.id, role_on_job: c.is_primary ? "primary" : "cc" }))
        );
      }

      router.push(`/jobs/${job.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  const s = {
    card: { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 18px" } as React.CSSProperties,
    label: { fontSize: 11, color: T.muted, marginBottom: 4, display: "block", fontFamily: font, fontWeight: 500 } as React.CSSProperties,
    input: { width: "100%", padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, outline: "none", fontFamily: font, boxSizing: "border-box" as const },
    select: { width: "100%", padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, outline: "none", fontFamily: font, cursor: "pointer", boxSizing: "border-box" as const },
  };

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, fontFamily: font, marginBottom: 4 }}>New Project</h1>
      <p style={{ fontSize: 12, color: T.faint, fontFamily: font, marginBottom: 20 }}>Select a client to get started</p>

      <form onSubmit={handleSubmit}>
        {/* Client selection */}
        <div style={{ ...s.card, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: font }}>Client</span>
            <button type="button" onClick={openNewClientModal}
              style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
              + New Client
            </button>
          </div>

          {selectedClient ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 8, background: T.accentDim, border: `1px solid ${T.accent}44` }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text, fontFamily: font }}>{selectedClient.name}</div>
                {selectedClient.default_terms && <div style={{ fontSize: 10, color: T.accent, fontFamily: font, marginTop: 1 }}>{selectedClient.default_terms.replace(/_/g, " ")}</div>}
              </div>
              <button type="button" onClick={clearClient}
                style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 16, padding: "0 4px" }}
                onMouseEnter={e => (e.currentTarget.style.color = T.red)} onMouseLeave={e => (e.currentTarget.style.color = T.faint)}>✕</button>
            </div>
          ) : (
            <div ref={clientRef} style={{ position: "relative" }}>
              <input value={clientSearch} onChange={e => { setClientSearch(e.target.value); setShowClientList(true); }}
                onFocus={() => setShowClientList(true)} placeholder="Search clients..." style={s.input} autoComplete="off" autoFocus />
              {showClientList && (
                <div style={{ position: "absolute", zIndex: 50, top: "100%", left: 0, right: 0, marginTop: 4, maxHeight: 240, overflowY: "auto", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                  {filteredClients.length === 0 ? (
                    <div style={{ padding: "12px 14px", fontSize: 12, color: T.faint, fontFamily: font }}>{clientSearch.trim() ? "No clients found" : "No clients yet"}</div>
                  ) : filteredClients.map(c => (
                    <button key={c.id} type="button" onClick={() => selectClient(c)}
                      style={{ width: "100%", textAlign: "left", padding: "9px 14px", background: "transparent", border: "none", borderBottom: `1px solid ${T.border}`, cursor: "pointer", color: T.text, fontSize: 13, fontFamily: font, fontWeight: 600 }}
                      onMouseEnter={e => (e.currentTarget.style.background = T.surface)} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Project details */}
        <div style={{ ...s.card, marginBottom: 12, opacity: selectedClient ? 1 : 0.4, pointerEvents: selectedClient ? "auto" : "none", transition: "opacity 0.2s" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: font, display: "block", marginBottom: 10 }}>Project Details</span>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
            <div>
              <label style={s.label}>Project memo</label>
              <input value={form.title} onChange={e => set("title", e.target.value)} style={s.input} />
            </div>
            <div>
              <label style={s.label}>Shipping route</label>
              <select value={form.shipping_route} onChange={e => set("shipping_route", e.target.value)} style={s.select}>
                <option value="ship_through">Ship-through</option>
                <option value="stage">Stage (fulfillment)</option>
                <option value="drop_ship">Drop ship</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={s.label}>Notes</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2}
              style={{ ...s.input, resize: "vertical" as const, lineHeight: 1.5 }} />
          </div>
        </div>

        {error && <p style={{ fontSize: 12, color: T.red, fontFamily: font, marginBottom: 8 }}>{error}</p>}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={loading || !selectedClient}
            style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: selectedClient ? T.accent : T.surface, color: selectedClient ? "#fff" : T.faint, fontSize: 13, fontWeight: 600, cursor: selectedClient ? "pointer" : "default", fontFamily: font, opacity: loading ? 0.5 : 1 }}>
            {loading ? "Creating..." : "Create Project"}
          </button>
          <button type="button" onClick={() => router.back()}
            style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 13, fontFamily: font, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </form>

      {/* New Client Modal */}
      {showNewClientModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) { if (nc.company.trim() || nc.contactName.trim() || nc.email.trim()) { if (!window.confirm("You have unsaved client info. Discard?")) return; } setShowNewClientModal(false); } }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 520, maxWidth: "90vw", maxHeight: "85vh", overflowY: "auto" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, fontFamily: font, marginBottom: 16 }}>New Client</h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Company name */}
              <div>
                <label style={s.label}>Company / Client Name *</label>
                <input value={nc.company} onChange={e => setNc(p => ({ ...p, company: e.target.value }))}
                  style={{ ...s.input, fontSize: 14 }} autoFocus />
              </div>

              {/* Primary contact */}
              <div style={{ background: T.surface, borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, fontFamily: font }}>Primary Contact</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={s.label}>Name</label>
                    <input value={nc.contactName} onChange={e => setNc(p => ({ ...p, contactName: e.target.value }))} style={s.input} />
                  </div>
                  <div>
                    <label style={s.label}>Phone</label>
                    <input value={nc.phone} onChange={e => setNc(p => ({ ...p, phone: e.target.value }))} style={s.input} />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={s.label}>Email</label>
                    <input value={nc.email} onChange={e => setNc(p => ({ ...p, email: e.target.value }))} type="email" style={s.input} />
                  </div>
                </div>
              </div>

              {/* Additional contacts */}
              {nc.extraContacts.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {nc.extraContacts.map((c, idx) => (
                    <div key={idx} style={{ background: T.surface, borderRadius: 8, padding: "10px 12px", position: "relative" }}>
                      <button type="button" onClick={() => removeExtraContact(idx)}
                        style={{ position: "absolute", top: 8, right: 10, background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 12 }}
                        onMouseEnter={e => (e.currentTarget.style.color = T.red)} onMouseLeave={e => (e.currentTarget.style.color = T.faint)}>✕</button>
                      <div style={{ fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, fontFamily: font }}>Additional Contact</div>
                      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 6 }}>
                        <div><label style={s.label}>Name</label><input value={c.name} onChange={e => updateExtraContact(idx, "name", e.target.value)} style={s.input} /></div>
                        <div><label style={s.label}>Email</label><input value={c.email} onChange={e => updateExtraContact(idx, "email", e.target.value)} style={s.input} /></div>
                        <div><label style={s.label}>Phone</label><input value={c.phone} onChange={e => updateExtraContact(idx, "phone", e.target.value)} style={s.input} /></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" onClick={addExtraContact}
                style={{ background: "none", border: `1px dashed ${T.border}`, borderRadius: 6, color: T.muted, fontSize: 11, padding: "7px 0", cursor: "pointer", fontFamily: font, width: "100%" }}>
                + Add Another Contact
              </button>

              {/* Website */}
              <div>
                <label style={s.label}>Website</label>
                <input value={nc.website} onChange={e => setNc(p => ({ ...p, website: e.target.value }))} style={s.input} />
              </div>

              {/* Addresses */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={s.label}>Billing Address</label>
                  <textarea value={nc.billingAddress} onChange={e => setNc(p => ({ ...p, billingAddress: e.target.value }))}
rows={3} style={{ ...s.input, resize: "vertical" as const, lineHeight: 1.4 }} />
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <label style={{ ...s.label, marginBottom: 0 }}>Shipping Address</label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: T.muted, cursor: "pointer", fontFamily: font }}>
                      <input type="checkbox" checked={nc.sameAsBilling} onChange={e => setNc(p => ({ ...p, sameAsBilling: e.target.checked }))}
                        style={{ accentColor: T.accent }} />
                      Same as billing
                    </label>
                  </div>
                  {nc.sameAsBilling ? (
                    <div style={{ padding: "10px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, fontSize: 12, color: T.faint, fontFamily: font, minHeight: 72, display: "flex", alignItems: "center" }}>
                      {nc.billingAddress.trim() || "Will use billing address"}
                    </div>
                  ) : (
                    <textarea value={nc.shippingAddress} onChange={e => setNc(p => ({ ...p, shippingAddress: e.target.value }))}
  rows={3} style={{ ...s.input, resize: "vertical" as const, lineHeight: 1.4 }} />
                  )}
                </div>
              </div>

              {/* Payment terms + tax exempt */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "end" }}>
                <div>
                  <label style={s.label}>Default Payment Terms</label>
                  <select value={nc.defaultTerms} onChange={e => setNc(p => ({ ...p, defaultTerms: e.target.value }))} style={s.select}>
                    <option value="">—</option>
                    <option value="net_15">Net 15</option>
                    <option value="net_30">Net 30</option>
                    <option value="deposit_balance">Deposit + Balance</option>
                    <option value="prepaid">Prepaid</option>
                  </select>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "8px 0", fontFamily: font, fontSize: 12, color: T.text, whiteSpace: "nowrap" }}>
                  <input type="checkbox" checked={nc.taxExempt} onChange={e => setNc(p => ({ ...p, taxExempt: e.target.checked }))}
                    style={{ accentColor: T.accent, width: 16, height: 16 }} />
                  Tax Exempt
                </label>
              </div>

              {/* Notes */}
              <div>
                <label style={s.label}>Notes</label>
                <textarea value={nc.notes} onChange={e => setNc(p => ({ ...p, notes: e.target.value }))}
rows={2} style={{ ...s.input, resize: "vertical" as const, lineHeight: 1.5 }} />
              </div>
            </div>

            {error && <p style={{ fontSize: 12, color: T.red, fontFamily: font, marginTop: 12 }}>{error}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: error ? 8 : 18 }}>
              <button type="button" onClick={() => setShowNewClientModal(false)}
                style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 13, cursor: "pointer", fontFamily: font }}>
                Cancel
              </button>
              <button type="button" onClick={saveNewClient} disabled={savingClient || !nc.company.trim()}
                style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: savingClient || !nc.company.trim() ? 0.5 : 1 }}>
                {savingClient ? "Creating..." : "Create Client"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
