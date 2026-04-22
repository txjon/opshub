import { getDriveToken, getReceivingFolderId } from "@/lib/drive-token";

// Shared helpers for Drive's resumable upload flow. The server mints an
// upload session URL + folder; the client PUTs the file bytes directly to
// Drive, bypassing Vercel's function body limit entirely. After success,
// the client POSTs the drive_file_id back to register metadata in DB.

export async function createResumableUploadSession({
  folderPath,
  fileName,
  mimeType,
}: {
  folderPath: string;
  fileName: string;
  mimeType: string;
}): Promise<{ uploadUrl: string; folderId: string }> {
  const token = await getDriveToken();
  const folderId = await getReceivingFolderId(token, folderPath);

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

export async function setFilePublicReadable(fileId: string): Promise<void> {
  const token = await getDriveToken();
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
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
