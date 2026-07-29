import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /d/[token] — magic-link viewer for client-facing documents (doc_links,
// mig 153). The prospectus files themselves sit behind the login wall; an
// unguessable token is the only public door (Jon, Jul 29: "I don't want it to
// be this easy to find"). ?pdf=1 serves the doc's PDF snapshot sibling.
// Every open bumps opened_count so Jon can see whether a prospect looked.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const sb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: link } = await sb.from("doc_links").select("id, doc").eq("token", params.token).maybeSingle();
  if (!link) return new NextResponse("Not found", { status: 404 });

  // doc is a bare filename from OUR table (never user input), served only
  // from public/ — belt-and-suspenders against traversal anyway.
  const wantPdf = req.nextUrl.searchParams.get("pdf") === "1";
  const fileName = path.basename(wantPdf ? link.doc.replace(/\.html$/, ".pdf") : link.doc);
  const filePath = path.join(process.cwd(), "public", fileName);
  if (!fs.existsSync(filePath)) return new NextResponse("Not found", { status: 404 });

  // fire-and-forget open counter (never blocks the render)
  sb.rpc("exec_sql", { sql: `update doc_links set opened_count = opened_count + 1, last_opened_at = now() where id = '${link.id}'` }).then(() => {}, () => {});

  const body = fs.readFileSync(filePath);
  return new NextResponse(body, {
    headers: {
      "Content-Type": wantPdf ? "application/pdf" : "text/html; charset=utf-8",
      ...(wantPdf ? { "Content-Disposition": `inline; filename="${fileName}"` } : {}),
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
