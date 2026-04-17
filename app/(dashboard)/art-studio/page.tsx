"use client";
import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { ArtBriefMessages } from "@/components/ArtBriefMessages";

const STATE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "Draft", color: T.muted, bg: T.surface },
  sent: { label: "Sent", color: T.accent, bg: T.accentDim },
  in_progress: { label: "In Progress", color: T.accent, bg: T.accentDim },
  wip_review: { label: "WIP Review", color: T.amber, bg: T.amberDim },
  client_review: { label: "Client Review", color: T.purple, bg: T.purpleDim },
  revisions: { label: "Revisions", color: T.red, bg: T.redDim },
  final_approved: { label: "Final Approved", color: T.green, bg: T.greenDim },
  delivered: { label: "Delivered", color: T.green, bg: T.greenDim },
};

const STATE_ORDER = ["draft", "sent", "in_progress", "wip_review", "client_review", "revisions", "final_approved", "delivered"];

type Brief = {
  id: string;
  title: string | null;
  concept: string | null;
  state: string;
  deadline: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  version_count: number;
  item_id: string | null;
  job_id: string | null;
  client_id: string | null;
  items?: { name: string } | null;
  jobs?: { title: string; job_number: string } | null;
  clients?: { name: string } | null;
  message_count?: number;
  designer_message_count?: number;
};

type Client = { id: string; name: string };

export default function ArtStudioPage() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [showNew, setShowNew] = useState(false);
  const [newBrief, setNewBrief] = useState({ title: "", client_id: "", concept: "", deadline: "" });
  const [creating, setCreating] = useState(false);
  const [selectedBrief, setSelectedBrief] = useState<Brief | null>(null);

  useEffect(() => { loadBriefs(); loadClients(); }, []);

  // Deep-link: open brief from ?brief=id (set by notification bell)
  useEffect(() => {
    const briefId = params?.get("brief");
    if (!briefId || briefs.length === 0) return;
    const match = briefs.find(b => b.id === briefId);
    if (match && (!selectedBrief || selectedBrief.id !== briefId)) setSelectedBrief(match);
  }, [params, briefs]);

  async function loadBriefs() {
    setLoading(true);
    const res = await fetch("/api/art-briefs");
    const data = await res.json();
    setBriefs(data.briefs || []);
    setLoading(false);
  }

  async function loadClients() {
    const { data } = await supabase.from("clients").select("id, name").order("name");
    setClients(data || []);
  }

  async function createBrief() {
    if (!newBrief.title.trim()) return;
    setCreating(true);
    const res = await fetch("/api/art-briefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newBrief.title.trim(),
        client_id: newBrief.client_id || null,
        concept: newBrief.concept.trim() || null,
        deadline: newBrief.deadline || null,
        state: "draft",
      }),
    });
    const data = await res.json();
    setCreating(false);
    if (data.brief) {
      setShowNew(false);
      setNewBrief({ title: "", client_id: "", concept: "", deadline: "" });
      setBriefs(p => [data.brief, ...p]);
      setSelectedBrief(data.brief);
    }
  }

  const filtered = stateFilter === "all" ? briefs : briefs.filter(b => b.state === stateFilter);

  // Count by state for filter chips
  const stateCounts: Record<string, number> = {};
  briefs.forEach(b => { stateCounts[b.state] = (stateCounts[b.state] || 0) + 1; });

  const ic = { padding: "7px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: "none", fontFamily: font, boxSizing: "border-box" as const };
  const label = { fontSize: 10, fontWeight: 600 as const, color: T.muted, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4, display: "block" };

  return (
    <div style={{ fontFamily: font, color: T.text }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Art Studio</h1>
          <p style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>Design team briefs and creative workflow</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <a href="/art-studio/preview"
            style={{ padding: "7px 14px", background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: "none", fontFamily: font }}>
            Preview (fake data)
          </a>
          <button onClick={() => setShowNew(true)}
            style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontFamily: font, fontWeight: 600, cursor: "pointer" }}>
            + New Brief
          </button>
        </div>
      </div>

      {/* State filter chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={() => setStateFilter("all")}
          style={{ padding: "5px 12px", borderRadius: 99, border: `1px solid ${stateFilter === "all" ? T.accent : T.border}`, background: stateFilter === "all" ? T.accentDim : "transparent", color: stateFilter === "all" ? T.accent : T.muted, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
          All ({briefs.length})
        </button>
        {STATE_ORDER.map(s => {
          const c = stateCounts[s] || 0;
          if (c === 0) return null;
          const st = STATE_LABELS[s];
          const active = stateFilter === s;
          return (
            <button key={s} onClick={() => setStateFilter(s)}
              style={{ padding: "5px 12px", borderRadius: 99, border: `1px solid ${active ? st.color : T.border}`, background: active ? st.bg : "transparent", color: active ? st.color : T.muted, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
              {st.label} ({c})
            </button>
          );
        })}
      </div>

      {/* Brief list */}
      {loading ? (
        <div style={{ fontSize: 13, color: T.muted }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 40, textAlign: "center", fontSize: 13, color: T.faint }}>
          {briefs.length === 0 ? "No briefs yet. Click + New Brief to get started." : "No briefs in this state."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map(b => {
            const st = STATE_LABELS[b.state] || STATE_LABELS.draft;
            const context = b.clients?.name || b.jobs?.title || "Unlinked";
            const dCount = b.designer_message_count || 0;
            return (
              <div key={b.id} onClick={() => setSelectedBrief(b)}
                style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 16, transition: "border-color 0.1s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = T.accent)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = T.border)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text, display: "flex", alignItems: "center", gap: 8 }}>
                    {b.title || "Untitled Brief"}
                    {dCount > 0 && (
                      <span title={`${dCount} message${dCount === 1 ? "" : "s"} from designer`}
                        style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: T.accentDim, color: T.accent, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        💬 {dCount}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                    {context}{b.items?.name ? ` · ${b.items.name}` : ""}
                    {b.deadline && ` · Due ${new Date(b.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                    {b.version_count > 0 && ` · v${b.version_count}`}
                    {b.assigned_to && ` · ${b.assigned_to}`}
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, padding: "4px 12px", borderRadius: 99, background: st.bg, color: st.color }}>
                  {st.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* New Brief Modal */}
      {showNew && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setShowNew(false); }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 480, maxWidth: "90vw" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, fontFamily: font, marginBottom: 16 }}>New Art Brief</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={label}>Title *</label>
                <input value={newBrief.title} onChange={e => setNewBrief(p => ({ ...p, title: e.target.value }))} style={{ ...ic, width: "100%" }} placeholder="e.g. Summer tour merch concepts" autoFocus />
              </div>
              <div>
                <label style={label}>Client (optional)</label>
                <select value={newBrief.client_id} onChange={e => setNewBrief(p => ({ ...p, client_id: e.target.value }))} style={{ ...ic, width: "100%", cursor: "pointer" }}>
                  <option value="">— unlinked —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={label}>Concept (optional)</label>
                <textarea rows={3} value={newBrief.concept} onChange={e => setNewBrief(p => ({ ...p, concept: e.target.value }))} style={{ ...ic, width: "100%", resize: "vertical" }} placeholder="Brief description of what you need..." />
              </div>
              <div>
                <label style={label}>Deadline (optional)</label>
                <input type="date" value={newBrief.deadline} onChange={e => setNewBrief(p => ({ ...p, deadline: e.target.value }))} style={{ ...ic, width: "100%" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={() => setShowNew(false)} style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 13, cursor: "pointer", fontFamily: font }}>Cancel</button>
              <button onClick={createBrief} disabled={creating || !newBrief.title.trim()} style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: (creating || !newBrief.title.trim()) ? 0.5 : 1 }}>
                {creating ? "Creating..." : "Create Brief"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Brief detail modal — reuse ArtBriefPanel via direct import */}
      {selectedBrief && (
        <BriefDetailModal brief={selectedBrief} onClose={(updated) => {
          setSelectedBrief(null);
          if (params?.get("brief")) router.replace("/art-studio");
          if (updated) loadBriefs();
        }} />
      )}
    </div>
  );
}

function BriefDetailModal({ brief, onClose }: { brief: Brief; onClose: (updated?: boolean) => void }) {
  const [form, setForm] = useState({
    title: brief.title || "",
    concept: brief.concept || "",
    placement: (brief as any).placement || "",
    colors: (brief as any).colors || "",
    deadline: brief.deadline || "",
    internal_notes: (brief as any).internal_notes || "",
    state: brief.state || "draft",
    assigned_to: brief.assigned_to || "",
  });
  const [saving, setSaving] = useState(false);
  const [savedIndicator, setSavedIndicator] = useState(false);
  const [changed, setChanged] = useState(false);

  async function save(updates: any) {
    setSaving(true);
    await fetch("/api/art-briefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: brief.id, ...updates }),
    });
    setSaving(false);
    setSavedIndicator(true);
    setChanged(true);
    setTimeout(() => setSavedIndicator(false), 1200);
  }

  function handleBlur(field: string) {
    if ((form as any)[field] !== (brief as any)[field]) save({ [field]: (form as any)[field] });
  }

  async function handleDelete() {
    if (!window.confirm("Delete this brief permanently?")) return;
    await fetch(`/api/art-briefs?id=${brief.id}`, { method: "DELETE" });
    onClose(true);
  }

  const ic = { width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: "none", fontFamily: font, boxSizing: "border-box" as const };
  const label = { fontSize: 10, fontWeight: 600 as const, color: T.muted, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4, display: "block" };

  const context = brief.clients?.name || brief.jobs?.title || "Unlinked brief";

  const [intakeData, setIntakeData] = useState<{ purpose: string | null; audience: string | null; mood_words: string[]; no_gos: string | null; submitted: string | null }>({
    purpose: (brief as any).purpose || null,
    audience: (brief as any).audience || null,
    mood_words: (brief as any).mood_words || [],
    no_gos: (brief as any).no_gos || null,
    submitted: (brief as any).client_intake_submitted_at || null,
  });
  const [references, setReferences] = useState<any[]>([]);
  const [wips, setWips] = useState<any[]>([]);
  const [finals, setFinals] = useState<any[]>([]);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [designers, setDesigners] = useState<any[]>([]);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [assignedDesignerId, setAssignedDesignerId] = useState<string | null>((brief as any).assigned_designer_id || null);
  const [sentAt, setSentAt] = useState<string | null>((brief as any).sent_to_designer_at || null);

  useEffect(() => {
    fetch(`/api/art-briefs?id=${brief.id}`).then(r => r.json()).then(data => {
      if (data.brief) {
        setIntakeData({
          purpose: data.brief.purpose || null,
          audience: data.brief.audience || null,
          mood_words: data.brief.mood_words || [],
          no_gos: data.brief.no_gos || null,
          submitted: data.brief.client_intake_submitted_at || null,
        });
        setAssignedDesignerId(data.brief.assigned_designer_id || null);
        setSentAt(data.brief.sent_to_designer_at || null);
      }
      const files = data.files || [];
      setReferences(files.filter((f: any) => f.kind === "reference"));
      setWips(files.filter((f: any) => f.kind === "wip").sort((a: any, b: any) => b.version - a.version));
      setFinals(files.filter((f: any) => f.kind === "final").sort((a: any, b: any) => b.version - a.version));
    });
    fetch("/api/designers").then(r => r.json()).then(d => setDesigners((d.designers || []).filter((x: any) => x.active)));
  }, [brief.id]);

  async function promoteFinalToPrintReady(fileId: string) {
    setPromoting(fileId);
    const res = await fetch("/api/art-briefs/promote-final", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief_file_id: fileId, brief_id: brief.id }),
    });
    const data = await res.json();
    setPromoting(null);
    if (data.success) {
      setSendResult(data.item_id ? "Promoted to print-ready on item ✓" : "Promoted (no item linked)");
      setChanged(true);
      setTimeout(() => setSendResult(null), 2500);
    } else {
      setSendResult(`Error: ${data.error}`);
      setTimeout(() => setSendResult(null), 3000);
    }
  }

  async function sendToDesigner(designerId: string) {
    setSending(true);
    const res = await fetch("/api/art-briefs/send-to-designer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief_id: brief.id, designer_id: designerId }),
    });
    const data = await res.json();
    setSending(false);
    setShowSendModal(false);
    if (data.success) {
      setAssignedDesignerId(designerId);
      setSentAt(new Date().toISOString());
      setSendResult(data.emailed ? "Sent + email delivered" : "Sent (no email — set up email on designer)");
      setChanged(true);
      setTimeout(() => setSendResult(null), 3000);
    } else {
      setSendResult(`Error: ${data.error}`);
    }
  }

  async function copyIntakeLink() {
    const res = await fetch("/api/art-briefs/intake-link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief_id: brief.id }),
    });
    const data = await res.json();
    if (data.token) {
      const url = `${window.location.origin}/art-intake/${data.token}`;
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }

  const [sendingIntake, setSendingIntake] = useState(false);
  const [intakeEmailResult, setIntakeEmailResult] = useState<string | null>(null);
  async function emailIntakeToClient() {
    setSendingIntake(true);
    const res = await fetch("/api/art-briefs/send-intake", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief_id: brief.id }),
    });
    const data = await res.json();
    setSendingIntake(false);
    if (data.success) {
      setIntakeEmailResult(`Emailed to ${data.recipients.join(", ")}`);
      setChanged(true);
    } else {
      setIntakeEmailResult(`Error: ${data.error}`);
    }
    setTimeout(() => setIntakeEmailResult(null), 3500);
  }

  async function saveHpdAnnotation(fileId: string, annotation: string) {
    await fetch("/api/art-briefs/files", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: fileId, hpd_annotation: annotation }),
    }).catch(() => {});
  }

  const purposeLabel: Record<string, string> = {
    tour: "Tour merch", event: "Event / one-off", brand_staple: "Brand staple",
    drop: "Drop / capsule", corporate: "Corporate / promo", retail: "Retail",
    other: "Other",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 40 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(changed); }}>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, width: "90vw", maxWidth: 900, maxHeight: "90vh", overflow: "auto", fontFamily: font }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{form.title || "Untitled Brief"}</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{context}{brief.items?.name ? ` · ${brief.items.name}` : ""}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={copyIntakeLink}
              style={{ padding: "5px 10px", background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
              {linkCopied ? "✓ Copied" : "Copy Link"}
            </button>
            <button onClick={emailIntakeToClient} disabled={sendingIntake}
              style={{ padding: "5px 12px", background: "transparent", color: T.accent, border: `1px solid ${T.accent}`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: sendingIntake ? 0.5 : 1 }}>
              {sendingIntake ? "Sending..." : "Email to Client"}
            </button>
            {intakeEmailResult && <span style={{ fontSize: 10, color: intakeEmailResult.startsWith("Error") ? T.red : T.green, fontWeight: 600 }}>{intakeEmailResult}</span>}
            <button onClick={() => setShowSendModal(true)}
              style={{ padding: "5px 12px", background: sentAt ? T.greenDim : T.accent, color: sentAt ? T.green : "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
              {sentAt ? "✓ Sent to Designer" : "Send to Designer"}
            </button>
            {sendResult && <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>{sendResult}</span>}
            {savedIndicator && !sendResult && <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>Saved</span>}
            {saving && <span style={{ fontSize: 10, color: T.muted }}>Saving...</span>}
            <button onClick={handleDelete} style={{ background: "none", border: `1px solid ${T.border}`, color: T.red, fontSize: 10, padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontFamily: font }}>Delete</button>
            <button onClick={() => onClose(changed)} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 18, padding: "0 4px" }}>×</button>
          </div>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* CLIENT INTAKE SECTION */}
          <div style={{ padding: 14, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Client Intake</div>
              {intakeData.submitted ? (
                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 10px", borderRadius: 99, background: T.greenDim, color: T.green }}>
                  Submitted {new Date(intakeData.submitted).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 10px", borderRadius: 99, background: T.amberDim, color: T.amber }}>
                  Awaiting client
                </span>
              )}
            </div>
            {!intakeData.submitted ? (
              <div style={{ fontSize: 12, color: T.faint, fontStyle: "italic" }}>
                Click "Copy Client Link" above and send it to the client. They'll fill out a quick intake that appears here.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", fontSize: 12 }}>
                  <span style={{ color: T.muted, fontWeight: 600 }}>Purpose:</span>
                  <span style={{ color: T.text }}>{intakeData.purpose ? purposeLabel[intakeData.purpose] || intakeData.purpose : "—"}</span>
                  <span style={{ color: T.muted, fontWeight: 600 }}>Audience:</span>
                  <span style={{ color: T.text }}>{intakeData.audience || "—"}</span>
                  <span style={{ color: T.muted, fontWeight: 600 }}>Mood:</span>
                  <span style={{ color: T.text }}>
                    {intakeData.mood_words.length > 0 ? intakeData.mood_words.map((w, i) => (
                      <span key={i} style={{ display: "inline-block", background: T.card, border: `1px solid ${T.border}`, borderRadius: 99, padding: "2px 10px", fontSize: 11, marginRight: 4 }}>{w}</span>
                    )) : "—"}
                  </span>
                  {intakeData.no_gos && <>
                    <span style={{ color: T.red, fontWeight: 600 }}>Avoid:</span>
                    <span style={{ color: T.text }}>{intakeData.no_gos}</span>
                  </>}
                </div>

                {/* Reference gallery */}
                {references.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>References</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                      {references.map(r => (
                        <div key={r.id} style={{ background: T.card, borderRadius: 6, border: `1px solid ${T.border}`, overflow: "hidden" }}>
                          <a href={r.drive_link} target="_blank" rel="noopener noreferrer">
                            <div style={{ width: "100%", aspectRatio: "5/4", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", borderBottom: `1px solid ${T.border}` }}>
                              <img src={r.drive_link?.replace("/view", "/preview") || ""} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} onError={e => (e.target as HTMLImageElement).style.display = "none"} />
                            </div>
                          </a>
                          <div style={{ padding: 8 }}>
                            {r.client_annotation && <div style={{ fontSize: 10, color: T.muted, fontStyle: "italic", marginBottom: 4 }}>"{r.client_annotation}"</div>}
                            <input
                              defaultValue={r.hpd_annotation || ""}
                              onBlur={e => saveHpdAnnotation(r.id, e.target.value)}
                              placeholder="HPD note to designer..."
                              style={{ width: "100%", fontSize: 10, padding: "4px 6px", border: `1px solid ${T.amber}44`, borderRadius: 4, background: T.amberDim + "33", color: T.amber, fontFamily: font, outline: "none", boxSizing: "border-box" }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* HPD TRANSLATION SECTION */}
          <div style={{ padding: 14, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>HPD Brief → Designer</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={label}>Title</label>
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} onBlur={() => handleBlur("title")} style={ic} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div>
                  <label style={label}>State</label>
                  <select value={form.state} onChange={e => { const v = e.target.value; setForm(p => ({ ...p, state: v })); save({ state: v }); }} style={{ ...ic, cursor: "pointer" }}>
                    {Object.entries(STATE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Deadline</label>
                  <input type="date" value={form.deadline || ""} onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))} onBlur={() => handleBlur("deadline")} style={ic} />
                </div>
                <div>
                  <label style={label}>Designer</label>
                  <input value={form.assigned_to} onChange={e => setForm(p => ({ ...p, assigned_to: e.target.value }))} onBlur={() => handleBlur("assigned_to")} style={ic} placeholder="Name" />
                </div>
              </div>
              <div>
                <label style={label}>Concept (for designer)</label>
                <textarea rows={3} value={form.concept} onChange={e => setForm(p => ({ ...p, concept: e.target.value }))} onBlur={() => handleBlur("concept")} style={{ ...ic, resize: "vertical", lineHeight: 1.4 }} placeholder="Translate client's intake into a clear creative direction..." />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={label}>Placement</label>
                  <input value={form.placement} onChange={e => setForm(p => ({ ...p, placement: e.target.value }))} onBlur={() => handleBlur("placement")} style={ic} placeholder="e.g. Full back, 12×14" />
                </div>
                <div>
                  <label style={label}>Colors</label>
                  <input value={form.colors} onChange={e => setForm(p => ({ ...p, colors: e.target.value }))} onBlur={() => handleBlur("colors")} style={ic} placeholder="e.g. 2c screen — white, red" />
                </div>
              </div>
              <div>
                <label style={{ ...label, color: T.amber }}>Internal Notes (HPD only, designer doesn't see)</label>
                <textarea rows={2} value={form.internal_notes} onChange={e => setForm(p => ({ ...p, internal_notes: e.target.value }))} onBlur={() => handleBlur("internal_notes")} style={{ ...ic, resize: "vertical", lineHeight: 1.4, borderColor: T.amber + "44" }} placeholder="Scratch pad, private..." />
              </div>
            </div>
          </div>

          {sentAt && (
            <div style={{ padding: 10, background: T.greenDim, borderRadius: 6, border: `1px solid ${T.green}44`, fontSize: 11, color: T.green, textAlign: "center" }}>
              Sent to designer on {new Date(sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.
              Their uploads, status changes, and messages appear below.
            </div>
          )}

          {/* DESIGNER WORK FILES */}
          {(wips.length > 0 || finals.length > 0) && (
            <div style={{ padding: 14, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Designer Work</div>
              {finals.length > 0 && (
                <div style={{ marginBottom: wips.length > 0 ? 14 : 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.green, marginBottom: 8 }}>Final · {finals.length}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {finals.map(f => (
                      <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: T.greenDim, border: `1px solid ${T.green}33`, borderRadius: 6, fontSize: 12 }}>
                        <span style={{ padding: "2px 8px", background: T.green, color: "#fff", borderRadius: 4, fontWeight: 700, fontSize: 10 }}>FINAL V{f.version}</span>
                        <a href={f.drive_link || "#"} target="_blank" rel="noopener noreferrer" style={{ flex: 1, color: T.text, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: font }}>{f.file_name}</a>
                        <span style={{ fontSize: 10, color: T.muted }}>{new Date(f.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        {brief.item_id && (
                          <button
                            onClick={() => promoteFinalToPrintReady(f.id)}
                            disabled={promoting === f.id}
                            style={{ padding: "4px 10px", background: T.accent, color: "#fff", border: "none", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: promoting === f.id ? 0.5 : 1 }}
                          >
                            {promoting === f.id ? "..." : "→ Print-Ready"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {wips.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.blue, marginBottom: 8 }}>WIPs · {wips.length}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {wips.map(w => (
                      <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: T.surface, borderRadius: 6, fontSize: 12 }}>
                        <span style={{ padding: "2px 8px", background: T.blueDim, color: T.blue, borderRadius: 4, fontWeight: 700, fontSize: 10 }}>V{w.version}</span>
                        <a href={w.drive_link || "#"} target="_blank" rel="noopener noreferrer" style={{ flex: 1, color: T.text, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: font }}>{w.file_name}</a>
                        <span style={{ fontSize: 10, color: T.muted }}>{new Date(w.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MESSAGES */}
          <div style={{ padding: 14, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8 }}>
            <ArtBriefMessages briefId={brief.id} onSent={() => setChanged(true)} />
          </div>
        </div>
      </div>

      {/* Send to Designer modal */}
      {showSendModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowSendModal(false); }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 440, maxWidth: "90vw" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, margin: 0, marginBottom: 6 }}>Send Brief to Designer</h3>
            <p style={{ fontSize: 12, color: T.muted, margin: 0, marginBottom: 16 }}>Designer will see this brief in their dashboard. If they have an email set, they'll get a notification.</p>
            {designers.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: T.faint, background: T.surface, borderRadius: 8 }}>
                No active designers.<br/>
                <a href="/settings/designers" style={{ color: T.accent, textDecoration: "none" }}>Add one in Settings →</a>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {designers.map(d => (
                  <button key={d.id} onClick={() => sendToDesigner(d.id)} disabled={sending}
                    style={{ padding: "10px 14px", textAlign: "left", background: assignedDesignerId === d.id ? T.accentDim : T.surface, border: `1px solid ${assignedDesignerId === d.id ? T.accent : T.border}`, borderRadius: 8, cursor: "pointer", fontFamily: font, opacity: sending ? 0.5 : 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{d.name}</div>
                    <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{d.email || "No email"}</div>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setShowSendModal(false)} style={{ marginTop: 14, width: "100%", padding: "8px", background: "transparent", border: `1px solid ${T.border}`, color: T.muted, borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: font }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
