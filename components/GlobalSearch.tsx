"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { T, font, mono } from "@/lib/theme";
import { Search } from "lucide-react";
import { useIsMobile } from "@/lib/useIsMobile";

type Result = {
  type: "page" | "project" | "client" | "item" | "decorator";
  id: string;
  href: string;
  title: string;
  subtitle: string;
};

// Pages the current user may navigate to — passed in by AppShell (already
// v2-swapped, retired-filtered, and grant-scoped, so search never offers a
// page the sidebar wouldn't). group = the sidebar group title.
export type SearchPage = { href: string; label: string; group: string };

export function GlobalSearch({ compact = false, bar = false, pages = [] }: {
  compact?: boolean;
  bar?: boolean;          // full-width pill trigger (the mobile bottom bar)
  pages?: SearchPage[];
} = {}) {
  const supabase = createClient();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic counter — only the most recent search is allowed to write
  // results. Prevents stale in-flight responses from replacing the list
  // (and swallowing clicks) after the user has stopped typing.
  const searchSeq = useRef(0);

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
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) {
      searchSeq.current++; // invalidate any in-flight search
      setResults([]);
      setLoading(false);
      setSelectedIdx(0);
      return;
    }
    searchTimer.current = setTimeout(() => search(query.trim()), 200);
  }, [query]);

  // Page matches are synchronous — they appear the instant you type, ahead
  // of the async entity results. Navigation should never wait on the DB.
  const pageMatches: Result[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return pages
      .filter(p => p.label.toLowerCase().includes(q) || p.group.toLowerCase().includes(q))
      .slice(0, 6)
      .map(p => ({ type: "page" as const, id: p.href, href: p.href, title: p.label, subtitle: p.group }));
  }, [query, pages]);

  const combined: Result[] = useMemo(() => [...pageMatches, ...results], [pageMatches, results]);

  async function search(q: string) {
    const seq = ++searchSeq.current;
    setLoading(true);

    // All five lookups run in parallel — sequentially they took long
    // enough that late responses landed while the user was mid-click.
    const [jobsRes, jobsByClientRes, clientsRes, decoratorsRes, itemsRes] = await Promise.all([
      supabase
        .from("jobs")
        .select("id, title, job_number, type_meta, phase, clients(name)")
        .or(`title.ilike.%${q}%,job_number.ilike.%${q}%,type_meta->>qb_invoice_number.ilike.%${q}%`)
        .limit(5),
      supabase
        .from("jobs")
        .select("id, title, job_number, type_meta, phase, clients!inner(name)")
        .ilike("clients.name", `%${q}%`)
        .limit(5),
      supabase
        .from("clients")
        .select("id, name, client_type")
        .ilike("name", `%${q}%`)
        .limit(5),
      supabase
        .from("decorators")
        .select("id, name, short_code")
        .or(`name.ilike.%${q}%,short_code.ilike.%${q}%`)
        .limit(3),
      supabase
        .from("items")
        .select("id, name, blank_vendor, blank_sku, job_id, jobs(title, clients(name))")
        .ilike("name", `%${q}%`)
        .limit(5),
    ]);

    // A newer search (or a cleared query) superseded this one — drop it.
    if (seq !== searchSeq.current) return;

    const results: Result[] = [];

    // Jobs
    for (const j of (jobsRes.data || [])) {
      const displayNum = (j as any).type_meta?.qb_invoice_number || j.job_number;
      results.push({
        type: "project",
        id: j.id,
        href: `/jobs/${j.id}`,
        title: j.title,
        subtitle: `${(j.clients as any)?.name || ""} · ${displayNum} · ${j.phase}`,
      });
    }

    // Jobs matched by client name
    for (const j of (jobsByClientRes.data || [])) {
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

    // Clients
    for (const c of (clientsRes.data || [])) {
      results.push({
        type: "client",
        id: c.id,
        href: `/clients/${c.id}`,
        title: c.name,
        subtitle: c.client_type || "Client",
      });
    }

    // Decorators
    for (const d of (decoratorsRes.data || [])) {
      results.push({
        type: "decorator",
        id: d.id,
        href: `/decorators`,
        title: d.name,
        subtitle: d.short_code || "Decorator",
      });
    }

    // Items
    for (const it of (itemsRes.data || [])) {
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

  function navigate(href: string) {
    router.push(href);
    setOpen(false);
    setQuery("");
    setResults([]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, combined.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && combined[selectedIdx]) { navigate(combined[selectedIdx].href); }
  }

  const typeIcon: Record<string, { label: string; color: string }> = {
    page: { label: "Page", color: T.blue },
    project: { label: "Project", color: T.accent },
    client: { label: "Client", color: T.green },
    item: { label: "Item", color: T.amber },
    decorator: { label: "Decorator", color: T.purple },
  };

  // Empty-state quick nav — every granted page, grouped like the sidebar.
  // On mobile this IS the nav (the bottom bar replaced the icon rail).
  const navGroups = useMemo(() => {
    const by: Record<string, SearchPage[]> = {};
    for (const p of pages) (by[p.group] ||= []).push(p);
    return Object.entries(by);
  }, [pages]);

  const openSearch = () => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); };

  return (
    <>
      {/* Trigger — bar pill (mobile bottom bar), compact icon, or desktop field. */}
      {bar ? (
        <button onClick={openSearch}
          aria-label="Search and navigate"
          style={{
            width: "100%", minHeight: 48, display: "flex", alignItems: "center", gap: 10,
            padding: "0 16px", borderRadius: 999,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.muted, fontSize: 14, fontFamily: font, cursor: "pointer", textAlign: "left",
          }}>
          <Search size={17} />
          <span style={{ flex: 1 }}>Search or go to…</span>
        </button>
      ) : compact ? (
        <button onClick={openSearch}
          aria-label="Search"
          style={{
            width: 44, height: 44, borderRadius: 10,
            background: "transparent", border: "none",
            color: "rgba(255,255,255,0.8)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
          <Search size={20} />
        </button>
      ) : (
        <button onClick={openSearch}
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
      )}

      {/* Overlay — centered modal on desktop, full-screen sheet on mobile
          (input at top so the keyboard doesn't cover it). */}
      {open && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9998,
          background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)",
          display: "flex", alignItems: "flex-start", justifyContent: "center",
          paddingTop: isMobile ? 0 : "15vh",
        }}>
          <div ref={containerRef} style={isMobile ? {
            width: "100%", height: "100dvh",
            background: T.card, display: "flex", flexDirection: "column",
            fontFamily: font, overflow: "hidden",
          } : {
            width: 520, maxWidth: "90vw",
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            fontFamily: font, overflow: "hidden",
          }}>
            {/* Input */}
            <div style={{ padding: isMobile ? "14px 16px" : "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <Search size={16} style={{ color: T.muted, flexShrink: 0 }} />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={pages.length ? "Search, or go to a page…" : "Search projects, clients, items, decorators..."}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: T.text, fontSize: isMobile ? 16 : 14, fontFamily: font, minWidth: 0,
                }}
              />
              {query && (
                <button onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
                  style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 14, flexShrink: 0 }}>✕</button>
              )}
              {isMobile && (
                <button onClick={() => { setOpen(false); setQuery(""); setResults([]); }}
                  style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: font, padding: "8px 2px 8px 8px", flexShrink: 0 }}>
                  Cancel
                </button>
              )}
            </div>

            {/* Results / quick nav */}
            <div style={{ maxHeight: isMobile ? undefined : 400, flex: isMobile ? 1 : undefined, overflowY: "auto", minHeight: 0 }}>
              {/* Empty query → the full granted nav, grouped like the sidebar. */}
              {!query && navGroups.length > 0 && navGroups.map(([group, items]) => (
                <div key={group}>
                  <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.faint, padding: "12px 16px 4px" }}>{group}</div>
                  {items.map(p => (
                    <div key={p.href}
                      onMouseDown={e => { if (e.button === 0) { e.preventDefault(); navigate(p.href); } }}
                      style={{ padding: isMobile ? "12px 16px" : "8px 16px", fontSize: isMobile ? 14 : 13, fontWeight: 600, color: T.text, cursor: "pointer" }}>
                      {p.label}
                    </div>
                  ))}
                </div>
              ))}

              {/* Only show the banner when there are no rows yet — if it
                  rendered above existing results, toggling it would shift
                  the rows under the user's cursor mid-click. */}
              {loading && combined.length === 0 && <div style={{ padding: "16px", textAlign: "center", fontSize: 12, color: T.muted }}>Searching...</div>}

              {!loading && query && combined.length === 0 && (
                <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12, color: T.faint }}>No results for "{query}"</div>
              )}

              {combined.map((r, i) => {
                const t = typeIcon[r.type];
                return (
                  <div key={r.type + r.id + i}
                    // Commit on mousedown (not click) so a results
                    // re-render between mousedown and mouseup can't
                    // swallow the selection.
                    onMouseDown={e => { if (e.button === 0) { e.preventDefault(); navigate(r.href); } }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: isMobile ? "12px 16px" : "10px 16px", cursor: "pointer",
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
                    {!isMobile && i === selectedIdx && <span style={{ fontSize: 10, color: T.faint }}>↵</span>}
                  </div>
                );
              })}
            </div>

            {/* Footer hint — desktop only */}
            {!isMobile && !query && (
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
