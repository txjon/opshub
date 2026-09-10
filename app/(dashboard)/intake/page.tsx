"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resolveSlugFromHost, DEFAULT_SLUG } from "@/lib/tenants";
import { T, font, mono } from "@/lib/theme";
import { snapshotMid, defaultPunch, quoteTotal, type Quote, type QuoteLine, type PunchPoint } from "@/lib/menu-quote";
import { buildPrintersMap, calcCostProduct, lookupPrintPrice, lookupTagPrice } from "@/lib/pricing";
import { DecorationPanel as DecorationPanelRaw } from "../jobs/[id]/DecorationPanel";
const DecorationPanel: any = DecorationPanelRaw; // .jsx — bypass narrow inferred prop types

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

// Menu leads (mig 172) — people who knocked at the /start email gate.
// quote_requested = the actionable queue (1-business-day promise);
// browsed = window shoppers, collapsed, light-touch follow-up only.
type MenuLead = {
  id: string;
  email: string;
  status: string;
  picks: {
    // Order-builder shape (Sep 8): a basket of items + art files.
    items?: { styleCode: string; qty: number; colors: string[] }[];
    files?: { filename: string; path: string; size: number; url?: string | null; styleCode?: string | null; placement?: string | null }[];
    budget?: number | null;
    artStatus?: string | null;
    notes?: string;
    // Legacy single-pick fields (pre-basket leads)
    styleCode?: string | null;
    qty?: number | null;
    notSure?: boolean;
    colorways?: number;
  } | null;
  contact: { name?: string; phone?: string | null; neededBy?: string | null; notes?: string | null } | null;
  client_match: string | null;
  quote: import("@/lib/menu-quote").Quote | null;
  quoted_at: string | null;
  accepted_at: string | null;
  job_id: string | null;
  quote_requested_at: string | null;
  rates_snapshot: { style_code: string; style_name: string; band_min: number; price_lo: number | null; price_hi: number | null }[] | null;
  responded_at: string | null;
  response: { subject?: string; body?: string; by?: string; sent_at?: string } | null;
  created_at: string;
  updated_at: string;
};

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
  const [menuLeads, setMenuLeads] = useState<MenuLead[]>([]);
  const [matchNames, setMatchNames] = useState<Record<string, string>>({});

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

    const { data: leads } = await supabase
      .from("menu_leads")
      .select("id,email,status,picks,contact,client_match,quote,quoted_at,accepted_at,job_id,quote_requested_at,rates_snapshot,responded_at,response,created_at,updated_at")
      .order("quote_requested_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false });
    const leadRows = (leads as unknown as MenuLead[]) || [];
    setMenuLeads(leadRows);
    const matchIds = [...new Set(leadRows.map(l => l.client_match).filter(Boolean))] as string[];
    if (matchIds.length) {
      const { data: cl } = await supabase.from("clients").select("id,name").in("id", matchIds);
      setMatchNames(Object.fromEntries(((cl as unknown as ClientRow[]) || []).map(c => [c.id, c.name])));
    }
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
      <header style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 4 }}>Intake</h1>
          <p style={{ fontSize: 12, color: T.faint }}>
            Leads from /start on the public site. Review, convert to a client, or decline.
          </p>
        </div>
        <a href="/intake/menu" style={{ fontSize: 12, color: T.blue, textDecoration: "none", borderBottom: `1px dotted ${T.blue}`, whiteSpace: "nowrap", marginTop: 6 }}>
          Menu pricing
        </a>
      </header>

      <StatStrip
        n={buckets.new.length}
        r={buckets.reviewed.length}
        c={buckets.converted.length}
        d={buckets.declined.length}
      />

      <MenuLeadBucket
        label="The Build · quote pipeline"
        color={T.purple}
        leads={menuLeads.filter(l => ["quote_requested", "quoted", "accepted", "converted"].includes(l.status))}
        matchNames={matchNames}
        onChanged={load}
        emptyText="No open quote requests from The Build."
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

      <MenuLeadBucket
        label="The Build · browsing"
        color={T.faint}
        leads={menuLeads.filter(l => !["quote_requested", "quoted", "accepted", "converted"].includes(l.status))}
        matchNames={matchNames}
        onChanged={load}
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
  color: "#0a0a0a",
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

// ─── Menu leads (the /start email gate → unlisted menu) ─────────────

function summarizePicks(l: MenuLead): string {
  const p = l.picks || {};
  const bits: string[] = [];
  if (Array.isArray(p.items) && p.items.length) {
    for (const it of p.items) bits.push(`${it.styleCode}×${it.qty}${it.colors?.length ? ` (${it.colors.length}cw)` : ""}`);
  } else {
    // Legacy single-pick leads
    if (p.styleCode) bits.push(p.styleCode);
    if (p.notSure) bits.push("qty unsure");
    else if (p.qty) bits.push(`${p.qty}u`);
    if (p.colorways && p.colorways > 1) bits.push(`${p.colorways} colorways`);
  }
  if (p.budget) bits.push(`browsed at $${Number(p.budget).toLocaleString()} budget`);
  if (p.artStatus === "need_help") bits.push("needs design");
  if (p.files?.length) bits.push(`${p.files.length} art file${p.files.length > 1 ? "s" : ""}`);
  return bits.length ? bits.join(" · ") : "no picks yet";
}

// Prefilled tailored-response draft. Taylor edits before sending — the
// bracketed line is where the real number goes.
function buildResponseDraft(l: MenuLead): { subject: string; body: string } {
  const p = l.picks || {};
  const firstName = (l.contact?.name || "").trim().split(/\s+/)[0] || "there";
  const snapFor = (styleCode: string, qty: number) => {
    const rows = (l.rates_snapshot || []).filter(r => r.style_code === styleCode).sort((a, b) => b.band_min - a.band_min);
    return rows.find(r => r.band_min <= qty) || rows[rows.length - 1];
  };
  // Normalize legacy single-pick leads into the basket shape.
  const items = Array.isArray(p.items) && p.items.length
    ? p.items
    : p.styleCode
      ? [{ styleCode: p.styleCode, qty: p.notSure ? 100 : (p.qty || 100), colors: [] as string[] }]
      : [];

  const lines: string[] = [];
  lines.push(`Hi ${firstName},`);
  lines.push("");
  lines.push("Thanks for knocking. Here is where your picks landed:");
  lines.push("");
  const recap: string[] = [];
  let anyColorways = false;
  for (const it of items) {
    const snap = snapFor(it.styleCode, it.qty);
    const styleName = snap?.style_name || it.styleCode;
    const colorBit = it.colors?.length ? ` in ${it.colors.join(", ")}` : "";
    const rangeBit = snap?.price_lo != null ? ` (menu range $${Number(snap.price_lo).toFixed(2)} to $${Number(snap.price_hi).toFixed(2)} per piece)` : "";
    recap.push(`- ${styleName}, ${it.qty} pieces${colorBit}${rangeBit}`);
    if ((it.colors?.length || 0) > 1) anyColorways = true;
  }
  if (anyColorways) recap.push("- Reminder: each colorway carries its own 48 piece minimum");
  if (p.artStatus === "need_help") recap.push("- Design help: our in-house team can take your logo and vibe to a finished drop");
  if (p.files?.length) recap.push(`- Got your ${p.files.length} art file${p.files.length > 1 ? "s" : ""} — thank you`);
  if (recap.length === 0) recap.push("- (no picks on file yet, they were browsing)");
  lines.push(...recap);
  lines.push("");
  lines.push(items.length > 1 ? "Your exact quote: [$ ___ total — per-style breakdown below]" : "Your exact quote: [$ ___ per piece, $ ___ total]");
  lines.push("");
  lines.push("If that works, reply here and we will get sizes, art, and timeline locked. Typical turnaround is [X weeks] from art approval.");
  const firstSnap = items[0] ? snapFor(items[0].styleCode, items[0].qty) : null;
  return {
    subject: items.length === 1
      ? `Your House Party quote for the ${firstSnap?.style_name || items[0].styleCode}`
      : "Your House Party quote",
    body: lines.join("\n"),
  };
}

function MenuLeadBucket({
  label, color, leads, matchNames, onChanged, emptyText, collapsedByDefault,
}: {
  label: string;
  color: string;
  leads: MenuLead[];
  matchNames: Record<string, string>;
  onChanged: () => void;
  emptyText?: string;
  collapsedByDefault?: boolean;
}) {
  const supabase = createClient();
  const [collapsed, setCollapsed] = useState(!!collapsedByDefault);
  const [composing, setComposing] = useState<MenuLead | null>(null);
  const [quoting, setQuoting] = useState<MenuLead | null>(null);
  const [openLead, setOpenLead] = useState<MenuLead | null>(null);
  const [converting, setConverting] = useState<string | null>(null);
  const [convertErr, setConvertErr] = useState<string | null>(null);
  if (leads.length === 0 && !emptyText) return null;

  async function convertLead(l: MenuLead) {
    if (converting) return;
    let clientName: string | undefined;
    if (!l.client_match) {
      const suggested = l.contact?.name || l.email.split("@")[0];
      const answer = window.prompt("New client name (their brand, not the person):", suggested);
      if (answer === null) return;
      clientName = answer.trim() || suggested;
    }
    setConverting(l.id);
    setConvertErr(null);
    const res = await fetch("/api/menu/lead-convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: l.id, clientName }),
    }).catch(() => null);
    setConverting(null);
    if (res?.ok) { onChanged(); return; }
    const d = await res?.json().catch(() => null);
    setConvertErr(d?.error || "Convert failed.");
  }

  async function setStatus(l: MenuLead, status: string) {
    await supabase.from("menu_leads").update({ status, updated_at: new Date().toISOString() } as never).eq("id", l.id);
    onChanged();
  }

  return (
    <section style={{ marginBottom: 24 }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, cursor: leads.length > 0 ? "pointer" : "default" }}
        onClick={() => leads.length > 0 && setCollapsed(c => !c)}
      >
        <span style={{ width: 8, height: 8, borderRadius: 99, background: color }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: T.muted }}>
          {label} · {leads.length}
        </span>
        {leads.length > 0 && (
          <span style={{ fontSize: 10, color: T.faint }}>{collapsed ? "▸" : "▾"}</span>
        )}
      </div>
      {leads.length === 0 && emptyText && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16, fontSize: 12, color: T.faint }}>
          {emptyText}
        </div>
      )}
      {!collapsed && leads.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {leads.map(l => {
            const isQuote = l.status === "quote_requested";
            const anchor = isQuote && l.quote_requested_at ? l.quote_requested_at : l.updated_at;
            const ageHrs = (Date.now() - new Date(anchor).getTime()) / 3600000;
            const ageText = ageHrs < 1 ? "just now" : ageHrs < 24 ? `${Math.floor(ageHrs)}h ago` : `${Math.floor(ageHrs / 24)}d ago`;
            // The 1-business-day promise: amber past 24h on the actionable queue.
            const overdue = isQuote && ageHrs > 24;
            return (
              <div
                key={l.id}
                onClick={() => setOpenLead(l)}
                style={{
                  background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
                  padding: "14px 16px", cursor: "pointer",
                  display: "grid", gridTemplateColumns: "4px 1fr auto", gap: 12, alignItems: "center",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = color; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}
              >
                <div style={{ width: 4, alignSelf: "stretch", background: overdue ? T.amber : color, borderRadius: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>
                      {l.contact?.name || l.email}
                    </span>
                    {l.contact?.name && (
                      <a href={`mailto:${l.email}`} style={{ fontSize: 12, color: T.blue, textDecoration: "none" }}>{l.email}</a>
                    )}
                    {l.client_match && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: T.blue, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                        EXISTING CLIENT{matchNames[l.client_match] ? ` · ${matchNames[l.client_match]}` : ""}
                      </span>
                    )}
                    {!isQuote && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                        {l.status}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 4, fontFamily: mono }}>
                    {summarizePicks(l)}
                    {l.contact?.neededBy ? ` · needed ${l.contact.neededBy}` : ""}
                    {l.contact?.phone ? ` · ${l.contact.phone}` : ""}
                  </div>
                  {(l.picks?.notes || l.contact?.notes) && (
                    <div style={{ fontSize: 12, color: T.faint, marginTop: 4, whiteSpace: "pre-wrap" }}>
                      {[l.picks?.notes, l.contact?.notes].filter(Boolean).join(" — ")}
                    </div>
                  )}
                  {(l.picks?.files || []).filter(f => f.url).length > 0 && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 5 }}>
                      {l.picks!.files!.filter(f => f.url).map(f => (
                        <a key={f.path} href={f.url!} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: 11, color: T.blue, textDecoration: "none", borderBottom: `1px dotted ${T.blue}`, fontFamily: mono }}>
                          📎 {f.filename}{f.styleCode ? ` (${f.styleCode}${f.placement ? ` · ${f.placement}` : ""})` : ""}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  <span style={{ fontSize: 11, color: overdue ? T.amber : T.faint, fontFamily: mono }}>
                    {overdue ? `⚠ ${ageText}` : ageText}
                  </span>
                  {["quote_requested", "quoted", "accepted"].includes(l.status) && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {l.quote && !l.job_id && (
                        <span onClick={(e) => { e.stopPropagation(); convertLead(l); }} style={{ fontSize: 11, color: T.green, cursor: "pointer", borderBottom: `1px dotted ${T.green}`, fontWeight: 700 }}>
                          {converting === l.id ? "Creating..." : "Create job"}
                        </span>
                      )}
                      <span onClick={(e) => { e.stopPropagation(); setQuoting(l); }} style={{ fontSize: 11, color: T.purple, cursor: "pointer", borderBottom: `1px dotted ${T.purple}`, fontWeight: 700 }}>
                        {l.quote ? "Edit quote" : "Build quote"}
                      </span>
                      <span onClick={(e) => { e.stopPropagation(); setComposing(l); }} style={{ fontSize: 11, color: T.blue, cursor: "pointer", borderBottom: `1px dotted ${T.blue}` }}>
                        Respond
                      </span>
                      {l.status === "quote_requested" && (
                        <span onClick={(e) => { e.stopPropagation(); setStatus(l, "declined"); }} style={{ fontSize: 11, color: T.faint, cursor: "pointer", borderBottom: `1px dotted ${T.faint}` }}>
                          Decline
                        </span>
                      )}
                    </div>
                  )}
                  {l.quote && (
                    <span style={{ fontSize: 10, fontFamily: mono, color: l.status === "converted" || l.job_id ? T.green : l.status === "accepted" ? T.green : T.purple, fontWeight: 700, letterSpacing: "0.06em" }}>
                      {l.job_id ? "CONVERTED" : l.status === "accepted" ? "ACCEPTED" : "QUOTED"} ${Number(l.quote.total || 0).toLocaleString()} ·{" "}
                      {l.quote.punch.filter(pt => pt.status === "done").length}/{l.quote.punch.length} points
                      {l.job_id && <a href={`/jobs/${l.job_id}`} onClick={(e) => e.stopPropagation()} style={{ color: T.blue, marginLeft: 8, textDecoration: "none", borderBottom: `1px dotted ${T.blue}` }}>open job →</a>}
                    </span>
                  )}
                  {convertErr && converting === null && (
                    <span style={{ fontSize: 10.5, color: T.red }}>{convertErr}</span>
                  )}
                  {l.response?.sent_at && (
                    <span title={l.response.body} style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>
                      responded {new Date(l.response.sent_at).toLocaleDateString()} by {l.response.by?.split("@")[0]}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {composing && (
        <ComposeResponseModal
          lead={composing}
          onClose={() => setComposing(null)}
          onSent={() => { setComposing(null); onChanged(); }}
        />
      )}
      {quoting && (
        <QuoteBuilderModal
          lead={quoting}
          onClose={() => setQuoting(null)}
          onSent={() => { setQuoting(null); onChanged(); }}
        />
      )}
      {openLead && (
        <MenuLeadDetailModal
          lead={openLead}
          matchNames={matchNames}
          onClose={() => setOpenLead(null)}
          onBuildQuote={() => { setQuoting(openLead); setOpenLead(null); }}
          onRespond={() => { setComposing(openLead); setOpenLead(null); }}
          onConvert={() => { setOpenLead(null); convertLead(openLead); }}
          onDecline={() => { setStatus(openLead, "declined"); setOpenLead(null); }}
        />
      )}
    </section>
  );
}

function ComposeResponseModal({ lead, onClose, onSent }: { lead: MenuLead; onClose: () => void; onSent: () => void }) {
  const draft = useMemo(() => buildResponseDraft(lead), [lead]);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hasPlaceholder = /\[\$?\s?_+|\[X /.test(body);

  async function send() {
    if (sending) return;
    setSending(true);
    setErr(null);
    const res = await fetch("/api/menu/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, subject, body }),
    }).catch(() => null);
    setSending(false);
    if (res?.ok) { onSent(); return; }
    const d = await res?.json().catch(() => null);
    setErr(d?.error || "Send failed. Try again.");
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: "100%", maxWidth: 560, fontFamily: font, color: T.text }}>
        <h3 style={{ margin: "0 0 2px", fontSize: 17, fontWeight: 700 }}>Response to {lead.contact?.name || lead.email}</h3>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: T.faint }}>
          Prefilled from their picks and the ranges they were shown. Fill the bracketed number, tweak, send. Goes from hello@ with their menu link attached.
        </p>
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, fontSize: 13, padding: "9px 11px", marginBottom: 10, fontFamily: font }}
        />
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, fontSize: 13, padding: "10px 11px", minHeight: 260, lineHeight: 1.55, fontFamily: font, resize: "vertical" }}
        />
        {hasPlaceholder && (
          <div style={{ fontSize: 11, color: T.amber, marginTop: 8 }}>
            Draft still has a bracketed placeholder — fill in the real number before sending.
          </div>
        )}
        {err && <div style={{ fontSize: 12, color: T.red, marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8, color: T.muted, fontSize: 13, padding: "9px 16px", cursor: "pointer", fontFamily: font }}>
            Cancel
          </button>
          <button
            onClick={send}
            disabled={sending || hasPlaceholder || !subject.trim() || !body.trim()}
            style={{ background: T.accent, border: "none", borderRadius: 8, color: "#111", fontSize: 13, fontWeight: 700, padding: "9px 18px", cursor: "pointer", fontFamily: font, opacity: sending || hasPlaceholder || !subject.trim() || !body.trim() ? 0.5 : 1 }}
          >
            {sending ? "Sending..." : "Send response"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Quick Quote builder ────────────────────────────────────────
// THE SAME costing surface as the job (Jon: "we may as well have this
// same function on the intake"): margin chips, per-item sell card, and
// the REAL DecorationPanel embedded per line — vendor, locations, share
// groups, specialty chips, tag print, packaging, setup fees, custom
// costs. calcCostProduct runs across all lines so share groups price
// exactly like in-project costing. On convert the spec seeds
// costing_data.costProds (qtys never persisted — single-source).

const QQ_MARGINS = [10, 15, 20, 25, 30];

function QuoteBuilderModal({ lead, onClose, onSent }: { lead: MenuLead; onClose: () => void; onSent: () => void }) {
  const supabase = createClient();
  const [printers, setPrinters] = useState<Record<string, any>>({});
  const [decoratorRecords, setDecoratorRecords] = useState<any[]>([]);
  const [rateMeta, setRateMeta] = useState<Record<string, { blank: number | null; group: string }>>({});
  useEffect(() => {
    supabase.from("decorators").select("id, name, short_code, pricing_data, capabilities").then(({ data }) => {
      const rows = (data as any[]) || [];
      setDecoratorRecords(rows);
      setPrinters(buildPrintersMap(rows));
    });
    supabase.from("menu_rates").select("style_code,product_group,seed_meta").eq("active", true).then(({ data }) => {
      const m: Record<string, { blank: number | null; group: string }> = {};
      for (const r of (data as any[]) || []) {
        if (!m[r.style_code]) m[r.style_code] = { blank: r.seed_meta?.blank ?? null, group: r.product_group };
        if (m[r.style_code].blank == null && r.seed_meta?.blank != null) m[r.style_code].blank = r.seed_meta.blank;
      }
      setRateMeta(m);
    });
  }, []);
  const lookupPrint = (pk: string, qty: number, colors: number) => lookupPrintPrice(printers, pk, qty, colors);
  const lookupTag = (pk: string, qty: number) => lookupTagPrice(printers, pk, qty);

  const initial = useMemo<{ lines: QuoteLine[]; punch: PunchPoint[]; validUntil: string }>(() => {
    if (lead.quote) {
      return { lines: lead.quote.lines, punch: lead.quote.punch, validUntil: lead.quote.validUntil };
    }
    const snap = lead.rates_snapshot || [];
    const items = lead.picks?.items || [];
    const lines: QuoteLine[] = items.map(it => {
      const mid = snapshotMid(snap as any, it.styleCode, it.qty);
      const name = (snap as any[]).find(r => r.style_code === it.styleCode)?.style_name || it.styleCode;
      return {
        styleCode: it.styleCode,
        label: name,
        qty: it.qty,
        colors: it.colors || [],
        unitPrice: mid != null ? Number(mid.toFixed(2)) : null,
        note: (it as any).notes || undefined,
      };
    });
    const punch = defaultPunch({
      lines,
      hasArtFiles: (lead.picks?.files || []).length > 0,
      artStatus: lead.picks?.artStatus || null,
      neededBy: lead.contact?.neededBy || null,
    });
    const vu = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    return { lines, punch, validUntil: vu };
  }, [lead]);

  const [lines, setLines] = useState<QuoteLine[]>(initial.lines);
  const [punch, setPunch] = useState<PunchPoint[]>(initial.punch);
  const [validUntil, setValidUntil] = useState(initial.validUntil);
  const [marginPct, setMarginPct] = useState<number>(() => {
    const c: any = initial.lines.find(l => (l.costing as any)?.__margin != null)?.costing;
    return c?.__margin ?? 30;
  });
  const [customPoint, setCustomPoint] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Seed each styled line's costProd spec once the rate meta lands.
  useEffect(() => {
    if (!Object.keys(rateMeta).length) return;
    setLines(ls => ls.map(l => {
      if (!l.styleCode || l.costing) return l;
      const meta = rateMeta[l.styleCode];
      const group = meta?.group || "tee";
      if (!["tee", "hoodie", "hat"].includes(group)) return l; // accessories price manually
      return {
        ...l,
        costing: {
          garment_type: group === "hat" ? "hat" : group,
          blank_vendor: l.label,
          blankCostPerUnit: meta?.blank ?? 0,
          isFleece: group === "hoodie",
          printVendor: null, printLocations: {},
          finishingQtys: {}, setupFees: {}, specialtyQtys: {}, customCosts: [],
        } as any,
      };
    }));
  }, [rateMeta]);

  // Assemble engine prods (share groups span lines, same as the job).
  const prods = useMemo(() => lines.map((l, i) => l.costing ? ({
    ...(l.costing as any),
    id: `qq-${i}`, name: l.label, totalQty: l.qty,
  }) : null), [lines]);
  const allProds = prods.filter(Boolean) as any[];

  function engineFor(i: number): any | null {
    const prod = prods[i];
    if (!prod?.printVendor || !Object.keys(printers).length) return null;
    const r = calcCostProduct(prod, `${marginPct}%`, false, false, allProds, printers);
    return r && r.sellPerUnit > 0 ? r : null;
  }

  // DecorationPanel edit hooks — write the spec back onto the line and
  // resync the auto price.
  function writeSpec(i: number, newP: any) {
    setLines(ls => ls.map((l, x) => {
      if (x !== i) return l;
      const { id: _id, name: _n, totalQty: _q, ...spec } = newP;
      return { ...l, costing: spec };
    }));
  }
  const updateProd = (i: number, newP: any) => writeSpec(i, newP);
  const setCostProdsFn = (fn: any) => {
    const next = fn(prods.map(p => p || {}));
    next.forEach((np: any, i: number) => { if (prods[i]) writeSpec(i, np); });
  };

  // Auto price: engine sell → unitPrice unless overridden.
  useEffect(() => {
    if (!Object.keys(printers).length) return;
    setLines(ls => ls.map((l, i) => {
      const c: any = l.costing;
      if (!c || c.sellOverride != null) return l;
      const prod = { ...c, id: `qq-${i}`, name: l.label, totalQty: l.qty };
      if (!prod.printVendor) return l;
      const all = ls.map((l2, x) => l2.costing ? { ...(l2.costing as any), id: `qq-${x}`, name: l2.label, totalQty: l2.qty } : null).filter(Boolean);
      const r = calcCostProduct(prod, `${marginPct}%`, false, false, all as any[], printers);
      if (!r || !(r.sellPerUnit > 0)) return l;
      const sell = Math.round(r.sellPerUnit * 20) / 20;
      const allIn = Number((r.totalCost / l.qty).toFixed(2));
      if (l.unitPrice === sell && (c as any).__allIn === allIn) return l;
      return { ...l, unitPrice: sell, costing: { ...c, __allIn: allIn, __margin: marginPct } };
    }));
  }, [JSON.stringify(prods), marginPct, printers]);

  function setLine(i: number, patch: Partial<QuoteLine>) {
    setLines(ls => ls.map((l, x) => (x === i ? { ...l, ...patch } : l)));
  }

  const total = quoteTotal(lines);
  const unpriced = lines.filter(l => l.unitPrice == null).length;

  async function send() {
    if (sending) return;
    setSending(true);
    setErr(null);
    const res = await fetch("/api/menu/quote-send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, lines, punch, validUntil }),
    }).catch(() => null);
    setSending(false);
    if (res?.ok) { onSent(); return; }
    const d = await res?.json().catch(() => null);
    setErr(d?.error || "Send failed. Try again.");
  }

  const inp: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, color: T.text, fontSize: 12.5, padding: "7px 9px", fontFamily: font };
  const kpi = (label: string, val: string, color?: string) => (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: T.muted, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 800, fontFamily: mono, color: color || T.text }}>{val}</div>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 22, width: "100%", maxWidth: 820, maxHeight: "94vh", overflowY: "auto", fontFamily: font, color: T.text }}>

        {/* Header — margin chips, same rhythm as JOB PRICING */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", color: T.amber, textTransform: "uppercase" }}>
            Quick quote · {lead.contact?.name || lead.email}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: T.muted, textTransform: "uppercase" }}>Margin</span>
          <div style={{ display: "flex", background: T.card, borderRadius: 8, padding: 2 }}>
            {QQ_MARGINS.map(mg => (
              <button key={mg} onClick={() => setMarginPct(mg)}
                style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 700, fontFamily: mono, cursor: "pointer", border: "none", background: marginPct === mg ? T.amber : "transparent", color: marginPct === mg ? "#111" : T.muted }}>
                {mg}%
              </button>
            ))}
          </div>
          <span style={{ marginLeft: "auto", fontSize: 17, fontWeight: 800, fontFamily: mono }}>${total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
        <p style={{ margin: "0 0 14px", fontSize: 11.5, color: T.faint }}>
          Same engine as in-project costing (blanks + decoration; no ship/CC buffers). Specs carry into the job&apos;s Costing on convert. Re-sending never wipes the customer&apos;s checklist progress.
        </p>

        {/* Lines */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {lines.map((l, i) => {
            const c: any = l.costing;
            const r = engineFor(i);
            return (
              <div key={i} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, background: T.card }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 92px 24px", gap: 8, alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <input value={l.label} onChange={e => setLine(i, { label: e.target.value })} style={{ ...inp, width: "100%", boxSizing: "border-box", background: T.surface }} />
                    {(l.colors.length > 0 || l.note) && (
                      <div style={{ fontSize: 10.5, color: T.faint, fontFamily: mono, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {l.colors.join(", ")}{l.note ? ` · "${l.note}"` : ""}
                      </div>
                    )}
                  </div>
                  <input type="number" value={l.qty || ""} onChange={e => setLine(i, { qty: Number(e.target.value) || 0 })} style={{ ...inp, textAlign: "right", fontFamily: mono, background: T.surface }} />
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 8, top: 8, fontSize: 12, color: c?.sellOverride != null ? T.amber : T.faint }}>$</span>
                    <input
                      type="number" step="0.05"
                      value={l.unitPrice ?? ""}
                      placeholder="price"
                      title={c?.sellOverride != null ? "Manual override — clear to return to engine pricing" : undefined}
                      onChange={e => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        setLine(i, { unitPrice: v, costing: c ? { ...c, sellOverride: v } : c });
                      }}
                      style={{ ...inp, width: "100%", boxSizing: "border-box", paddingLeft: 18, textAlign: "right", fontFamily: mono, background: T.surface, borderColor: c?.sellOverride != null ? T.amber : l.unitPrice == null ? T.amber : T.border }}
                    />
                  </div>
                  <span onClick={() => setLines(ls => ls.filter((_, x) => x !== i))} style={{ color: T.faint, cursor: "pointer", textAlign: "center" }}>×</span>
                </div>

                {c && (
                  <>
                    {/* Sell/unit card — the job modal's per-item summary, condensed */}
                    <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", margin: "10px 0", padding: "8px 12px", borderRadius: 8, background: T.surface, border: `1px solid ${T.border}` }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: T.muted, textTransform: "uppercase" }}>Sell / unit</span>
                        <span style={{ fontSize: 18, fontWeight: 800, fontFamily: mono, color: T.amber }}>{l.unitPrice != null ? `$${l.unitPrice.toFixed(2)}` : "—"}</span>
                        {c.sellOverride != null && <span style={{ fontSize: 9.5, color: T.amber }}>override</span>}
                      </div>
                      {r ? (
                        <>
                          {kpi("Revenue", `$${(r.grossRev || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)}
                          {kpi("Blank", `$${(r.blankCost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)}
                          {kpi("Decoration", `$${((r.printTotal || 0) + (r.setupTotal || 0) + (r.finTotal || 0) + (r.specTotal || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)}
                          {kpi("Profit / pc", `$${(r.profitPerPiece || 0).toFixed(2)}`, T.amber)}
                          {kpi("Margin", `${((r.margin_pct || 0) * 100).toFixed(1)}%`, T.amber)}
                        </>
                      ) : (
                        <span style={{ fontSize: 11, color: T.faint }}>{c.printVendor ? "add a location with colors" : "pick a vendor below"}</span>
                      )}
                      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 10, color: T.muted }}>blank $</span>
                        <input type="text" inputMode="decimal" value={c.blankCostPerUnit ?? ""} onChange={e => writeSpec(i, { ...prods[i], blankCostPerUnit: Number(e.target.value) || 0 })}
                          style={{ width: 54, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 13, fontWeight: 700, fontFamily: mono, outline: "none", padding: "3px 4px" }} />
                      </div>
                    </div>

                    {/* THE real DecorationPanel */}
                    <DecorationPanel
                      p={prods[i]} i={i} costProds={prods.map(x => x || {})}
                      PRINTERS={printers} decoratorRecords={decoratorRecords}
                      updateProd={updateProd} setCostProds={setCostProdsFn}
                      lookupPrintPrice={lookupPrint} lookupTagPrice={lookupTag}
                      hideVendorApplyAll flush
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
        <span
          onClick={() => setLines(ls => [...ls, { styleCode: null, label: "", qty: 1, colors: [], unitPrice: null }])}
          style={{ display: "inline-block", marginTop: 10, fontSize: 11.5, color: T.blue, cursor: "pointer", borderBottom: `1px dotted ${T.blue}` }}
        >
          + Add line (setup fee, art services, shipping...)
        </span>
        {unpriced > 0 && <div style={{ fontSize: 11, color: T.amber, marginTop: 6 }}>{unpriced} unpriced line{unpriced > 1 ? "s" : ""} (shows as &quot;quoted on art&quot;)</div>}

        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: T.muted, margin: "18px 0 6px" }}>
          CHECKLIST · what the customer completes on their page
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
          {punch.map((pt, i) => (
            <label key={pt.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked onChange={() => setPunch(ps => ps.filter((_, x) => x !== i))} style={{ marginTop: 2 }} />
              <span>
                <b>{pt.label}</b>{pt.status === "done" ? <span style={{ color: T.green, fontFamily: mono, fontSize: 10.5 }}> · already done</span> : ""}
                <span style={{ display: "block", color: T.faint, fontSize: 11.5 }}>{pt.desc}</span>
              </span>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input
            value={customPoint}
            onChange={e => setCustomPoint(e.target.value)}
            placeholder="Add a custom point (e.g. confirm neck label text)"
            style={{ ...inp, flex: 1 }}
            onKeyDown={e => {
              if (e.key === "Enter" && customPoint.trim()) {
                setPunch(ps => [...ps, { key: `custom-${Date.now()}`, label: customPoint.trim(), desc: "", kind: "text", required: false, status: "needed" }]);
                setCustomPoint("");
              }
            }}
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, marginBottom: 16 }}>
          <span style={{ color: T.muted }}>Quote good through</span>
          <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} style={inp} />
        </label>

        {err && <div style={{ fontSize: 12, color: T.red, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8, color: T.muted, fontSize: 13, padding: "9px 16px", cursor: "pointer", fontFamily: font }}>
            Cancel
          </button>
          <button
            onClick={send}
            disabled={sending || lines.length === 0}
            style={{ background: T.accent, border: "none", borderRadius: 8, color: "#111", fontSize: 13, fontWeight: 700, padding: "9px 18px", cursor: "pointer", fontFamily: font, opacity: sending || lines.length === 0 ? 0.5 : 1 }}
          >
            {sending ? "Sending..." : lead.quote ? "Re-send quote" : "Send quote"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Lead detail modal (mirrors the intake submissions' DetailModal) ──
// The whole lead on one surface for Taylor: contact, picks, art, the
// quote with checklist payloads (size grids, date, ship-to), response
// history, and every action.

function MenuLeadDetailModal({ lead, matchNames, onClose, onBuildQuote, onRespond, onConvert, onDecline }: {
  lead: MenuLead;
  matchNames: Record<string, string>;
  onClose: () => void;
  onBuildQuote: () => void;
  onRespond: () => void;
  onConvert: () => void;
  onDecline: () => void;
}) {
  const p = lead.picks || {};
  const q = lead.quote;
  const sec: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: T.muted, margin: "18px 0 8px" };
  const box: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 12.5 };
  const items = Array.isArray(p.items) ? p.items : [];
  const files = (p.files || []).filter(f => f.url);
  const punchSummary = (pt: NonNullable<MenuLead["quote"]>["punch"][number]): string => {
    const pl = pt.payload as any;
    if (pt.status !== "done") return "open";
    if (pt.kind === "files") return `${(pl?.files || []).length} file(s)`;
    if (pt.kind === "sizes") {
      const grids = pl?.grids || {};
      const parts = Object.entries(grids).map(([k, g]: [string, any]) => {
        const total = Object.values(g as Record<string, number>).reduce((s: number, n) => s + (Number(n) || 0), 0);
        return `${k.split("|")[1] || "all"}: ${total}u`;
      });
      return parts.join(" · ") || (pl?.value ? String(pl.value).slice(0, 60) : "done");
    }
    if (pl?.value) return String(pl.value).slice(0, 80);
    return "done";
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: "100%", maxWidth: 620, maxHeight: "92vh", overflowY: "auto", fontFamily: font, color: T.text }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{lead.contact?.name || lead.email}</h3>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginTop: 4 }}>
              <a href={`mailto:${lead.email}`} style={{ fontSize: 12, color: T.blue, textDecoration: "none" }}>{lead.email}</a>
              {lead.contact?.phone && <span style={{ fontSize: 12, color: T.muted, fontFamily: mono }}>{lead.contact.phone}</span>}
              {lead.client_match && (
                <span style={{ fontSize: 10, fontWeight: 700, color: T.blue, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Existing client{matchNames[lead.client_match] ? ` · ${matchNames[lead.client_match]}` : ""}
                </span>
              )}
              <span style={{ fontSize: 10, fontWeight: 700, color: lead.job_id ? T.green : T.purple, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                {lead.job_id ? "Converted" : lead.status.replace(/_/g, " ")}
              </span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: T.faint, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={sec}>Picks from The Build</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.length ? items.map((it, i) => (
            <div key={i} style={box}>
              <b>{it.styleCode}</b> × {it.qty}
              {it.colors?.length ? <span style={{ color: T.muted }}> · {it.colors.join(", ")}</span> : null}
              {(it as any).notes && <div style={{ color: T.faint, marginTop: 3 }}>&ldquo;{(it as any).notes}&rdquo;</div>}
            </div>
          )) : <div style={{ ...box, color: T.faint }}>No styles picked; they were browsing.</div>}
          {(p.budget || p.artStatus || p.notes || lead.contact?.neededBy) && (
            <div style={{ ...box, color: T.muted }}>
              {p.budget ? `Browsed at a $${Number(p.budget).toLocaleString()} budget · ` : ""}
              {p.artStatus === "need_help" ? "Needs design help · " : p.artStatus === "ready" ? "Art ready · " : ""}
              {lead.contact?.neededBy ? `Needed ${lead.contact.neededBy}` : ""}
              {p.notes && <div style={{ color: T.faint, marginTop: 3 }}>&ldquo;{p.notes}&rdquo;</div>}
              {lead.contact?.notes && <div style={{ color: T.faint, marginTop: 3 }}>&ldquo;{lead.contact.notes}&rdquo;</div>}
            </div>
          )}
        </div>

        {files.length > 0 && (
          <>
            <div style={sec}>Art files</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {files.map(f => (
                <a key={f.path} href={f.url!} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: T.blue, textDecoration: "none", borderBottom: `1px dotted ${T.blue}`, fontFamily: mono }}>
                  📎 {f.filename}{f.styleCode ? ` (${f.styleCode}${f.placement ? ` · ${f.placement}` : ""})` : ""}
                </a>
              ))}
            </div>
          </>
        )}

        {q && (
          <>
            <div style={sec}>Quote · ${Number(q.total || 0).toLocaleString()} · good through {q.validUntil}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {q.lines.map((l, i) => (
                <div key={i} style={{ ...box, display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>{l.label}{l.colors.length ? <span style={{ color: T.faint }}> · {l.colors.join(", ")}</span> : null} × {l.qty}</span>
                  <span style={{ fontFamily: mono }}>{l.unitPrice != null ? `$${l.unitPrice.toFixed(2)}/pc` : "unpriced"}</span>
                </div>
              ))}
            </div>
            <div style={sec}>Checklist · {q.punch.filter(pt => pt.status === "done").length}/{q.punch.length} done</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {q.punch.map(pt => (
                <div key={pt.key} style={{ ...box, display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ color: pt.status === "done" ? T.text : T.amber }}>{pt.status === "done" ? "✓" : "○"} {pt.label}</span>
                  <span style={{ color: T.faint, fontFamily: mono, fontSize: 11.5, textAlign: "right" }}>{punchSummary(pt)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {lead.response?.sent_at && (
          <>
            <div style={sec}>Last response · {new Date(lead.response.sent_at).toLocaleString()} by {lead.response.by?.split("@")[0]}</div>
            <div style={{ ...box, whiteSpace: "pre-wrap", color: T.muted, maxHeight: 140, overflowY: "auto" }}>{lead.response.body}</div>
          </>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 22, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {lead.job_id ? (
            <a href={`/jobs/${lead.job_id}`} style={{ background: T.accent, borderRadius: 8, color: "#111", fontSize: 13, fontWeight: 700, padding: "9px 18px", textDecoration: "none" }}>
              Open job →
            </a>
          ) : (
            <>
              {q && <button onClick={onConvert} style={{ background: T.greenDim, border: `1px solid ${T.green}`, borderRadius: 8, color: T.green, fontSize: 13, fontWeight: 700, padding: "9px 16px", cursor: "pointer", fontFamily: font }}>Create job</button>}
              <button onClick={onBuildQuote} style={{ background: T.accent, border: "none", borderRadius: 8, color: "#111", fontSize: 13, fontWeight: 700, padding: "9px 16px", cursor: "pointer", fontFamily: font }}>{q ? "Edit quote" : "Build quote"}</button>
              <button onClick={onRespond} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8, color: T.blue, fontSize: 13, padding: "9px 16px", cursor: "pointer", fontFamily: font }}>Respond</button>
              <button onClick={onDecline} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8, color: T.faint, fontSize: 13, padding: "9px 16px", cursor: "pointer", fontFamily: font }}>Decline</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
