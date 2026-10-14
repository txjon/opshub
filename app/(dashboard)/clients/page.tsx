"use client";
import { createClient } from "@/lib/supabase/client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { T, font, mono } from "@/lib/theme";
import { useIsMobile } from "@/lib/useIsMobile";
import { SkeletonTable } from "@/components/Skeleton";

type Client = {
  id: string;
  name: string;
  default_terms: string | null;
  jobs: { id: string }[];
  contacts: { id: string }[];
};

export default function ClientsPage() {
  const supabase = createClient();
  const isMobile = useIsMobile();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("clients")
        .select("*, contacts(id), jobs(id)")
        .order("name");
      setClients((data || []) as Client[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return clients;
    const q = search.toLowerCase();
    return clients.filter(c => c.name.toLowerCase().includes(q));
  }, [clients, search]);

  async function createClientRow(name: string) {
    const { data } = await supabase
      .from("clients")
      .insert({ name } as any)
      .select("*, contacts(id), jobs(id)")
      .single();
    if (data) {
      setClients(prev => [...prev, data as Client].sort((a, b) => a.name.localeCompare(b.name)));
    }
    setNewName("");
    setAdding(false);
  }

  return (
    <div style={{ fontFamily: font, color: T.text, maxWidth: 560, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header — mirrors /jobs */}
      <div style={{ display: "flex", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 10 : 12, flexDirection: isMobile ? "column" : "row", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ fontSize: isMobile ? 20 : 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Clients</h1>
          {isMobile && (
            <button onClick={() => setAdding(true)}
              style={{ background: T.accent, color: "#0a0a0a", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontFamily: font, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              + New
            </button>
          )}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search clients..."
          style={{ flex: 1, maxWidth: isMobile ? "100%" : 360, padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }}
        />
        {!isMobile && (
          <button onClick={() => setAdding(true)}
            style={{ background: T.accent, color: "#0a0a0a", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontFamily: font, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            + New Client
          </button>
        )}
      </div>

      {/* Company info form — email every active hub client their prefilled
          form (lib/client-info). Two taps; owner/manager only (server-enforced). */}
      <InfoBlast clients={clients} />
      <QbSyncPanel />

      {/* Inline new-client row */}
      {adding && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px" }}>
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && newName.trim()) createClientRow(newName.trim());
              if (e.key === "Escape") { setNewName(""); setAdding(false); }
            }}
            placeholder="Client name…"
            style={{ flex: 1, minWidth: 180, padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }}
          />
          <button onClick={() => { if (newName.trim()) createClientRow(newName.trim()); }}
            style={{ background: T.accent, color: "#0a0a0a", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: "pointer" }}>
            Save
          </button>
          <button onClick={() => { setNewName(""); setAdding(false); }}
            style={{ background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 8, padding: "7px 12px", fontSize: 12, fontFamily: font, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      )}

      {/* List */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 16 }}><SkeletonTable rows={6} cols={3} /></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "32px 18px", textAlign: "center", color: T.muted, fontSize: 13 }}>
            {search ? "No clients match your search." : "No clients yet."}
          </div>
        ) : (
          <div>
            {/* Column header — hidden on mobile to keep rows tight */}
            {!isMobile && (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 90px 140px", gap: 12, padding: "8px 14px", fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: `1px solid ${T.border}`, background: T.surface }}>
                <div>Name</div>
                <div style={{ textAlign: "right" }}>Projects</div>
                <div>Terms</div>
              </div>
            )}
            {filtered.map((c, i) => {
              const terms = c.default_terms?.replace(/_/g, " ") ?? "—";
              if (isMobile) {
                return (
                  <Link key={c.id} href={`/clients/${c.id}`}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: i < filtered.length - 1 ? `1px solid ${T.border}` : "none", textDecoration: "none", color: T.text }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: T.muted, marginTop: 2, textTransform: "capitalize" }}>{terms}</div>
                    </div>
                    <div style={{ fontSize: 12, color: T.muted, fontFamily: mono, whiteSpace: "nowrap" }}>
                      {c.jobs.length} project{c.jobs.length === 1 ? "" : "s"}
                    </div>
                  </Link>
                );
              }
              return (
                <Link key={c.id} href={`/clients/${c.id}`}
                  style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 90px 140px", gap: 12, padding: "10px 14px", borderBottom: i < filtered.length - 1 ? `1px solid ${T.border}` : "none", textDecoration: "none", color: T.text, alignItems: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: T.muted, fontFamily: mono, textAlign: "right" }}>{c.jobs.length}</div>
                  <div style={{ fontSize: 12, color: T.muted, textTransform: "capitalize" }}>{terms}</div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoBlast({ clients }: { clients: any[] }) {
  const targets = clients.filter((c: any) => c.client_hub_enabled && !c.is_internal && !c.is_lead && (c.contacts || []).length > 0);
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ sent: number; failed: { clientId: string; error: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    if (!arm) { setArm(true); setRes(null); setErr(null); return; }
    setArm(false); setBusy(true);
    try {
      const r = await fetch("/api/clients/info-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientIds: targets.map((c: any) => c.id) }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Send failed");
      setRes({ sent: d.sent, failed: d.failed || [] });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const nameOf = (id: string) => clients.find((c: any) => c.id === id)?.name || id;
  if (!targets.length) return null;
  return (
    <div style={{ fontSize: 12.5, color: T.muted, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={go} disabled={busy}
          style={{ background: arm ? T.accent : "transparent", color: arm ? "#0a0a0a" : T.muted, border: `1px solid ${arm ? T.accent : T.border}`, borderRadius: 999, padding: "6px 13px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: busy ? "default" : "pointer" }}>
          {busy ? `Emailing ${targets.length} clients…` : arm ? `Tap again: email ${targets.length} clients now` : `Email the company info form to all clients (${targets.length})`}
        </button>
        {arm && <button onClick={() => setArm(false)} style={{ background: "none", border: "none", color: T.faint, fontSize: 12, cursor: "pointer", fontFamily: font }}>Cancel</button>}
      </div>
      {err && <div style={{ color: T.red }}>{err}</div>}
      {res && (
        <div>
          <span style={{ color: T.green }}>Sent to {res.sent} client{res.sent === 1 ? "" : "s"}.</span>
          {res.failed.length > 0 && <span> Couldn&apos;t reach {res.failed.length}: {res.failed.map(f => `${nameOf(f.clientId)} (${f.error.replace(/^.*?(has no|Email failed)/, "$1")})`).join("; ")}</span>}
        </div>
      )}
    </div>
  );
}

// ── OpsHub → QuickBooks customer sync (lib/qb-customer-sync) ──
// Preview every linked client whose QB customer differs from OpsHub, field by
// field; untick anything that shouldn't go; two taps to write. Blanks in
// OpsHub never overwrite QB; tax and display names are never touched.
function QbSyncPanel() {
  type D = { field: string; label: string; qb: string; opshub: string };
  type C = { clientId: string; name: string; qbName: string; diffs: D[] };
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"load" | "write" | null>(null);
  const [rows, setRows] = useState<C[] | null>(null);
  const [checked, setChecked] = useState<number>(0);
  const [pick, setPick] = useState<Record<string, Set<string>>>({});
  const [arm, setArm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // only owners / managers can change QuickBooks customers (the API enforces it too)
  const [canSync, setCanSync] = useState(false);
  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: me } = await sb.from("profiles").select("role, is_god").eq("id", user.id).single();
      setCanSync(!!(me as any)?.is_god || ["owner", "manager"].includes((me as any)?.role));
    });
  }, []);
  const load = async () => {
    setBusy("load"); setErr(null); setArm(false);
    try {
      const r = await fetch("/api/qb/customer-sync"); const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't read QuickBooks");
      setRows(d.clients); setChecked(d.checked);
      setPick(Object.fromEntries((d.clients as C[]).map(c => [c.clientId, new Set(c.diffs.map(x => x.field))])));
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const toggle = (cid: string, f: string) => setPick(p => { const s = new Set(p[cid] || []); s.has(f) ? s.delete(f) : s.add(f); return { ...p, [cid]: s }; });
  const items = Object.entries(pick).filter(([, s]) => s.size).map(([clientId, s]) => ({ clientId, fields: Array.from(s) }));
  const nFields = items.reduce((a, i) => a + i.fields.length, 0);
  const write = async () => {
    if (!arm) { setArm(true); return; }
    setArm(false); setBusy("write"); setErr(null); setDone(null);
    try {
      const r = await fetch("/api/qb/customer-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Update failed");
      const nameOf = (id: string) => rows?.find(c => c.clientId === id)?.name || id;
      setDone(`Updated ${d.updated} QuickBooks customer${d.updated === 1 ? "" : "s"}.` + (d.failed?.length ? ` Not updated: ${d.failed.map((f: any) => `${nameOf(f.clientId)} (${f.error})`).join("; ")}.` : "") + (d.websiteRefused?.length ? ` QuickBooks refused the website for ${d.websiteRefused.map(nameOf).join(", ")}; fix it on their client page.` : ""));
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const btn: React.CSSProperties = { background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 999, padding: "6px 13px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: "pointer" };
  if (!canSync) return null;
  if (!open) return <div><button style={btn} onClick={() => { setOpen(true); load(); }}>Review QuickBooks customer updates</button></div>;
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 10, fontFamily: font }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <b style={{ fontSize: 13, color: T.text }}>QuickBooks customers</b>
        <span style={{ fontSize: 12, color: T.muted }}>{busy === "load" ? "Reading QuickBooks…" : rows ? `${rows.length} of ${checked} differ from OpsHub. Untick anything that shouldn't go.` : ""}</span>
        <button style={{ ...btn, border: "none", marginLeft: "auto" }} onClick={() => { setOpen(false); setRows(null); setDone(null); setErr(null); }}>Close</button>
      </div>
      {err && <div style={{ color: T.red, fontSize: 12.5 }}>{err}</div>}
      {done && <div style={{ color: T.green, fontSize: 12.5 }}>{done}</div>}
      {rows && rows.length === 0 && <div style={{ fontSize: 12.5, color: T.muted }}>Every linked client matches QuickBooks.</div>}
      {rows && rows.map(c => (
        <div key={c.clientId} style={{ borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{c.name}{c.qbName && c.qbName !== c.name ? <span style={{ color: T.faint, fontWeight: 400 }}> · QuickBooks: {c.qbName}</span> : null}</div>
          {c.diffs.map(d => {
            const on = pick[c.clientId]?.has(d.field) || false;
            return (
              <label key={d.field} style={{ display: "grid", gridTemplateColumns: "20px minmax(70px, 0.6fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 8, overflowWrap: "anywhere", alignItems: "start", fontSize: 12, padding: "6px 0", cursor: "pointer", opacity: on ? 1 : 0.5 }}>
                <input type="checkbox" checked={on} onChange={() => toggle(c.clientId, d.field)} style={{ accentColor: T.accent, marginTop: 2 }} />
                <span style={{ color: T.muted }}>{d.label}</span>
                <span style={{ color: T.faint, whiteSpace: "pre-line", textDecoration: on && d.qb ? "line-through" : "none" }}>{d.qb || "(blank in QuickBooks)"}</span>
                <span style={{ color: T.text, whiteSpace: "pre-line" }}>{d.opshub}</span>
              </label>
            );
          })}
        </div>
      ))}
      {rows && rows.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
          <button onClick={write} disabled={!!busy || !nFields}
            style={{ ...btn, background: arm ? T.accent : "transparent", color: arm ? "#0a0a0a" : T.text, borderColor: arm ? T.accent : T.border, opacity: nFields ? 1 : 0.5 }}>
            {busy === "write" ? "Updating QuickBooks…" : arm ? `Tap again: update ${items.length} customers in QuickBooks` : `Update ${nFields} field${nFields === 1 ? "" : "s"} across ${items.length} customer${items.length === 1 ? "" : "s"}`}
          </button>
          {arm && <button style={{ ...btn, border: "none" }} onClick={() => setArm(false)}>Cancel</button>}
          <span style={{ fontSize: 11.5, color: T.faint }}>Left column = QuickBooks now · right = what it becomes. Blanks in OpsHub never overwrite QuickBooks.</span>
        </div>
      )}
    </div>
  );
}
