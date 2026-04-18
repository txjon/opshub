"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { ArtBriefMessages } from "@/components/ArtBriefMessages";
import {
  STAGES,
  STAGE_BY_KEY,
  type Card,
  type BoardFilters,
  type AvailableProject,
  KanbanBoard,
  ClientLanesBoard,
  BoardFilterControls,
  ActiveFilterBar,
} from "@/components/ArtBoard";
import { ProjectPicker } from "@/components/ProjectPicker";

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
  client_intake_token?: string | null;
  client_intake_submitted_at?: string | null;
  items?: { name: string } | null;
  jobs?: { title: string; job_number: string; job_type: string | null } | null;
  clients?: { name: string } | null;
  message_count?: number;
  designer_message_count?: number;
  thumbs?: Array<{ drive_file_id: string | null; drive_link: string | null }>;
  thumb_total?: number;
  thumb_file_id?: string | null;
  thumb_link?: string | null;
};

// Map brief.state (+ intake sub-state) to one of the 9 ArtBoard stages.
function stageForBrief(b: Brief) {
  const s = b.state;
  if (s === "draft") {
    if (b.client_intake_submitted_at) return STAGE_BY_KEY.intake_submitted;
    if (b.client_intake_token) return STAGE_BY_KEY.awaiting_intake;
    return STAGE_BY_KEY.draft;
  }
  if (s === "sent" || s === "in_progress") return STAGE_BY_KEY.sent_to_designer;
  if (s === "wip_review") return STAGE_BY_KEY.wip_review;
  if (s === "client_review") return STAGE_BY_KEY.client_review;
  if (s === "revisions") return STAGE_BY_KEY.revisions;
  if (s === "final_approved") return STAGE_BY_KEY.final_approved;
  if (s === "delivered") return STAGE_BY_KEY.delivered;
  return STAGE_BY_KEY.draft;
}

function daysSince(iso?: string | null) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

// Real brief → board Card. Meta is derived from actual fields.
function briefToCard(b: Brief): Card {
  const stage = stageForBrief(b);
  const dCount = b.designer_message_count || 0;
  const daysUpdated = daysSince(b.updated_at || b.created_at);
  const lines: string[] = [];
  let urgency: Card["meta"]["urgency"] = "normal";
  let cta: string | undefined;

  if (stage.key === "draft") {
    lines.push("No intake sent yet");
    if (daysUpdated > 3) urgency = "stale";
    cta = "Open brief";
  } else if (stage.key === "awaiting_intake") {
    lines.push(`Intake sent ${daysUpdated}d ago`);
    lines.push("Waiting on client");
    if (daysUpdated > 3) urgency = "stale";
    cta = "Send reminder";
  } else if (stage.key === "intake_submitted") {
    lines.push(`Submitted ${daysSince(b.client_intake_submitted_at)}d ago`);
    lines.push("Ready to translate");
    urgency = "action";
    cta = "Translate";
  } else if (stage.key === "sent_to_designer") {
    lines.push(`Sent ${daysUpdated}d ago`);
    if (dCount) lines.push(`${dCount} msg from designer`);
    else lines.push("No updates yet");
    if (daysUpdated > 4) urgency = "stale";
  } else if (stage.key === "wip_review") {
    lines.push(`WIP uploaded ${daysUpdated}d ago${b.version_count ? ` · v${b.version_count}` : ""}`);
    if (dCount) lines.push(`${dCount} msg from designer`);
    urgency = "action";
    cta = "Review & send to client";
  } else if (stage.key === "client_review") {
    lines.push(`With client ${daysUpdated}d`);
    if (daysUpdated > 3) urgency = "stale";
    cta = "Nudge client";
  } else if (stage.key === "revisions") {
    lines.push(`Revisions requested ${daysUpdated}d ago`);
    if (dCount) lines.push(`${dCount} msg from designer`);
    urgency = "action";
    cta = "View feedback";
  } else if (stage.key === "final_approved") {
    lines.push(`Final uploaded${b.version_count ? ` v${b.version_count}` : ""}`);
    lines.push("Ready for handoff");
    urgency = "action";
    cta = "→ Print-Ready";
  } else if (stage.key === "delivered") {
    lines.push(`Delivered ${daysUpdated}d ago`);
    urgency = "done";
  }

  if (b.deadline) {
    const d = new Date(b.deadline);
    lines.push(`Due ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
  }

  const thumbs = (b.thumbs || []).map(t => ({ fileId: t.drive_file_id, link: t.drive_link }));

  return {
    id: b.id,
    title: b.title || "",
    clientName: b.clients?.name || "Unlinked",
    jobTitle: b.jobs?.title || (b.items?.name ? b.items.name : ""),
    jobNumber: b.jobs?.job_number || null,
    jobType: b.jobs?.job_type || null,
    jobId: b.job_id,
    thumbs,
    thumbTotal: b.thumb_total ?? thumbs.length,
    thumbFileId: b.thumb_file_id || null,
    thumbLink: b.thumb_link || null,
    stage,
    meta: { lines, urgency, cta },
    hash: 0,
  };
}

type Client = { id: string; name: string };

export default function ArtStudioPage() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [selectedBrief, setSelectedBrief] = useState<Brief | null>(null);
  const [filters, setFiltersState] = useState<BoardFilters>({
    search: "",
    clientFilter: "",
    projectFilter: "",
    view: "by_stage",
  });
  const setFilters = (patch: Partial<BoardFilters>) => setFiltersState(p => ({ ...p, ...patch }));

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

  // Map briefs → board cards once, then apply filters against cards
  const allCards = useMemo(() => briefs.map(briefToCard), [briefs]);

  const allClients = useMemo(() => {
    const set = new Set<string>();
    allCards.forEach(c => set.add(c.clientName));
    return [...set].sort();
  }, [allCards]);

  const availableProjects = useMemo<AvailableProject[]>(() => {
    const map = new Map<string, AvailableProject>();
    allCards.forEach(c => {
      if (!c.jobId) return;
      if (filters.clientFilter && c.clientName !== filters.clientFilter) return;
      const cur = map.get(c.jobId);
      if (cur) cur.count++;
      else map.set(c.jobId, { jobId: c.jobId, title: c.jobTitle, jobNumber: c.jobNumber, clientName: c.clientName, count: 1 });
    });
    return [...map.values()].sort((a, b) =>
      a.clientName.localeCompare(b.clientName) || a.title.localeCompare(b.title)
    );
  }, [allCards, filters.clientFilter]);

  useEffect(() => {
    if (!filters.projectFilter) return;
    const ok = availableProjects.some(p => p.jobId === filters.projectFilter);
    if (!ok) setFilters({ projectFilter: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableProjects]);

  const filteredCards = useMemo(() => {
    let out = allCards;
    if (filters.clientFilter) out = out.filter(c => c.clientName === filters.clientFilter);
    if (filters.projectFilter) out = out.filter(c => c.jobId === filters.projectFilter);
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      out = out.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.clientName.toLowerCase().includes(q) ||
        c.jobTitle.toLowerCase().includes(q) ||
        (c.jobNumber || "").toLowerCase().includes(q)
      );
    }
    return out;
  }, [allCards, filters]);

  // Filtered briefs for list view (keeps the original row rendering that staff know)
  const filteredBriefs = useMemo(() => {
    const ids = new Set(filteredCards.map(c => c.id));
    return briefs.filter(b => ids.has(b.id));
  }, [filteredCards, briefs]);

  function openBriefFromCard(card: Card) {
    const b = briefs.find(x => x.id === card.id);
    if (b) setSelectedBrief(b);
  }

  const projectCount = useMemo(() => {
    const s = new Set<string>();
    allCards.forEach(c => c.jobId && s.add(c.jobId));
    return s.size;
  }, [allCards]);

  const ic = { padding: "7px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: "none", fontFamily: font, boxSizing: "border-box" as const };
  const label = { fontSize: 10, fontWeight: 600 as const, color: T.muted, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4, display: "block" };

  return (
    <div style={{ fontFamily: font, color: T.text }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Art Studio</h1>
          <p style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            {filteredCards.length} {filters.clientFilter ? `briefs for ${filters.clientFilter}` : "briefs"} · {allClients.length} {allClients.length === 1 ? "client" : "clients"} · {projectCount} {projectCount === 1 ? "project" : "projects"} active
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setShowNewRequest(true)}
            style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontFamily: font, fontWeight: 700, cursor: "pointer" }}>
            + New Request
          </button>
        </div>
      </div>

      {/* Filter controls */}
      <div style={{ marginBottom: 14 }}>
        <BoardFilterControls
          filters={filters}
          setFilters={setFilters}
          allClients={allClients}
          availableProjects={availableProjects}
          showListView
        />
      </div>

      <ActiveFilterBar
        filters={filters}
        setFilters={setFilters}
        availableProjects={availableProjects}
        resultCount={filteredCards.length}
      />

      {/* Board */}
      {loading ? (
        <div style={{ fontSize: 13, color: T.muted }}>Loading...</div>
      ) : briefs.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 40, textAlign: "center", fontSize: 13, color: T.faint }}>
          No requests yet. Click <strong>+ New Request</strong> to load some references.
        </div>
      ) : filteredCards.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 30, textAlign: "center", fontSize: 12, color: T.faint }}>
          No briefs match the current filter.
          <button onClick={() => setFilters({ clientFilter: "", projectFilter: "", search: "" })}
            style={{ color: T.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontSize: 12, fontFamily: font, marginLeft: 6 }}>
            Clear filter
          </button>
        </div>
      ) : filters.view === "by_stage" ? (
        <KanbanBoard
          cards={filteredCards}
          onSelectCard={openBriefFromCard}
          onClientFilter={(name) => setFilters({ clientFilter: name, projectFilter: "" })}
          onProjectFilter={(jobId, clientName) => setFilters({ clientFilter: clientName, projectFilter: jobId })}
        />
      ) : filters.view === "by_client" ? (
        <ClientLanesBoard
          cards={filteredCards}
          onSelectCard={openBriefFromCard}
          onFilterClient={(name) => setFilters({ clientFilter: name, projectFilter: "" })}
          onFilterProject={(jobId, clientName) => setFilters({ clientFilter: clientName, projectFilter: jobId })}
          clientFilter={filters.clientFilter}
          projectFilter={filters.projectFilter}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filteredBriefs.map(b => {
            const stage = stageForBrief(b);
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
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, padding: "4px 12px", borderRadius: 99, background: stage.bg, color: stage.accent }}>
                  {stage.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* New Request modal — visual-first single-brief input */}
      {showNewRequest && (
        <NewRequestModal
          clients={clients}
          onClose={() => setShowNewRequest(false)}
          onCreated={(brief) => {
            loadBriefs();
            if (brief) setSelectedBrief(brief);
          }}
        />
      )}

      {/* Brief detail modal */}
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
    // Prefer the client-wide portal URL; fall back to per-brief intake
    const url = data.client_portal_token
      ? `${window.location.origin}/portal/client/${data.client_portal_token}`
      : (data.token ? `${window.location.origin}/art-intake/${data.token}` : null);
    if (url) {
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

  const refInputRef = useRef<HTMLInputElement>(null);
  const [uploadingRefs, setUploadingRefs] = useState(0);
  const [refUploadError, setRefUploadError] = useState<string | null>(null);

  async function uploadReferences(files: File[]) {
    if (!files.length) return;
    setUploadingRefs(files.length);
    setRefUploadError(null);
    let doneCount = 0;
    const newFiles: any[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("brief_id", brief.id);
      fd.append("file", file);
      fd.append("kind", "reference");
      try {
        const res = await fetch("/api/art-briefs/upload-reference", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) {
          setRefUploadError(data.error || "Upload failed");
        } else if (data.file) {
          newFiles.push(data.file);
        }
      } catch (e: any) {
        setRefUploadError(e.message || "Upload failed");
      }
      doneCount++;
      setUploadingRefs(files.length - doneCount);
    }
    if (newFiles.length) {
      setReferences(p => [...p, ...newFiles]);
      setChanged(true);
    }
    setUploadingRefs(0);
  }

  async function deleteReference(fileId: string) {
    if (!confirm("Remove this reference?")) return;
    await fetch(`/api/art-briefs/files?id=${fileId}`, { method: "DELETE" });
    setReferences(p => p.filter(r => r.id !== fileId));
    setChanged(true);
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
            {/* Intake answers (client-submitted) */}
            {intakeData.submitted ? (
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", fontSize: 12, marginBottom: 14 }}>
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
            ) : (
              <div style={{ fontSize: 12, color: T.faint, fontStyle: "italic", marginBottom: 14 }}>
                Client hasn't submitted intake. Use <strong>Copy Link</strong> or <strong>Email to Client</strong> above to send it — their answers show here when they fill it out.
              </div>
            )}

            {/* References (always visible, HPD can add more) */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  References {references.length > 0 && <span style={{ fontWeight: 400, color: T.faint }}>· {references.length}</span>}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {uploadingRefs > 0 && (
                    <span style={{ fontSize: 10, color: T.blue, fontWeight: 600 }}>Uploading… {uploadingRefs} left</span>
                  )}
                  {refUploadError && (
                    <span style={{ fontSize: 10, color: T.red, fontWeight: 600 }}>{refUploadError}</span>
                  )}
                  <button
                    onClick={() => refInputRef.current?.click()}
                    disabled={uploadingRefs > 0}
                    style={{ padding: "4px 10px", background: T.accent, color: "#fff", border: "none", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: uploadingRefs > 0 ? "not-allowed" : "pointer", fontFamily: font, opacity: uploadingRefs > 0 ? 0.5 : 1 }}
                  >
                    + Add references
                  </button>
                  <input
                    ref={refInputRef}
                    type="file"
                    multiple
                    style={{ display: "none" }}
                    onChange={e => {
                      const files = Array.from(e.target.files || []);
                      uploadReferences(files);
                      if (refInputRef.current) refInputRef.current.value = "";
                    }}
                  />
                </div>
              </div>

              {references.length === 0 ? (
                <div
                  onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = T.accent; }}
                  onDragLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = T.border; }}
                  onDrop={e => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).style.borderColor = T.border;
                    uploadReferences(Array.from(e.dataTransfer.files || []));
                  }}
                  onClick={() => refInputRef.current?.click()}
                  style={{
                    padding: 20, border: `2px dashed ${T.border}`, borderRadius: 8,
                    textAlign: "center", fontSize: 11, color: T.faint, cursor: "pointer",
                    background: T.card,
                  }}
                >
                  No references yet — drop files here or click <strong>+ Add references</strong>
                </div>
              ) : (
                <div
                  onDragOver={e => { e.preventDefault(); }}
                  onDrop={e => {
                    e.preventDefault();
                    uploadReferences(Array.from(e.dataTransfer.files || []));
                  }}
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}
                >
                  {references.map(r => (
                    <div key={r.id} style={{ background: T.card, borderRadius: 6, border: `1px solid ${T.border}`, overflow: "hidden", position: "relative" }}>
                      <button
                        onClick={() => deleteReference(r.id)}
                        style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", borderRadius: 4, width: 20, height: 20, cursor: "pointer", fontSize: 12, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}
                        title="Remove"
                      >
                        ×
                      </button>
                      <a href={r.drive_link} target="_blank" rel="noopener noreferrer">
                        <div style={{ width: "100%", aspectRatio: "5/4", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", borderBottom: `1px solid ${T.border}` }}>
                          <img
                            src={r.drive_file_id ? `https://drive.google.com/thumbnail?id=${r.drive_file_id}&sz=w400` : (r.drive_link?.replace("/view", "/preview") || "")}
                            referrerPolicy="no-referrer"
                            alt=""
                            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                            onError={e => (e.target as HTMLImageElement).style.display = "none"}
                          />
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
              )}
            </div>
          </div>

          {/* HPD TRANSLATION SECTION */}
          <div style={{ padding: 14, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>HPD Brief → Designer</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={label}>Title</label>
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} onBlur={() => handleBlur("title")} style={ic} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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

// ─── New Request Modal ────────────────────────────────────────────────────
// Visual-first input: one request = many refs. Pick client + optional project,
// drop images, optionally name it. Creates ONE brief with N reference files.
type StagedFile = {
  id: string;
  file: File;
  previewUrl: string | null;
  status: "queued" | "uploading" | "done" | "error";
  errorMsg?: string;
};

function NewRequestModal({
  clients,
  onClose,
  onCreated,
}: {
  clients: Client[];
  onClose: () => void;
  onCreated: (brief: Brief | null) => void;
}) {
  const [clientId, setClientId] = useState("");
  const [jobId, setJobId] = useState("");
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: File[]) {
    if (!list.length) return;
    const staged = list.map(f => {
      const isImg = f.type.startsWith("image/");
      return {
        id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2),
        file: f,
        previewUrl: isImg ? URL.createObjectURL(f) : null,
        status: "queued" as const,
      };
    });
    setFiles(prev => [...prev, ...staged]);
  }

  function removeFile(id: string) {
    setFiles(prev => {
      const match = prev.find(f => f.id === id);
      if (match?.previewUrl) URL.revokeObjectURL(match.previewUrl);
      return prev.filter(f => f.id !== id);
    });
  }

  useEffect(() => {
    return () => files.forEach(f => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSubmit = !!clientId && files.length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);

    const finalTitle = (title.trim() || "").slice(0, 200);

    // 1. Create the brief
    const briefRes = await fetch("/api/art-briefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: finalTitle,
        client_id: clientId,
        job_id: jobId || null,
        state: "draft",
      }),
    });
    const briefData = await briefRes.json();
    if (!briefRes.ok || !briefData.brief) {
      setErrorMsg(briefData.error || "Couldn't create the request");
      setSubmitting(false);
      return;
    }
    const brief: Brief = briefData.brief;

    // 2. Upload references one by one
    setProgress({ current: 0, total: files.length });
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: "uploading" } : x));
      try {
        const fd = new FormData();
        fd.append("brief_id", brief.id);
        fd.append("file", f.file);
        fd.append("kind", "reference");
        const res = await fetch("/api/art-briefs/upload-reference", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) {
          setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: "error", errorMsg: data.error || "Upload failed" } : x));
        } else {
          setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: "done" } : x));
        }
      } catch (e: any) {
        setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: "error", errorMsg: e.message || "Upload failed" } : x));
      }
      setProgress({ current: i + 1, total: files.length });
    }

    setSubmitting(false);
    onCreated(brief);
    onClose();
  }

  const selectedClient = clients.find(c => c.id === clientId);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onClick={e => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div
        onDragOver={e => { if (clientId) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          if (!clientId) return;
          e.preventDefault();
          setDragOver(false);
          addFiles(Array.from(e.dataTransfer.files || []));
        }}
        style={{
          background: T.card,
          border: `2px solid ${dragOver ? T.accent : T.border}`,
          borderRadius: 14,
          width: "88vw",
          maxWidth: 960,
          height: "86vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "border-color 0.1s",
        }}
      >
        {/* Header */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.text, fontFamily: font }}>New Request</div>
          <button onClick={onClose} disabled={submitting} style={{ background: "none", border: "none", color: T.muted, cursor: submitting ? "not-allowed" : "pointer", fontSize: 22, padding: "0 4px" }}>×</button>
        </div>

        {/* Top input row — minimal, compact */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "grid", gridTemplateColumns: "220px 1fr 1fr", gap: 12, alignItems: "center", background: T.surface }}>
          <select
            value={clientId}
            onChange={e => { setClientId(e.target.value); setJobId(""); }}
            disabled={submitting}
            autoFocus
            style={{
              padding: "9px 12px",
              fontSize: 13,
              borderRadius: 7,
              border: `1px solid ${clientId ? T.accent : T.border}`,
              background: clientId ? T.accentDim : T.card,
              color: T.text,
              outline: "none",
              fontFamily: font,
              cursor: submitting ? "not-allowed" : "pointer",
              fontWeight: clientId ? 600 : 400,
            }}
          >
            <option value="">Select client…</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <ProjectPicker
            clientId={clientId}
            value={jobId}
            onChange={setJobId}
            disabled={submitting}
            label=""
            helperText=""
          />

          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            disabled={submitting}
            placeholder="Request title (optional)"
            style={{
              padding: "9px 12px",
              fontSize: 13,
              borderRadius: 7,
              border: `1px solid ${T.border}`,
              background: T.card,
              color: T.text,
              outline: "none",
              fontFamily: font,
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Visual area — the main real estate */}
        <div style={{ flex: 1, overflow: "auto", padding: 20, background: dragOver ? T.accentDim + "44" : "transparent" }}>
          {files.length === 0 ? (
            <div
              onClick={() => clientId && !submitting && inputRef.current?.click()}
              style={{
                height: "100%",
                minHeight: 320,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                padding: 20,
                border: `2px dashed ${clientId ? (dragOver ? T.accent : T.border) : T.border}`,
                borderRadius: 14,
                background: clientId ? T.surface : T.surface + "88",
                cursor: clientId && !submitting ? "pointer" : "not-allowed",
                opacity: clientId ? 1 : 0.5,
                transition: "all 0.1s",
              }}
            >
              <div style={{ fontSize: 28, color: T.faint }}>⤴</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
                {clientId ? "Drop references here" : "Pick a client first"}
              </div>
              <div style={{ fontSize: 12, color: T.muted }}>
                {clientId ? "or click to browse · multi-select ok" : "then drop or select your reference images"}
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {files.length} reference{files.length === 1 ? "" : "s"}
                </div>
                <button
                  onClick={() => inputRef.current?.click()}
                  disabled={submitting}
                  style={{ padding: "6px 12px", background: "transparent", color: T.accent, border: `1px solid ${T.accent}`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer", fontFamily: font, opacity: submitting ? 0.5 : 1 }}
                >
                  + Add more
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                {files.map(f => (
                  <div
                    key={f.id}
                    style={{
                      position: "relative",
                      aspectRatio: "1/1",
                      background: T.card,
                      borderRadius: 8,
                      border: `1px solid ${f.status === "error" ? T.red + "77" : f.status === "done" ? T.green + "77" : T.border}`,
                      overflow: "hidden",
                    }}
                  >
                    {f.previewUrl ? (
                      <img
                        src={f.previewUrl}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: T.faint, fontSize: 11, padding: 10, textAlign: "center" }}>
                        {f.file.name.split(".").pop()?.toUpperCase() || "FILE"}
                      </div>
                    )}

                    {/* Status overlay */}
                    {f.status === "uploading" && (
                      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 600 }}>
                        Uploading…
                      </div>
                    )}
                    {f.status === "done" && (
                      <div style={{ position: "absolute", top: 6, right: 6, background: T.green, color: "#fff", borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                        ✓
                      </div>
                    )}
                    {f.status === "error" && (
                      <div style={{ position: "absolute", inset: "auto 0 0 0", background: T.red, color: "#fff", padding: "4px 8px", fontSize: 10, fontWeight: 600 }}>
                        {f.errorMsg || "Failed"}
                      </div>
                    )}

                    {!submitting && f.status !== "done" && (
                      <button
                        onClick={() => removeFile(f.id)}
                        style={{ position: "absolute", top: 4, left: 4, background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", borderRadius: 4, width: 20, height: 20, cursor: "pointer", fontSize: 13, lineHeight: 1 }}
                        title="Remove"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <input
            ref={inputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={e => {
              addFiles(Array.from(e.target.files || []));
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, background: T.surface }}>
          {errorMsg && <span style={{ fontSize: 11, color: T.red, fontWeight: 600 }}>{errorMsg}</span>}
          {progress && progress.current < progress.total && (
            <span style={{ fontSize: 11, color: T.muted }}>Uploading {progress.current}/{progress.total}…</span>
          )}
          {selectedClient && !errorMsg && !progress && files.length > 0 && (
            <span style={{ fontSize: 11, color: T.muted }}>
              → Filing under <strong style={{ color: T.text }}>{selectedClient.name}</strong>
              {jobId && " in selected project"}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            disabled={submitting}
            style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 12, fontFamily: font, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            style={{
              padding: "9px 22px",
              borderRadius: 6,
              border: "none",
              background: T.accent,
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: font,
              cursor: canSubmit ? "pointer" : "not-allowed",
              opacity: canSubmit ? 1 : 0.4,
            }}
          >
            {submitting ? "Creating…" : `Create request${files.length ? ` · ${files.length}` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

