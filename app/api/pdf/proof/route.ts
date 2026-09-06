export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { renderProofHtml } from "@/lib/proof-html";

// Render the product proof PDF from ProofDocView (the SAME component as the web
// proof) → Browserless. All display data arrives in the POST body (spec +
// pre-cropped mockup + branding); no DB read. Auth-gated so only signed-in team
// members can spend Browserless quota. See lib/proof-html.tsx (the cure).
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    if (!body?.spec) return NextResponse.json({ error: "Missing spec" }, { status: 400 });
    const html = await renderProofHtml(body);
    const pdf = await generatePDF(html);
    return new NextResponse(pdf as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="proof.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[pdf/proof]", e?.message || e);
    return NextResponse.json({ error: e?.message || "PDF generation failed" }, { status: 500 });
  }
}
