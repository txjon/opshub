/**
 * Upload a file directly from the browser to Google Drive.
 *
 * Flow:
 * 1. Get token + folder ID from server (tiny JSON)
 * 2. Upload file directly to Google Drive (browser → Google, bypasses Vercel)
 * 3. Set file permissions (public link)
 * 4. Return file ID + link
 */
export async function uploadToDrive({ blob, fileName, mimeType, clientName, projectTitle, itemName }) {
  // Step 1: Get token + folder from server
  const tokenRes = await fetch("/api/drive/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientName, projectTitle, itemName }),
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({ error: "Failed to get token" }));
    throw new Error(err.error);
  }
  const { token, folderId } = await tokenRes.json();

  // Step 2: Upload file directly to Google Drive (multipart)
  const boundary = "opshub_boundary_" + Date.now();
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });

  // Build multipart body
  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`;
  const filePart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;

  const metaBytes = new TextEncoder().encode(metadataPart + filePart);
  const closeBytes = new TextEncoder().encode(closing);
  const fileBytes = new Uint8Array(await blob.arrayBuffer());

  // Combine into single body
  const body = new Uint8Array(metaBytes.length + fileBytes.length + closeBytes.length);
  body.set(metaBytes, 0);
  body.set(fileBytes, metaBytes.length);
  body.set(closeBytes, metaBytes.length + fileBytes.length);

  const uploadRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: body,
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({ error: { message: "Upload failed" } }));
    throw new Error(err.error?.message || "Drive upload failed");
  }
  const driveFile = await uploadRes.json();

  // Step 3: Set permissions (anyone with link can view)
  await fetch(`https://www.googleapis.com/drive/v3/files/${driveFile.id}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  // Get webViewLink if not returned
  let webViewLink = driveFile.webViewLink;
  if (!webViewLink) {
    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFile.id}?fields=webViewLink`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meta = await metaRes.json();
    webViewLink = meta.webViewLink;
  }

  return {
    fileId: driveFile.id,
    webViewLink: webViewLink || `https://drive.google.com/file/d/${driveFile.id}/view`,
    folderLink: `https://drive.google.com/drive/folders/${folderId}`,
    fileName,
    mimeType,
    fileSize: blob.size,
  };
}

/**
 * Register an uploaded file in the database.
 */
export async function registerFileInDb({ fileId, webViewLink, folderLink, fileName, mimeType, fileSize, itemId, stage }) {
  const res = await fetch("/api/drive/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, webViewLink, folderLink, fileName, mimeType, fileSize, itemId, stage }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to register file" }));
    throw new Error(err.error);
  }
  return res.json();
}
