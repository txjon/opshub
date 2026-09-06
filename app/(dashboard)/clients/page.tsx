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
