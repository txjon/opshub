"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font } from "@/lib/theme";

type Project = {
  id: string;
  title: string;
  job_number: string | null;
  job_type: string | null;
  phase: string | null;
};

const JOB_TYPES = ["corporate", "brand", "artist", "tour", "webstore", "drop_ship"];

export function ProjectPicker({
  clientId,
  value,
  onChange,
  disabled,
  label = "Project",
  helperText = "Optional. Group multiple briefs under one project / campaign.",
}: {
  clientId: string;
  value: string;
  onChange: (jobId: string) => void;
  disabled?: boolean;
  label?: string;
  helperText?: string;
}) {
  const supabase = createClient();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("brand");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) {
      setProjects([]);
      return;
    }
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("jobs")
        .select("id, title, job_number, job_type, phase")
        .eq("client_id", clientId)
        .not("phase", "in", "(complete,cancelled)")
        .order("created_at", { ascending: false });
      setProjects((data as any) || []);
      setLoading(false);

      // Seed default job type from client type
      const { data: c } = await supabase.from("clients").select("type").eq("id", clientId).single();
      if ((c as any)?.type) {
        const t = (c as any).type;
        if (JOB_TYPES.includes(t)) setNewType(t);
      }
    })();
  }, [clientId]);

  async function createProject() {
    if (!newTitle.trim() || !clientId) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), client_id: clientId, job_type: newType }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Create failed");
      } else if (data.job) {
        setProjects(p => [data.job, ...p]);
        onChange(data.job.id);
        setNewTitle("");
        setShowNewForm(false);
      }
    } catch (e: any) {
      setError(e.message || "Create failed");
    }
    setCreating(false);
  }

  const disabledLook = disabled || !clientId;

  return (
    <div>
      <label style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "block" }}>
        {label}
      </label>

      {!showNewForm ? (
        <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
          <select
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={disabledLook || loading}
            style={{
              flex: 1,
              padding: "7px 10px",
              fontSize: 12,
              borderRadius: 6,
              border: `1px solid ${value ? T.accent : T.border}`,
              background: disabledLook ? T.surface : T.card,
              color: disabledLook ? T.faint : T.text,
              outline: "none",
              fontFamily: font,
              cursor: disabledLook ? "not-allowed" : "pointer",
              fontWeight: value ? 600 : 400,
              opacity: disabledLook ? 0.6 : 1,
              boxSizing: "border-box",
            }}
          >
            <option value="">
              {!clientId ? "Pick a client first" : loading ? "Loading..." : projects.length === 0 ? "No projects yet — create one" : `Unassigned (${projects.length} project${projects.length === 1 ? "" : "s"} available)`}
            </option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.title}{p.job_number ? ` · ${p.job_number}` : ""}{p.job_type ? ` · ${p.job_type}` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowNewForm(true)}
            disabled={disabledLook}
            style={{
              padding: "7px 12px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 6,
              border: `1px solid ${T.accent}`,
              background: "transparent",
              color: T.accent,
              cursor: disabledLook ? "not-allowed" : "pointer",
              fontFamily: font,
              whiteSpace: "nowrap",
              opacity: disabledLook ? 0.5 : 1,
            }}
          >
            + New project
          </button>
        </div>
      ) : (
        <div style={{ padding: 10, background: T.surface, border: `1px solid ${T.accent}55`, borderRadius: 6 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Project title (e.g. Summer Tour '26)"
              autoFocus
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); createProject(); }
                if (e.key === "Escape") { setShowNewForm(false); setNewTitle(""); }
              }}
              style={{
                flex: 1, padding: "7px 10px", fontSize: 12, borderRadius: 6,
                border: `1px solid ${T.border}`, background: T.card, color: T.text,
                outline: "none", fontFamily: font, boxSizing: "border-box",
              }}
            />
            <select
              value={newType}
              onChange={e => setNewType(e.target.value)}
              style={{
                padding: "7px 10px", fontSize: 12, borderRadius: 6,
                border: `1px solid ${T.border}`, background: T.card, color: T.text,
                outline: "none", fontFamily: font, cursor: "pointer",
              }}
            >
              {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              onClick={createProject}
              disabled={creating || !newTitle.trim()}
              style={{
                padding: "6px 14px", fontSize: 11, fontWeight: 600, borderRadius: 5,
                border: "none", background: T.accent, color: "#fff",
                cursor: creating || !newTitle.trim() ? "not-allowed" : "pointer",
                fontFamily: font,
                opacity: creating || !newTitle.trim() ? 0.5 : 1,
              }}
            >
              {creating ? "Creating…" : "Create project"}
            </button>
            <button
              type="button"
              onClick={() => { setShowNewForm(false); setNewTitle(""); setError(null); }}
              disabled={creating}
              style={{
                padding: "6px 10px", fontSize: 11, fontWeight: 600, borderRadius: 5,
                border: `1px solid ${T.border}`, background: "transparent", color: T.muted,
                cursor: "pointer", fontFamily: font,
              }}
            >
              Cancel
            </button>
            {error && <span style={{ fontSize: 10, color: T.red }}>{error}</span>}
          </div>
        </div>
      )}

      {helperText && !showNewForm && (
        <div style={{ fontSize: 10, color: T.faint, marginTop: 4, fontFamily: font }}>{helperText}</div>
      )}
    </div>
  );
}
