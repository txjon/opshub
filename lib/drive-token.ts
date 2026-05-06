import { google } from "googleapis";

function getAuth() {
  let key: any;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } else {
    const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 || "";
    key = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  }

  return new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/drive"],
    clientOptions: { subject: "jon@housepartydistro.com" },
  });
}

export async function getDriveToken(): Promise<string> {
  const client = await getAuth().getClient();
  const token = await client.getAccessToken();
  return token.token!;
}

// Resolve the Drive root folder id for the active tenant. Per-company
// override is stored on companies.drive_folder_id (set after creating
// a tenant-specific folder + sharing it with the service account).
// Falls back to the global GOOGLE_DRIVE_ROOT_FOLDER_ID env var when:
//   • no row override is set, OR
//   • we're outside a request lifecycle (cron, background, build)
//   • lookup fails for any reason
// HPD continues to use the env var fallback so existing files don't
// move. IHM (and any future tenant) gets a per-row folder id.
export async function getTenantRootFolderId(): Promise<string> {
  const fallback = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;
  try {
    const { getActiveCompany } = await import("./company");
    const company = await getActiveCompany();
    return (company as any).drive_folder_id || fallback;
  } catch {
    return fallback;
  }
}

// Find or create a folder, using the token directly via REST API
async function findOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  // Search for existing
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) return searchData.files[0].id;

  // Create
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  const createData = await createRes.json();
  return createData.id;
}

export async function getItemFolderIdDirect(token: string, clientName: string, projectTitle: string, itemName: string): Promise<string> {
  const rootId = await getTenantRootFolderId();
  const clientFolder = await findOrCreateFolder(token, clientName, rootId);
  const projectFolder = await findOrCreateFolder(token, projectTitle, clientFolder);
  const itemFolder = await findOrCreateFolder(token, itemName, projectFolder);
  return itemFolder;
}

export async function getPackingSlipFolderId(token: string, clientName: string, projectTitle: string): Promise<string> {
  const rootId = await getTenantRootFolderId();
  const clientFolder = await findOrCreateFolder(token, clientName, rootId);
  const projectFolder = await findOrCreateFolder(token, projectTitle, clientFolder);
  const slipFolder = await findOrCreateFolder(token, "Packing Slips", projectFolder);
  return slipFolder;
}

export async function getReceivingFolderId(token: string, shipmentLabel: string): Promise<string> {
  const rootId = await getTenantRootFolderId();
  const receivingFolder = await findOrCreateFolder(token, "Receiving", rootId);
  const shipmentFolder = await findOrCreateFolder(token, shipmentLabel, receivingFolder);
  return shipmentFolder;
}

// Creates (or finds) a nested folder tree under OpsHub Files root.
// Pass ["Art Studio", "Client Name", "Brief Title"] → returns final folder id.
// Sanitizes each segment (Drive doesn't like empty names).
export async function getOrCreateNestedFolder(token: string, segments: string[]): Promise<string> {
  const rootId = await getTenantRootFolderId();
  let parent = rootId;
  for (const raw of segments) {
    const name = (raw || "Untitled").trim().replace(/[\/\\]+/g, "-").slice(0, 120) || "Untitled";
    parent = await findOrCreateFolder(token, name, parent);
  }
  return parent;
}
