"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { subtractBusinessDays, addBusinessDays, calculatePriority } from "@/lib/dates";

type ClientOption = { id: string; name: string; default_terms: string | null; client_type: string | null; };

export default function NewJobPage() {
  const router = useRouter();
  const supabase = createClient();
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
    target_ship_date: "",
    in_hands_date: "",
    notes: "",
    client_name: "",
  });

  // Client typeahead
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [filteredClients, setFilteredClients] = useState<ClientOption[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [newClientForm, setNewClientForm] = useState({ name: "", client_type: "", default_terms: "", notes: "", contacts: [] as {name:string,email:string,phone:string,role:string}[] });
  const [savingClient, setSavingClient] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from("clients").select("id, name, default_terms, client_type").order("name").then(({ data }) => {
      setClients(data || []);
    });
  }, []);

  useEffect(() => {
    const q = form.client_name.trim().toLowerCase();
    if (q.length === 0) { setFilteredClients([]); return; }
    setFilteredClients(clients.filter(c => c.name.toLowerCase().includes(q)));
  }, [form.client_name, clients]);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const selectClient = (c: ClientOption) => {
    setForm(f => ({
      ...f,
      client_name: c.name,
      payment_terms: c.default_terms || f.payment_terms,
      job_type: c.client_type || f.job_type,
    }));
    setSelectedClientId(c.id);
    setShowDropdown(false);
  };

  const openNewClientModal = () => {
    setNewClientForm({ name: form.client_name.trim(), client_type: "", default_terms: "", notes: "", contacts: [] });
    setShowNewClientModal(true);
    setShowDropdown(false);
  };

  const addModalContact = () => {
    setNewClientForm(f => ({...f, contacts: [...f.contacts, {name:"",email:"",phone:"",role:""}]}));
  };
  const updateModalContact = (idx: number, field: string, value: string) => {
    setNewClientForm(f => ({...f, contacts: f.contacts.map((c,i) => i===idx ? {...c,[field]:value} : c)}));
  };
  const removeModalContact = (idx: number) => {
    setNewClientForm(f => ({...f, contacts: f.contacts.filter((_,i) => i!==idx)}));
  };

  const saveNewClient = async () => {
    if (!newClientForm.name.trim()) return;
    setSavingClient(true);
    const { data, error: err } = await supabase.from("clients").insert({
      name: newClientForm.name.trim(),
      client_type: newClientForm.client_type || null,
      default_terms: newClientForm.default_terms || null,
      notes: newClientForm.notes || null,
    }).select("id, name").single();
    if (err || !data) { setSavingClient(false); setError(err?.message || "Failed to create client"); return; }
    // Create contacts
    const validContacts = newClientForm.contacts.filter(c => c.name.trim() || c.email.trim());
    if (validContacts.length > 0) {
      await supabase.from("contacts").insert(validContacts.map((c,i) => ({
        client_id: data.id,
        name: c.name.trim() || c.email.trim(),
        email: c.email.trim() || null,
        phone: c.phone.trim() || null,
        role_label: c.role.trim() || null,
        is_primary: i === 0,
      })));
    }
    setSavingClient(false);
    // Add to local list and select
    setClients(prev => [...prev, { id: data.id, name: data.name, default_terms: newClientForm.default_terms || null, client_type: newClientForm.client_type || null }].sort((a,b) => a.name.localeCompare(b.name)));
    setForm(f => ({ ...f, client_name: data.name, payment_terms: newClientForm.default_terms || f.payment_terms, job_type: newClientForm.client_type || f.job_type }));
    setSelectedClientId(data.id);
    setShowNewClientModal(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const clientId = selectedClientId;

      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          title: form.title,
          job_type: form.job_type,
          phase: form.phase,
          priority: form.priority,
          shipping_route: form.shipping_route,
          payment_terms: form.payment_terms || null,
          target_ship_date: form.target_ship_date || null,
          type_meta: {
            in_hands_date: form.in_hands_date || null,
            payment_method: form.payment_method || null,
          },
          notes: form.notes || null,
          client_id: clientId,
          job_number: "",
        })
        .select("id")
        .single();

      if (jobError) throw jobError;

      // Auto-add client's contacts to the new job
      if (clientId) {
        const { data: clientContacts } = await supabase
          .from("contacts")
          .select("id, is_primary")
          .eq("client_id", clientId);
        if (clientContacts?.length) {
          await supabase.from("job_contacts").insert(
            clientContacts.map(c => ({
              job_id: job.id,
              contact_id: c.id,
              role_on_job: c.is_primary ? "primary" : "cc",
            }))
          );
        }
      }

      router.push(`/jobs/${job.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  const ic = "w-full px-3 py-2 rounded-md bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary transition-colors";
  const lc = "block text-sm font-medium mb-1.5";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Project</h1>
        <p className="text-muted-foreground text-sm mt-1">Create a new production project</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Project Details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div ref={dropdownRef} className="relative">
              <label className={lc}>Client</label>
              <input value={form.client_name}
                onChange={e => { set("client_name", e.target.value); setSelectedClientId(null); setShowDropdown(true); }}
                onFocus={() => { if (form.client_name.trim()) setShowDropdown(true); }}
                placeholder="Start typing to search..."
                className={ic}
                autoComplete="off" />
              {showDropdown && form.client_name.trim() && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-card shadow-lg">
                  {filteredClients.map(c => (
                    <button key={c.id} type="button" onClick={() => selectClient(c)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors border-b border-border last:border-0">
                      {c.name}
                    </button>
                  ))}
                  <button type="button" onClick={openNewClientModal}
                    className="w-full text-left px-3 py-2 text-sm font-semibold text-primary hover:bg-secondary transition-colors">
                    + Create &quot;{form.client_name.trim()}&quot; as new client
                  </button>
                </div>
              )}
              {selectedClientId && <p className="text-xs text-primary mt-1">Existing client selected</p>}
              {!selectedClientId && form.client_name.trim() && <p className="text-xs text-muted-foreground mt-1">Select a client or create new</p>}
            </div>
            <div>
              <label className={lc}>Project memo</label>
              <input value={form.title} onChange={e => set("title", e.target.value)}
                placeholder="Optional description..." className={ic} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lc}>Project Type *</label>
              <select value={form.job_type} onChange={e => set("job_type", e.target.value)} className={ic}>
                {["corporate","brand","artist","tour","webstore","drop_ship"].map(t=>
                  <option key={t} value={t}>{t.replace(/_/g," ")}</option>
                )}
              </select>
            </div>
          </div>

          <div>
            <label className={lc}>Shipping Route</label>
            <select value={form.shipping_route} onChange={e => set("shipping_route", e.target.value)} className={ic}>
              <option value="ship_through">Ship-through (forward from HPD)</option>
              <option value="stage">Stage (fulfillment from HPD)</option>
              <option value="drop_ship">Drop ship (direct to client)</option>
            </select>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Timeline & Payment</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lc}>In-Hands Date</label>
              <input type="date" value={form.in_hands_date} onChange={e => {
                set("in_hands_date", e.target.value);
                if (e.target.value) {
                  const ship = subtractBusinessDays(e.target.value, 3);
                  set("target_ship_date", ship);
                  set("priority", calculatePriority(ship));
                }
              }} className={ic} />
            </div>
            <div>
              <label className={lc}>Target Ship Date</label>
              <input type="date" value={form.target_ship_date} onChange={e => {
                set("target_ship_date", e.target.value);
                if (e.target.value) {
                  set("priority", calculatePriority(e.target.value));
                  if (!form.in_hands_date) set("in_hands_date", addBusinessDays(e.target.value, 3));
                }
              }} className={ic} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lc}>Payment Terms</label>
              <select value={form.payment_terms} onChange={e => set("payment_terms", e.target.value)} className={ic}>
                <option value="">Not set</option>
                <option value="net_15">Net 15</option>
                <option value="net_30">Net 30</option>
                <option value="deposit_balance">Deposit + Balance</option>
                <option value="prepaid">Prepaid</option>
              </select>
            </div>
            <div>
              <label className={lc}>Payment Method</label>
              <select value={form.payment_method} onChange={e => set("payment_method", e.target.value)} className={ic}>
                <option value="quickbooks">QuickBooks</option>
                <option value="ach">ACH</option>
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Notes</h2>
          <textarea value={form.notes} onChange={e => set("notes", e.target.value)}
            placeholder="Any additional context..."
            rows={3}
            className={ic + " resize-none"} />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-3">
          <button type="submit" disabled={loading}
            className="px-6 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
            {loading ? "Creating..." : "Create project"}
          </button>
          <button type="button" onClick={() => router.back()}
            className="px-6 py-2 rounded-md border border-border text-sm font-medium hover:bg-secondary transition-colors">
            Cancel
          </button>
        </div>
      </form>

      {/* New Client Modal */}
      {showNewClientModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}
          onClick={e => { if (e.target === e.currentTarget) setShowNewClientModal(false); }}>
          <div style={{ background:"#1e2333", border:"1px solid #2a3050", borderRadius:12, padding:24, width:420, maxWidth:"90vw" }}>
            <h3 style={{ fontSize:16, fontWeight:700, color:"#e8eaf2", marginBottom:16 }}>New Client</h3>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <label style={{ fontSize:12, color:"#7a82a0", marginBottom:4, display:"block" }}>Client Name *</label>
                <input value={newClientForm.name} onChange={e => setNewClientForm(f => ({...f, name: e.target.value}))}
                  style={{ width:"100%", padding:"8px 12px", borderRadius:6, border:"1px solid #2a3050", background:"#181c27", color:"#e8eaf2", fontSize:14, outline:"none", boxSizing:"border-box" }} autoFocus />
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div>
                  <label style={{ fontSize:12, color:"#7a82a0", marginBottom:4, display:"block" }}>Client Type</label>
                  <select value={newClientForm.client_type} onChange={e => setNewClientForm(f => ({...f, client_type: e.target.value}))}
                    style={{ width:"100%", padding:"8px 12px", borderRadius:6, border:"1px solid #2a3050", background:"#181c27", color:"#e8eaf2", fontSize:13, outline:"none", cursor:"pointer" }}>
                    <option value="">—</option>
                    <option value="corporate">Corporate</option>
                    <option value="brand">Brand</option>
                    <option value="artist">Artist</option>
                    <option value="tour">Tour</option>
                    <option value="webstore">Webstore</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:12, color:"#7a82a0", marginBottom:4, display:"block" }}>Payment Terms</label>
                  <select value={newClientForm.default_terms} onChange={e => setNewClientForm(f => ({...f, default_terms: e.target.value}))}
                    style={{ width:"100%", padding:"8px 12px", borderRadius:6, border:"1px solid #2a3050", background:"#181c27", color:"#e8eaf2", fontSize:13, outline:"none", cursor:"pointer" }}>
                    <option value="">—</option>
                    <option value="net_15">Net 15</option>
                    <option value="net_30">Net 30</option>
                    <option value="deposit_balance">Deposit + Balance</option>
                    <option value="prepaid">Prepaid</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize:12, color:"#7a82a0", marginBottom:4, display:"block" }}>Notes</label>
                <textarea value={newClientForm.notes} onChange={e => setNewClientForm(f => ({...f, notes: e.target.value}))}
                  placeholder="Any notes about this client..."
                  rows={2}
                  style={{ width:"100%", padding:"8px 12px", borderRadius:6, border:"1px solid #2a3050", background:"#181c27", color:"#e8eaf2", fontSize:13, outline:"none", resize:"vertical", lineHeight:1.5, boxSizing:"border-box" }} />
              </div>
              {/* Contacts */}
              <div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                  <label style={{ fontSize:12, color:"#7a82a0" }}>Contacts</label>
                  <button type="button" onClick={addModalContact}
                    style={{ background:"none", border:"1px solid #2a3050", borderRadius:5, color:"#7a82a0", fontSize:11, padding:"2px 8px", cursor:"pointer" }}>+ Add</button>
                </div>
                {newClientForm.contacts.length === 0 && (
                  <div style={{ fontSize:11, color:"#3a4060", padding:"4px 0" }}>No contacts — you can add them later too</div>
                )}
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {newClientForm.contacts.map((c, idx) => (
                    <div key={idx} style={{ background:"#181c27", borderRadius:6, padding:"8px 10px", position:"relative" }}>
                      <button type="button" onClick={() => removeModalContact(idx)}
                        style={{ position:"absolute", top:6, right:8, background:"none", border:"none", color:"#3a4060", cursor:"pointer", fontSize:12 }}
                        onMouseEnter={e => e.currentTarget.style.color="#f05353"}
                        onMouseLeave={e => e.currentTarget.style.color="#3a4060"}>✕</button>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                        <input value={c.name} onChange={e => updateModalContact(idx, "name", e.target.value)} placeholder="Name"
                          style={{ padding:"5px 8px", borderRadius:4, border:"1px solid #2a3050", background:"#0f1117", color:"#e8eaf2", fontSize:12, outline:"none" }} />
                        <input value={c.email} onChange={e => updateModalContact(idx, "email", e.target.value)} placeholder="Email"
                          style={{ padding:"5px 8px", borderRadius:4, border:"1px solid #2a3050", background:"#0f1117", color:"#e8eaf2", fontSize:12, outline:"none" }} />
                        <input value={c.phone} onChange={e => updateModalContact(idx, "phone", e.target.value)} placeholder="Phone"
                          style={{ padding:"5px 8px", borderRadius:4, border:"1px solid #2a3050", background:"#0f1117", color:"#e8eaf2", fontSize:12, outline:"none" }} />
                        <input value={c.role} onChange={e => updateModalContact(idx, "role", e.target.value)} placeholder="Role"
                          style={{ padding:"5px 8px", borderRadius:4, border:"1px solid #2a3050", background:"#0f1117", color:"#e8eaf2", fontSize:12, outline:"none" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:16 }}>
              <button onClick={() => setShowNewClientModal(false)}
                style={{ padding:"8px 16px", borderRadius:6, border:"1px solid #2a3050", background:"transparent", color:"#7a82a0", fontSize:13, cursor:"pointer" }}>
                Cancel
              </button>
              <button onClick={saveNewClient} disabled={savingClient || !newClientForm.name.trim()}
                style={{ padding:"8px 20px", borderRadius:6, border:"none", background:"#4f8ef7", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", opacity: savingClient || !newClientForm.name.trim() ? 0.5 : 1 }}>
                {savingClient ? "Creating..." : "Create Client"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
