export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { freezeVersion, currentVersion, markVersionSent } from "@/lib/proof-versions";

const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Freeze the current art as a proof version. Called when the editor closes on
// changed art and when proofs are sent. No PDF is made here — the document is
// rendered from this record whenever somebody asks for it
// (/api/proof/[versionId]/pdf), so it can never be out of date.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await createServerClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body?.spec) return NextResponse.json({ error: "Missing spec" }, { status: 400 });

  const db = admin();
  const { data: item } = await db.from("items").select("id, name, blank_vendor, blank_sku").eq("id", params.id).maybeSingle();
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const res = await freezeVersion(db, {
    itemId: params.id,
    spec: body.spec,
    itemSnapshot: { name: (item as any).name, blank_vendor: (item as any).blank_vendor, blank_sku: (item as any).blank_sku },
    mockupDriveFileId: body.mockupDriveFileId || null,
    rendererVersion: body.rendererVersion ?? null,
    createdBy: user.id,
    state: body.state === "sent" ? "sent" : "draft",
    note: body.note || null,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });

  // A NEW version over an approved one means the art moved on: the item is no
  // longer approved, and the client has to look again. Any new version counts,
  // draft or sent — otherwise the screen reads "approved" over a document
  // nobody has seen (Jon caught exactly this, Sep 2026).
  if (res.version.state !== "approved") {
    const { data: hadApproved } = await db.from("proof_versions")
      .select("id, version").eq("item_id", params.id).eq("state", "approved").limit(1);
    if ((hadApproved || []).length && (hadApproved as any)[0].version < res.version.version) {
      await db.from("items").update({ artwork_status: "not_started" }).eq("id", params.id).eq("artwork_status", "approved");
      await db.from("item_files").update({ approval: "pending", approved_at: null })
        .eq("item_id", params.id).eq("stage", "proof").is("superseded_at", null).eq("approval", "approved");
    }
  }
  return NextResponse.json({ version: res.version });
}

// What version is current for this item, for the surfaces that show it.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await createServerClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const version = await currentVersion(admin(), params.id);
  return NextResponse.json({ version });
}

// Mark the current version as SENT — the document the client is now looking
// at. Only the send flow calls this, and the date is stamped here, so a version
// can never claim a send that did not happen.
export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await createServerClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const version = await markVersionSent(admin(), params.id);
  return NextResponse.json({ version });
}
