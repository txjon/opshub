/**
 * Drive cleanup utilities — rename, archive, find folders.
 * Purely additive — does NOT modify existing google-drive.ts logic.
 * Uses the same auth pattern (googleapis + service account).
 */
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

function getDrive() {
  return google.drive({ version: "v3", auth: getAuth() });
}

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;

/**
 * Find a folder by name inside a parent. Returns folder ID or null.
 */
export async function findFolder(name: string, parentId: string): Promise<string | null> {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name)",
    spaces: "drive",
  });
  return res.data.files?.[0]?.id || null;
}

/**
 * Find or create a folder inside a parent.
 */
async function findOrCreateFolder(name: string, parentId: string): Promise<string> {
  const existing = await findFolder(name, parentId);
  if (existing) return existing;
  const drive = getDrive();
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

/**
 * Rename a Drive folder.
 */
export async function renameFolder(folderId: string, newName: string): Promise<void> {
  const drive = getDrive();
  await drive.files.update({
    fileId: folderId,
    requestBody: { name: newName },
  });
}

/**
 * Move a folder to _Archive inside its grandparent (client folder).
 * Structure: Root / Client / _Archive / {folder}
 * The folder keeps its name for reference.
 */
export async function archiveFolder(folderId: string, clientFolderId: string): Promise<void> {
  const drive = getDrive();
  const archiveId = await findOrCreateFolder("_Archive", clientFolderId);

  // Get current parents to remove
  const file = await drive.files.get({ fileId: folderId, fields: "parents" });
  const currentParents = (file.data.parents || []).join(",");

  // Move to archive
  await drive.files.update({
    fileId: folderId,
    addParents: archiveId,
    removeParents: currentParents,
  });
}

/**
 * Find the item folder for a given path. Returns folder ID or null.
 * Path: Root / clientName / projectTitle / itemName
 */
export async function findItemFolder(
  clientName: string,
  projectTitle: string,
  itemName: string
): Promise<string | null> {
  const clientFolder = await findFolder(clientName, ROOT_FOLDER_ID);
  if (!clientFolder) return null;
  const projectFolder = await findFolder(projectTitle, clientFolder);
  if (!projectFolder) return null;
  return findFolder(itemName, projectFolder);
}

/**
 * Find the project folder. Returns { projectFolderId, clientFolderId } or null.
 */
export async function findProjectFolder(
  clientName: string,
  projectTitle: string
): Promise<{ projectFolderId: string; clientFolderId: string } | null> {
  const clientFolderId = await findFolder(clientName, ROOT_FOLDER_ID);
  if (!clientFolderId) return null;
  const projectFolderId = await findFolder(projectTitle, clientFolderId);
  if (!projectFolderId) return null;
  return { projectFolderId, clientFolderId };
}

/**
 * Rename an item's Drive folder.
 * Finds: Root / clientName / projectTitle / oldName → renames to newName
 */
export async function renameItemFolder(
  clientName: string,
  projectTitle: string,
  oldName: string,
  newName: string
): Promise<boolean> {
  const folderId = await findItemFolder(clientName, projectTitle, oldName);
  if (!folderId) return false;
  await renameFolder(folderId, newName);
  return true;
}

/**
 * Archive an item's Drive folder.
 * Moves: Root / clientName / projectTitle / itemName → Root / clientName / _Archive / projectTitle - itemName
 */
export async function archiveItemFolder(
  clientName: string,
  projectTitle: string,
  itemName: string
): Promise<boolean> {
  const clientFolderId = await findFolder(clientName, ROOT_FOLDER_ID);
  if (!clientFolderId) return false;
  const projectFolderId = await findFolder(projectTitle, clientFolderId);
  if (!projectFolderId) return false;
  const itemFolderId = await findFolder(itemName, projectFolderId);
  if (!itemFolderId) return false;

  // Rename to "ProjectTitle - ItemName" before archiving for context
  await renameFolder(itemFolderId, `${projectTitle} - ${itemName}`);
  await archiveFolder(itemFolderId, clientFolderId);
  return true;
}

/**
 * Archive an entire project's Drive folder.
 * Moves: Root / clientName / projectTitle → Root / clientName / _Archive / projectTitle
 */
export async function archiveProjectFolder(
  clientName: string,
  projectTitle: string
): Promise<boolean> {
  const result = await findProjectFolder(clientName, projectTitle);
  if (!result) return false;
  await archiveFolder(result.projectFolderId, result.clientFolderId);
  return true;
}
