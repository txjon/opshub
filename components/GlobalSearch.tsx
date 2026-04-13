"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { T, font, mono } from "@/lib/theme";
import { Search } from "lucide-react";

type Result = {
  type: "project" | "client" | "item" | "decorator";
  id: string;
  href: string;
  title: string;
  subtitle: string;
};

export function GlobalSearch() {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keyboard shortcut: Cmd+K or Ctrl+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        setResults([]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Search on query change
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => search(query.trim()), 200);
  }, [query]);

  async function search(q: string) {
    setLoading(true);
    const lower = q.toLowerCase();
    const results: Result[] = [];

    // Search jobs
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, title, job_number, type_meta, phase, clients(name)")
      .or(`title.ilike.%${q}%,job_number.ilike.%${q}%,type_meta->>qb_invoice_number.ilike.%${q}%`)
      .limit(5);

    for (const j of (jobs || [])) {
      const displayNum = (j as any).type_meta?.qb_invoice_number || j.job_number;
      results.push({
        type: "project",
        id: j.id,
        href: `/jobs/${j.id}`,
        title: j.title,
        subtitle: `${(j.clients as any)?.name || ""} · ${displayNum} · ${j.phase}`,
      });
    }

    // Also search jobs by client name
    const { data: jobsByClient } = await supabase
      .from("jobs")
      .select("id, title, job_number, type_meta, phase, clients!inner(name)")
      .ilike("clients.name", `%${q}%`)
      .limit(5);

    for (const j of (jobsByClient || [])) {
      if (!results.some(r => r.id === j.id)) {
        const displayNum = (j as any).type_meta?.qb_invoice_number || j.job_number;
        results.push({
          type: "project",
          id: j.id,
          href: `/jobs/${j.id}`,
          title: j.title,
          subtitle: `${(j.clients as any)?.name || ""} · ${displayNum} · ${j.phase}`,
        });
      }
    }

    // Search clients
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name, client_type")
      .ilike("name", `%${q}%`)
      .limit(5);

    for (const c of (clients || [])) {
      results.push({
        type: "client",
        id: c.id,
        href: `/clients/${c.id}`,
        title: c.name,
        subtitle: c.client_type || "Client",
      });
    }

    // Search decorators
    const { data: decorators } = await supabase
      .from("decorators")
      .select("id, name, short_code")
      .or(`name.ilike.%${q}%,short_code.ilike.%${q}%`)
      .limit(3);

    for (const d of (decorators || [])) {
      results.push({
        type: "decorator",
        id: d.id,
        href: `/decorators`,
        title: d.name,
        subtitle: d.short_code || "Decorator",
      });
    }

    // Search items
    const { data: items } = await supabase
      .from("items")
      .select("id, name, blank_vendor, blank_sku, job_id, jobs(title, clients(name))")
      .ilike("name", `%${q}%`)
      .limit(5);

    for (const it of (items || [])) {
      results.push({
        type: "item",
        id: it.id,
        href: `/jobs/${it.job_id}`,
        title: it.name,
        subtitle: `${(it.jobs as any)?.clients?.name || ""} · ${(it.jobs as any)?.title || ""} · ${[it.blank_vendor, it.blank_sku].filter(Boolean).join(" ")}`,
      });
    }

    setResults(results);
    setSelectedIdx(0);
    setLoading(false);
  }

  function navigate(result: Result) {
    router.push(result.href);
    setOpen(false);
    setQuery("");
    setResults([]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && results[selectedIdx]) { navigate(results[selectedIdx]); }
  }

  const typeIcon: Record<string, { label: string; color: string }> = {
    project: { label: "Project", color: T.accent },
    client: { label: "Client", color: T.green },
    item: { label: "Item", color: T.amber },
    decorator: { label: "Decorator", color: T.purple },
  };

  return (
    <>
      {/* Trigger button in sidebar */}
      <button onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "7px 12px", borderRadius: 6,
          background: T.surface, border: `1px solid ${T.border}`,
          color: T.faint, fontSize: 12, fontFamily: font,
          cursor: "pointer", textAlign: "left",
        }}>
        <Search size={14} />
        <span style={{ flex: 1 }}>Search...</span>
        <span style={{ fontSize: 9, fontFamily: mono, color: T.faint, background: T.card, padding: "1px 4px", borderRadius: 3 }}>⌘K</span>
      </button>

      {/* Modal overlay */}
      {open && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9998,
          background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)",
          display: "flex", alignItems: "flex-start", justifyContent: "center",
          paddingTop: "15vh",
        }}>
          <div ref={containerRef} style={{
            width: 520, maxWidth: "90vw",
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            fontFamily: font, overflow: "hidden",
          }}>
            {/* Input */}
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Search size={16} style={{ color: T.muted }} />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search projects, clients, items, decorators..."
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: T.text, fontSize: 14, fontFamily: font,
                }}
              />
              {query && (
                <button onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
                  style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 14 }}>✕</button>
              )}
            </div>

            {/* Results */}
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {loading && <div style={{ padding: "16px", textAlign: "center", fontSize: 12, color: T.muted }}>Searching...</div>}

              {!loading && query && results.length === 0 && (
                <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12, color: T.faint }}>No results for "{query}"</div>
              )}

              {results.map((r, i) => {
                const t = typeIcon[r.type];
                return (
                  <div key={r.type + r.id + i}
                    onClick={() => navigate(r)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 16px", cursor: "pointer",
                      background: i === selectedIdx ? T.surface : "transparent",
                      borderBottom: `1px solid ${T.border}`,
                    }}
                    onMouseEnter={() => setSelectedIdx(i)}>
                    <span style={{
                      fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                      background: t.color + "22", color: t.color,
                      textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0,
                    }}>{t.label}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                      <div style={{ fontSize: 10, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.subtitle}</div>
                    </div>
                    {i === selectedIdx && <span style={{ fontSize: 10, color: T.faint }}>↵</span>}
                  </div>
                );
              })}
            </div>

            {/* Footer hint */}
            {!query && (
              <div style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 12, justifyContent: "center" }}>
                {[["↑↓", "Navigate"], ["↵", "Open"], ["esc", "Close"]].map(([k, l]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 9, fontFamily: mono, background: T.surface, padding: "1px 4px", borderRadius: 3, color: T.muted }}>{k}</span>
                    <span style={{ fontSize: 10, color: T.faint }}>{l}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
