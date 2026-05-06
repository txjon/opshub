import { google } from "googleapis";
import { Readable } from "stream";

function getAuth() {
  let key: any;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } else {
    const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 || "";
    key = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  }
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/drive"],
    clientOptions: {
      subject: "jon@housepartydistro.com",
    },
  });
  return auth;
}

function getDrive() {
  return google.drive({ version: "v3", auth: getAuth() });
}

// Per-tenant root folder. Reads companies.drive_folder_id of the
// active tenant (set by the layout via x-company-slug request header)
// and falls back to the env var when no tenant context is available
// (cron jobs, build-time, etc.). HPD's row leaves drive_folder_id
// NULL → falls through to GOOGLE_DRIVE_ROOT_FOLDER_ID → existing
// HPD files stay where they are.
async function getRootFolderId(): Promise<string> {
  const fallback = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;
  try {
    const { getActiveCompany } = await import("./company");
    const company = await getActiveCompany();
    return (company as any).drive_folder_id || fallback;
  } catch {
    return fallback;
  }
}

// Find or create a subfolder inside a parent folder
async function findOrCreateFolder(name: string, parentId: string): Promise<string> {
  const drive = getDrive();
  // Search for existing folder
  const res = await drive.files.list({
    q: `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name)",
    spaces: "drive",
  });
  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!;
  }
  // Create folder
  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });
  return folder.data.id!;
}

// Build the full folder path: Root / Client Name / Project Title / Item Name
export async function getItemFolderId(
  clientName: string,
  projectTitle: string,
  itemName: string
): Promise<string> {
  const root = await getRootFolderId();
  const clientFolder = await findOrCreateFolder(clientName, root);
  const projectFolder = await findOrCreateFolder(projectTitle, clientFolder);
  const itemFolder = await findOrCreateFolder(itemName, projectFolder);
  return itemFolder;
}

// Upload a file to the item folder, return file ID and web link
export async function uploadFile(
  folderId: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer
): Promise<{ fileId: string; webViewLink: string; webContentLink: string }> {
  const drive = getDrive();
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: "id,webViewLink,webContentLink",
  });

  // Make file viewable by anyone with the link
  await drive.permissions.create({
    fileId: res.data.id!,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  return {
    fileId: res.data.id!,
    webViewLink: res.data.webViewLink || "",
    webContentLink: res.data.webContentLink || "",
  };
}

// Delete a file from Drive
export async function deleteFile(fileId: string): Promise<void> {
  const drive = getDrive();
  await drive.files.delete({ fileId });
}

// Get a thumbnail/preview link for a file
export function getThumbnailUrl(fileId: string): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w200`;
}
