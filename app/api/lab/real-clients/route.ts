import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { labDb, newToken } from "@/lib/lab";
import { getActiveCompany } from "@/lib/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Lab's doors onto real client identity (decided Aug 4). Auth-gated —
// this is the real client book, and the lab pages themselves are open.
//
// GET ?q=  → company-scoped search-first picker (name typeahead).
// POST { clientId }                → link: lab client pointing at a real one.
// POST { name, email }             → new LEAD: real clients row flagged
//                                    is_lead (hidden from ops lists until the
//                                    first job flips it) + primary contact +
//                                    lab pointer. Email required — it's where
//                                    the quote goes.
async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET(req: NextRequest) {
  if (!(await requireUser())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  const company = await getActiveCompany();
  const db = labDb();
  let sel = db.from("clients").select("id, name, is_lead").eq("company_id", company.id).order("name").limit(20);
  if (q) sel = sel.ilike("name", `%${q}%`);
  const { data } = await sel;
  // Which of these already have a lab door? The picker shows it.
  const ids = (data || []).map((c: any) => c.id);
  let linked = new Set<string>();
  if (ids.length) {
    const { data: lc } = await db.from("lab_clients").select("client_id").in("client_id", ids);
    linked = new Set((lc || []).map((x: any) => x.client_id));
  }
  return NextResponse.json({ clients: (data || []).map((c: any) => ({ ...c, in_lab: linked.has(c.id) })) });
}

export async function POST(req: NextRequest) {
  if (!(await requireUser())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const db = labDb();

  if (b.clientId) {
    const { data: client } = await db.from("clients").select("id, name").eq("id", b.clientId).maybeSingle();
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    // One lab door per client — reuse an existing pointer instead of minting a second token.
    const { data: existing } = await db.from("lab_clients").select("*").eq("client_id", (client as any).id).maybeSingle();
    if (existing) return NextResponse.json({ client: existing, existed: true });
    const { data, error } = await db.from("lab_clients")
      .insert({ name: (client as any).name, token: newToken(), client_id: (client as any).id } as never)
      .select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ client: data });
  }

  const name = String(b.name || "").trim();
  const email = String(b.email || "").trim();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  if (!/.+@.+\..+/.test(email)) return NextResponse.json({ error: "A real email is required — it's where the quote goes" }, { status: 400 });
  const company = await getActiveCompany();
  // Search-first, enforced server-side: an existing client by this name is a
  // link, never a duplicate (client rows carry QB ids — dupes split billing).
  const { data: dupe } = await db.from("clients").select("id, name").eq("company_id", company.id).ilike("name", name).maybeSingle();
  if (dupe) return NextResponse.json({ error: `"${(dupe as any).name}" already exists — pick them from the search instead`, existingId: (dupe as any).id }, { status: 409 });

  const { data: client, error: cErr } = await db.from("clients")
    .insert({ name, client_type: "brand", company_id: company.id, is_lead: true } as never)
    .select("id, name").single();
  if (cErr || !client) return NextResponse.json({ error: cErr?.message || "Couldn't create the lead" }, { status: 500 });
  await db.from("contacts").insert({ client_id: (client as any).id, name, email, is_primary: true } as never);
  const { data, error } = await db.from("lab_clients")
    .insert({ name, token: newToken(), client_id: (client as any).id } as never)
    .select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ client: data, lead: true });
}
