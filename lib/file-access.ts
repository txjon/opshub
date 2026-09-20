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
// Three rules this file lives by, learned in review:
//   - it must never cost the reader their file: a slow or broken judge serves
//     (hard timeout, fail-open),
//   - it must never be slower than it has to be: lookups run in parallel and
//     verdicts are cached briefly,
//   - a visitor may hold SEVERAL identities (a client who also opened an old
//     per-job link, a staff member checking a vendor portal). Every identity
//     presented gets its chance, and the file is served if any of them may
//     have it.

import { createClient as createAdmin } from "@supabase/supabase-js";

export const FILE_ACCESS_ENFORCE = process.env.FILE_ACCESS_ENFORCE === "1";

// The judge is advisory. If it hasn't answered in this long, serve the file.
const JUDGE_TIMEOUT_MS = 1500;
// Same file, same viewer, within this window: reuse the verdict.
const VERDICT_TTL_MS = 60_000;

// What a client may ever see of an item's files — mirrors what the hub already
// lists (api/portal/client/[token]/items: mockup, proof, print_ready).
const CLIENT_STAGES = ["mockup", "proof", "print_ready"];
// What a vendor may see: what the PO hands them, plus their own packing slips.
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
  | { kind: "lineup_option"; id: string; lineupId: string | null }
  | { kind: "product_mockup"; id: string }
  | { kind: "client_file"; id: string; clientId: string }
  | { kind: "legacy_art"; id: string; clientId: string | null }
  | { kind: "lab_request"; id: string };

const admin = () =>
  createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/**
 * EVERY OpsHub record that points at this Drive file. A file can be shared by
 * several items (282 are, one across 4 clients), so returning only the first
 * row would refuse clients their own art. All lookups run in parallel.
 */
export async function resolveOwners(db: any, driveFileId: string): Promise<Owner[]> {
  // A failed lookup must NEVER read as "nothing owns this file" — that is a
  // refusal, and under enforcement it would blank a real image. Errors throw
  // and the caller serves the file (lib/google-drive-refs takes the same
  // fail-safe stance for deletes).
  const rows = (table: string, column: string, select: string) =>
    db.from(table).select(select).eq(column, driveFileId).limit(25)
      .then((r: any) => { if (r.error) throw new Error(`${table}.${column}: ${r.error.message}`); return r.data || []; });

  const [items, briefs, briefPreviews, lineups, lineupPreviews, clientDocs, legacy, products, lab] = await Promise.all([
    rows("item_files", "drive_file_id", "id, item_id, stage, superseded_at"),
    rows("art_brief_files", "drive_file_id", "id, brief_id"),
    rows("art_brief_files", "preview_drive_file_id", "id, brief_id"),
    rows("lineup_options", "drive_file_id", "id, lineup_id"),
    rows("lineup_options", "preview_drive_file_id", "id, lineup_id"),
    rows("client_files", "drive_file_id", "id, client_id"),
    rows("legacy_art_files", "drive_file_id", "id, client_id"),
    db.from("products").select("id").eq("spec->>mockup_drive_file_id", driveFileId).limit(5)
      .then((r: any) => { if (r.error) throw new Error(`products: ${r.error.message}`); return r.data || []; }),
    // The public Lab page renders a stored URL that carries the Drive id.
    db.from("lab_order_requests").select("id").ilike("design_file_url", `%${driveFileId}%`).limit(1)
      .then((r: any) => { if (r.error) throw new Error(`lab_order_requests: ${r.error.message}`); return r.data || []; }),
  ]);

  const out: Owner[] = [];
  for (const f of items) out.push({ kind: "item_file", id: f.id, itemId: f.item_id, stage: f.stage, superseded: !!f.superseded_at });
  for (const b of [...briefs, ...briefPreviews]) out.push({ kind: "brief_file", id: b.id, briefId: b.brief_id });
  for (const l of [...lineups, ...lineupPreviews]) out.push({ kind: "lineup_option", id: l.id, lineupId: l.lineup_id ?? null });
  for (const c of clientDocs) out.push({ kind: "client_file", id: c.id, clientId: c.client_id });
  for (const a of legacy) out.push({ kind: "legacy_art", id: a.id, clientId: a.client_id ?? null });
  for (const p of products) out.push({ kind: "product_mockup", id: p.id });
  for (const l of lab) out.push({ kind: "lab_request", id: l.id });
  return out;
}

/** Does this audience get to read this particular record? */
async function allowsOwner(db: any, who: Audience, owner: Owner): Promise<{ ok: boolean; reason: string }> {
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

    return { ok: false, reason: `item-wrong-audience:${who.kind}` };
  }

  if (owner.kind === "brief_file" || owner.kind === "lineup_option") {
    let briefId: string | null = null;
    if (owner.kind === "brief_file") briefId = owner.briefId;
    else if (owner.lineupId) {
      // lineup_options hang off lineups, which carry the brief.
      const { data: lineup } = await db.from("lineups").select("brief_id").eq("id", owner.lineupId).maybeSingle();
      briefId = (lineup as any)?.brief_id || null;
    }
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
    return { ok: false, reason: `brief-wrong-audience:${who.kind}` };
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

/** Any identity + any owning record that says yes, wins. */
export async function isAllowed(db: any, whos: Audience[], owners: Owner[]): Promise<{ ok: boolean; reason: string }> {
  // Staff see everything, INCLUDING files OpsHub doesn't index (work-order
  // attachments, proposal art). Page grants already decide which surfaces they
  // can open, and this check comes first so an unindexed file never 404s them.
  if (whos.some(w => w.kind === "staff")) return { ok: true, reason: "staff" };
  if (!owners.length) return { ok: false, reason: "unknown-file" };

  let firstReason = "no-identity";
  for (const owner of owners) {
    for (const who of whos) {
      const verdict = await allowsOwner(db, who, owner);
      if (verdict.ok) return verdict;
      if (firstReason === "no-identity") firstReason = verdict.reason;
    }
  }
  return { ok: false, reason: firstReason };
}

/** Identify every identity presented: a session, plus any portal tokens. */
export async function identify(db: any, tokens: string[], userId: string | null): Promise<Audience[]> {
  const out: Audience[] = [];
  if (userId) out.push({ kind: "staff", userId });

  const unique = Array.from(new Set(tokens.filter(Boolean)));
  await Promise.all(unique.map(async (token) => {
    const hint = token.slice(0, 8);
    const [client, dec, designer, job] = await Promise.all([
      db.from("clients").select("id").eq("portal_token", token).eq("client_hub_enabled", true).maybeSingle().then((r: any) => r.data).catch(() => null),
      db.from("decorators").select("id, name, short_code").eq("external_token", token).maybeSingle().then((r: any) => r.data).catch(() => null),
      db.from("designers").select("id").eq("portal_token", token).eq("active", true).maybeSingle().then((r: any) => r.data).catch(() => null),
      db.from("jobs").select("id").eq("portal_token", token).maybeSingle().then((r: any) => r.data).catch(() => null),
    ]);
    if (client) out.push({ kind: "client", clientId: (client as any).id, tokenHint: hint });
    if (dec) out.push({ kind: "vendor", decoratorId: (dec as any).id, name: (dec as any).name, shortCode: (dec as any).short_code, tokenHint: hint });
    if (designer) out.push({ kind: "designer", designerId: (designer as any).id, tokenHint: hint });
    if (job) out.push({ kind: "job", jobId: (job as any).id, tokenHint: hint });
  }));

  if (!out.length) out.push({ kind: "anonymous" });
  return out;
}

// Short-lived verdict cache: a board renders 30 thumbnails for the same viewer,
// and re-judging each one from scratch would add half a second apiece.
const verdictCache = new Map<string, { at: number; allowed: boolean; reason: string }>();
function cacheGet(key: string) {
  const hit = verdictCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > VERDICT_TTL_MS) { verdictCache.delete(key); return null; }
  return hit;
}
function cacheSet(key: string, allowed: boolean, reason: string) {
  if (verdictCache.size > 5000) verdictCache.clear();
  verdictCache.set(key, { at: Date.now(), allowed, reason });
}

// A referer is a full URL, and portal URLs carry the visitor's access token.
// Never store one: the token is redacted, matching the 8-character hint kept
// beside it.
export function redactTokens(url: string | null): string | null {
  if (!url) return null;
  return url
    .replace(/(\/portal\/client\/|\/portal\/vendor\/|\/design\/|\/designer\/|\/portal\/|\/art-request\/)[^/?#]+/g, "$1<token>")
    .replace(/([?&]t=)[^&]+/g, "$1<token>")
    .slice(0, 500);
}

async function judge(opts: {
  driveFileId: string; tokens: string[]; userId: string | null;
  route: "view" | "thumbnail"; referer: string | null; selfPath?: string | null;
}): Promise<{ allowed: boolean; reason: string }> {
  const db = admin();
  const [whos, owners] = await Promise.all([
    identify(db, opts.tokens, opts.userId),
    resolveOwners(db, opts.driveFileId),
  ]);
  const verdict = await isAllowed(db, whos, owners);

  // Shadow only: a staff member testing a client hub in their logged-in browser
  // is judged staff and logs nothing, which makes an internal test read as
  // "clean". Judge the portal identity too and record that verdict, marked, so
  // the go/no-go data reflects what a real client would get.
  if (!FILE_ACCESS_ENFORCE && verdict.ok && verdict.reason === "staff") {
    const portalOnly = whos.filter(w => w.kind !== "staff");
    if (portalOnly.length) {
      const masked = await isAllowed(db, portalOnly, owners);
      if (!masked.ok) {
        await db.from("file_access_log").insert({
          drive_file_id: opts.driveFileId, route: opts.route,
          audience: portalOnly.map(w => w.kind).join("+"),
          verdict: "deny", reason: `staff-masked:${masked.reason}`,
          owner_ref: owners.length ? owners.map(o => `${o.kind}:${(o as any).id}`).slice(0, 3).join(",") : null,
          user_id: null,
          token_hint: (portalOnly.find(w => (w as any).tokenHint) as any)?.tokenHint || null,
          path: redactTokens(opts.referer) || opts.selfPath || null,
        }).then(() => {}, () => {});
      }
    }
  }

  if (!verdict.ok) {
    // Record only refusals: allowances are the normal case and would bury them.
    // The REFERER is what makes a refusal traceable to a page — the request path
    // is the same route for every call site.
    const staff = whos.find(w => w.kind === "staff") as any;
    await db.from("file_access_log").insert({
      drive_file_id: opts.driveFileId,
      route: opts.route,
      audience: whos.map(w => w.kind).join("+"),
      verdict: FILE_ACCESS_ENFORCE ? "blocked" : "deny",
      reason: verdict.reason,
      owner_ref: owners.length ? owners.map(o => `${o.kind}:${(o as any).id}`).slice(0, 3).join(",") : null,
      user_id: staff?.userId || null,
      token_hint: (whos.find(w => (w as any).tokenHint) as any)?.tokenHint || null,
      path: redactTokens(opts.referer) || opts.selfPath || null,
    });
  }
  return { allowed: verdict.ok, reason: verdict.reason };
}

/**
 * Judge one request. In shadow mode the answer is always "serve it" — the
 * verdict is recorded instead, so we can see what enforcement WOULD break
 * before it breaks anything. A judge that errors, or takes longer than
 * JUDGE_TIMEOUT_MS, always serves: authorization must never cost a reader
 * their file while it is still advisory.
 */
export async function judgeFileRequest(opts: {
  driveFileId: string;
  tokens: (string | null | undefined)[];
  userId: string | null;
  route: "view" | "thumbnail";
  referer: string | null;
  /** The file route's own URL, used when the referer is suppressed. */
  selfPath?: string | null;
}): Promise<{ serve: boolean; allowed: boolean; reason: string }> {
  const tokens = (opts.tokens.filter(Boolean) as string[]).sort();
  const key = `${opts.driveFileId}|${opts.userId || ""}|${tokens.join(",")}`;
  const cached = cacheGet(key);
  // A remembered timeout means "serve, don't re-judge yet".
  if (cached) return { serve: cached.allowed || cached.reason === "judge-timeout" || !FILE_ACCESS_ENFORCE, allowed: cached.allowed, reason: cached.reason };

  let result: { allowed: boolean; reason: string };
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    result = await Promise.race([
      judge({ ...opts, tokens }),
      new Promise<{ allowed: boolean; reason: string }>((resolve) => {
        timer = setTimeout(() => resolve({ allowed: false, reason: "judge-timeout" }), JUDGE_TIMEOUT_MS);
      }),
    ]);
  } catch (e: any) {
    // Includes a failed lookup: serve the file, and never cache the failure.
    return { serve: true, allowed: false, reason: "judge-error" };
  } finally {
    if (timer) clearTimeout(timer);
  }
  // A timeout is not a verdict, but re-judging every thumbnail on a slow
  // database makes the slowness self-sustaining: remember it briefly as
  // "serve", never as an allow.
  if (result.reason === "judge-timeout") {
    verdictCache.set(key, { at: Date.now() - (VERDICT_TTL_MS - 5000), allowed: false, reason: "judge-timeout" });
    return { serve: true, allowed: false, reason: "judge-timeout" };
  }
  cacheSet(key, result.allowed, result.reason);
  return { serve: result.allowed || !FILE_ACCESS_ENFORCE, allowed: result.allowed, reason: result.reason };
}

// ── Portal identity cookies ──────────────────────────────────────────────────
// Portal pages build file URLs in ~40 inline places; threading a token through
// every one is brittle. Instead, when a portal page loads, a cookie holds the
// SAME token already in the visitor's URL, and the file routes read it. No new
// access is granted: the cookie only restates what the visitor already has.
//
// One cookie PER AUDIENCE, because a person can hold several at once — a client
// who also opens an old per-job link, or a staff member checking a vendor
// portal. A single shared cookie let the last one opened overwrite the rest.
export const PORTAL_COOKIES = {
  client: "opshub_portal_client",
  vendor: "opshub_portal_vendor",
  designer: "opshub_portal_designer",
  job: "opshub_portal_job",
} as const;
export type PortalKind = keyof typeof PORTAL_COOKIES;
export const ALL_PORTAL_COOKIES: string[] = Object.values(PORTAL_COOKIES);

export function portalCookie(kind: PortalKind, token: string): string {
  const oneDay = 60 * 60 * 24;
  // Secure only in production: the LAN URL used for phone testing is http,
  // and a Secure cookie is dropped there outright.
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${PORTAL_COOKIES[kind]}=${encodeURIComponent(token)}; Path=/; Max-Age=${oneDay}; HttpOnly; SameSite=Lax${secure}`;
}

/** Attach a portal identity cookie to a response. */
export function withPortalCookie<T extends Response>(res: T, kind: PortalKind, token: string | null | undefined): T {
  if (token) res.headers.append("Set-Cookie", portalCookie(kind, token));
  return res;
}
