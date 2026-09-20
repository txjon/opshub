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
 * Permanently delete a folder and all its contents from Drive.
 * Drive trash retains files for 30 days if recovery is needed.
 */
export async function deleteFolderPermanently(folderId: string): Promise<void> {
  const drive = getDrive();
  await drive.files.update({ fileId: folderId, requestBody: { trashed: true } });
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
 * Delete an item's Drive folder permanently.
 * Trashes: Root / clientName / projectTitle / itemName
 */
/**
 * Trash a folder WITHOUT destroying files that something else still uses.
 *
 * The old behaviour trashed the whole folder, so archiving an item or project
 * took its duplicates' and re-orders' shared art with it (Phase 0, Sep 2026).
 * Now the tree is collected first, every file id checked in ONE batch, then
 * unreferenced files are trashed; referenced files stay. A folder is trashed
 * only when nothing inside it (or below it) had to be kept.
 *
 * Collect-then-batch matters: checking each file separately meant ~7 database
 * round trips per file, and a 59-file project archive timed out mid-trash.
 */
export async function trashFolderSafely(
  folderId: string,
  opts?: { excludeItemIds?: string[] }
): Promise<{ trashedFiles: number; keptFiles: number; folderTrashed: boolean }> {
  const drive = getDrive();
  const { referencedDriveFileIds } = await import("./google-drive-refs");
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 1. Walk the tree once: every file, and every folder in child-first order.
  type Entry = { id: string; parent: string; shortcut: boolean };
  const files: Entry[] = [];
  const folders: string[] = [];        // child-first
  const collect = async (id: string) => {
    let pageToken: string | undefined;
    do {
      const res: any = await drive.files.list({
        q: `'${id}' in parents and trashed=false`,
        fields: "nextPageToken, files(id, mimeType)",
        pageSize: 200, pageToken,
      });
      for (const f of (res.data.files || [])) {
        if (f.mimeType === "application/vnd.google-apps.folder") await collect(f.id!);
        else files.push({ id: f.id!, parent: id, shortcut: f.mimeType === "application/vnd.google-apps.shortcut" });
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);
    folders.push(id);
  };
  await collect(folderId);

  // 2. One batched reference check for the whole tree. Shortcuts are pointers,
  //    never the art itself, so they are always safe to trash.
  const realFileIds = files.filter(f => !f.shortcut).map(f => f.id);
  const referenced = await referencedDriveFileIds(db, realFileIds, opts);

  // 3. Trash what nothing else uses; remember which folders had to keep something.
  const keptIn = new Set<string>();
  let trashedFiles = 0, keptFiles = 0;
  for (const f of files) {
    if (!f.shortcut && referenced.has(f.id)) { keptFiles++; keptIn.add(f.parent); continue; }
    try { await drive.files.update({ fileId: f.id, requestBody: { trashed: true } }); trashedFiles++; }
    catch { keptFiles++; keptIn.add(f.parent); }
  }

  // 4. Child-first, trash folders that kept nothing (a kept child keeps its parents).
  const parentOf = new Map<string, string>();
  for (const f of files) parentOf.set(f.id, f.parent);
  const keptFolders = new Set(keptIn);
  for (const id of folders) {
    if (keptFolders.has(id)) continue;
    try { await drive.files.update({ fileId: id, requestBody: { trashed: true } }); }
    catch { keptFolders.add(id); }
    if (keptFolders.has(id)) {
      // propagate upward so ancestors are kept too
      const res: any = await drive.files.get({ fileId: id, fields: "parents" }).catch(() => null);
      for (const p of (res?.data?.parents || [])) keptFolders.add(p);
    }
  }
  // a kept child folder must keep its ancestors: re-walk child-first
  for (const id of folders) {
    if (!keptFolders.has(id)) continue;
    const res: any = await drive.files.get({ fileId: id, fields: "parents" }).catch(() => null);
    for (const p of (res?.data?.parents || [])) keptFolders.add(p);
  }

  return { trashedFiles, keptFiles, folderTrashed: !keptFolders.has(folderId) };
}

export async function deleteItemFolder(
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
  await deleteFolderPermanently(itemFolderId);
  return true;
}

/**
 * Delete an entire project's Drive folder permanently.
 * Trashes: Root / clientName / projectTitle
 */
export async function deleteProjectFolder(
  clientName: string,
  projectTitle: string
): Promise<boolean> {
  const result = await findProjectFolder(clientName, projectTitle);
  if (!result) return false;
  await deleteFolderPermanently(result.projectFolderId);
  return true;
}
