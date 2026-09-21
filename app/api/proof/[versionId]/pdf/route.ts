export const runtime = "nodejs";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { renderVersionPdf } from "@/lib/proof-versions";
import { identify, isAllowed, ALL_PORTAL_COOKIES } from "@/lib/file-access";

// The proof PDF for one VERSION, rendered on demand.
//
// Nothing is baked in advance, so nothing can be stale: a draft renders fresh
// every time, and an approved version is rendered once and then kept as the
// evidence of what was signed off (lib/proof-versions).
//
// Who may read it is the same question as any other file, answered the same
// way: a staff session, or the portal token of the client or vendor whose work
// it is (lib/file-access).
export async function GET(req: NextRequest, { params }: { params: { versionId: string } }) {
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: version } = await db.from("proof_versions")
    .select("id, item_id, state, version").eq("id", params.versionId).maybeSingle();
  if (!version) return new NextResponse("Not found", { status: 404 });

  let userId: string | null = null;
  try {
    const session = await createServerClient();
    const { data: { user } } = await session.auth.getUser();
    userId = user?.id || null;
  } catch { userId = null; }

  const tokens = [
    req.nextUrl.searchParams.get("t"),
    ...ALL_PORTAL_COOKIES.map(c => req.cookies.get(c)?.value),
  ].filter(Boolean) as string[];

  // A proof belongs to its item, so the item's own proof file decides who may
  // see it — one rule for every audience, not a second set for proofs.
  const whos = await identify(db, tokens, userId);
  const verdict = await isAllowed(db, whos, [{
    kind: "item_file", id: (version as any).id, itemId: (version as any).item_id,
    stage: "proof", superseded: false,
  }]);
  if (!verdict.ok) return new NextResponse("Not found", { status: 404 });

  // A DRAFT is ours, not theirs. Nothing client- or vendor-facing emits a draft
  // id today, so this guards the rule rather than patching a leak — but this is
  // the route whose whole job is to enforce it, and it wasn't.
  const isStaff = !!userId;
  if (!isStaff && (version as any).state === "draft") {
    return new NextResponse("Not found", { status: 404 });
  }

  const out = await renderVersionPdf(params.versionId);
  if (!out.ok) return new NextResponse(out.error, { status: out.status });

  const asciiName = out.fileName.replace(/[^\x20-\x7E]/g, "_");
  return new NextResponse(out.pdf as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${req.nextUrl.searchParams.get("download") ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(out.fileName)}`,
      // Approved versions never change, so they cache privately. A draft must
      // always be rendered fresh.
      "Cache-Control": (version as any).state === "approved" ? "private, max-age=86400" : "no-store",
    },
  });
}
