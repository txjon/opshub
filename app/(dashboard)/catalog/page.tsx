"use client";

// CLIENT CATALOG — a client's products, produced pieces and art archive, and
// nothing else (Oct 2026: a creative needs the art without the client page's
// balances, orders and contacts). View + download: the same CatalogRail /
// ArchiveRail the client page renders (components/client/ClientCatalog), in
// readOnly. Loads only what those two sections read — no payments, costing,
// contacts or invoices ever reach this page.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { H, HUB_PAGE } from "@/components/hub/theme";
import { CatalogRail, ArchiveRail, buildCatalogPieces, CLIENT_CARD_CSS } from "@/components/client/ClientCatalog";

const JOB_SELECT = "id, job_number, phase, qb_invoice_number, items(id, name, created_at, blank_sku, blank_vendor, garment_type, drive_link, pipeline_stage, buy_sheet_lines(size, qty_ordered))";

const secHead = (title: string, hint: string) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 12, margin: "34px 0 14px", flexWrap: "wrap" }}>
    <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{title}</h2>
    <span style={{ fontSize: 10.5, color: H.faint }}>{hint}</span>
  </div>
);

export default function CatalogPage() {
  return <Suspense fallback={null}><Catalog /></Suspense>;
}

function Catalog() {
  const router = useRouter();
  const params = useSearchParams();
  const clientId = params?.get("client") || null;
  const supabase = useMemo(() => createClient(), []);

  // ── client picker ──
  const [clients, setClients] = useState<{ id: string; name: string }[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    supabase.from("clients").select("id, name").order("name").range(0, 1999)
      .then(({ data }) => setClients(((data || []) as any[]).filter(c => (c.name || "").trim())));
  }, [supabase]);

  // ── one client's catalog ──
  const [section, setSection] = useState<"Catalog" | "Archive">("Catalog");
  const [products, setProducts] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [archive, setArchive] = useState<any[]>([]);
  const [briefs, setBriefs] = useState<any[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);   // which client the shown data belongs to
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let live = true;
    setLoadedFor(null); setErr(null); setProducts([]); setJobs([]); setArchive([]); setBriefs([]); setThumbs({});
    (async () => {
      try {
        const [{ data: prods, error: pErr }, { data: js, error: jErr }] = await Promise.all([
          supabase.from("products").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
          supabase.from("jobs").select(JOB_SELECT).eq("client_id", clientId).order("created_at", { ascending: false }),
        ]);
        if (pErr || jErr) throw new Error((pErr || jErr)!.message);
        // paged — archives beat the 1000-row cap (supdef: 1,565)
        const arc: any[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.from("legacy_art_files").select("id, drive_file_id, file_name, mime_type, folder_path").eq("client_id", clientId).order("folder_path").range(from, from + 999);
          if (error) throw new Error(error.message);
          arc.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
        if (!live) return;
        setProducts(prods || []); setJobs(js || []); setArchive(arc);
        try {
          const b = await (await fetch("/api/art-briefs")).json();
          if (live) setBriefs((b.briefs || []).filter((x: any) => x.client_id === clientId && !x.client_aborted_at));
        } catch {}
        // thumbnails: mockup > proof, newest, non-superseded (hub parity)
        const ids = ((js || []) as any[]).flatMap(j => (j.items || []).map((i: any) => i.id));
        const th: Record<string, string> = {};
        for (let i = 0; i < ids.length; i += 150) {
          const { data: files } = await supabase.from("item_files")
            .select("item_id, stage, drive_file_id, created_at").in("stage", ["mockup", "proof"]).is("superseded_at", null)
            .not("drive_file_id", "is", null).in("item_id", ids.slice(i, i + 150))
            .order("created_at", { ascending: false });
          for (const f of (files || []) as any[]) if (!th[f.item_id] && f.stage === "mockup") th[f.item_id] = f.drive_file_id;
          for (const f of (files || []) as any[]) if (!th[f.item_id]) th[f.item_id] = f.drive_file_id;
        }
        if (live) setThumbs(th);
      } catch (e: any) {
        if (live) setErr(e?.message || "Couldn't load this catalog");
      } finally {
        if (live) setLoadedFor(clientId);
      }
    })();
    return () => { live = false; };
  }, [clientId, supabase]);

  const model = useMemo(() => ({ pieces: buildCatalogPieces(jobs) }), [jobs]);
  const client = (clients || []).find(c => c.id === clientId) || null;
  const shown = (clients || []).filter(c => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const pill = (on: boolean): React.CSSProperties => ({ borderRadius: 999, border: `1px solid ${on ? "#fff" : H.line}`, background: on ? "#fff" : "transparent", color: on ? H.ink : H.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", padding: "8px 15px", cursor: "pointer", fontFamily: H.font });

  return (
    <div style={HUB_PAGE}>
      <style dangerouslySetInnerHTML={{ __html: CLIENT_CARD_CSS }} />
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "26px 0 90px" }}>
        {!clientId ? (
          <>
            <h1 style={{ fontSize: "clamp(34px,5vw,64px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: 0 }}>Client catalog</h1>
            <div style={{ fontSize: 13, color: H.dim, marginTop: 10 }}>Pick a client to see their products, everything produced, and their art archive.</div>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients" autoFocus
              style={{ marginTop: 22, width: "100%", maxWidth: 420, padding: "11px 14px", borderRadius: 10, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 16, fontFamily: H.font, outline: "none" }} />
            {clients === null ? (
              <div style={{ color: H.faint, fontSize: 13, marginTop: 24 }}>Loading clients…</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8, marginTop: 18 }}>
                {shown.map(c => (
                  <button key={c.id} onClick={() => { setSection("Catalog"); router.push(`/catalog?client=${c.id}`); }} className="cs-card"
                    style={{ padding: "14px 16px", fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.02em" }}>
                    {c.name}
                  </button>
                ))}
                {shown.length === 0 && <div style={{ color: H.faint, fontSize: 13 }}>No client matches “{q}”.</div>}
              </div>
            )}
          </>
        ) : (
          <>
            <button onClick={() => router.push("/catalog")} style={{ background: "none", border: 0, color: H.dim, fontSize: 11, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", padding: 0, fontFamily: H.font }}>← All clients</button>
            <h1 style={{ fontSize: "clamp(34px,5vw,64px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "10px 0 0" }}>{client?.name || "Client"}</h1>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "18px 0 0" }}>
              {(["Catalog", "Archive"] as const).map(s => (
                <button key={s} onClick={() => setSection(s)} style={pill(section === s)}>
                  {s}{s === "Catalog" ? ` · ${products.length + model.pieces.length}` : ` · ${archive.length.toLocaleString()}`}
                </button>
              ))}
            </div>
            {err ? (
              <div style={{ color: H.red, fontSize: 13, marginTop: 24 }}>{err}. Nothing was changed; reload to try again.</div>
            ) : loadedFor !== clientId ? (
              <div style={{ color: H.faint, fontSize: 13, marginTop: 24 }}>Loading the catalog…</div>
            ) : section === "Catalog" ? (
              <CatalogRail products={products} briefs={briefs} model={model} router={router} secHead={secHead} thumbs={thumbs} clientId={clientId} readOnly />
            ) : (
              <ArchiveRail archive={archive} briefs={briefs} clientId={clientId} secHead={secHead} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
