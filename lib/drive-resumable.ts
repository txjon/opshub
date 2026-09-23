import { getDriveToken, getOrCreateNestedFolder } from "@/lib/drive-token";

// Shared helpers for Drive's resumable upload flow. The server mints an
// upload session URL + folder; the client PUTs the file bytes directly to
// Drive, bypassing Vercel's function body limit entirely. After success,
// the client POSTs the drive_file_id back to register metadata in DB.

export async function createResumableUploadSession({
  folderSegments,
  folderId: givenFolderId,
  fileName,
  mimeType,
}: {
  folderSegments?: string[];   // nested path under the tenant root, or…
  folderId?: string;           // …an already-resolved folder (e.g. an item's stashed folder)
  fileName: string;
  mimeType: string;
}): Promise<{ uploadUrl: string; folderId: string }> {
  const token = await getDriveToken();
  const folderId = givenFolderId || await getOrCreateNestedFolder(token, folderSegments || []);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType || "application/octet-stream",
      },
      body: JSON.stringify({
        name: fileName,
        parents: [folderId],
      }),
    }
  );

  const uploadUrl = res.headers.get("location");
  if (!uploadUrl) {
    const errText = await res.text().catch(() => "unknown");
    throw new Error(`Drive resumable session failed: ${res.status} ${errText}`);
  }
  return { uploadUrl, folderId };
}

/** Kept as a no-op: the archive is private and served through OpsHub. Making a
 *  single file world-readable would quietly punch a hole in it. */
export async function setFilePublicReadable(_fileId: string): Promise<void> {
  return;
}

export async function getDriveWebLink(fileId: string): Promise<string | null> {
  const token = await getDriveToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.webViewLink || null;
}

// A brief upload names a Drive id the server never saw. Before registering it
// (or granting read access), prove the file really sits in one of THIS brief's
// own folders. Without it, a designer or client token could register, expose
// and later delete any file in the account (Phase 0, Sep 2026).
//
// Uses the SAME resolver the upload session used (tenant root, sanitized
// segment names, case/whitespace-folded match). A hand-rolled exact-name
// lookup refused real uploads: a brief titled "13/FRWD" is stored as
// "13-FRWD", and the IHM tenant has its own root.
export async function verifyBriefUpload(db: any, briefId: string, driveFileId: string): Promise<boolean> {
  try {
    if (!driveFileId) return false;
    const { data: brief } = await db.from("art_briefs")
      .select("id, title, clients:client_id(name)").eq("id", briefId).maybeSingle();
    if (!brief) return false;
    const clientName = (brief as any).clients?.name || "Unassigned";
    const title = (brief as any).title || briefId;
    const token = await getDriveToken();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?fields=parents`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return false;
    const meta = await res.json().catch(() => null);
    const parents: string[] = Array.isArray(meta?.parents) ? meta.parents : [];
    if (!parents.length) return false;
    // Both brief folder layouts: the upload-session path ("Art Studio / client
    // / brief") and the staff studio path ("client / Studio / brief").
    const allowed = await Promise.all([
      getOrCreateNestedFolder(token, ["Art Studio", clientName, title]),
      getOrCreateNestedFolder(token, [clientName, "Studio", title]),
    ]);
    return allowed.some(id => id && parents.includes(id));
  } catch { return false; }
}
