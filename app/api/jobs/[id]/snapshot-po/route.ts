import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { snapshotVendorPo } from "@/lib/costing-summary";
import { mergeJobTypeMeta } from "@/lib/job-type-meta";
import { loadProductionFiles, buildRelease, releaseFor } from "@/lib/production-files";

export const dynamic = "force-dynamic";

// POST { vendor } — freeze the vendor's expected costs at PO send AND the
// release: the exact production files the printer is being handed
// (type_meta.po_releases[vendor]). Every vendor surface reads the release
// back to tell the printer "v2, sent Sep 18" and to flag files that changed
// after the send. Fired by the job page when a PO is emailed or marked sent.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await createClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { vendor } = await req.json();
    if (!vendor) return NextResponse.json({ error: "vendor required" }, { status: 400 });
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const res = await snapshotVendorPo(admin, params.id, vendor);

    // Release snapshot — independent of the cost snapshot so a costing gap
    // (no costProds) never leaves the printer without a frozen file list.
    let release: { ok: boolean; reason?: string; version?: number; files?: number } = { ok: false, reason: "not attempted" };
    try {
      const { data: job } = await admin.from("jobs").select("costing_data, type_meta").eq("id", params.id).single();
      const key = String(vendor).toLowerCase().trim();
      const itemIds = ((job?.costing_data?.costProds || []) as any[])
        .filter(p => String(p.printVendor || "").toLowerCase().trim() === key)
        .map(p => p.id).filter(Boolean);
      if (!itemIds.length) release = { ok: false, reason: "no items for vendor" };
      else {
        const filesByItem = await loadProductionFiles(admin, itemIds);
        const next = buildRelease(releaseFor(job?.type_meta, vendor), filesByItem, itemIds);
        const r = await mergeJobTypeMeta(admin, params.id, { po_releases: { ...(job?.type_meta?.po_releases || {}), [vendor]: next } });
        release = r.ok ? { ok: true, version: next.version, files: next.files.length } : { ok: false, reason: r.error };
      }
    } catch (e: any) { release = { ok: false, reason: e?.message || "release failed" }; }

    return NextResponse.json({ ...res, release }, { status: res.ok || release.ok ? 200 : 422 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "snapshot failed" }, { status: 500 });
  }
}
