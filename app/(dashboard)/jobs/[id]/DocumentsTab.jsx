"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { DriveThumb } from "@/components/DriveThumb";

const STAGE_ORDER = ["client_art", "vector", "mockup", "proof", "print_ready"];
const STAGE_LABELS = {
  client_art: "Client art",
  vector: "Vector",
  mockup: "Mockup",
  proof: "Proof",
  print_ready: "Print-ready",
  packing_slip: "Packing slip",
};
const STAGE_COLORS = {
  client_art: T.muted,
  vector: T.accent,
  mockup: T.amber,
  proof: T.purple,
  print_ready: T.green,
  packing_slip: T.blue,
};

/**
 * Consolidated archive view — all project PDFs + all per-item Drive files
 * in one place. Works on any phase (including complete/cancelled).
 *
 * Project-level PDFs are resolved by URL against /api/pdf/* routes.
 * Per-item files come from item_files (Drive-backed).
 */
export function DocumentsTab({ job, items }) {
  const supabase = createClient();
  const [filesByItem, setFilesByItem] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ids = (items || []).map(it => it.id).filter(id => typeof id === "string" && id.length > 20);
    if (ids.length === 0) { setLoading(false); return; }
    supabase.from("item_files")
      .select("id, item_id, stage, file_name, drive_file_id, drive_link, mime_type, approval, created_at")
      .in("item_id", ids)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        const grouped = {};
        for (const f of (data || [])) {
          if (!grouped[f.item_id]) grouped[f.item_id] = {};
          if (!grouped[f.item_id][f.stage]) grouped[f.item_id][f.stage] = [];
          grouped[f.item_id][f.stage].push(f);
        }
        setFilesByItem(grouped);
        setLoading(false);
      });
  }, [items?.map(it => it.id).join(",")]);

  const vendors = [...new Set(((job.costing_data?.costProds) || []).map(p => p.printVendor).filter(Boolean))];
  const qbInvoiceNumber = job.type_meta?.qb_invoice_number;
  const hasAnyShipTracking = items.some(it => it.ship_tracking || it.received_at_hpd || it.pipeline_stage === "shipped");
  const hasAnyItems = items.length > 0;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 }}>

      {/* ── Project PDFs ── */}
      <section>
        <SectionHeader label="Project documents" />
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
          <DocRow
            label="Quote"
            previewHref={`/api/pdf/quote/${job.id}`}
            downloadHref={`/api/pdf/quote/${job.id}?download=1`}
            available={hasAnyItems}
            unavailableNote={!hasAnyItems ? "Add items first" : null}
          />
          <DocRow
            label={qbInvoiceNumber ? `Invoice #${qbInvoiceNumber}` : "Invoice"}
            previewHref={`/api/pdf/invoice/${job.id}`}
            downloadHref={`/api/pdf/invoice/${job.id}?download=1`}
            available={hasAnyItems}
            unavailableNote={!hasAnyItems ? "Add items first" : null}
          />
          <DocRow
            label="Invoice + Proofs"
            previewHref={`/api/pdf/invoice-proofs/${job.id}`}
            downloadHref={`/api/pdf/invoice-proofs/${job.id}?download=1`}
            available={hasAnyItems}
          />
          <DocRow
            label="Packing Slip"
            previewHref={`/api/pdf/packing-slip/${job.id}`}
            downloadHref={`/api/pdf/packing-slip/${job.id}?download=1`}
            available={hasAnyShipTracking}
            unavailableNote={!hasAnyShipTracking ? "Available after items ship" : null}
          />
          {vendors.length === 0 && (
            <DocRow label="Purchase Order" available={false} unavailableNote="No vendor assigned in Costing yet" />
          )}
          {vendors.map(v => (
            <DocRow
              key={v}
              label={`PO — ${v}`}
              previewHref={`/api/pdf/po/${job.id}?vendor=${encodeURIComponent(v)}`}
              downloadHref={`/api/pdf/po/${job.id}?download=1&vendor=${encodeURIComponent(v)}`}
              available={hasAnyItems}
            />
          ))}
        </div>
      </section>

      {/* ── Per-item files ── */}
      <section>
        <SectionHeader label="Item files" />
        {loading && <div style={{ padding: 14, color: T.muted, fontSize: 12 }}>Loading files…</div>}
        {!loading && items.length === 0 && (
          <div style={{ padding: 14, color: T.muted, fontSize: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
            No items on this project.
          </div>
        )}
        {!loading && items.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((item, i) => (
              <ItemFileGroup key={item.id} item={item} idx={i} filesByStage={filesByItem[item.id] || {}} />
            ))}
          </div>
        )}
      </section>

    </div>
  );
}

function SectionHeader({ label }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
      {label}
    </div>
  );
}

function DocRow({ label, previewHref, downloadHref, available, unavailableNote }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
      borderBottom: `1px solid ${T.border}`, opacity: available ? 1 : 0.5,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, letterSpacing: "-0.01em" }}>{label}</div>
        {unavailableNote && <div style={{ fontSize: 10, color: T.faint, marginTop: 2 }}>{unavailableNote}</div>}
      </div>
      {available && previewHref && (
        <button
          onClick={() => window.open(previewHref, "_blank")}
          style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}
          onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.accent; }}
          onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}
        >Preview</button>
      )}
      {available && downloadHref && (
        <a
          href={downloadHref}
          target="_blank"
          rel="noopener noreferrer"
          style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: T.accent, color: "#fff", fontSize: 11, fontWeight: 600, textDecoration: "none", fontFamily: font }}
        >Download</a>
      )}
    </div>
  );
}

function ItemFileGroup({ item, idx, filesByStage }) {
  const letter = String.fromCharCode(65 + idx);
  // Flatten all files across stages into one grid, preserving stage order so
  // mockups come first, proofs next, etc. Stage lives as a badge on each card.
  const allFiles = STAGE_ORDER.flatMap(s => (filesByStage[s] || []).map(f => ({ ...f, _stage: s })));
  const totalFiles = allFiles.length;

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
      {/* Item header */}
      <div style={{ padding: "10px 14px", borderBottom: totalFiles > 0 ? `1px solid ${T.border}` : "none", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 22, height: 22, borderRadius: 5, background: T.accentDim, color: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, fontFamily: mono, flexShrink: 0 }}>{letter}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name || `Item ${idx + 1}`}</div>
          {(item.blank_vendor || item.color) && (
            <div style={{ fontSize: 10, color: T.muted, marginTop: 1 }}>
              {item.blank_vendor}{item.color ? ` · ${item.color}` : ""}
            </div>
          )}
        </div>
        <span style={{ fontSize: 10, color: T.faint }}>{totalFiles} file{totalFiles !== 1 ? "s" : ""}</span>
      </div>

      {totalFiles === 0 ? (
        <div style={{ padding: 14, fontSize: 11, color: T.faint }}>No files yet.</div>
      ) : (
        <div style={{
          padding: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 12,
        }}>
          {allFiles.map(f => (
            <FileCard key={f.id} file={f} itemName={item.name || ""} stage={f._stage} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileCard({ file, itemName, stage }) {
  const isImage = file.mime_type?.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp)$/i.test(file.file_name || "");
  const approval = file.approval;
  const approvalColor = approval === "approved" ? T.green : approval === "revision_requested" ? T.red : approval === "pending" ? T.amber : null;
  const stageColor = STAGE_COLORS[stage] || T.muted;
  const stageLabel = STAGE_LABELS[stage] || stage;
  const ext = (file.file_name || "").split(".").pop()?.toUpperCase() || "FILE";

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column", background: T.card }}>
      <div style={{ position: "relative", background: T.surface }}>
        {isImage ? (
          <DriveThumb
            driveFileId={file.drive_file_id}
            enlargeable
            title={`${itemName} — ${stageLabel}`}
            driveLink={file.drive_link || null}
            style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "contain", display: "block" }}
            fallback={
              <div style={{ width: "100%", aspectRatio: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center", color: T.faint, fontSize: 10 }}>
                No preview
              </div>
            }
          />
        ) : (
          <div style={{ width: "100%", aspectRatio: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center", color: T.faint, fontSize: 11, fontFamily: mono, fontWeight: 700, letterSpacing: "0.08em" }}>
            {ext}
          </div>
        )}
        {/* Stage badge — pinned top-left over thumbnail */}
        <span style={{
          position: "absolute", top: 6, left: 6,
          background: stageColor, color: "#fff",
          padding: "2px 7px", borderRadius: 4,
          fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
          fontFamily: font,
        }}>{stageLabel}</span>
      </div>
      <div style={{ padding: "8px 10px", fontSize: 10, display: "flex", flexDirection: "column", gap: 4, borderTop: `1px solid ${T.border}` }}>
        <div style={{ fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.file_name}>
          {file.file_name || "Untitled"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {approvalColor && (
            <span style={{ fontSize: 8, fontWeight: 700, color: approvalColor, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {approval.replace(/_/g, " ")}
            </span>
          )}
          {file.drive_link && (
            <a
              href={file.drive_link}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 9, color: T.accent, textDecoration: "none", marginLeft: "auto" }}
            >Drive ↗</a>
          )}
        </div>
      </div>
    </div>
  );
}
