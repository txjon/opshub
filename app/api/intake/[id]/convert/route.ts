export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/intake/[id]/convert
//
// Promotes an intake_submission into a real customer record. The
// caller decides whether to:
//   - link to an existing clients row (mode = "existing"), OR
//   - create a new clients row (mode = "new")
//
// Either way, the submission's contact gets attached to the client.
// Optionally creates a draft project pre-filled from the submission
// scope (project_type, name, shipping_route, target_ship_date).
//
// On success: flips submission.status = 'converted', records the
// linkage (client_id, project_id), and stamps reviewed_at/by.

type Mode = "existing" | "new";

const PROJECT_TYPE_TO_CLIENT_TYPE: Record<string, string> = {
  brand: "brand",
  tour: "tour",
  corporate: "corporate",
  webstore: "webstore",
};

// shipping_route on the form uses different vocabulary than jobs.shipping_route
// in OpsHub. Map to the internal terms.
const SHIPPING_ROUTE_MAP: Record<string, string> = {
  drop_ship: "drop_ship",
  ship_to_us: "ship_through",
  hold_for_fulfillment: "stage",
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const mode: Mode = body?.mode === "existing" ? "existing" : "new";
    const existingClientId: string | null = body?.existing_client_id || null;
    const createProject: boolean = !!body?.create_project;
    const newClient = body?.new_client || {};

    // 1. Load the submission
    const { data: sub, error: subErr } = await (supabase.from("intake_submissions") as any)
      .select("*")
      .eq("id", params.id)
      .single();
    if (subErr || !sub) {
      return NextResponse.json({ error: subErr?.message || "Submission not found" }, { status: 404 });
    }
    if (sub.status === "converted") {
      return NextResponse.json({ error: "Already converted" }, { status: 400 });
    }

    // 2. Resolve client_id — existing or new
    let clientId: string;
    if (mode === "existing") {
      if (!existingClientId) {
        return NextResponse.json({ error: "existing_client_id required when mode=existing" }, { status: 400 });
      }
      clientId = existingClientId;
    } else {
      const clientType =
        newClient.client_type
        || PROJECT_TYPE_TO_CLIENT_TYPE[sub.project_type || ""]
        || "corporate";

      const { data: newRow, error: cErr } = await (supabase.from("clients") as any)
        .insert({
          name: (newClient.name || sub.company).trim(),
          client_type: clientType,
          default_terms: newClient.default_terms || null,
          notes: `Converted from intake submission ${sub.id} on ${new Date().toISOString().slice(0, 10)}`,
        })
        .select("id")
        .single();
      if (cErr || !newRow) {
        return NextResponse.json({ error: cErr?.message || "Could not create client" }, { status: 500 });
      }
      clientId = newRow.id;
    }

    // 3. Attach the contact (idempotent — skip if email already on this client)
    const { data: existingContact } = await supabase
      .from("contacts")
      .select("id")
      .eq("client_id", clientId)
      .ilike("email", sub.contact_email)
      .maybeSingle();
    if (!existingContact) {
      await (supabase.from("contacts") as any).insert({
        client_id: clientId,
        name: sub.contact_name,
        email: sub.contact_email,
        phone: sub.contact_phone,
        is_primary: mode === "new",  // new client → this is the primary; existing → don't override
      });
    }

    // 4. Optionally create a draft project
    let projectId: string | null = null;
    if (createProject) {
      const shippingRoute = SHIPPING_ROUTE_MAP[sub.shipping_route || ""] || "ship_through";
      const { data: newJob, error: jErr } = await (supabase.from("jobs") as any)
        .insert({
          client_id: clientId,
          title: sub.project_name || `New project — ${sub.company}`,
          shipping_route: shippingRoute,
          target_ship_date: sub.target_ship_date || null,
          phase: "intake",
          notes: buildProjectNotes(sub),
        })
        .select("id")
        .single();
      if (jErr) {
        console.error("[intake/convert] project create failed:", jErr);
        // Don't fail the whole flow — return what we have
      } else {
        projectId = newJob.id;
      }
    }

    // 5. Flip submission status
    await (supabase.from("intake_submissions") as any)
      .update({
        status: "converted",
        client_id: clientId,
        project_id: projectId,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      })
      .eq("id", params.id);

    return NextResponse.json({
      ok: true,
      client_id: clientId,
      project_id: projectId,
    });
  } catch (e: any) {
    console.error("[intake/convert]", e);
    return NextResponse.json({ error: e.message || "Convert failed" }, { status: 500 });
  }
}

// Human-readable summary of the intake — written onto the project's
// notes field so the team has the full briefing inline in the new job.
function buildProjectNotes(sub: any): string {
  const lines: string[] = ["━━━ FROM INTAKE ━━━"];
  if (sub.description) lines.push(sub.description.trim());
  const scope: string[] = [];
  if (sub.items_count_range) scope.push(`Designs: ${sub.items_count_range}`);
  if (sub.units_range)       scope.push(`Units: ${sub.units_range}`);
  if (sub.budget_range)      scope.push(`Budget: ${sub.budget_range}`);
  if (scope.length) lines.push("", "Scope: " + scope.join(" · "));
  const itemsArr: any[] = Array.isArray(sub.items) ? sub.items : [];
  if (itemsArr.length) {
    lines.push("", "Items breakdown:");
    for (const it of itemsArr) {
      const sizeStr = Object.entries(it.sizes || {}).map(([k, v]) => `${k}(${v})`).join(" ");
      lines.push(`  • ${it.name || "Item"}${sizeStr ? ` — ${sizeStr}` : ""}`);
    }
  }
  const filesArr: any[] = Array.isArray(sub.files) ? sub.files : [];
  if (filesArr.length) {
    lines.push("", "Files attached:");
    for (const f of filesArr) {
      lines.push(`  • ${f.filename || "file"}`);
      if (f.url) lines.push(`    ${f.url}`);
    }
  }
  return lines.join("\n");
}

// PATCH /api/intake/[id]/convert — used by the inbox to update
// non-conversion status changes (mark reviewed, decline). Kept on the
// same route for proximity; the inbox dispatches based on action.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action: "review" | "decline" | "unreview" = body?.action;

    const patch: any = {};
    if (action === "review") {
      patch.status = "reviewed";
      patch.reviewed_at = new Date().toISOString();
      patch.reviewed_by = user.id;
    } else if (action === "decline") {
      patch.status = "declined";
      patch.reviewed_at = new Date().toISOString();
      patch.reviewed_by = user.id;
    } else if (action === "unreview") {
      patch.status = "new";
      patch.reviewed_at = null;
      patch.reviewed_by = null;
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const { error } = await (supabase.from("intake_submissions") as any)
      .update(patch)
      .eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
