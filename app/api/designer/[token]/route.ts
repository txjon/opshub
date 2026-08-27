import { NextRequest, NextResponse } from "next/server";
import { loadWorkOrderByToken, targetOf } from "@/lib/design-work-orders-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE DESIGNER'S VIEW of one work order — resolved by magic link only. The
// client's NAME rides along (Jon, Aug 26: it goes in the art, and it's how
// Slack stays searchable); nothing else about the client does. Images
// render through the token-scoped proxy (./file/[driveId]); the page builds
// those urls, so raw Drive ids never need to be trusted from the outside.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const r = await loadWorkOrderByToken(params.token);
  if (!r || r.wo.state === "killed") return NextResponse.json({ error: "This link isn't live" }, { status: 404 });
  const { wo, messages } = r;
  const t = await targetOf(wo);
  const base = `/api/designer/${params.token}/file/`;
  const safe = {
    id: wo.id, type: wo.type, title: wo.title, headline: wo.headline, instructions: wo.instructions,
    client_name: t?.clientName || null, job_number: t?.jobNumber || null,
    brief: wo.brief, due_by: wo.due_by, designer_name: wo.designer_name, state: wo.state,
    created_at: wo.created_at, updated_at: wo.updated_at,
  };
  const msgs = messages.map((m: any) => {
    const img = m._preview || m._drive;
    return {
      id: m.id, sender_role: m.sender_role, sender_name: m.sender_role === "hpd" ? "House Party Distro" : (m.sender_name || "You"),
      body: m.body, file_name: m.file_name, kind: m.kind, created_at: m.created_at,
      image_url: img ? `${base}${img}?thumb=1&size=900` : (m.file_url || null),
      download_url: m._drive ? `${base}${m._drive}?dl=1` : (m.file_url || null),
    };
  });
  return NextResponse.json({ workOrder: safe, messages: msgs, fileBase: base });
}
