// WHO may read WHICH file — the single authorization rule for OpsHub's file
// routes (/api/files/view, /api/files/thumbnail).
//
// Those routes serve any Google Drive id to anyone who asks. They are read by
// ~100 call sites across the staff app, the client hub, the vendor portal, the
// designer door and the public Lab page, so switching on a hard rule blind
// could blank a client's artwork or a printer's files without warning.
//
// So this ships in SHADOW MODE (Phase 1, Sep 2026): every request is judged and
// every refusal is recorded in file_access_log, but the file is still served.
// Once real traffic produces no legitimate refusals, FILE_ACCESS_ENFORCE flips
// it to actually blocking.
//
// Identity comes from two places: a Supabase session (staff) or a portal token
// passed as ?t= (client hub, vendor, designer, legacy per-job portal).

import { createClient as createAdmin } from "@supabase/supabase-js";

export const FILE_ACCESS_ENFORCE = process.env.FILE_ACCESS_ENFORCE === "1";

// What a client may ever see of an item's files. Print files are included
// because the hub already shows them today; proofs and mockups are the point.
const CLIENT_STAGES = ["mockup", "proof", "print_ready"];
// What a vendor may see: exactly what the PO hands them.
const VENDOR_STAGES = ["print_ready", "proof", "mockup", "packing_slip"];

export type Audience =
  | { kind: "staff"; userId: string }
  | { kind: "client"; clientId: string; tokenHint: string }
  | { kind: "vendor"; decoratorId: string; name: string; shortCode: string | null; tokenHint: string }
  | { kind: "designer"; designerId: string; tokenHint: string }
  | { kind: "job"; jobId: string; tokenHint: string }        // legacy per-job portal
  | { kind: "anonymous" };

export type Owner =
  | { kind: "item_file"; id: string; itemId: string; stage: string; superseded: boolean }
  | { kind: "brief_file"; id: string; briefId: string }
  | { kind: "lineup_option"; id: string; briefId: string | null }
  | { kind: "product_mockup"; id: string }
  | { kind: "client_file"; id: string; clientId: string }
  | { kind: "legacy_art"; id: string; clientId: string | null }
  | { kind: "lab_request"; id: string }
  | null;

const admin = () =>
  createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/** Which OpsHub record owns this Drive file? null = OpsHub doesn't know it. */
export async function resolveOwner(db: any, driveFileId: string): Promise<Owner> {
  const one = async (table: string, column: string, select: string) => {
    const { data, error } = await db.from(table).select(select).eq(column, driveFileId).limit(1);
    if (error) return null;
    return (data || [])[0] || null;
  };

  const f = await one("item_files", "drive_file_id", "id, item_id, stage, superseded_at");
  if (f) return { kind: "item_file", id: f.id, itemId: f.item_id, stage: f.stage, superseded: !!f.superseded_at };

  for (const col of ["drive_file_id", "preview_drive_file_id"]) {
    const b = await one("art_brief_files", col, "id, brief_id");
    if (b) return { kind: "brief_file", id: b.id, briefId: b.brief_id };
  }

  for (const col of ["drive_file_id", "preview_drive_file_id"]) {
    const l = await one("lineup_options", col, "id, brief_id");
    if (l) return { kind: "lineup_option", id: l.id, briefId: (l as any).brief_id ?? null };
  }

  const c = await one("client_files", "drive_file_id", "id, client_id");
  if (c) return { kind: "client_file", id: c.id, clientId: c.client_id };

  const la = await one("legacy_art_files", "drive_file_id", "id, client_id");
  if (la) return { kind: "legacy_art", id: la.id, clientId: la.client_id ?? null };

  try {
    const { data } = await db.from("products").select("id").eq("spec->>mockup_drive_file_id", driveFileId).limit(1);
    if ((data || []).length) return { kind: "product_mockup", id: (data as any)[0].id };
  } catch { /* table may be empty or absent in this tenant */ }

  // The public Lab page renders a stored URL that carries the Drive id.
  try {
    const { data } = await db.from("lab_order_requests").select("id").ilike("design_file_url", `%${driveFileId}%`).limit(1);
    if ((data || []).length) return { kind: "lab_request", id: (data as any)[0].id };
  } catch { /* table may be absent */ }

  return null;
}

/** Does this audience get to read this file? */
export async function isAllowed(db: any, who: Audience, owner: Owner): Promise<{ ok: boolean; reason: string }> {
  if (!owner) return { ok: false, reason: "unknown-file" };

  // Staff see everything OpsHub knows about. Page-level grants already decide
  // which surfaces they can open.
  if (who.kind === "staff") return { ok: true, reason: "staff" };

  // A file the Lab page publishes is public by design.
  if (owner.kind === "lab_request") return { ok: true, reason: "lab-public" };

  if (who.kind === "anonymous") return { ok: false, reason: "no-identity" };

  if (owner.kind === "client_file") {
    return who.kind === "client" && who.clientId === owner.clientId
      ? { ok: true, reason: "own-document" }
      : { ok: false, reason: "staff-only-document" };
  }

  if (owner.kind === "item_file") {
    const { data: item } = await db.from("items").select("id, job_id").eq("id", owner.itemId).maybeSingle();
    if (!item) return { ok: false, reason: "orphan-item-file" };

    if (who.kind === "job") {
      return (item as any).job_id === who.jobId ? { ok: true, reason: "job-token" } : { ok: false, reason: "other-job" };
    }

    if (who.kind === "client") {
      if (!CLIENT_STAGES.includes(owner.stage)) return { ok: false, reason: `client-stage:${owner.stage}` };
      const { data: job } = await db.from("jobs").select("client_id").eq("id", (item as any).job_id).maybeSingle();
      return (job as any)?.client_id === who.clientId
        ? { ok: true, reason: "own-order" }
        : { ok: false, reason: "other-client" };
    }

    if (who.kind === "vendor") {
      if (!VENDOR_STAGES.includes(owner.stage)) return { ok: false, reason: `vendor-stage:${owner.stage}` };
      // Assigned directly…
      const { data: assign } = await db.from("decorator_assignments")
        .select("id").eq("item_id", owner.itemId).eq("decorator_id", who.decoratorId).limit(1);
      if ((assign || []).length) return { ok: true, reason: "assigned" };
      // …or named as this item's print vendor in the job's costing.
      const { data: job } = await db.from("jobs").select("costing_data").eq("id", (item as any).job_id).maybeSingle();
      const cps: any[] = (job as any)?.costing_data?.costProds || [];
      const mine = cps.find(p => p.id === owner.itemId);
      const names = [who.name, who.shortCode].filter(Boolean).map(s => String(s).toLowerCase().trim());
      if (mine && names.includes(String(mine.printVendor || "").toLowerCase().trim())) {
        return { ok: true, reason: "print-vendor" };
      }
      return { ok: false, reason: "not-this-vendor" };
    }

    if (who.kind === "designer") return { ok: false, reason: "designer-not-item" };
  }

  if (owner.kind === "brief_file" || owner.kind === "lineup_option") {
    const briefId = owner.kind === "brief_file" ? owner.briefId : owner.briefId;
    if (!briefId) return { ok: false, reason: "brief-unknown" };
    const { data: brief } = await db.from("art_briefs")
      .select("id, client_id, assigned_designer_id").eq("id", briefId).maybeSingle();
    if (!brief) return { ok: false, reason: "brief-missing" };
    if (who.kind === "designer") {
      return (brief as any).assigned_designer_id === who.designerId
        ? { ok: true, reason: "assigned-brief" }
        : { ok: false, reason: "other-designer" };
    }
    if (who.kind === "client") {
      return (brief as any).client_id === who.clientId
        ? { ok: true, reason: "own-brief" }
        : { ok: false, reason: "other-client-brief" };
    }
    return { ok: false, reason: "brief-wrong-audience" };
  }

  if (owner.kind === "legacy_art") {
    return who.kind === "client" && owner.clientId && who.clientId === owner.clientId
      ? { ok: true, reason: "own-archive" }
      : { ok: false, reason: "archive-staff-only" };
  }

  if (owner.kind === "product_mockup") {
    // Catalog imagery: clients browse it in the hub, vendors don't need it.
    return who.kind === "client" ? { ok: true, reason: "catalog" } : { ok: false, reason: "catalog-wrong-audience" };
  }

  return { ok: false, reason: "unhandled" };
}

/** Identify the caller from a session cookie or a ?t= portal token. */
export async function identify(db: any, token: string | null, userId: string | null): Promise<Audience> {
  if (userId) return { kind: "staff", userId };
  if (!token) return { kind: "anonymous" };
  const hint = token.slice(0, 8);

  const { data: client } = await db.from("clients").select("id").eq("portal_token", token).maybeSingle();
  if (client) return { kind: "client", clientId: (client as any).id, tokenHint: hint };

  const { data: dec } = await db.from("decorators").select("id, name, short_code").eq("external_token", token).maybeSingle();
  if (dec) return { kind: "vendor", decoratorId: (dec as any).id, name: (dec as any).name, shortCode: (dec as any).short_code, tokenHint: hint };

  const { data: designer } = await db.from("designers").select("id").eq("portal_token", token).eq("active", true).maybeSingle();
  if (designer) return { kind: "designer", designerId: (designer as any).id, tokenHint: hint };

  const { data: job } = await db.from("jobs").select("id").eq("portal_token", token).maybeSingle();
  if (job) return { kind: "job", jobId: (job as any).id, tokenHint: hint };

  return { kind: "anonymous" };
}

/**
 * Judge one request. In shadow mode the answer is always "serve it" — the
 * verdict is recorded instead, so we can see what enforcement WOULD break
 * before it breaks anything.
 */
export async function judgeFileRequest(opts: {
  driveFileId: string;
  /** ?t= on the URL, or the portal identity cookie. First match wins. */
  token: string | null;
  userId: string | null;
  route: "view" | "thumbnail";
  path: string;
}): Promise<{ serve: boolean; allowed: boolean; reason: string }> {
  let allowed = false, reason = "error", who: Audience = { kind: "anonymous" }, owner: Owner = null;
  try {
    const db = admin();
    who = await identify(db, opts.token, opts.userId);
    owner = await resolveOwner(db, opts.driveFileId);
    const verdict = await isAllowed(db, who, owner);
    allowed = verdict.ok; reason = verdict.reason;

    if (!allowed) {
      // Record only refusals: allowances are the normal case and would bury them.
      await db.from("file_access_log").insert({
        drive_file_id: opts.driveFileId,
        route: opts.route,
        audience: who.kind,
        verdict: FILE_ACCESS_ENFORCE ? "blocked" : "deny",
        reason,
        owner_ref: owner ? `${owner.kind}:${(owner as any).id}` : null,
        user_id: who.kind === "staff" ? who.userId : null,
        token_hint: (who as any).tokenHint || null,
        path: opts.path.slice(0, 500),
      });
    }
  } catch {
    // A failure in the judge must never cost the user their file.
    return { serve: true, allowed: false, reason: "judge-error" };
  }
  return { serve: allowed || !FILE_ACCESS_ENFORCE, allowed, reason };
}

// ── Portal identity cookie ───────────────────────────────────────────────────
// Portal pages build file URLs in ~40 inline places; threading a token through
// every one is brittle. Instead, when a portal page loads its own data, that
// response drops a short-lived cookie holding the SAME token already in the
// visitor's URL. The file routes then read it. No new access is granted: the
// cookie only restates what the visitor already has.
export const PORTAL_COOKIE = "opshub_portal";

export function portalCookie(token: string): string {
  const oneDay = 60 * 60 * 24;
  return `${PORTAL_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${oneDay}; HttpOnly; SameSite=Lax; Secure`;
}

/** Attach the portal identity cookie to a JSON response. */
export function withPortalCookie<T extends Response>(res: T, token: string | null | undefined): T {
  if (token) res.headers.append("Set-Cookie", portalCookie(token));
  return res;
}
