import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { reviewCertificate } from "@/lib/client-info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff: a client's resale certificates (GET) and approve / reject (POST).
// Approving marks the QuickBooks customer tax exempt (lib/client-info).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await sb.from("client_tax_certificates")
    .select("id, state, permit_number, expires_on, status, review_note, reviewed_at, created_at, client_files(file_name, drive_file_id), client_info_submissions(signer_name, signer_title, submitted_at)")
    .eq("client_id", params.id).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: subs } = await sb.from("client_info_submissions")
    .select("id, signer_name, signer_title, applied, tax_review, submitted_at").eq("client_id", params.id).order("submitted_at", { ascending: false }).limit(5);
  return NextResponse.json({ certificates: data || [], submissions: subs || [] });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const { certId, action, note } = body;
    // Staff: a tax document already on file → a certificate awaiting approval.
    if (action === "add_from_file") {
      const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const state = String(body.state || "").trim().toUpperCase().slice(0, 5), permit = String(body.permit || "").trim().slice(0, 60);
      if (!state || !permit) return NextResponse.json({ error: "State and permit number are required" }, { status: 400 });
      const { data: doc } = await db.from("client_files").select("id").eq("id", body.fileId).eq("client_id", params.id).eq("kind", "tax_exempt").maybeSingle();
      if (!doc) return NextResponse.json({ error: "That document isn't one of this client's tax documents" }, { status: 400 });
      const expiresOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body.expiresOn || "")) ? body.expiresOn : null;
      const { error } = await db.from("client_tax_certificates").insert({ client_id: params.id, state, permit_number: permit, expires_on: expiresOn, client_file_id: (doc as any).id, status: "pending" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    // Staff: fix a mistyped expiration (often the ISSUE date) on a cert still to review
    if (action === "set_expiry") {
      const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const expiresOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body.expiresOn || "")) ? body.expiresOn : null;
      const { data, error } = await db.from("client_tax_certificates").update({ expires_on: expiresOn }).eq("id", certId).eq("client_id", params.id).eq("status", "pending").select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data?.length) return NextResponse.json({ error: "Only a certificate still to review can be changed" }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    if (!certId || !["approve", "reject"].includes(action)) return NextResponse.json({ error: "certId + action required" }, { status: 400 });
    const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: own } = await db.from("client_tax_certificates").select("client_id").eq("id", certId).single();
    if (!own || (own as any).client_id !== params.id) return NextResponse.json({ error: "Certificate not found" }, { status: 404 });
    const r = await reviewCertificate(db, certId, action, user.id, note);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Review failed" }, { status: 500 });
  }
}
