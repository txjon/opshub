"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

type Thumb = { drive_file_id: string | null; drive_link: string | null };
type Brief = {
  id: string;
  title: string | null;
  state: string;
  deadline: string | null;
  job_title: string | null;
  job_number: string | null;
  intake_token: string;
  submitted_at: string | null;
  has_intake: boolean;
  thumbs: Thumb[];
  thumb_total: number;
  updated_at: string;
};

type PortalData = {
  client: { name: string };
  briefs: Brief[];
};

const STATE_LABEL: Record<string, { label: string; tone: "pending" | "ok" | "action" | "done" }> = {
  draft: { label: "Awaiting your intake", tone: "action" },
  sent: { label: "In design", tone: "pending" },
  in_progress: { label: "In design", tone: "pending" },
  wip_review: { label: "Internal review", tone: "pending" },
  client_review: { label: "Ready for your review", tone: "action" },
  revisions: { label: "Revisions in progress", tone: "pending" },
  final_approved: { label: "Final approved", tone: "ok" },
  delivered: { label: "Delivered", tone: "done" },
};

const TONE = {
  pending: { bg: "#f3f3f5", border: "#e0e0e4", fg: "#6b6b78" },
  ok: { bg: "#edf7f2", border: "#b4dfc9", fg: "#1a8c5c" },
  action: { bg: "#fef9ee", border: "#f5dfa8", fg: "#b45309" },
  done: { bg: "#f3f3f5", border: "#e0e0e4", fg: "#6b6b78" },
};

export default function ClientPortal({ params }: { params: { token: string } }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/portal/client/${params.token}`);
        const body = await res.json();
        if (!res.ok) { setError(body.error || "Couldn't load"); setLoading(false); return; }
        setData(body);
      } catch (e: any) {
        setError("Connection error");
      }
      setLoading(false);
    })();
  }, [params.token]);

  if (loading) return <Center>Loading…</Center>;
  if (error) return (
    <Center>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, marginBottom: 8 }}>Link not found</h1>
      <p style={{ color: "#888", fontSize: 13 }}>{error}</p>
    </Center>
  );
  if (!data) return <Center>Nothing here</Center>;

  const outstanding = data.briefs.filter(b => !b.has_intake);
  const inProgress = data.briefs.filter(b => b.has_intake);

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa", fontFamily: "-apple-system, sans-serif", color: "#1a1a1a" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "40px 20px 80px" }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, color: "#888", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            House Party Distro
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
            {data.client.name} · Art Requests
          </h1>
          <p style={{ fontSize: 14, color: "#666", marginTop: 6, lineHeight: 1.5 }}>
            Every design in flight, in one place. Bookmark this link — come back any time.
          </p>
        </div>

        {data.briefs.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid #e0e0e4", borderRadius: 12, padding: 40, textAlign: "center", color: "#888", fontSize: 14 }}>
            No active art requests yet. HPD will send you a link once one is ready for intake.
          </div>
        ) : (
          <>
            {outstanding.length > 0 && (
              <Section label={`Needs your input · ${outstanding.length}`} tone="action">
                {outstanding.map(b => <BriefRow key={b.id} brief={b} />)}
              </Section>
            )}
            {inProgress.length > 0 && (
              <Section label={`In progress · ${inProgress.length}`}>
                {inProgress.map(b => <BriefRow key={b.id} brief={b} />)}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system, sans-serif", padding: 40, textAlign: "center" }}>
      <div>{children}</div>
    </div>
  );
}

function Section({ label, tone, children }: { label: string; tone?: "action"; children: React.ReactNode }) {
  const isAction = tone === "action";
  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: isAction ? "#b45309" : "#888",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

function BriefRow({ brief }: { brief: Brief }) {
  const stateInfo = STATE_LABEL[brief.state] || { label: brief.state, tone: "pending" as const };
  // If intake hasn't been submitted, override to "Awaiting intake" regardless of state
  const effectiveState = brief.has_intake ? stateInfo : STATE_LABEL.draft;
  const tone = TONE[effectiveState.tone];
  const needsAction = !brief.has_intake || brief.state === "client_review";

  const overflow = Math.max(0, brief.thumb_total - 4);
  const thumbCount = Math.min(brief.thumbs.length, 4);

  return (
    <Link
      href={brief.has_intake ? "#" : `/art-intake/${brief.intake_token}`}
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <div
        style={{
          background: "#fff",
          border: `1px solid ${needsAction ? "#f5dfa8" : "#e0e0e4"}`,
          borderRadius: 12,
          padding: 14,
          display: "flex",
          gap: 16,
          alignItems: "stretch",
          cursor: brief.has_intake ? "default" : "pointer",
          transition: "border-color 0.1s, transform 0.08s",
        }}
        onMouseEnter={e => {
          if (!brief.has_intake) {
            (e.currentTarget as HTMLElement).style.borderColor = "#b45309";
            (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
          }
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.borderColor = needsAction ? "#f5dfa8" : "#e0e0e4";
          (e.currentTarget as HTMLElement).style.transform = "none";
        }}
      >
        {/* Thumbnail mosaic */}
        <div
          style={{
            width: 140,
            height: 100,
            flexShrink: 0,
            background: "#f4f4f7",
            borderRadius: 8,
            overflow: "hidden",
            display: "grid",
            gridTemplateColumns: thumbCount <= 1 ? "1fr" : "1fr 1fr",
            gridTemplateRows: thumbCount <= 2 ? "1fr" : "1fr 1fr",
            gap: 1,
          }}
        >
          {thumbCount > 0 ? (
            brief.thumbs.slice(0, 4).map((t, i) => {
              const isLast = i === thumbCount - 1;
              return (
                <div key={i} style={{ background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" }}>
                  {t.drive_file_id ? (
                    <img
                      src={`https://drive.google.com/thumbnail?id=${t.drive_file_id}&sz=w200`}
                      referrerPolicy="no-referrer"
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={e => ((e.target as HTMLImageElement).style.display = "none")}
                    />
                  ) : null}
                  {isLast && overflow > 0 && (
                    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700 }}>
                      +{overflow}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#b0b0b8", fontSize: 11 }}>
              No refs yet
            </div>
          )}
        </div>

        {/* Middle: title + meta */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1a1a1a", marginBottom: 4 }}>
            {brief.title || "Untitled request"}
          </div>
          {(brief.job_title || brief.deadline) && (
            <div style={{ fontSize: 12, color: "#888" }}>
              {brief.job_title}
              {brief.job_number && ` · ${brief.job_number}`}
              {brief.deadline && ` · Due ${new Date(brief.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
            </div>
          )}
        </div>

        {/* Right: status + CTA */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", gap: 8, flexShrink: 0 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "4px 12px",
              borderRadius: 99,
              background: tone.bg,
              color: tone.fg,
              border: `1px solid ${tone.border}`,
              whiteSpace: "nowrap",
            }}
          >
            {effectiveState.label}
          </span>
          {!brief.has_intake && (
            <span style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a", whiteSpace: "nowrap" }}>
              Complete intake →
            </span>
          )}
          {brief.has_intake && brief.state === "client_review" && (
            <span style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a", whiteSpace: "nowrap" }}>
              Review design →
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
