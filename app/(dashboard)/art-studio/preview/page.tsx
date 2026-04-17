"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";

// Synthetic workflow stages for preview. Real briefs use art_briefs.state — this
// just distributes real items across every possible state to visualize density.
const STAGES = [
  { key: "awaiting_intake", label: "Awaiting Client", sub: "Intake link sent — waiting on client to fill it out", color: T.faint, bg: T.surface, accent: "#b0b5c4" },
  { key: "intake_submitted", label: "Intake Submitted", sub: "Client filled it out — HPD translating to designer brief", color: T.amber, bg: T.amberDim, accent: T.amber },
  { key: "sent_to_designer", label: "With Designer", sub: "Brief handed off — waiting on WIP", color: T.blue, bg: T.blueDim, accent: T.blue },
  { key: "wip_review", label: "WIP Review", sub: "Designer uploaded work — HPD reviewing before sending to client", color: T.blue, bg: T.blueDim, accent: T.blue },
  { key: "client_review", label: "Client Review", sub: "Sent to client — awaiting approval or revision notes", color: T.purple, bg: T.purpleDim, accent: T.purple },
  { key: "revisions", label: "Revisions", sub: "Client asked for changes — back to designer", color: T.red, bg: T.redDim, accent: T.red },
  { key: "final_approved", label: "Final Approved", sub: "Designer uploaded final — ready to sync to print", color: T.green, bg: T.greenDim, accent: T.green },
  { key: "delivered", label: "Delivered", sub: "Final synced to item's print-ready stage — closed loop", color: T.green, bg: T.greenDim, accent: T.green },
];

// Deterministic stage assignment based on hash of item id, so refreshing
// keeps the same distribution.
function hashIndex(id: string, mod: number) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

// Thumbnail URL for a Drive file.
function thumbUrl(fileId: string | null | undefined, w = 400) {
  if (!fileId) return null;
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${w}`;
}

// Synthetic activity per stage — tells Jon what info appears on each card.
function stageMeta(stage: string, hash: number) {
  const daysInStage = (hash % 6) + 1;
  const version = 1 + (hash % 3);
  const designerMsgs = hash % 4;
  const deadlineDays = 3 + (hash % 10);
  switch (stage) {
    case "awaiting_intake":
      return { lines: [`Intake sent ${daysInStage}d ago`, "Client hasn't opened link"], cta: "Send reminder", urgency: daysInStage > 3 ? "stale" : "normal" };
    case "intake_submitted":
      return { lines: [`Client submitted ${daysInStage}d ago`, "Translating to designer brief"], cta: "Open brief", urgency: daysInStage > 2 ? "stale" : "normal" };
    case "sent_to_designer":
      return { lines: [`Sent ${daysInStage}d ago`, designerMsgs ? `${designerMsgs} msg from designer` : "No updates yet"], cta: "View brief", urgency: daysInStage > 4 ? "stale" : "normal" };
    case "wip_review":
      return { lines: [`WIP v${version} uploaded ${daysInStage}d ago`, designerMsgs ? `${designerMsgs} msgs from designer` : "No messages"], cta: "Send to client", urgency: "action" };
    case "client_review":
      return { lines: [`Sent to client ${daysInStage}d ago`, "Awaiting response"], cta: "Nudge client", urgency: daysInStage > 3 ? "stale" : "normal" };
    case "revisions":
      return { lines: [`Revisions requested ${daysInStage}d ago`, designerMsgs ? `${designerMsgs} msgs from designer` : "Designer notified"], cta: "View feedback", urgency: "action" };
    case "final_approved":
      return { lines: [`Final v${version} uploaded ${daysInStage}d ago`, "Ready for handoff"], cta: "→ Print-Ready", urgency: "action" };
    case "delivered":
      return { lines: [`Delivered ${daysInStage}d ago`, "Auto-synced to item"], cta: "View brief", urgency: "done" };
  }
  return { lines: [], cta: "", urgency: "normal" };
}

type Item = {
  id: string;
  name: string | null;
  job_id: string | null;
  sort_order: number | null;
  jobs?: { id: string; title: string | null; job_number: string | null; clients?: { name: string } | null } | null;
};

type FileRow = {
  id: string;
  item_id: string;
  file_name: string;
  stage: string;
  drive_file_id: string | null;
  drive_link: string | null;
};

type Card = {
  itemId: string;
  itemName: string;
  clientName: string;
  jobTitle: string;
  jobId: string | null;
  thumbFileId: string | null;
  thumbLink: string | null;
  stage: typeof STAGES[number];
  meta: ReturnType<typeof stageMeta>;
  hash: number;
};

export default function ArtStudioPreview() {
  const supabase = createClient();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Card | null>(null);
  const [view, setView] = useState<"by_stage" | "by_client">("by_stage");
  const [clientFilter, setClientFilter] = useState<string>(""); // "" = all
  const [search, setSearch] = useState<string>("");

  useEffect(() => {
    (async () => {
      // Grab a bunch of items with good imagery
      const [itemsRes, filesRes] = await Promise.all([
        supabase
          .from("items")
          .select("id, name, job_id, sort_order, jobs(id, title, job_number, clients(name))")
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

      // Best-image-per-item: mockup > proof > print_ready > client_art
      const rank: Record<string, number> = { mockup: 4, proof: 3, print_ready: 2, client_art: 1 };
      const byItem = new Map<string, FileRow>();
      for (const f of files) {
        if (!f.drive_file_id) continue;
        const cur = byItem.get(f.item_id);
        if (!cur || (rank[f.stage] || 0) > (rank[cur.stage] || 0)) byItem.set(f.item_id, f);
      }

      // Filter to items that have imagery, then synthesize stages
      const withImages = items.filter(i => byItem.has(i.id)).slice(0, 24);
      const list: Card[] = withImages.map(i => {
        const file = byItem.get(i.id)!;
        const hash = Math.abs(hashStr(i.id));
        const stage = STAGES[hash % STAGES.length];
        return {
          itemId: i.id,
          itemName: i.name || "Untitled item",
          clientName: i.jobs?.clients?.name || "Unknown client",
          jobTitle: i.jobs?.title || "Project",
          jobId: i.jobs?.id || null,
          thumbFileId: file.drive_file_id,
          thumbLink: file.drive_link,
          stage,
          meta: stageMeta(stage.key, hash),
          hash,
        };
      });

      // Ensure every stage gets at least one card if possible (redistribute if some stages are empty)
      rebalance(list);

      setCards(list);
      setLoading(false);
    })();
  }, []);

  // Unique client list for the filter dropdown
  const allClients = useMemo(() => {
    const set = new Set<string>();
    cards.forEach(c => set.add(c.clientName));
    return [...set].sort();
  }, [cards]);

  // Filter cards by selected client and search
  const filteredCards = useMemo(() => {
    let out = cards;
    if (clientFilter) out = out.filter(c => c.clientName === clientFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(c =>
        c.itemName.toLowerCase().includes(q) ||
        c.clientName.toLowerCase().includes(q) ||
        c.jobTitle.toLowerCase().includes(q)
      );
    }
    return out;
  }, [cards, clientFilter, search]);

  // Group filtered by stage (kanban view)
  const byStage = useMemo(() => {
    const g: Record<string, Card[]> = {};
    STAGES.forEach(s => (g[s.key] = []));
    for (const c of filteredCards) (g[c.stage.key] ||= []).push(c);
    return g;
  }, [filteredCards]);

  // Group filtered by client (swim-lane view)
  const byClient = useMemo(() => {
    const g = new Map<string, Card[]>();
    for (const c of filteredCards) {
      if (!g.has(c.clientName)) g.set(c.clientName, []);
      g.get(c.clientName)!.push(c);
    }
    // Sort each client's cards by stage order
    const stageOrder = new Map(STAGES.map((s, i) => [s.key, i]));
    const rows: { client: string; cards: Card[] }[] = [];
    for (const [client, list] of g) {
      list.sort((a, b) => (stageOrder.get(a.stage.key) ?? 99) - (stageOrder.get(b.stage.key) ?? 99));
      rows.push({ client, cards: list });
    }
    // Sort clients by count desc, then alpha
    rows.sort((a, b) => b.cards.length - a.cards.length || a.client.localeCompare(b.client));
    return rows;
  }, [filteredCards]);

  const stats = useMemo(() => ({
    total: filteredCards.length,
    awaiting_client: (byStage.awaiting_intake?.length || 0) + (byStage.client_review?.length || 0),
    with_designer: (byStage.sent_to_designer?.length || 0) + (byStage.revisions?.length || 0),
    needs_hpd: (byStage.intake_submitted?.length || 0) + (byStage.wip_review?.length || 0) + (byStage.final_approved?.length || 0),
    delivered: byStage.delivered?.length || 0,
    clientCount: allClients.length,
  }), [filteredCards, byStage, allClients]);

  return (
    <div style={{ fontFamily: font, color: T.text, paddingBottom: 60 }}>
      {/* Preview banner */}
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
          <strong>ART STUDIO PREVIEW</strong> — Real items and mockups from OpsHub, shown across every possible workflow stage. Nothing is actually in these states. Use this to see what the dashboard looks like at full density.
        </div>
        <Link href="/art-studio" style={{ fontSize: 11, fontWeight: 600, color: "#7a4500", textDecoration: "underline" }}>← Real Art Studio</Link>
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Art Studio</h1>
          <p style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            {stats.total} {clientFilter ? `briefs for ${clientFilter}` : "briefs"} · {stats.clientCount} {stats.clientCount === 1 ? "client" : "clients"} active
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Search */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
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

          {/* Client filter */}
          <select
            value={clientFilter}
            onChange={e => setClientFilter(e.target.value)}
            style={{
              padding: "7px 10px",
              fontSize: 12,
              borderRadius: 6,
              border: `1px solid ${clientFilter ? T.accent : T.border}`,
              background: clientFilter ? T.accentDim : T.card,
              color: T.text,
              outline: "none",
              fontFamily: font,
              cursor: "pointer",
              minWidth: 180,
              fontWeight: clientFilter ? 600 : 400,
            }}
          >
            <option value="">All clients ({allClients.length})</option>
            {allClients.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* View toggle */}
          <div style={{ display: "flex", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, overflow: "hidden" }}>
            <button
              onClick={() => setView("by_stage")}
              style={{
                padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: font,
                background: view === "by_stage" ? T.accent : "transparent",
                color: view === "by_stage" ? "#fff" : T.muted,
                border: "none", cursor: "pointer",
              }}
            >
              By Stage
            </button>
            <button
              onClick={() => setView("by_client")}
              style={{
                padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: font,
                background: view === "by_client" ? T.accent : "transparent",
                color: view === "by_client" ? "#fff" : T.muted,
                border: "none", cursor: "pointer",
              }}
            >
              By Client
            </button>
          </div>
        </div>
      </div>

      {/* Active filter bar */}
      {(clientFilter || search) && (
        <div style={{ marginBottom: 14, padding: "8px 12px", background: T.accentDim, border: `1px solid ${T.accent}33`, borderRadius: 6, display: "flex", alignItems: "center", gap: 10, fontSize: 11 }}>
          <span style={{ color: T.muted, fontWeight: 600 }}>Filtering:</span>
          {clientFilter && <span style={{ padding: "2px 10px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 99, fontWeight: 600 }}>{clientFilter}</span>}
          {search && <span style={{ padding: "2px 10px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 99 }}>"{search}"</span>}
          <span style={{ color: T.muted }}>· {stats.total} results</span>
          <button
            onClick={() => { setClientFilter(""); setSearch(""); }}
            style={{ marginLeft: "auto", padding: "3px 10px", background: "transparent", color: T.accent, border: `1px solid ${T.accent}`, borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: font }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Stats row */}
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
          No items match the current filter. <button onClick={() => { setClientFilter(""); setSearch(""); }} style={{ color: T.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontSize: 12, fontFamily: font }}>Clear filter</button>
        </div>
      )}

      {/* Kanban (By Stage) */}
      {!loading && view === "by_stage" && filteredCards.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(8, minmax(260px, 1fr))",
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
                      key={card.itemId}
                      card={card}
                      onClick={() => setSelected(card)}
                      onClientClick={(name) => setClientFilter(name)}
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
      )}

      {/* Client swim lanes (By Client) */}
      {!loading && view === "by_client" && filteredCards.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {byClient.map(row => (
            <ClientLane
              key={row.client}
              client={row.client}
              cards={row.cards}
              onFilter={() => setClientFilter(row.client)}
              onSelectCard={c => setSelected(c)}
              isFiltered={clientFilter === row.client}
            />
          ))}
        </div>
      )}

      {selected && <BriefPreviewModal card={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ClientLane({
  client,
  cards,
  onFilter,
  onSelectCard,
  isFiltered,
}: {
  client: string;
  cards: Card[];
  onFilter: () => void;
  onSelectCard: (c: Card) => void;
  isFiltered: boolean;
}) {
  // Stage distribution summary
  const counts: Record<string, number> = {};
  cards.forEach(c => (counts[c.stage.key] = (counts[c.stage.key] || 0) + 1));

  const stalest = cards.reduce((max, c) => (c.meta.urgency === "stale" ? max + 1 : max), 0);
  const actions = cards.reduce((max, c) => (c.meta.urgency === "action" ? max + 1 : max), 0);

  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Client header row */}
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
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{client}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span><strong>{cards.length}</strong> {cards.length === 1 ? "item" : "items"}</span>
            {actions > 0 && <span style={{ color: T.accent }}><strong>{actions}</strong> need HPD action</span>}
            {stalest > 0 && <span style={{ color: T.amber }}><strong>{stalest}</strong> stale</span>}
          </div>
        </div>

        {/* Stage mini-strip */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
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

        {!isFiltered && (
          <button
            onClick={onFilter}
            style={{ padding: "5px 12px", fontSize: 10, fontWeight: 600, color: T.accent, background: "transparent", border: `1px solid ${T.accent}`, borderRadius: 6, cursor: "pointer", fontFamily: font }}
          >
            Focus →
          </button>
        )}
      </div>

      {/* Items strip */}
      <div
        style={{
          padding: 12,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 10,
        }}
      >
        {cards.map(card => (
          <CompactCard key={card.itemId} card={card} onClick={() => onSelectCard(card)} />
        ))}
      </div>
    </div>
  );
}

function CompactCard({ card, onClick }: { card: Card; onClick: () => void }) {
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
          <img src={thumb} alt="" referrerPolicy="no-referrer" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} onError={e => ((e.target as HTMLImageElement).style.display = "none")} />
        ) : (
          <span style={{ fontSize: 9, color: T.faint }}>—</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.text, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.itemName}</div>
        <div style={{ fontSize: 9, fontWeight: 700, color: s.accent, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 3 }}>{s.label}</div>
        <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{card.meta.lines[0]}</div>
      </div>
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

function BriefCard({ card, onClick, onClientClick }: { card: Card; onClick: () => void; onClientClick?: (clientName: string) => void }) {
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
      {/* Thumbnail */}
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

      {/* Card body */}
      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.text, lineHeight: 1.3 }}>{card.itemName}</div>
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
          {" · "}{card.jobTitle}
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
        {/* Header */}
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
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginTop: 2 }}>{card.itemName}</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
              {card.clientName} · {card.jobTitle}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 22, padding: "0 4px" }}
          >
            ×
          </button>
        </div>

        {/* Body: two columns — image + brief content */}
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

/**
 * Narrative block — shows what the real brief modal would display at this stage.
 * This is the "what does it look like?" answer per column.
 */
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

  if (stage === "awaiting_intake") {
    return (
      <>
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
      </>
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
          <div style={{ ...mutedLine, marginTop: 10, fontStyle: "italic" }}>
            "Love the color palette on this one" — client note on a reference image
          </div>
        </div>
        <div style={{ ...panel, borderColor: T.amber + "77" }}>
          <div style={{ ...sectionLabel, color: T.amber }}>HPD Brief → Designer (draft)</div>
          <div style={{ ...textLine, marginBottom: 8 }}>
            <em>Translation in progress.</em> Turn client's intake into a designer-ready concept: clarify visual direction, confirm placement, lock colors.
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
          <div style={sectionLabel}>Designer Work</div>
          <div style={{ fontSize: 12, color: T.faint, fontStyle: "italic" }}>No uploads yet. Designer acknowledged the brief.</div>
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
            <span style={{ flex: 1, color: T.text }}>{card.itemName.toLowerCase().replace(/\s+/g, "_")}_wip_v2.psd</span>
            <span style={{ fontSize: 10, color: T.muted }}>3h ago</span>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
            <button style={btn(T.accent, "#fff")}>Send to client for review</button>
            <button style={btn("transparent", T.muted, true)}>Ask designer for changes</button>
          </div>
        </div>
        <div style={panel}>
          <div style={sectionLabel}>Messages</div>
          <MessageBubble who="designer" text="V2 is up — tightened the letterforms and dropped the cream tone a notch. Let me know." when="3h ago" />
          <MessageBubble who="designer" text="If we want a V3 with a cleaner woodblock texture I can do that too." when="3h ago" />
        </div>
      </>
    );
  }

  if (stage === "client_review") {
    return (
      <>
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
        <div style={panel}>
          <div style={sectionLabel}>Latest WIP</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: T.surface, borderRadius: 6, fontSize: 12 }}>
            <span style={{ padding: "2px 8px", background: T.blue, color: "#fff", borderRadius: 4, fontWeight: 700, fontSize: 10 }}>V2</span>
            <span style={{ flex: 1, color: T.text }}>{card.itemName.toLowerCase().replace(/\s+/g, "_")}_v2_proof.pdf</span>
          </div>
        </div>
      </>
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
      <>
        <div style={{ ...panel, borderColor: T.green + "77", background: T.greenDim + "55" }}>
          <div style={{ ...sectionLabel, color: T.green }}>Final Uploaded</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: T.green, color: "#fff", borderRadius: 6, fontSize: 12 }}>
            <span style={{ padding: "2px 8px", background: "#fff", color: T.green, borderRadius: 4, fontWeight: 700, fontSize: 10 }}>FINAL V3</span>
            <span style={{ flex: 1, fontWeight: 600 }}>{card.itemName.toLowerCase().replace(/\s+/g, "_")}_final_print.ai</span>
            <span style={{ fontSize: 10, opacity: 0.8 }}>Just now</span>
          </div>
          <div style={{ ...mutedLine, marginTop: 10 }}>
            Click to sync this final to the item's print-ready stage. The PO auto-picks up the file link, decorator gets it on their next PO.
          </div>
          <div style={{ marginTop: 10 }}>
            <button style={btn(T.green, "#fff")}>→ Deliver to print-ready</button>
          </div>
        </div>
      </>
    );
  }

  // delivered
  return (
    <>
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
      <div style={panel}>
        <div style={sectionLabel}>Full thread</div>
        <div style={mutedLine}>18 messages · 3 designer WIPs · 1 final · 2 client reviews · 1 revision cycle</div>
      </div>
    </>
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

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// Redistribute cards so every stage has at least one if we have enough items
function rebalance(list: Card[]) {
  if (list.length < STAGES.length) return;
  const byKey: Record<string, Card[]> = {};
  STAGES.forEach(s => (byKey[s.key] = []));
  list.forEach(c => byKey[c.stage.key].push(c));

  // Find stages with more than 2, redistribute excess into empty stages
  const empties = STAGES.filter(s => byKey[s.key].length === 0);
  for (const empty of empties) {
    const donor = STAGES.find(s => byKey[s.key].length >= 3);
    if (!donor) break;
    const moved = byKey[donor.key].pop();
    if (moved) {
      moved.stage = empty;
      moved.meta = stageMeta(empty.key, moved.hash);
      byKey[empty.key].push(moved);
    }
  }
}
