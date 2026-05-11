import { google } from "googleapis";
import { createClient as createAdmin } from "@supabase/supabase-js";

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

// Item-ID-aware folder resolution. Reads drive_folder_id stashed on
// clients/jobs/items rows so a rename of the underlying name doesn't
// cause the next upload to split files into a new sibling folder.
// First call for any row walks Client → Project → Item, find-or-creates
// each, stashes the resulting ids back. Subsequent calls short-circuit.
export async function getItemFolderIdForItem(token: string, itemId: string): Promise<string> {
  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: item, error } = await admin
    .from("items")
    .select("id, name, drive_folder_id, jobs:job_id(id, title, drive_folder_id, clients:client_id(id, name, drive_folder_id))")
    .eq("id", itemId)
    .single();
  if (error || !item) throw new Error("Item not found");

  // Already stashed — use it.
  if ((item as any).drive_folder_id) return (item as any).drive_folder_id as string;

  const job = (item as any).jobs;
  const client = job?.clients;
  if (!job || !client) throw new Error("Item is missing job/client context");

  const rootId = await getTenantRootFolderId();

  // Client folder — reuse stashed id, else find-or-create + stash.
  let clientFolderId: string = client.drive_folder_id;
  if (!clientFolderId) {
    clientFolderId = await findOrCreateFolder(token, client.name || "Unknown Client", rootId);
    await admin.from("clients").update({ drive_folder_id: clientFolderId }).eq("id", client.id);
  }

  // Project folder — same pattern.
  let projectFolderId: string = job.drive_folder_id;
  if (!projectFolderId) {
    projectFolderId = await findOrCreateFolder(token, job.title || "Untitled Project", clientFolderId);
    await admin.from("jobs").update({ drive_folder_id: projectFolderId }).eq("id", job.id);
  }

  // Item folder.
  const itemFolderId = await findOrCreateFolder(token, (item as any).name || "Untitled Item", projectFolderId);
  await admin.from("items").update({ drive_folder_id: itemFolderId }).eq("id", (item as any).id);

  return itemFolderId;
}

// Rename a Drive folder in place. Keeps the folder ID intact so any
// stored references (links on item rows, PO drive_link, etc.) stay
// valid. Used by the /api/drive/rename hook after a name change on
// clients / jobs / items.
export async function renameDriveFolder(token: string, folderId: string, newName: string): Promise<void> {
  const safeName = (newName || "Untitled").trim().replace(/[\/\\]+/g, "-").slice(0, 120) || "Untitled";
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: safeName }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive rename failed (${res.status}): ${text.slice(0, 300)}`);
  }
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
