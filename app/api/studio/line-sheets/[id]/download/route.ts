import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { studioUser, lineSheetInCompany } from "@/lib/studio-access";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { sheetMocksDownload, type MockPick } from "@/lib/line-sheet-zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Next 14 caches fetches forever in a GET-only force-dynamic route; this
// route must always read live data.
export const fetchCache = "force-no-store";
export const maxDuration = 300;

// GET ?pick=approved | all | <itemId,itemId,…> → the sheet's mockups, full
// res, named by item (lib/line-sheet-zip). One file = the file; more = a ZIP.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  if (!(await studioUser(supabase))) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  if (!(await lineSheetInCompany(db, params.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const raw = (req.nextUrl.searchParams.get("pick") || "approved").trim();
  const pick: MockPick = raw === "approved" ? { mode: "approved" } : raw === "all" ? { mode: "all" }
    : { mode: "items", ids: raw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 500) };
  const label = raw === "approved" ? "approved" : raw === "all" ? "all" : "selected";
  try {
    const z = await sheetMocksDownload(db, params.id, pick, label);
    if (!z) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!z.count) return NextResponse.json({ error: raw === "approved" ? "Nothing approved yet" : "No files to download" }, { status: 404 });
    // RFC 5987: encodeURIComponent leaves ' ( ) * bare ("Men's Tee")
    const star = encodeURIComponent(z.name).replace(/['()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
    return new Response(z.stream, { headers: {
      "Content-Type": z.type,
      "Content-Disposition": `attachment; filename="${z.name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${star}`,
      ...(z.size ? { "Content-Length": String(z.size) } : {}),
      "Cache-Control": "no-store",
    } });
  } catch (e: any) {
    console.error("[line-sheet-download] failed", e?.message || e);
    return NextResponse.json({ error: "Couldn't build the download" }, { status: 500 });
  }
}
