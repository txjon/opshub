"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import {
  STAGES,
  type Card,
  type StageDef,
  type BoardFilters,
  type AvailableProject,
  thumbUrl,
  hashStr,
  groupByStage,
  groupByClient,
  KanbanBoard,
  ClientLanesBoard,
  BoardFilterControls,
  ActiveFilterBar,
} from "@/components/ArtBoard";

// Deterministic stage assignment based on hash so refreshing is stable.
function hashIndex(id: string, mod: number) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

// Synthetic meta per stage for preview cards.
function stageMeta(stage: string, hash: number) {
  const daysInStage = (hash % 6) + 1;
  const version = 1 + (hash % 3);
  const designerMsgs = hash % 4;
  switch (stage) {
    case "draft":
      return { lines: [`Drafting ${daysInStage}d ago`, "No intake link yet"], cta: "Send to client", urgency: "normal" as const };
    case "awaiting_intake":
      return { lines: [`Intake sent ${daysInStage}d ago`, "Client hasn't opened link"], cta: "Send reminder", urgency: daysInStage > 3 ? ("stale" as const) : ("normal" as const) };
    case "intake_submitted":
      return { lines: [`Client submitted ${daysInStage}d ago`, "Translating to designer brief"], cta: "Open brief", urgency: daysInStage > 2 ? ("stale" as const) : ("normal" as const) };
    case "sent_to_designer":
      return { lines: [`Sent ${daysInStage}d ago`, designerMsgs ? `${designerMsgs} msg from designer` : "No updates yet"], cta: "View brief", urgency: daysInStage > 4 ? ("stale" as const) : ("normal" as const) };
    case "wip_review":
      return { lines: [`WIP v${version} uploaded ${daysInStage}d ago`, designerMsgs ? `${designerMsgs} msgs from designer` : "No messages"], cta: "Send to client", urgency: "action" as const };
    case "client_review":
      return { lines: [`Sent to client ${daysInStage}d ago`, "Awaiting response"], cta: "Nudge client", urgency: daysInStage > 3 ? ("stale" as const) : ("normal" as const) };
    case "revisions":
      return { lines: [`Revisions requested ${daysInStage}d ago`, designerMsgs ? `${designerMsgs} msgs from designer` : "Designer notified"], cta: "View feedback", urgency: "action" as const };
    case "final_approved":
      return { lines: [`Final v${version} uploaded ${daysInStage}d ago`, "Ready for handoff"], cta: "→ Print-Ready", urgency: "action" as const };
    case "delivered":
      return { lines: [`Delivered ${daysInStage}d ago`, "Auto-synced to item"], cta: "View brief", urgency: "done" as const };
  }
  return { lines: [], cta: "", urgency: "normal" as const };
}

type Item = {
  id: string;
  name: string | null;
  job_id: string | null;
  sort_order: number | null;
  jobs?: { id: string; title: string | null; job_number: string | null; job_type: string | null; clients?: { name: string } | null } | null;
};

type FileRow = {
  id: string;
  item_id: string;
  file_name: string;
  stage: string;
  drive_file_id: string | null;
  drive_link: string | null;
};

export default function ArtStudioPreview() {
  const supabase = createClient();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Card | null>(null);
  const [filters, setFiltersState] = useState<BoardFilters>({
    search: "",
    clientFilter: "",
    projectFilter: "",
    view: "by_stage",
  });
  const setFilters = (patch: Partial<BoardFilters>) => setFiltersState(p => ({ ...p, ...patch }));

  useEffect(() => {
    (async () => {
      const [itemsRes, filesRes] = await Promise.all([
        supabase
          .from("items")
          .select("id, name, job_id, sort_order, jobs(id, title, job_number, job_type, clients(name))")
          .order("created_at", { ascending: false })
          .limit(60),
        supabase
          .from("item_files")
          .select("id, item_id, file_name, stage, drive_file_id, drive_link")
          .in("stage", ["mockup", "proof", "print_ready", "client_art"])
          .order("created_at", { ascending: false })
          .limit(300),
      ]);

      const items = (itemsRes.data as Item[] | null) || [];
      const files = (filesRes.data as FileRow[] | null) || [];

      const rank: Record<string, number> = { mockup: 4, proof: 3, print_ready: 2, client_art: 1 };
      const byItem = new Map<string, FileRow>();
      for (const f of files) {
        if (!f.drive_file_id) continue;
        const cur = byItem.get(f.item_id);
        if (!cur || (rank[f.stage] || 0) > (rank[cur.stage] || 0)) byItem.set(f.item_id, f);
      }

      const withImages = items.filter(i => byItem.has(i.id)).slice(0, 24);
      const list: Card[] = withImages.map(i => {
        const file = byItem.get(i.id)!;
        const hash = Math.abs(hashStr(i.id));
        const stage = STAGES[hash % STAGES.length];
        return {
          id: i.id,
          title: i.name || "Untitled item",
          clientName: i.jobs?.clients?.name || "Unknown client",
          jobTitle: i.jobs?.title || "Untitled project",
          jobNumber: i.jobs?.job_number || null,
          jobType: i.jobs?.job_type || null,
          jobId: i.jobs?.id || null,
          thumbFileId: file.drive_file_id,
          thumbLink: file.drive_link,
          stage,
          meta: stageMeta(stage.key, hash),
          hash,
        };
      });

      rebalance(list);
      setCards(list);
      setLoading(false);
    })();
  }, []);

  const allClients = useMemo(() => {
    const set = new Set<string>();
    cards.forEach(c => set.add(c.clientName));
    return [...set].sort();
  }, [cards]);

  const availableProjects = useMemo<AvailableProject[]>(() => {
    const map = new Map<string, AvailableProject>();
    cards.forEach(c => {
      if (!c.jobId) return;
      if (filters.clientFilter && c.clientName !== filters.clientFilter) return;
      const cur = map.get(c.jobId);
      if (cur) cur.count++;
      else map.set(c.jobId, { jobId: c.jobId, title: c.jobTitle, jobNumber: c.jobNumber, clientName: c.clientName, count: 1 });
    });
    return [...map.values()].sort((a, b) =>
      a.clientName.localeCompare(b.clientName) || a.title.localeCompare(b.title)
    );
  }, [cards, filters.clientFilter]);

  useEffect(() => {
    if (!filters.projectFilter) return;
    const stillValid = availableProjects.some(p => p.jobId === filters.projectFilter);
    if (!stillValid) setFilters({ projectFilter: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableProjects]);

  const filteredCards = useMemo(() => {
    let out = cards;
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
  }, [cards, filters]);

  const byStage = useMemo(() => groupByStage(filteredCards), [filteredCards]);

  const stats = useMemo(() => {
    const projectSet = new Set<string>();
    cards.forEach(c => c.jobId && projectSet.add(c.jobId));
    return {
      total: filteredCards.length,
      awaiting_client: (byStage.awaiting_intake?.length || 0) + (byStage.client_review?.length || 0),
      with_designer: (byStage.sent_to_designer?.length || 0) + (byStage.revisions?.length || 0),
      needs_hpd: (byStage.intake_submitted?.length || 0) + (byStage.wip_review?.length || 0) + (byStage.final_approved?.length || 0),
      delivered: byStage.delivered?.length || 0,
      clientCount: allClients.length,
      projectCount: projectSet.size,
    };
  }, [filteredCards, byStage, allClients, cards]);

  return (
    <div style={{ fontFamily: font, color: T.text, paddingBottom: 60 }}>
      <div
        style={{
          background: "linear-gradient(90deg, #fef3c7, #fee2e2)",
          border: `1px solid ${T.amber}`,
          borderRadius: 10,
          padding: "10px 14px",
          marginBottom: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 12, color: "#7a4500" }}>
          <strong>ART STUDIO PREVIEW</strong> — Real items and mockups from OpsHub, shown across every possible workflow stage. Nothing is actually in these states.
        </div>
        <Link href="/art-studio" style={{ fontSize: 11, fontWeight: 600, color: "#7a4500", textDecoration: "underline" }}>← Real Art Studio</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Art Studio</h1>
          <p style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            {stats.total} {filters.clientFilter ? `briefs for ${filters.clientFilter}` : "briefs"} · {stats.clientCount} {stats.clientCount === 1 ? "client" : "clients"} · {stats.projectCount} {stats.projectCount === 1 ? "project" : "projects"} active
          </p>
        </div>

        <BoardFilterControls
          filters={filters}
          setFilters={setFilters}
          allClients={allClients}
          availableProjects={availableProjects}
        />
      </div>

      <ActiveFilterBar
        filters={filters}
        setFilters={setFilters}
        availableProjects={availableProjects}
        resultCount={stats.total}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 20 }}>
        <StatCard label="Active briefs" value={stats.total} tone="neutral" />
        <StatCard label="Awaiting client" value={stats.awaiting_client} tone="amber" note="intake or review" />
        <StatCard label="With designer" value={stats.with_designer} tone="blue" note="working or revising" />
        <StatCard label="Needs HPD action" value={stats.needs_hpd} tone="red" note="translate / send / deliver" />
        <StatCard label="Delivered" value={stats.delivered} tone="green" note="this period" />
      </div>

      {loading && <div style={{ fontSize: 13, color: T.muted }}>Loading real items...</div>}

      {!loading && cards.length === 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 40, textAlign: "center", fontSize: 13, color: T.faint }}>
          No items with mockup imagery found. Upload some in Product Builder first.
        </div>
      )}

      {!loading && cards.length > 0 && filteredCards.length === 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 30, textAlign: "center", fontSize: 12, color: T.faint }}>
          No items match the current filter.
          <button onClick={() => setFilters({ clientFilter: "", projectFilter: "", search: "" })} style={{ color: T.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontSize: 12, fontFamily: font, marginLeft: 6 }}>
            Clear filter
          </button>
        </div>
      )}

      {!loading && filters.view === "by_stage" && filteredCards.length > 0 && (
        <KanbanBoard
          cards={filteredCards}
          onSelectCard={setSelected}
          onClientFilter={(name) => setFilters({ clientFilter: name, projectFilter: "" })}
          onProjectFilter={(jobId, clientName) => setFilters({ clientFilter: clientName, projectFilter: jobId })}
        />
      )}

      {!loading && filters.view === "by_client" && filteredCards.length > 0 && (
        <ClientLanesBoard
          cards={filteredCards}
          onSelectCard={setSelected}
          onFilterClient={(name) => setFilters({ clientFilter: name, projectFilter: "" })}
          onFilterProject={(jobId, clientName) => setFilters({ clientFilter: clientName, projectFilter: jobId })}
          clientFilter={filters.clientFilter}
          projectFilter={filters.projectFilter}
        />
      )}

      {selected && <BriefPreviewModal card={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function StatCard({ label, value, tone, note }: { label: string; value: number; tone: "neutral" | "amber" | "blue" | "red" | "green"; note?: string }) {
  const color = {
    neutral: T.text,
    amber: T.amber,
    blue: T.blue,
    red: T.red,
    green: T.green,
  }[tone];
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 4, fontFamily: mono }}>{value}</div>
      {note && <div style={{ fontSize: 10, color: T.faint, marginTop: 2 }}>{note}</div>}
    </div>
  );
}

function BriefPreviewModal({ card, onClose }: { card: Card; onClose: () => void }) {
  const fullThumb = thumbUrl(card.thumbFileId, 800);
  const s = card.stage;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 100,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: 40,
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          width: "92vw",
          maxWidth: 960,
          maxHeight: "90vh",
          overflow: "auto",
          fontFamily: font,
        }}
      >
        <div
          style={{
            padding: "14px 20px",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: s.accent, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {s.label}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginTop: 2 }}>{card.title}</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
              {card.clientName} · {card.jobTitle}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 22, padding: "0 4px" }}>×</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 0 }}>
          <div style={{ background: "#f4f4f7", borderRight: `1px solid ${T.border}`, padding: 14, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
            {fullThumb ? (
              <img src={fullThumb} alt="" referrerPolicy="no-referrer" style={{ maxWidth: "100%", maxHeight: 500, objectFit: "contain" }} />
            ) : (
              <span style={{ fontSize: 11, color: T.faint }}>No preview</span>
            )}
          </div>

          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <StageNarrative stage={s.key} card={card} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StageNarrative({ stage, card }: { stage: string; card: Card }) {
  const sectionLabel: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: T.muted,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 8,
  };
  const panel: React.CSSProperties = { padding: 14, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 };
  const mutedLine = { fontSize: 12, color: T.muted, lineHeight: 1.5 };
  const textLine = { fontSize: 12, color: T.text, lineHeight: 1.5 };

  const hash = card.hash;
  const moodWords = ["bold", "vintage", "gritty", "modern", "streetwear", "psychedelic", "clean", "90s"];
  const pickMoods = () => [moodWords[hash % moodWords.length], moodWords[(hash + 3) % moodWords.length], moodWords[(hash + 5) % moodWords.length]];
  const purposeLabels = ["Tour merch", "Brand staple", "Drop / capsule", "Event one-off", "Retail"];
  const purpose = purposeLabels[hash % purposeLabels.length];

  if (stage === "draft") {
    return (
      <div style={panel}>
        <div style={sectionLabel}>Draft brief</div>
        <div style={{ ...mutedLine }}>
          HPD is still setting this one up. No intake sent yet. Pick up where you left off, or send the client a link to fill in the details.
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
          <button style={btn(T.accent, "#fff")}>Send intake link</button>
          <button style={btn("transparent", T.muted, true)}>Skip — brief manually</button>
        </div>
      </div>
    );
  }

  if (stage === "awaiting_intake") {
    return (
      <div style={panel}>
        <div style={sectionLabel}>Client Intake</div>
        <div style={{ padding: "6px 12px", background: T.amberDim, borderRadius: 99, display: "inline-block", color: T.amber, fontSize: 11, fontWeight: 600 }}>
          Awaiting client response
        </div>
        <div style={{ ...mutedLine, marginTop: 10 }}>
          Intake link sent to the client. They'll fill out a 5-question form (purpose, audience, mood, references, no-gos) and their answers appear here.
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 6 }}>
          <button style={btn(T.accent, "#fff")}>Send reminder email</button>
          <button style={btn("transparent", T.accent, true)}>Copy intake link</button>
        </div>
      </div>
    );
  }

  if (stage === "intake_submitted") {
    return (
      <>
        <div style={panel}>
          <div style={{ ...sectionLabel, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Client Intake</span>
            <span style={{ fontSize: 10, color: T.green, fontWeight: 700, padding: "2px 10px", background: T.greenDim, borderRadius: 99 }}>Submitted 1d ago</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: 12 }}>
            <span style={{ color: T.muted, fontWeight: 600 }}>Purpose:</span>
            <span style={{ color: T.text }}>{purpose}</span>
            <span style={{ color: T.muted, fontWeight: 600 }}>Audience:</span>
            <span style={{ color: T.text }}>Fans 18-30, streetwear leaning</span>
            <span style={{ color: T.muted, fontWeight: 600 }}>Mood:</span>
            <span>
              {pickMoods().map(w => (
                <span key={w} style={{ display: "inline-block", background: T.card, border: `1px solid ${T.border}`, borderRadius: 99, padding: "2px 10px", fontSize: 11, marginRight: 4 }}>{w}</span>
              ))}
            </span>
            <span style={{ color: T.red, fontWeight: 600 }}>Avoid:</span>
            <span style={{ color: T.text }}>nothing too corporate, no pastels</span>
          </div>
        </div>
        <div style={{ ...panel, borderColor: T.amber + "77" }}>
          <div style={{ ...sectionLabel, color: T.amber }}>HPD Brief → Designer (draft)</div>
          <div style={{ ...textLine, marginBottom: 8 }}>
            <em>Translation in progress.</em> Turn client's intake into a designer-ready concept.
          </div>
          <button style={btn(T.accent, "#fff")}>Open editor & translate</button>
        </div>
      </>
    );
  }

  if (stage === "sent_to_designer") {
    return (
      <>
        <div style={panel}>
          <div style={sectionLabel}>HPD Brief → Designer</div>
          <div style={textLine}>
            Screen-printed front-chest logo with gritty, hand-drawn feel. Limited 2-color palette (black + cream). Placement 4×3 on chest.
            Reference: sludge-metal gig posters circa 1998.
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: T.muted }}>
            <strong>Deadline:</strong> Apr 22 · <strong>Assigned:</strong> Designer Team · <strong>Sent:</strong> 2d ago
          </div>
        </div>
        <div style={panel}>
          <div style={sectionLabel}>Messages</div>
          <MessageBubble who="designer" text="Got it. Pulling references now — should have a first WIP by EOD tomorrow." when="1d ago" />
          <MessageBubble who="hpd" text="Sounds good. No rush on polish for V1 — just directionally right." when="1d ago" />
        </div>
      </>
    );
  }

  if (stage === "wip_review") {
    return (
      <>
        <div style={{ ...panel, borderColor: T.blue + "66" }}>
          <div style={{ ...sectionLabel, color: T.blue }}>Designer Work — WIP v2</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: T.blueDim, borderRadius: 6, fontSize: 12 }}>
            <span style={{ padding: "2px 8px", background: T.blue, color: "#fff", borderRadius: 4, fontWeight: 700, fontSize: 10 }}>WIP V2</span>
            <span style={{ flex: 1, color: T.text }}>{card.title.toLowerCase().replace(/\s+/g, "_")}_wip_v2.psd</span>
            <span style={{ fontSize: 10, color: T.muted }}>3h ago</span>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
            <button style={btn(T.accent, "#fff")}>Send to client for review</button>
            <button style={btn("transparent", T.muted, true)}>Ask designer for changes</button>
          </div>
        </div>
      </>
    );
  }

  if (stage === "client_review") {
    return (
      <div style={{ ...panel, borderColor: T.purple + "66" }}>
        <div style={{ ...sectionLabel, color: T.purple }}>Client Review</div>
        <div style={textLine}>
          WIP v2 sent to client via approval portal. They'll approve, request revisions, or add notes.
        </div>
        <div style={{ marginTop: 10, padding: "8px 12px", background: T.purpleDim, borderRadius: 6, fontSize: 11, color: T.purple, fontWeight: 600 }}>
          Link opened 2x · Sent 2 days ago · No response yet
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
          <button style={btn(T.accent, "#fff")}>Nudge client</button>
          <button style={btn("transparent", T.muted, true)}>Call instead</button>
        </div>
      </div>
    );
  }

  if (stage === "revisions") {
    return (
      <>
        <div style={{ ...panel, borderColor: T.red + "66", background: T.redDim + "33" }}>
          <div style={{ ...sectionLabel, color: T.red }}>Revision Request — from client</div>
          <div style={{ ...textLine, fontStyle: "italic", color: T.text }}>
            "Love the overall vibe. Can we make the center element about 20% larger and try a more saturated red?
            Also want to swap the bottom text to say '2026 TOUR' instead."
          </div>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 6 }}>Received from client 8h ago · Designer already notified</div>
        </div>
        <div style={panel}>
          <div style={sectionLabel}>Messages</div>
          <MessageBubble who="hpd" text="Forwarded the feedback. Prioritize size + color tweaks — text swap should be trivial." when="7h ago" />
          <MessageBubble who="designer" text="On it. V3 coming by tomorrow AM." when="6h ago" />
        </div>
      </>
    );
  }

  if (stage === "final_approved") {
    return (
      <div style={{ ...panel, borderColor: T.green + "77", background: T.greenDim + "55" }}>
        <div style={{ ...sectionLabel, color: T.green }}>Final Uploaded</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: T.green, color: "#fff", borderRadius: 6, fontSize: 12 }}>
          <span style={{ padding: "2px 8px", background: "#fff", color: T.green, borderRadius: 4, fontWeight: 700, fontSize: 10 }}>FINAL V3</span>
          <span style={{ flex: 1, fontWeight: 600 }}>{card.title.toLowerCase().replace(/\s+/g, "_")}_final_print.ai</span>
          <span style={{ fontSize: 10, opacity: 0.8 }}>Just now</span>
        </div>
        <div style={{ ...mutedLine, marginTop: 10 }}>
          Click to sync this final to the item's print-ready stage. The PO auto-picks up the file link.
        </div>
        <div style={{ marginTop: 10 }}>
          <button style={btn(T.green, "#fff")}>→ Deliver to print-ready</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...panel, borderColor: T.green + "55" }}>
      <div style={{ ...sectionLabel, color: T.green }}>Delivered & Synced</div>
      <div style={textLine}>
        Final auto-landed on the item's print-ready stage. <strong>items.drive_link</strong> updated. Decorator PO pulls this file link automatically.
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: T.muted, fontFamily: mono }}>
        item_files.stage = "print_ready" ✓<br />
        items.drive_link updated ✓<br />
        brief.state = "delivered" ✓
      </div>
    </div>
  );
}

function MessageBubble({ who, text, when }: { who: "hpd" | "designer" | "client"; text: string; when: string }) {
  const isHpd = who === "hpd";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isHpd ? "flex-end" : "flex-start", marginBottom: 8 }}>
      <div
        style={{
          maxWidth: "85%",
          padding: "7px 11px",
          borderRadius: 10,
          fontSize: 12,
          background: isHpd ? T.accentDim : T.card,
          border: `1px solid ${isHpd ? T.accent + "44" : T.border}`,
          color: T.text,
          lineHeight: 1.45,
        }}
      >
        {text}
      </div>
      <div style={{ fontSize: 9, color: T.muted, marginTop: 3 }}>
        {who === "hpd" ? "HPD" : who === "designer" ? "Designer" : "Client"} · {when}
      </div>
    </div>
  );
}

function btn(bg: string, color: string, outline?: boolean): React.CSSProperties {
  return {
    padding: "7px 14px",
    borderRadius: 6,
    border: outline ? `1px solid ${color}` : "none",
    background: bg,
    color,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: font,
  };
}

// Redistribute synthetic cards so every stage gets at least one if we have enough items
function rebalance(list: Card[]) {
  if (list.length < STAGES.length) return;
  const byKey: Record<string, Card[]> = {};
  STAGES.forEach(s => (byKey[s.key] = []));
  list.forEach(c => byKey[c.stage.key].push(c));

  const empties = STAGES.filter(s => byKey[s.key].length === 0);
  for (const empty of empties) {
    const donor = STAGES.find(s => byKey[s.key].length >= 3);
    if (!donor) break;
    const moved = byKey[donor.key].pop();
    if (moved) {
      const newStage: StageDef = empty;
      (moved as any).stage = newStage;
      (moved as any).meta = stageMeta(empty.key, moved.hash);
      byKey[empty.key].push(moved);
    }
  }
}
