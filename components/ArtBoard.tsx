"use client";
import { useState, useEffect } from "react";
import { T, font, mono } from "@/lib/theme";

// ─── STAGES ────────────────────────────────────────────────────────────────
export type StageDef = {
  key: string;
  label: string;
  sub: string;
  color: string;
  bg: string;
  accent: string;
};

export const STAGES: StageDef[] = [
  { key: "draft", label: "Draft", sub: "Still being set up — no intake or designer yet", color: T.muted, bg: T.surface, accent: T.muted },
  { key: "awaiting_intake", label: "Awaiting Client", sub: "Intake link sent — waiting on the client to fill it", color: T.faint, bg: T.surface, accent: "#8a8fa8" },
  { key: "intake_submitted", label: "Intake Submitted", sub: "Client filled it out — HPD translating to designer brief", color: T.amber, bg: T.amberDim, accent: T.amber },
  { key: "sent_to_designer", label: "With Designer", sub: "Brief handed off — waiting on WIP", color: T.blue, bg: T.blueDim, accent: T.blue },
  { key: "wip_review", label: "WIP Review", sub: "Designer uploaded work — HPD reviewing before sending to client", color: T.blue, bg: T.blueDim, accent: T.blue },
  { key: "client_review", label: "Client Review", sub: "Sent to client — awaiting approval or revision notes", color: T.purple, bg: T.purpleDim, accent: T.purple },
  { key: "revisions", label: "Revisions", sub: "Client asked for changes — back to designer", color: T.red, bg: T.redDim, accent: T.red },
  { key: "final_approved", label: "Final Approved", sub: "Designer uploaded final — ready to sync to print", color: T.green, bg: T.greenDim, accent: T.green },
  { key: "delivered", label: "Delivered", sub: "Final synced to item's print-ready stage — closed loop", color: T.green, bg: T.greenDim, accent: T.green },
];

export const STAGE_BY_KEY: Record<string, StageDef> = Object.fromEntries(STAGES.map(s => [s.key, s]));

// ─── CARD / META TYPES ────────────────────────────────────────────────────
export type CardUrgency = "normal" | "stale" | "action" | "done";
export type CardMeta = {
  lines: string[];
  cta?: string;
  urgency?: CardUrgency;
};

export type Card = {
  id: string;
  title: string;
  clientName: string;
  jobTitle: string;
  jobNumber: string | null;
  jobType: string | null;
  jobId: string | null;
  thumbFileId: string | null;
  thumbLink: string | null;
  stage: StageDef;
  meta: CardMeta;
  hash: number;
};

// ─── HELPERS ──────────────────────────────────────────────────────────────
export function thumbUrl(fileId: string | null | undefined, w = 400) {
  if (!fileId) return null;
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${w}`;
}

export function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// ─── GROUPERS ─────────────────────────────────────────────────────────────
export type ProjectGroup = {
  jobId: string | null;
  title: string;
  jobNumber: string | null;
  jobType: string | null;
  cards: Card[];
};

export type ClientRow = {
  client: string;
  cards: Card[];
  projects: ProjectGroup[];
};

export function groupByStage(cards: Card[]): Record<string, Card[]> {
  const g: Record<string, Card[]> = {};
  STAGES.forEach(s => (g[s.key] = []));
  for (const c of cards) (g[c.stage.key] ||= []).push(c);
  return g;
}

export function groupByClient(cards: Card[]): ClientRow[] {
  const stageOrder = new Map(STAGES.map((s, i) => [s.key, i]));
  const clientMap = new Map<string, ClientRow>();
  for (const c of cards) {
    let row = clientMap.get(c.clientName);
    if (!row) {
      row = { client: c.clientName, cards: [], projects: [] };
      clientMap.set(c.clientName, row);
    }
    row.cards.push(c);

    const pKey = c.jobId || `orphan:${c.clientName}`;
    let proj = row.projects.find(p => (p.jobId || `orphan:${c.clientName}`) === pKey);
    if (!proj) {
      proj = { jobId: c.jobId, title: c.jobTitle, jobNumber: c.jobNumber, jobType: c.jobType, cards: [] };
      row.projects.push(proj);
    }
    proj.cards.push(c);
  }

  for (const row of clientMap.values()) {
    row.cards.sort((a, b) => (stageOrder.get(a.stage.key) ?? 99) - (stageOrder.get(b.stage.key) ?? 99));
    for (const p of row.projects) {
      p.cards.sort((a, b) => (stageOrder.get(a.stage.key) ?? 99) - (stageOrder.get(b.stage.key) ?? 99));
    }
    row.projects.sort((a, b) => b.cards.length - a.cards.length || a.title.localeCompare(b.title));
  }

  return [...clientMap.values()].sort(
    (a, b) => b.cards.length - a.cards.length || a.client.localeCompare(b.client)
  );
}

// ─── STAGE STRIP ──────────────────────────────────────────────────────────
export function StageStrip({ counts }: { counts: Record<string, number> }) {
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
      {STAGES.map(s => {
        const n = counts[s.key] || 0;
        return (
          <div
            key={s.key}
            title={`${s.label}: ${n}`}
            style={{
              minWidth: 22,
              height: 22,
              borderRadius: 4,
              background: n > 0 ? s.bg : T.surface,
              border: `1px solid ${n > 0 ? s.accent + "55" : T.border}`,
              fontSize: 10,
              fontWeight: 700,
              color: n > 0 ? s.accent : T.faint,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 6px",
            }}
          >
            {n > 0 ? n : "·"}
          </div>
        );
      })}
    </div>
  );
}

// ─── BRIEF CARD (large kanban card) ────────────────────────────────────────
export function BriefCard({
  card,
  onClick,
  onClientClick,
  onProjectClick,
}: {
  card: Card;
  onClick: () => void;
  onClientClick?: (clientName: string) => void;
  onProjectClick?: (jobId: string, clientName: string) => void;
}) {
  const thumb = thumbUrl(card.thumbFileId, 320);
  const stale = card.meta.urgency === "stale";
  const action = card.meta.urgency === "action";
  return (
    <div
      onClick={onClick}
      style={{
        background: T.card,
        border: `1px solid ${stale ? T.amber + "77" : action ? card.stage.accent + "77" : T.border}`,
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        transition: "transform 0.08s, border-color 0.08s, box-shadow 0.08s",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.transform = "none";
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "4/3",
          background: "#f4f4f7",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            referrerPolicy="no-referrer"
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            onError={e => ((e.target as HTMLImageElement).style.display = "none")}
          />
        ) : (
          <span style={{ fontSize: 10, color: T.faint }}>No preview</span>
        )}
      </div>

      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.text, lineHeight: 1.3 }}>{card.title}</div>
        <div style={{ fontSize: 10, color: T.muted, marginTop: 2, lineHeight: 1.3 }}>
          {onClientClick ? (
            <span
              onClick={e => { e.stopPropagation(); onClientClick(card.clientName); }}
              style={{ cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textDecorationColor: T.muted }}
              title={`Filter to ${card.clientName}`}
            >
              {card.clientName}
            </span>
          ) : card.clientName}
          {" · "}
          {onProjectClick && card.jobId ? (
            <span
              onClick={e => { e.stopPropagation(); onProjectClick(card.jobId!, card.clientName); }}
              style={{ cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textDecorationColor: T.muted }}
              title={`Filter to project ${card.jobTitle}`}
            >
              {card.jobTitle}
            </span>
          ) : card.jobTitle}
        </div>

        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          {card.meta.lines.map((line, i) => (
            <div
              key={i}
              style={{
                fontSize: 10,
                color: i === 0 ? (stale ? T.amber : T.text) : T.faint,
                fontWeight: i === 0 ? 600 : 400,
              }}
            >
              {line}
            </div>
          ))}
        </div>

        {card.meta.cta && (
          <div
            style={{
              marginTop: 10,
              padding: "4px 10px",
              background: action ? card.stage.accent : "transparent",
              color: action ? "#fff" : card.stage.accent,
              border: action ? "none" : `1px solid ${card.stage.accent}55`,
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 700,
              textAlign: "center",
              display: "inline-block",
            }}
          >
            {card.meta.cta}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── COMPACT CARD (used inside client lanes) ───────────────────────────────
export function CompactCard({ card, onClick }: { card: Card; onClick: () => void }) {
  const thumb = thumbUrl(card.thumbFileId, 200);
  const s = card.stage;
  const stale = card.meta.urgency === "stale";
  const action = card.meta.urgency === "action";
  return (
    <div
      onClick={onClick}
      style={{
        background: T.card,
        border: `1px solid ${stale ? T.amber + "77" : action ? s.accent + "77" : T.border}`,
        borderRadius: 8,
        overflow: "hidden",
        cursor: "pointer",
        display: "flex",
        gap: 10,
        padding: 8,
        transition: "transform 0.08s, border-color 0.08s",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
        (e.currentTarget as HTMLElement).style.borderColor = s.accent;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.transform = "none";
        (e.currentTarget as HTMLElement).style.borderColor = stale ? T.amber + "77" : action ? s.accent + "77" : T.border;
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          background: "#f4f4f7",
          borderRadius: 6,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            referrerPolicy="no-referrer"
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            onError={e => ((e.target as HTMLImageElement).style.display = "none")}
          />
        ) : (
          <span style={{ fontSize: 9, color: T.faint }}>—</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.text, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.title}</div>
        <div style={{ fontSize: 9, fontWeight: 700, color: s.accent, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 3 }}>{s.label}</div>
        <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{card.meta.lines[0]}</div>
      </div>
    </div>
  );
}

// ─── KANBAN BOARD ─────────────────────────────────────────────────────────
export function KanbanBoard({
  cards,
  onSelectCard,
  onClientFilter,
  onProjectFilter,
}: {
  cards: Card[];
  onSelectCard: (c: Card) => void;
  onClientFilter?: (clientName: string) => void;
  onProjectFilter?: (jobId: string, clientName: string) => void;
}) {
  const byStage = groupByStage(cards);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${STAGES.length}, minmax(260px, 1fr))`,
        gap: 12,
        overflowX: "auto",
        paddingBottom: 10,
      }}
    >
      {STAGES.map(s => {
        const list = byStage[s.key] || [];
        return (
          <div
            key={s.key}
            style={{
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              padding: 12,
              minHeight: 200,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: s.accent, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 10, color: T.faint, marginTop: 2, lineHeight: 1.3 }}>{s.sub}</div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 99,
                  background: s.bg,
                  color: s.accent,
                  flexShrink: 0,
                }}
              >
                {list.length}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {list.map(card => (
                <BriefCard
                  key={card.id}
                  card={card}
                  onClick={() => onSelectCard(card)}
                  onClientClick={onClientFilter}
                  onProjectClick={onProjectFilter}
                />
              ))}
              {list.length === 0 && (
                <div style={{ fontSize: 10, color: T.faint, fontStyle: "italic", padding: 10, textAlign: "center" }}>
                  No briefs in this stage
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── CLIENT LANE VIEW ─────────────────────────────────────────────────────
export function ClientLanesBoard({
  cards,
  onSelectCard,
  onFilterClient,
  onFilterProject,
  clientFilter,
  projectFilter,
}: {
  cards: Card[];
  onSelectCard: (c: Card) => void;
  onFilterClient: (clientName: string) => void;
  onFilterProject: (jobId: string, clientName: string) => void;
  clientFilter: string;
  projectFilter: string;
}) {
  const rows = groupByClient(cards);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {rows.map(row => (
        <ClientLane
          key={row.client}
          client={row.client}
          cards={row.cards}
          projects={row.projects}
          onFilterClient={() => onFilterClient(row.client)}
          onFilterProject={onFilterProject}
          onSelectCard={onSelectCard}
          isFiltered={clientFilter === row.client}
          isProjectFiltered={projectFilter}
        />
      ))}
    </div>
  );
}

function ClientLane({
  client,
  cards,
  projects,
  onFilterClient,
  onFilterProject,
  onSelectCard,
  isFiltered,
  isProjectFiltered,
}: {
  client: string;
  cards: Card[];
  projects: ProjectGroup[];
  onFilterClient: () => void;
  onFilterProject: (jobId: string, clientName: string) => void;
  onSelectCard: (c: Card) => void;
  isFiltered: boolean;
  isProjectFiltered: string;
}) {
  const clientCounts: Record<string, number> = {};
  cards.forEach(c => (clientCounts[c.stage.key] = (clientCounts[c.stage.key] || 0) + 1));
  const stalest = cards.reduce((n, c) => (c.meta.urgency === "stale" ? n + 1 : n), 0);
  const actions = cards.reduce((n, c) => (c.meta.urgency === "action" ? n + 1 : n), 0);

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          gap: 14,
          background: T.surface,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: "-0.01em" }}>{client}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span><strong>{cards.length}</strong> {cards.length === 1 ? "item" : "items"}</span>
            <span><strong>{projects.length}</strong> {projects.length === 1 ? "project" : "projects"}</span>
            {actions > 0 && <span style={{ color: T.accent }}><strong>{actions}</strong> need HPD action</span>}
            {stalest > 0 && <span style={{ color: T.amber }}><strong>{stalest}</strong> stale</span>}
          </div>
        </div>

        <StageStrip counts={clientCounts} />

        {!isFiltered && (
          <button
            onClick={onFilterClient}
            style={{ padding: "5px 12px", fontSize: 10, fontWeight: 600, color: T.accent, background: "transparent", border: `1px solid ${T.accent}`, borderRadius: 6, cursor: "pointer", fontFamily: font }}
          >
            Focus client →
          </button>
        )}
      </div>

      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {projects.map((p, idx) => (
          <ProjectSection
            key={p.jobId || `orphan-${idx}`}
            project={p}
            clientName={client}
            onFilterProject={onFilterProject}
            onSelectCard={onSelectCard}
            isFiltered={isProjectFiltered === p.jobId}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectSection({
  project,
  clientName,
  onFilterProject,
  onSelectCard,
  isFiltered,
}: {
  project: ProjectGroup;
  clientName: string;
  onFilterProject: (jobId: string, clientName: string) => void;
  onSelectCard: (c: Card) => void;
  isFiltered: boolean;
}) {
  const counts: Record<string, number> = {};
  project.cards.forEach(c => (counts[c.stage.key] = (counts[c.stage.key] || 0) + 1));
  const stalest = project.cards.reduce((n, c) => (c.meta.urgency === "stale" ? n + 1 : n), 0);
  const actions = project.cards.reduce((n, c) => (c.meta.urgency === "action" ? n + 1 : n), 0);

  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${isFiltered ? T.accent : T.border}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: T.card,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{project.title}</span>
            {project.jobNumber && (
              <span style={{ fontSize: 10, color: T.muted, fontFamily: mono, letterSpacing: "-0.02em" }}>{project.jobNumber}</span>
            )}
            {project.jobType && (
              <span style={{ fontSize: 9, fontWeight: 600, color: T.muted, padding: "1px 8px", borderRadius: 99, background: T.surface, border: `1px solid ${T.border}`, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {project.jobType}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>{project.cards.length} {project.cards.length === 1 ? "item" : "items"}</span>
            {actions > 0 && <span style={{ color: T.accent, fontWeight: 600 }}>{actions} action</span>}
            {stalest > 0 && <span style={{ color: T.amber, fontWeight: 600 }}>{stalest} stale</span>}
          </div>
        </div>

        <StageStrip counts={counts} />

        {project.jobId && !isFiltered && (
          <button
            onClick={() => onFilterProject(project.jobId!, clientName)}
            style={{ padding: "4px 10px", fontSize: 10, fontWeight: 600, color: T.muted, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, cursor: "pointer", fontFamily: font }}
          >
            Focus project →
          </button>
        )}
      </div>

      <div
        style={{
          padding: 10,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
          gap: 8,
        }}
      >
        {project.cards.map(card => (
          <CompactCard key={card.id} card={card} onClick={() => onSelectCard(card)} />
        ))}
      </div>
    </div>
  );
}

// ─── BOARD FILTER BAR ─────────────────────────────────────────────────────
export type BoardFilters = {
  search: string;
  clientFilter: string;
  projectFilter: string;
  view: "by_stage" | "by_client" | "list";
};

export type AvailableProject = {
  jobId: string;
  title: string;
  jobNumber: string | null;
  clientName: string;
  count: number;
};

export function BoardFilterControls({
  filters,
  setFilters,
  allClients,
  availableProjects,
  showListView = false,
}: {
  filters: BoardFilters;
  setFilters: (f: Partial<BoardFilters>) => void;
  allClients: string[];
  availableProjects: AvailableProject[];
  showListView?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <input
        value={filters.search}
        onChange={e => setFilters({ search: e.target.value })}
        placeholder="Search items, clients…"
        style={{
          padding: "7px 10px",
          fontSize: 12,
          borderRadius: 6,
          border: `1px solid ${T.border}`,
          background: T.card,
          color: T.text,
          outline: "none",
          fontFamily: font,
          width: 200,
        }}
      />

      <select
        value={filters.clientFilter}
        onChange={e => setFilters({ clientFilter: e.target.value, projectFilter: "" })}
        style={{
          padding: "7px 10px",
          fontSize: 12,
          borderRadius: 6,
          border: `1px solid ${filters.clientFilter ? T.accent : T.border}`,
          background: filters.clientFilter ? T.accentDim : T.card,
          color: T.text,
          outline: "none",
          fontFamily: font,
          cursor: "pointer",
          minWidth: 180,
          fontWeight: filters.clientFilter ? 600 : 400,
        }}
      >
        <option value="">All clients ({allClients.length})</option>
        {allClients.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      <select
        value={filters.projectFilter}
        onChange={e => setFilters({ projectFilter: e.target.value })}
        style={{
          padding: "7px 10px",
          fontSize: 12,
          borderRadius: 6,
          border: `1px solid ${filters.projectFilter ? T.accent : T.border}`,
          background: filters.projectFilter ? T.accentDim : T.card,
          color: T.text,
          outline: "none",
          fontFamily: font,
          cursor: "pointer",
          minWidth: 200,
          fontWeight: filters.projectFilter ? 600 : 400,
        }}
      >
        <option value="">All projects ({availableProjects.length})</option>
        {availableProjects.map(p => (
          <option key={p.jobId} value={p.jobId}>
            {filters.clientFilter ? "" : `${p.clientName} · `}
            {p.title}{p.jobNumber ? ` (${p.jobNumber})` : ""} · {p.count}
          </option>
        ))}
      </select>

      <div style={{ display: "flex", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, overflow: "hidden" }}>
        <ViewBtn label="By Stage" active={filters.view === "by_stage"} onClick={() => setFilters({ view: "by_stage" })} />
        <ViewBtn label="By Client" active={filters.view === "by_client"} onClick={() => setFilters({ view: "by_client" })} />
        {showListView && <ViewBtn label="List" active={filters.view === "list"} onClick={() => setFilters({ view: "list" })} />}
      </div>
    </div>
  );
}

function ViewBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: font,
        background: active ? T.accent : "transparent",
        color: active ? "#fff" : T.muted,
        border: "none", cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

export function ActiveFilterBar({
  filters,
  setFilters,
  availableProjects,
  resultCount,
}: {
  filters: BoardFilters;
  setFilters: (f: Partial<BoardFilters>) => void;
  availableProjects: AvailableProject[];
  resultCount: number;
}) {
  const { clientFilter, projectFilter, search } = filters;
  if (!clientFilter && !projectFilter && !search) return null;
  const project = availableProjects.find(p => p.jobId === projectFilter);

  const pill: React.CSSProperties = {
    padding: "2px 8px 2px 10px", background: T.card, border: `1px solid ${T.border}`,
    borderRadius: 99, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4,
  };

  return (
    <div style={{ marginBottom: 14, padding: "8px 12px", background: T.accentDim, border: `1px solid ${T.accent}33`, borderRadius: 6, display: "flex", alignItems: "center", gap: 10, fontSize: 11, flexWrap: "wrap" }}>
      <span style={{ color: T.muted, fontWeight: 600 }}>Filtering:</span>
      {clientFilter && (
        <span style={pill}>
          {clientFilter}
          <button onClick={() => setFilters({ clientFilter: "", projectFilter: "" })} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", padding: "0 2px", fontSize: 14, lineHeight: 1 }}>×</button>
        </span>
      )}
      {project && (
        <span style={pill}>
          {project.title}{project.jobNumber ? ` · ${project.jobNumber}` : ""}
          <button onClick={() => setFilters({ projectFilter: "" })} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", padding: "0 2px", fontSize: 14, lineHeight: 1 }}>×</button>
        </span>
      )}
      {search && (
        <span style={pill}>
          "{search}"
          <button onClick={() => setFilters({ search: "" })} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", padding: "0 2px", fontSize: 14, lineHeight: 1 }}>×</button>
        </span>
      )}
      <span style={{ color: T.muted }}>· {resultCount} results</span>
      <button
        onClick={() => setFilters({ clientFilter: "", projectFilter: "", search: "" })}
        style={{ marginLeft: "auto", padding: "3px 10px", background: "transparent", color: T.accent, border: `1px solid ${T.accent}`, borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: font }}
      >
        Clear all
      </button>
    </div>
  );
}
