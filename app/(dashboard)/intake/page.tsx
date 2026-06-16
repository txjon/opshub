"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resolveSlugFromHost, DEFAULT_SLUG } from "@/lib/tenants";
import { T, font, mono } from "@/lib/theme";

// /intake — leads inbox. Submissions from the public /start form land
// here. Team triages by:
//   - reviewing the details + files inline
//   - converting to a client (with optional draft project)
//   - declining (out of scope, spam, etc.)
//
// Sectioned by status. "New" is the actionable bucket; "Reviewed" is
// the in-progress queue; "Converted" + "Declined" sit collapsed below
// for audit.

type Item = { name?: string; sizes?: Record<string, number> };
type FileRef = { filename?: string; url?: string | null; size?: number; path?: string };
type Submission = {
  id: string;
  status: "new" | "reviewed" | "converted" | "declined";
  created_at: string;
  reviewed_at: string | null;
  client_id: string | null;
  project_id: string | null;
  project_type: string | null;
  project_name: string | null;
  description: string | null;
  items_count_range: string | null;
  units_range: string | null;
  target_ship_date: string | null;
  budget_range: string | null;
  files: FileRef[];
  items: Item[];
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  company: string;
  company_slug: string;
  shipping_route: string | null;
  notes: string | null;
};

type ClientRow = { id: string; name: string };

const PROJECT_TYPE_LABEL: Record<string, string> = {
  brand: "Brand",
  tour: "Tour / Artist",
  corporate: "Corporate",
  webstore: "Webstore",
};

const SHIPPING_ROUTE_LABEL: Record<string, string> = {
  ship_to_us: "Ship to HPD warehouse",
  drop_ship: "Drop ship to customer",
  hold_for_fulfillment: "Hold for fulfillment",
};

export default function IntakePage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Submission[] | null>(null);
  const [open, setOpen] = useState<Submission | null>(null);

  async function load() {
    // Scope to the active tenant. intake_submissions uses company_slug (text,
    // set by the public /start form) and sits OUTSIDE the company_id RLS wall,
    // so this filter is what keeps one tenant's leads out of another's inbox.
    const activeSlug = typeof window === "undefined" ? DEFAULT_SLUG : resolveSlugFromHost(window.location.hostname);
    const { data } = await (supabase.from("intake_submissions") as any)
      .select("*")
      .eq("company_slug", activeSlug)
      .order("created_at", { ascending: false });
    setRows(data || []);
  }

  useEffect(() => { load(); }, []);

  const buckets = useMemo(() => {
    const r = rows || [];
    return {
      new: r.filter(s => s.status === "new"),
      reviewed: r.filter(s => s.status === "reviewed"),
      converted: r.filter(s => s.status === "converted"),
      declined: r.filter(s => s.status === "declined"),
    };
  }, [rows]);

  if (rows === null) {
    return <div style={{ padding: 24, color: T.muted, fontSize: 13, fontFamily: font }}>Loading...</div>;
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", fontFamily: font, color: T.text, paddingBottom: 80 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 4 }}>Intake</h1>
        <p style={{ fontSize: 12, color: T.faint }}>
          Leads from /start on the public site. Review, convert to a client, or decline.
        </p>
      </header>

      <StatStrip
        n={buckets.new.length}
        r={buckets.reviewed.length}
        c={buckets.converted.length}
        d={buckets.declined.length}
      />

      <Bucket
        label="New"
        color={T.accent}
        items={buckets.new}
        onClick={setOpen}
        emptyText="No new submissions. The /start form pipes here."
      />
      <Bucket
        label="Reviewed · in flight"
        color={T.amber}
        items={buckets.reviewed}
        onClick={setOpen}
      />
      <Bucket
        label="Converted"
        color={T.green}
        items={buckets.converted}
        onClick={setOpen}
        collapsedByDefault
      />
      <Bucket
        label="Declined"
        color={T.faint}
        items={buckets.declined}
        onClick={setOpen}
        collapsedByDefault
      />

      {open && (
        <DetailModal
          sub={open}
          onClose={() => setOpen(null)}
          onChanged={() => { load(); setOpen(null); }}
        />
      )}
    </div>
  );
}

function StatStrip({ n, r, c, d }: { n: number; r: number; c: number; d: number }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8,
      marginBottom: 24,
    }}>
      <Stat label="New" value={n} color={T.accent} />
      <Stat label="Reviewed" value={r} color={T.amber} />
      <Stat label="Converted" value={c} color={T.green} />
      <Stat label="Declined" value={d} color={T.faint} />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
      padding: "12px 14px",
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginTop: 3 }}>
        {label}
      </div>
    </div>
  );
}

function Bucket({
  label, color, items, onClick, emptyText, collapsedByDefault,
}: {
  label: string;
  color: string;
  items: Submission[];
  onClick: (s: Submission) => void;
  emptyText?: string;
  collapsedByDefault?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(!!collapsedByDefault);
  if (items.length === 0 && !emptyText) return null;
  return (
    <section style={{ marginBottom: 24 }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, cursor: items.length > 0 ? "pointer" : "default" }}
        onClick={() => items.length > 0 && setCollapsed(c => !c)}
      >
        <span style={{ width: 8, height: 8, borderRadius: 99, background: color }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: T.muted }}>
          {label} · {items.length}
        </span>
        {items.length > 0 && (
          <span style={{ fontSize: 10, color: T.faint }}>{collapsed ? "▸" : "▾"}</span>
        )}
      </div>
      {items.length === 0 && emptyText && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16, fontSize: 12, color: T.faint }}>
          {emptyText}
        </div>
      )}
      {!collapsed && items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map(s => <Row key={s.id} sub={s} color={color} onClick={() => onClick(s)} />)}
        </div>
      )}
    </section>
  );
}

function Row({ sub, color, onClick }: { sub: Submission; color: string; onClick: () => void }) {
  const ageDays = Math.floor((Date.now() - new Date(sub.created_at).getTime()) / 86400000);
  const ageText = ageDays === 0 ? "today" : ageDays === 1 ? "1d ago" : `${ageDays}d ago`;
  const scope: string[] = [];
  if (sub.units_range) scope.push(sub.units_range + " units");
  if (sub.budget_range) scope.push(sub.budget_range);
  if (sub.target_ship_date) scope.push("ship " + sub.target_ship_date);

  return (
    <button
      onClick={onClick}
      style={{
        background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
        padding: "14px 16px", textAlign: "left", cursor: "pointer",
        display: "grid", gridTemplateColumns: "4px 1fr auto", gap: 12,
        fontFamily: font, color: T.text, alignItems: "center",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = color; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}
    >
      <div style={{ width: 4, alignSelf: "stretch", background: color, borderRadius: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
            {sub.company}
          </span>
          {sub.project_type && (
            <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>
              {PROJECT_TYPE_LABEL[sub.project_type] || sub.project_type}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
          {sub.project_name || "(no project name)"}
          {sub.contact_name && ` · ${sub.contact_name}`}
        </div>
        {scope.length > 0 && (
          <div style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>
            {scope.join(" · ")}
            {sub.files.length > 0 && ` · ${sub.files.length} file${sub.files.length === 1 ? "" : "s"}`}
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: T.faint, whiteSpace: "nowrap" }}>{ageText}</div>
    </button>
  );
}

function DetailModal({
  sub, onClose, onChanged,
}: {
  sub: Submission;
  onClose: () => void;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [showConvert, setShowConvert] = useState(false);

  async function patch(action: "review" | "decline" | "unreview") {
    if (busy) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/intake/${sub.id}/convert`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("Failed");
      onChanged();
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "5vh 16px", overflow: "auto",
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
          width: "100%", maxWidth: 760,
          padding: "20px 24px",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, marginBottom: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              Intake · {new Date(sub.created_at).toLocaleString()}
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>{sub.company}</h2>
            <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>
              {sub.project_name || "(no project name)"}
              {sub.project_type && ` · ${PROJECT_TYPE_LABEL[sub.project_type] || sub.project_type}`}
            </div>
          </div>
          <button onClick={onClose} style={closeBtn}>×</button>
        </div>

        {/* Status chip */}
        <div style={{ fontSize: 10, fontWeight: 800, color: statusColor(sub.status), textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>
          {sub.status}
          {sub.client_id && sub.status === "converted" && (
            <>  ·  <a href={`/clients/${sub.client_id}`} style={{ color: T.accent, textDecoration: "underline" }}>view client</a></>
          )}
          {sub.project_id && (
            <>  ·  <a href={`/jobs/${sub.project_id}`} style={{ color: T.accent, textDecoration: "underline" }}>view project</a></>
          )}
        </div>

        {/* Contact */}
        <Section title="Contact">
          <div style={{ fontSize: 13, lineHeight: 1.65 }}>
            <div><b>{sub.contact_name}</b></div>
            <div style={{ fontFamily: mono, color: T.muted }}>{sub.contact_email}</div>
            {sub.contact_phone && <div style={{ color: T.muted }}>{sub.contact_phone}</div>}
          </div>
        </Section>

        {/* Scope */}
        {(sub.description || sub.items_count_range || sub.units_range || sub.budget_range || sub.target_ship_date || sub.shipping_route) && (
          <Section title="Scope">
            {sub.description && (
              <div style={{ fontSize: 13, lineHeight: 1.65, marginBottom: 10, whiteSpace: "pre-wrap" }}>
                {sub.description}
              </div>
            )}
            <ul style={ulStyle}>
              {sub.items_count_range && <li><span style={liLabel}>Designs:</span> {sub.items_count_range}</li>}
              {sub.units_range && <li><span style={liLabel}>Total units:</span> {sub.units_range}</li>}
              {sub.target_ship_date && <li><span style={liLabel}>Target ship:</span> {sub.target_ship_date}</li>}
              {sub.budget_range && <li><span style={liLabel}>Budget:</span> {sub.budget_range}</li>}
              {sub.shipping_route && <li><span style={liLabel}>Shipping route:</span> {SHIPPING_ROUTE_LABEL[sub.shipping_route] || sub.shipping_route}</li>}
            </ul>
          </Section>
        )}

        {/* Items */}
        {sub.items.length > 0 && (
          <Section title={`Items & sizes (${sub.items.length})`}>
            <ul style={ulStyle}>
              {sub.items.map((it, i) => {
                const sizeStr = Object.entries(it.sizes || {}).map(([k, v]) => `${k}(${v})`).join(" ");
                return <li key={i}>{it.name || "Item"}{sizeStr ? ` — ${sizeStr}` : ""}</li>;
              })}
            </ul>
          </Section>
        )}

        {/* Files */}
        {sub.files.length > 0 && <FilesSection files={sub.files} />}

        {/* Notes (legacy field, only if present) */}
        {sub.notes && (
          <Section title="Other notes">
            <div style={{ fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-wrap", color: T.muted }}>
              {sub.notes}
            </div>
          </Section>
        )}

        {/* Action bar */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
          {sub.status === "new" && (
            <button onClick={() => patch("review")} disabled={!!busy} style={btn}>
              Mark reviewed
            </button>
          )}
          {(sub.status === "reviewed" || sub.status === "declined") && (
            <button onClick={() => patch("unreview")} disabled={!!busy} style={btn}>
              ← Back to new
            </button>
          )}
          {(sub.status === "new" || sub.status === "reviewed") && (
            <>
              <button onClick={() => setShowConvert(true)} disabled={!!busy} style={btnPrimary}>
                Convert to client →
              </button>
              <button onClick={() => patch("decline")} disabled={!!busy} style={btnDanger}>
                Decline
              </button>
            </>
          )}
        </div>

        {showConvert && (
          <ConvertModal
            sub={sub}
            onCancel={() => setShowConvert(false)}
            onDone={() => { setShowConvert(false); onChanged(); }}
          />
        )}
      </div>
    </div>
  );
}

function ConvertModal({
  sub, onCancel, onDone,
}: {
  sub: Submission;
  onCancel: () => void;
  onDone: () => void;
}) {
  const supabase = createClient();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [existingClientId, setExistingClientId] = useState<string>("");
  const [clientSearch, setClientSearch] = useState("");
  const [results, setResults] = useState<ClientRow[]>([]);
  const [createProject, setCreateProject] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "existing") return;
    const q = clientSearch.trim();
    if (q.length < 1) { setResults([]); return; }
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, name")
        .ilike("name", `%${q}%`)
        .order("name")
        .limit(8);
      setResults(data || []);
    }, 200);
    return () => clearTimeout(handle);
  }, [mode, clientSearch]);

  async function go() {
    setErr(null);
    if (mode === "existing" && !existingClientId) {
      setErr("Pick an existing client first.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/intake/${sub.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          existing_client_id: mode === "existing" ? existingClientId : null,
          new_client: mode === "new" ? { name: sub.company } : null,
          create_project: createProject,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || "Convert failed");
      onDone();
    } catch (e: any) {
      setErr(e?.message || "Convert failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "5vh 16px",
      }}
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
          width: "100%", maxWidth: 520,
          padding: "22px 24px",
          fontFamily: font, color: T.text,
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>Convert to client</h3>
        <p style={{ fontSize: 12, color: T.muted, marginBottom: 16 }}>
          Link <b>{sub.company}</b> to an existing client, or create a new one.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <ToggleBtn label="Create new client" active={mode === "new"} onClick={() => setMode("new")} />
          <ToggleBtn label="Link to existing" active={mode === "existing"} onClick={() => setMode("existing")} />
        </div>

        {mode === "existing" && (
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              placeholder="Search clients by name..."
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              style={inputStyle}
              autoFocus
            />
            {results.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                {results.map(r => (
                  <button
                    key={r.id}
                    onClick={() => { setExistingClientId(r.id); setClientSearch(r.name); setResults([]); }}
                    style={{
                      background: existingClientId === r.id ? T.accentDim : T.surface,
                      border: `1px solid ${existingClientId === r.id ? T.accent : T.border}`,
                      borderRadius: 6, padding: "8px 12px",
                      textAlign: "left", cursor: "pointer", fontSize: 13,
                      color: T.text, fontFamily: font,
                    }}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.text, marginBottom: 16, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={createProject}
            onChange={e => setCreateProject(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          Also create a draft project pre-filled from this intake
        </label>

        {err && (
          <div style={{ background: T.redDim, border: `1px solid ${T.red}44`, color: T.red, fontSize: 12, padding: "10px 12px", borderRadius: 6, marginBottom: 12 }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} disabled={submitting} style={btn}>Cancel</button>
          <button onClick={go} disabled={submitting} style={btnPrimary}>
            {submitting ? "Converting..." : "Convert"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── small components ──────────────────────────────────────────

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

// Renders intake files as a preview grid. Image files show a thumbnail;
// everything else shows a labeled tile. Fresh signed URLs are fetched
// from the durable storage `path` on open (the bucket is private and
// stored URLs can expire on cold leads), so previews never go stale.
function FilesSection({ files }: { files: FileRef[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const paths = files.map(f => f.path).filter(Boolean) as string[];
    if (!paths.length) { setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/intake/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths }),
        });
        const data = await res.json();
        if (alive && data?.urls) setUrls(data.urls);
      } catch {
        /* fall back to any stored url below */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [files]);

  return (
    <Section title={`Files (${files.length})`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
        {files.map((f, i) => {
          const url = (f.path && urls[f.path]) || f.url || null;
          const isImage = IMAGE_RE.test(f.filename || "");
          return (
            <a
              key={i}
              href={url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                textDecoration: "none", color: T.text,
                background: T.surface, border: `1px solid ${T.border}`,
                borderRadius: 8, overflow: "hidden", display: "block",
              }}
            >
              <div style={{
                height: 100, background: T.bg || T.surface,
                display: "flex", alignItems: "center", justifyContent: "center",
                overflow: "hidden",
              }}>
                {isImage && url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={f.filename || "art file"}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: T.faint, textTransform: "uppercase" }}>
                    {loading && isImage ? "Loading…" : (f.filename?.split(".").pop() || "file").toUpperCase()}
                  </span>
                )}
              </div>
              <div style={{ padding: "8px 10px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.filename || "file"}
                </div>
                <div style={{ fontSize: 10, color: T.faint, marginTop: 2 }}>
                  {f.size ? `${Math.round(f.size / 1024)} KB` : ""}{url ? " · open ↗" : ""}
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ToggleBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: "10px 12px", borderRadius: 8,
        border: `1px solid ${active ? T.accent : T.border}`,
        background: active ? T.accentDim : T.surface,
        color: T.text, fontSize: 12, fontWeight: 600,
        cursor: "pointer", fontFamily: font,
      }}
    >
      {label}
    </button>
  );
}

function statusColor(s: Submission["status"]): string {
  if (s === "new") return T.accent;
  if (s === "reviewed") return T.amber;
  if (s === "converted") return T.green;
  return T.faint;
}

// ─── styles ────────────────────────────────────────────────────

const ulStyle: React.CSSProperties = {
  listStyle: "none", padding: 0, margin: 0,
  fontSize: 13, lineHeight: 1.7, color: T.text,
};
const liLabel: React.CSSProperties = {
  color: T.muted, fontSize: 11, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.06em", marginRight: 6,
};

const btn: React.CSSProperties = {
  padding: "8px 16px",
  background: "transparent",
  color: T.text,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  fontSize: 12, fontWeight: 600,
  cursor: "pointer",
  fontFamily: font,
};
const btnPrimary: React.CSSProperties = {
  ...btn,
  background: T.accent,
  color: "#fff",
  border: "none",
};
const btnDanger: React.CSSProperties = {
  ...btn,
  color: T.red,
  borderColor: T.red + "55",
};

const closeBtn: React.CSSProperties = {
  background: "transparent", border: "none", color: T.muted,
  fontSize: 20, cursor: "pointer", padding: "4px 8px",
  lineHeight: 1, fontFamily: font,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 13,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  outline: "none",
  fontFamily: font,
  color: T.text,
  background: T.surface,
  boxSizing: "border-box",
};
