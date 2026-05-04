export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createCustomer, findCustomerCandidates, getCustomerById } from "@/lib/quickbooks";

// Manual QB-customer linker. Surfaces candidates for the chooser dialog
// and writes clients.qb_customer_id when the user picks one.
//
// GET  ?clientId=xxx[&search=name]
//      → { current: { id, displayName } | null, candidates: [...] }
//      Candidates come from a fuzzy LIKE search using `search` if present,
//      else the OpsHub client.name. Used to populate the chooser.
//
// POST { clientId, qbCustomerId | null }
//      → { success: true, current: ... }
//      Sets (or clears with null) the cached qb_customer_id. We validate
//      the QB customer exists before writing so a typo can't permanently
//      mis-point the cache.

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("clientId");
    const search = (searchParams.get("search") || "").trim();
    if (!clientId) return NextResponse.json({ error: "Missing clientId" }, { status: 400 });

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: client } = await admin.from("clients").select("id, name, qb_customer_id").eq("id", clientId).single();
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    // Resolve current cached customer (if any). Failing this lookup
    // shouldn't fail the whole request — show stale id with no name.
    let current: { id: string; displayName: string | null; active: boolean } | null = null;
    if (client.qb_customer_id) {
      const cust = await getCustomerById(client.qb_customer_id);
      current = {
        id: client.qb_customer_id,
        displayName: cust?.DisplayName || null,
        active: cust ? cust.Active !== false : false,
      };
    }

    const queryName = search || client.name || "";
    const candidates = queryName ? await findCustomerCandidates(queryName, 15) : [];

    return NextResponse.json({
      clientId,
      clientName: client.name,
      searchedName: queryName,
      current,
      candidates: candidates.map((c: any) => ({
        id: c.Id,
        displayName: c.DisplayName,
        email: c.PrimaryEmailAddr?.Address || null,
        active: c.Active !== false,
      })),
    });
  } catch (e: any) {
    console.error("[QB Link Customer GET]", e);
    return NextResponse.json({ error: e.message || "Lookup failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const clientId: string | undefined = body?.clientId;
    const qbCustomerId: string | null | undefined = body?.qbCustomerId;
    const createNew: boolean = !!body?.createNew;
    const overrideName: string | undefined = body?.name;
    if (!clientId) return NextResponse.json({ error: "Missing clientId" }, { status: 400 });

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Unlink path — null/empty clears the cached id so the next push
    // re-runs the smart match.
    if (!createNew && (qbCustomerId === null || qbCustomerId === "")) {
      await admin.from("clients").update({ qb_customer_id: null }).eq("id", clientId);
      return NextResponse.json({ success: true, current: null });
    }

    // Create-new path — explicitly mint a new QB customer with the
    // OpsHub client's name (or an override) and link it. Bypasses the
    // ambiguous-match safety net entirely; meant for the case where
    // the user inspected the candidates and confirmed none match.
    if (createNew) {
      const { data: clientRow } = await admin.from("clients").select("id, name").eq("id", clientId).single();
      if (!clientRow) return NextResponse.json({ error: "Client not found" }, { status: 404 });
      const name = overrideName || clientRow.name;
      if (!name) return NextResponse.json({ error: "Missing customer name" }, { status: 400 });
      const cust = await createCustomer(name);
      await admin.from("clients").update({ qb_customer_id: cust.Id }).eq("id", clientId);
      return NextResponse.json({
        success: true,
        created: true,
        current: { id: cust.Id, displayName: cust.DisplayName, active: cust.Active !== false },
      });
    }

    if (!qbCustomerId) return NextResponse.json({ error: "Missing qbCustomerId" }, { status: 400 });

    // Validate the QB customer exists before writing — a bad id here
    // would silently send invoices to the wrong place forever.
    const cust = await getCustomerById(String(qbCustomerId));
    if (!cust) return NextResponse.json({ error: "QuickBooks customer not found" }, { status: 404 });

    await admin.from("clients").update({ qb_customer_id: String(qbCustomerId) }).eq("id", clientId);

    return NextResponse.json({
      success: true,
      current: {
        id: cust.Id,
        displayName: cust.DisplayName,
        active: cust.Active !== false,
      },
    });
  } catch (e: any) {
    console.error("[QB Link Customer POST]", e);
    return NextResponse.json({ error: e.message || "Link failed" }, { status: 500 });
  }
}
