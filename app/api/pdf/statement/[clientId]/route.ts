export const runtime = "nodejs";
export const maxDuration = 60;

// Account statement PDF — every open invoice for one client on one page.
// Numbers derive from lib/ar via lib/statement (never a parallel math path).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { contentDisposition } from "@/lib/pdf/filename";
import { getPdfBranding } from "@/lib/branding";
import { buildStatementData, renderStatementHTML } from "@/lib/statement";

export async function GET(req: NextRequest, { params }: { params: { clientId: string } }) {
  try {
    const internal = req.headers.get("x-internal-key") === process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!internal) {
      const authClient = await createAuthClient();
      const { data: { user } } = await authClient.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const data = await buildStatementData(db, params.clientId);
    if ("error" in data) return NextResponse.json({ error: data.error }, { status: 404 });

    const branding = await getPdfBranding();
    const html = renderStatementHTML(data, branding);
    if (req.nextUrl.searchParams.get("html") === "1") {
      return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const pdfBuffer = await generatePDF(html);
    const clientSlug = data.clientName.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
    const filename = `${clientSlug}-Statement-${new Date().toISOString().slice(0, 10)}.pdf`;
    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(filename, req.nextUrl.searchParams.get("download")),
        "Content-Length": pdfBuffer.byteLength.toString(),
      },
    });
  } catch (err: any) {
    console.error("[PDF Statement Error]", err);
    return NextResponse.json({ error: "PDF generation failed", detail: err.message }, { status: 500 });
  }
}
