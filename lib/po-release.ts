// Client-safe half of lib/production-files: types, stage constants and the PO
// release / drift logic. NO server imports (the job page renders this in the
// browser; lib/production-files itself pulls the Drive client). Server code
// imports from lib/production-files, which re-exports everything here.

export const PRODUCTION_STAGES = ["print_ready", "proof", "mockup"] as const;
export type ProductionStage = typeof PRODUCTION_STAGES[number];

export const STAGE_LABEL: Record<ProductionStage, string> = {
  print_ready: "Print file",
  proof: "Proof",
  mockup: "Mockup",
};

export type ProductionFile = {
  id: string;             // item_files.id
  itemId: string;
  name: string;
  stage: ProductionStage;
  driveFileId: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string;      // ISO
  viewUrl: string;        // inline (browser-renderable types) — served through the app
  downloadUrl: string;    // attachment — the real bytes, streamed through the app
  thumbUrl: string;       // Drive's pre-rendered thumbnail through the app
};

// ── PO releases ──────────────────────────────────────────────────────────────
// type_meta.po_releases[vendor] = the exact files the printer was handed.

export type PoReleaseFile = { item_file_id: string; item_id: string; drive_file_id: string; file_name: string; stage: ProductionStage };
export type PoRelease = { version: number; sent_at: string; files: PoReleaseFile[] };

export function releaseFor(typeMeta: any, vendor: string | null | undefined): PoRelease | null {
  if (!vendor) return null;
  const rel = typeMeta?.po_releases || {};
  const key = Object.keys(rel).find(k => k.toLowerCase().trim() === vendor.toLowerCase().trim());
  return key ? (rel[key] as PoRelease) : null;
}

export function buildRelease(prev: PoRelease | null, filesByItem: Record<string, ProductionFile[]>, itemIds: string[]): PoRelease {
  const files: PoReleaseFile[] = [];
  for (const id of itemIds) for (const f of (filesByItem[id] || [])) {
    files.push({ item_file_id: f.id, item_id: f.itemId, drive_file_id: f.driveFileId, file_name: f.name, stage: f.stage });
  }
  return { version: (prev?.version || 0) + 1, sent_at: new Date().toISOString(), files };
}

// Per-item drift between what's live now and what the release froze.
//   added   = live files the printer was never sent (uploaded after the PO)
//   removed = release files no longer active (replaced or deleted)
// No release (PO predates this feature, or never sent) → no drift, but
// `afterPo` still flags files uploaded after the recorded PO send date so
// legacy jobs get the cheap version of the warning.
export type ItemDrift = { added: ProductionFile[]; removed: PoReleaseFile[]; afterPo: ProductionFile[]; changed: boolean };

export function itemDrift(itemId: string, live: ProductionFile[], release: PoRelease | null, poSentDate?: string | null): ItemDrift {
  const liveList = live || [];
  if (release) {
    const sent = new Set(release.files.filter(f => f.item_id === itemId).map(f => f.item_file_id));
    const liveIds = new Set(liveList.map(f => f.id));
    const added = liveList.filter(f => !sent.has(f.id));
    const removed = release.files.filter(f => f.item_id === itemId && !liveIds.has(f.item_file_id));
    return { added, removed, afterPo: added, changed: added.length > 0 || removed.length > 0 };
  }
  // Legacy: po_sent_dates is a DATE. Only flag files from a LATER day — a
  // same-day upload-then-send (the normal order of work) must not cry wolf.
  if (!poSentDate) return { added: [], removed: [], afterPo: [], changed: false };
  const cutoff = poSentDate.slice(0, 10);
  const afterPo = liveList.filter(f => (f.createdAt || "").slice(0, 10) > cutoff);
  return { added: [], removed: [], afterPo, changed: afterPo.length > 0 };
}
