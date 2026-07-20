// Public art gallery for an outside graphic artist to review + download a
// job's artwork (no login, no raw Drive link). Reached via the tokenized link
// emailed from /api/art-request. Downloads proxy through /api/files/thumbnail
// (service account), so the Drive folder is never exposed. Read-only — the
// designer replies with pricing by email (email-back v1).
import { createClient } from "@supabase/supabase-js";
import ArtRequestResponseForm from "@/components/ArtRequestResponseForm";

export const dynamic = "force-dynamic";

// Document theme — matches the invoice/quote/portal aesthetic.
const C = {
  bg: "#f8f8f9", card: "#ffffff", surface: "#f3f3f5", border: "#e0e0e4",
  text: "#1a1a1a", muted: "#6b6b78", faint: "#a0a0ad", accent: "#1a1a1a",
  font: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  mono: "'SF Mono', 'IBM Plex Mono', Menlo, monospace",
};

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function NotFound() {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", color: C.muted }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>Link not found</div>
        <div style={{ fontSize: 14 }}>This art request link is invalid or has been removed.</div>
      </div>
    </div>
  );
}

export default async function ArtRequestGallery({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sb = admin();

  const { data: reqRow } = await sb
    .from("art_requests")
    .select("id, job_id, designer_name, message, file_ids, quoted_items, quoted_note, responded_at")
    .eq("token", token)
    .single();
  if (!reqRow) return <NotFound />;

  const { data: job } = await sb
    .from("jobs")
    .select("id, title, job_number, clients(name), companies:company_id(name)")
    .eq("id", (reqRow as any).job_id)
    .single();

  // ONLY the files this request explicitly shared — never the whole folder.
  const sharedIds: string[] = (reqRow as any).file_ids || [];
  const { data: files } = sharedIds.length
    ? await sb
        .from("item_files")
        .select("id, item_id, drive_file_id, file_name, stage, created_at")
        .in("id", sharedIds)
        .order("created_at", { ascending: true })
    : { data: [] as any[] };
  const usable = (files || []).filter((f: any) => f.drive_file_id);

  // Item names for grouping (only the items that own a shared file).
  const usableItemIds = Array.from(new Set(usable.map((f: any) => f.item_id)));
  const { data: items } = usableItemIds.length
    ? await sb
        .from("items")
        .select("id, name, sort_order")
        .in("id", usableItemIds)
        .order("sort_order", { ascending: true })
    : { data: [] as any[] };

  const byItem: Record<string, any[]> = {};
  usable.forEach((f: any) => { (byItem[f.item_id] ||= []).push(f); });

  const tenantName = (job as any)?.companies?.name || "House Party Distro";
  const clientName = (job as any)?.clients?.name || "";
  const jobLabel = (job as any)?.title || (job as any)?.job_number || "Project";
  const totalFiles = usable.length;

  const stageLabel = (s: string) =>
    ({ client_art: "Client art", vector: "Vector", mockup: "Mockup", proof: "Proof", print_ready: "Print-ready" } as any)[s] || (s || "File");

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 20px 80px" }}>
        {/* Header */}
        <div style={{ marginBottom: 6, fontSize: 11, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.1em" }}>{tenantName}</div>
        <h1 style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>Art files for pricing</h1>
        <div style={{ fontSize: 15, color: C.muted, marginBottom: 20 }}>
          {jobLabel}{clientName ? ` · ${clientName}` : ""}
        </div>

        {/* Request note */}
        {(reqRow as any).message && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px", marginBottom: 22, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {(reqRow as any).message}
          </div>
        )}
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 26 }}>
          {totalFiles === 0
            ? "No art files are attached to this project yet."
            : <>Review the files below, then send your <strong style={{ color: C.text }}>price</strong> and <strong style={{ color: C.text }}>screen count</strong> using the form at the bottom.</>}
        </div>

        {/* Files grouped by item */}
        {(items || []).map((it: any) => {
          const fs = byItem[it.id] || [];
          if (!fs.length) return null;
          return (
            <div key={it.id} style={{ marginBottom: 30 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 12, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
                {it.name || "Item"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
                {fs.map((f: any) => (
                  <div key={f.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <div style={{ aspectRatio: "1 / 1", background: C.surface, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/art-request/${token}/file/${f.id}?thumb=1&size=600`}
                        alt={f.file_name || ""}
                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                      />
                    </div>
                    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                      <div style={{ fontSize: 11.5, color: C.muted, wordBreak: "break-word", lineHeight: 1.35, flex: 1 }}>
                        <span style={{ fontWeight: 700, color: C.faint, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.06em", display: "block", marginBottom: 2 }}>{stageLabel(f.stage)}</span>
                        {f.file_name || "File"}
                      </div>
                      <a
                        href={`/api/art-request/${token}/file/${f.id}?dl=1`}
                        download
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 34, borderRadius: 8, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 700, textDecoration: "none" }}
                      >
                        Download
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Designer response — per-item price + screen count, submitted at once. */}
        {totalFiles > 0 && (
          <div style={{ marginTop: 34 }}>
            <ArtRequestResponseForm
              token={token}
              items={(items || []).map((it: any) => ({ id: it.id, name: it.name }))}
              initial={(reqRow as any).responded_at ? {
                items: (reqRow as any).quoted_items || [],
                note: (reqRow as any).quoted_note,
              } : null}
            />
          </div>
        )}

        <div style={{ marginTop: 40, fontSize: 11, color: C.faint, textAlign: "center" }}>
          Shared securely by {tenantName}. Files are private to this project.
        </div>
      </div>
    </div>
  );
}
