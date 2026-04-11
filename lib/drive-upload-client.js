/**
 * Upload a file directly from the browser to Google Drive.
 *
 * Flow:
 * 1. Get token + folder ID from server (tiny JSON)
 * 2. Upload file directly to Google Drive (browser → Google, bypasses Vercel)
 * 3. Set file permissions (public link)
 * 4. Return file ID + link
 */
export async function uploadToDrive({ blob, fileName, mimeType, clientName, projectTitle, itemName, onProgress }) {
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

  // Upload with progress tracking via XMLHttpRequest
  const driveFile = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", `multipart/related; boundary=${boundary}`);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try { const err = JSON.parse(xhr.responseText); reject(new Error(err.error?.message || "Drive upload failed")); }
        catch { reject(new Error("Drive upload failed")); }
      }
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(body);
  });

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
 * Upload a file to the Receiving folder in Google Drive.
 * Folder structure: OpsHub Files / Receiving / {shipmentLabel}
 */
export async function uploadToReceiving({ blob, fileName, mimeType, shipmentLabel }) {
  const tokenRes = await fetch("/api/drive/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ receiving: true, shipmentLabel }),
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({ error: "Failed to get token" }));
    throw new Error(err.error);
  }
  const { token, folderId } = await tokenRes.json();

  const boundary = "opshub_boundary_" + Date.now();
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`;
  const filePart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;
  const metaBytes = new TextEncoder().encode(metadataPart + filePart);
  const closeBytes = new TextEncoder().encode(closing);
  const fileBytes = new Uint8Array(await blob.arrayBuffer());
  const body = new Uint8Array(metaBytes.length + fileBytes.length + closeBytes.length);
  body.set(metaBytes, 0);
  body.set(fileBytes, metaBytes.length);
  body.set(closeBytes, metaBytes.length + fileBytes.length);

  const uploadRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!uploadRes.ok) throw new Error("Drive upload failed");
  const driveFile = await uploadRes.json();

  await fetch(`https://www.googleapis.com/drive/v3/files/${driveFile.id}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

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
 * Upload a packing slip to the Packing Slips folder in Google Drive.
 * Folder structure: OpsHub Files / {Client Name} / {Project Title} / Packing Slips /
 */
export async function uploadPackingSlip({ blob, fileName, mimeType, clientName, projectTitle, onProgress }) {
  const tokenRes = await fetch("/api/drive/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packingSlip: true, clientName, projectTitle }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    let msg = `Token error ${tokenRes.status}`;
    try { msg = JSON.parse(text).error || msg; } catch { msg = text.slice(0, 200) || msg; }
    throw new Error(msg);
  }
  const { token, folderId } = await tokenRes.json();

  const boundary = "opshub_boundary_" + Date.now();
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`;
  const filePart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;
  const metaBytes = new TextEncoder().encode(metadataPart + filePart);
  const closeBytes = new TextEncoder().encode(closing);
  const fileBytes = new Uint8Array(await blob.arrayBuffer());
  const body = new Uint8Array(metaBytes.length + fileBytes.length + closeBytes.length);
  body.set(metaBytes, 0);
  body.set(fileBytes, metaBytes.length);
  body.set(closeBytes, metaBytes.length + fileBytes.length);

  const driveFile = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", `multipart/related; boundary=${boundary}`);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(new Error("Drive upload failed"));
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(body);
  });

  await fetch(`https://www.googleapis.com/drive/v3/files/${driveFile.id}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

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
export async function registerFileInDb({ fileId, webViewLink, folderLink, fileName, mimeType, fileSize, itemId, stage, notes }) {
  const res = await fetch("/api/drive/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, webViewLink, folderLink, fileName, mimeType, fileSize, itemId, stage, notes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to register file" }));
    throw new Error(err.error);
  }
  return res.json();
}
