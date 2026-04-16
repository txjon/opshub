"use client";
import { useState, useEffect, useRef } from "react";

type Brief = {
  id: string;
  title: string | null;
  state: string;
  deadline: string | null;
  concept: string | null;
  placement: string | null;
  colors: string | null;
  mood_words: string[];
  sent_to_designer_at: string | null;
  updated_at: string;
  version_count: number;
  clients?: { name: string } | null;
};

type BriefFile = {
  id: string;
  file_name: string;
  drive_link: string | null;
  drive_file_id: string | null;
  kind: string;
  version: number;
  hpd_annotation: string | null;
  uploader_role: string;
  created_at: string;
};

type Message = {
  id: string;
  sender_role: string;
  sender_name: string | null;
  message: string;
  created_at: string;
};

const STATE_GROUPS = [
  { key: "action_needed", label: "Action needed", states: ["sent"], color: "#dc2626", bg: "#fee2e2" },
  { key: "in_progress", label: "In progress", states: ["in_progress"], color: "#2d7a8f", bg: "#e0f2f7" },
  { key: "awaiting_hpd", label: "Awaiting HPD", states: ["wip_review"], color: "#d4a017", bg: "#fef3c7" },
  { key: "client_review", label: "With client", states: ["client_review"], color: "#a855f7", bg: "#f3e8ff" },
  { key: "revisions", label: "Revisions needed", states: ["revisions"], color: "#dc2626", bg: "#fee2e2" },
  { key: "completed", label: "Completed", states: ["final_approved", "delivered"], color: "#16a34a", bg: "#dcfce7" },
];

export default function DesignerPortal({ params }: { params: { token: string } }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [designer, setDesigner] = useState<{ name: string } | null>(null);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ completed: true });

  useEffect(() => { loadDashboard(); }, []);

  async function loadDashboard() {
    setLoading(true);
    try {
      const res = await fetch(`/api/design/${params.token}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not load"); setLoading(false); return; }
      setDesigner(data.designer);
      setBriefs(data.briefs || []);
    } catch {
      setError("Connection error");
    }
    setLoading(false);
  }

  if (loading) return <div style={{ padding: 40, fontFamily: "-apple-system, sans-serif", color: "#666" }}>Loading...</div>;

  if (error) return (
    <div style={{ padding: 40, fontFamily: "-apple-system, sans-serif", textAlign: "center", maxWidth: 500, margin: "80px auto" }}>
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>Access denied</h1>
      <p style={{ color: "#666", fontSize: 14 }}>{error}</p>
    </div>
  );

  if (selected) {
    return <BriefDetail token={params.token} briefId={selected} onBack={() => { setSelected(null); loadDashboard(); }} />;
  }

  const grouped = STATE_GROUPS.map(g => ({
    ...g,
    items: briefs.filter(b => g.states.includes(b.state)),
  })).filter(g => g.items.length > 0 || g.key !== "completed");

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa", fontFamily: "-apple-system, sans-serif", color: "#222" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 20px" }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: "#888", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>House Party Distro</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>Design Dashboard</h1>
          <p style={{ fontSize: 14, color: "#666", marginTop: 6 }}>Welcome back{designer?.name ? `, ${designer.name}` : ""}.</p>
        </div>

        {briefs.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid #e2e4ea", borderRadius: 12, padding: 40, textAlign: "center", fontSize: 14, color: "#888" }}>
            No active briefs. We'll notify you when something comes in.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {grouped.map(g => (
              <div key={g.key}>
                <div onClick={() => setCollapsed(p => ({ ...p, [g.key]: !p[g.key] }))}
                  style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 10, color: "#888", transform: collapsed[g.key] ? "rotate(-90deg)" : "none", transition: "transform 0.15s" }}>▼</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: g.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>{g.label}</span>
                  <span style={{ fontSize: 11, color: "#888" }}>({g.items.length})</span>
                </div>
                {!collapsed[g.key] && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {g.items.map(b => (
                      <div key={b.id} onClick={() => setSelected(b.id)}
                        style={{ background: "#fff", border: "1px solid #e2e4ea", borderRadius: 10, padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 16, transition: "border-color 0.1s" }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = "#73b6c9")}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = "#e2e4ea")}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "#222" }}>{b.title || "Untitled Brief"}</div>
                          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                            {b.clients?.name ? `${b.clients.name}` : "Client"}
                            {b.deadline && ` · Due ${new Date(b.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                            {b.version_count > 0 && ` · v${b.version_count}`}
                          </div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: "4px 12px", borderRadius: 99, background: g.bg, color: g.color }}>
                          {g.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BriefDetail({ token, briefId, onBack }: { token: string; briefId: string; onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [files, setFiles] = useState<BriefFile[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);
  const wipInputRef = useRef<HTMLInputElement>(null);
  const finalInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, [briefId]);

  async function load() {
    const res = await fetch(`/api/design/${token}/briefs/${briefId}`);
    const data = await res.json();
    setBrief(data.brief);
    setFiles(data.files || []);
    setMessages(data.messages || []);
    setLoading(false);
  }

  async function upload(file: File, kind: "wip" | "final") {
    setUploadingKind(kind);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    await fetch(`/api/design/${token}/briefs/${briefId}/files`, { method: "POST", body: fd });
    setUploadingKind(null);
    load();
  }

  async function deleteFile(fileId: string) {
    if (!window.confirm("Delete this upload?")) return;
    await fetch(`/api/design/${token}/briefs/${briefId}/files?fileId=${fileId}`, { method: "DELETE" });
    load();
  }

  async function sendMessage() {
    if (!msgInput.trim()) return;
    setSending(true);
    await fetch(`/api/design/${token}/briefs/${briefId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: msgInput.trim() }),
    });
    setMsgInput("");
    setSending(false);
    load();
  }

  if (loading || !brief) return <div style={{ padding: 40, fontFamily: "-apple-system, sans-serif", color: "#666" }}>Loading...</div>;

  const references = files.filter(f => f.kind === "reference");
  const wips = files.filter(f => f.kind === "wip").sort((a, b) => b.version - a.version);
  const finals = files.filter(f => f.kind === "final").sort((a, b) => b.version - a.version);

  const panel: React.CSSProperties = { background: "#fff", border: "1px solid #e2e4ea", borderRadius: 12, padding: 20 };
  const sectionLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 };

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa", fontFamily: "-apple-system, sans-serif", color: "#222" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "30px 20px 60px" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#666", fontSize: 13, cursor: "pointer", marginBottom: 18, padding: 0, fontFamily: "-apple-system, sans-serif" }}>← Dashboard</button>

        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>{brief.title || "Untitled Brief"}</h1>
          <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
            {brief.clients?.name || "Client"}
            {brief.deadline && ` · Due ${new Date(brief.deadline).toLocaleDateString("en-US", { month: "long", day: "numeric" })}`}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Concept */}
          <div style={panel}>
            <div style={sectionLabel}>Concept</div>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: "#222", whiteSpace: "pre-wrap" }}>{brief.concept || "(no concept provided)"}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 16, fontSize: 12 }}>
              {brief.placement && <div><span style={{ color: "#888", fontWeight: 600 }}>Placement: </span>{brief.placement}</div>}
              {brief.colors && <div><span style={{ color: "#888", fontWeight: 600 }}>Colors: </span>{brief.colors}</div>}
              {brief.mood_words?.length > 0 && (
                <div>
                  <span style={{ color: "#888", fontWeight: 600 }}>Mood: </span>
                  {brief.mood_words.join(" · ")}
                </div>
              )}
            </div>
          </div>

          {/* References */}
          {references.length > 0 && (
            <div style={panel}>
              <div style={sectionLabel}>References ({references.length})</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
                {references.map(r => (
                  <div key={r.id} style={{ background: "#fafafa", borderRadius: 8, border: "1px solid #eee", overflow: "hidden" }}>
                    <a href={r.drive_link || "#"} target="_blank" rel="noopener noreferrer">
                      <div style={{ width: "100%", aspectRatio: "5/4", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", borderBottom: "1px solid #eee" }}>
                        <img src={r.drive_link?.replace("/view", "/preview") || ""} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} onError={e => ((e.target as HTMLImageElement).style.display = "none")} />
                      </div>
                    </a>
                    {r.hpd_annotation && (
                      <div style={{ padding: 8, fontSize: 11, color: "#222", lineHeight: 1.4, background: "#fff8e5" }}>{r.hpd_annotation}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Your Work */}
          <div style={panel}>
            <div style={sectionLabel}>Your Work</div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#222", marginBottom: 8 }}>WIP Uploads</div>
              {wips.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                  {wips.map(w => (
                    <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#fafafa", borderRadius: 6, fontSize: 12 }}>
                      <span style={{ padding: "2px 8px", background: "#e0f2f7", color: "#2d7a8f", borderRadius: 4, fontWeight: 700, fontSize: 10 }}>V{w.version}</span>
                      <a href={w.drive_link || "#"} target="_blank" rel="noopener noreferrer" style={{ flex: 1, color: "#222", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.file_name}</a>
                      <span style={{ fontSize: 10, color: "#888" }}>{new Date(w.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      <button onClick={() => deleteFile(w.id)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 13, padding: "0 4px" }}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => wipInputRef.current?.click()} disabled={uploadingKind === "wip"}
                style={{ padding: "10px", border: "1px dashed #c0c4cc", borderRadius: 8, background: "transparent", color: "#666", fontSize: 12, cursor: "pointer", width: "100%", fontFamily: "-apple-system, sans-serif" }}>
                {uploadingKind === "wip" ? "Uploading..." : "+ Upload WIP"}
              </button>
              <input ref={wipInputRef} type="file" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f, "wip"); e.target.value = ""; }} />
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#222", marginBottom: 8 }}>Final</div>
              {finals.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                  {finals.map(f => (
                    <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#dcfce7", borderRadius: 6, fontSize: 12 }}>
                      <span style={{ padding: "2px 8px", background: "#16a34a", color: "#fff", borderRadius: 4, fontWeight: 700, fontSize: 10 }}>FINAL V{f.version}</span>
                      <a href={f.drive_link || "#"} target="_blank" rel="noopener noreferrer" style={{ flex: 1, color: "#222", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name}</a>
                      <span style={{ fontSize: 10, color: "#666" }}>{new Date(f.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      <button onClick={() => deleteFile(f.id)} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 13, padding: "0 4px" }}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => finalInputRef.current?.click()} disabled={uploadingKind === "final"}
                style={{ padding: "10px", border: "1px dashed #c0c4cc", borderRadius: 8, background: "transparent", color: "#666", fontSize: 12, cursor: "pointer", width: "100%", fontFamily: "-apple-system, sans-serif" }}>
                {uploadingKind === "final" ? "Uploading..." : "+ Upload Final"}
              </button>
              <input ref={finalInputRef} type="file" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f, "final"); e.target.value = ""; }} />
            </div>
          </div>

          {/* Messages */}
          <div style={panel}>
            <div style={sectionLabel}>Messages with HPD</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, maxHeight: 400, overflowY: "auto" }}>
              {messages.length === 0 && <div style={{ fontSize: 12, color: "#888", fontStyle: "italic" }}>No messages yet. Send the first one below.</div>}
              {messages.map(m => {
                const isDesigner = m.sender_role === "designer";
                return (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: isDesigner ? "flex-end" : "flex-start" }}>
                    <div style={{ maxWidth: "75%", padding: "8px 12px", borderRadius: 10, fontSize: 13, background: isDesigner ? "#e0f2f7" : "#fafafa", color: "#222", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{m.message}</div>
                    <div style={{ fontSize: 10, color: "#888", marginTop: 3 }}>
                      {m.sender_name || (isDesigner ? "You" : "HPD")} · {new Date(m.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={msgInput} onChange={e => setMsgInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Message HPD..." style={{ flex: 1, padding: "10px 14px", border: "1px solid #d0d3da", borderRadius: 8, fontSize: 13, outline: "none", fontFamily: "-apple-system, sans-serif" }} />
              <button onClick={sendMessage} disabled={sending || !msgInput.trim()}
                style={{ padding: "10px 18px", background: "#222", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: (sending || !msgInput.trim()) ? 0.5 : 1, fontFamily: "-apple-system, sans-serif" }}>
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
