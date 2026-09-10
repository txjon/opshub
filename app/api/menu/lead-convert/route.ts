export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resendForSlug } from "@/lib/resend-client";
import { renderBrandedEmail } from "@/lib/email-template";
import { distributeCurve, gridKey, SIZE_ORDER, type Quote } from "@/lib/menu-quote";

// POST /api/menu/lead-convert — the accepted quote becomes a real job.
// { leadId, clientId?, clientName? }
//
// Single-source doctrine from birth: quote line unitPrice →
// items.sell_per_unit (sell truth); punch size grids → buy_sheet_lines
// (qty truth), one ITEM PER COLORWAY (how jobs model reality). No
// costing_data is fabricated — money enters the P&L when Taylor runs
// costing, same gate as every job; refreshJobFinancials no-ops cleanly
// until then. Missing size grids seed the standard curve, loudly marked
// in the item notes — production orders nothing before proof approval
// anyway, and the worksheet is where Taylor trues it up.
//
// The stranger→family handoff: a new client's portal_token mints via
// trigger (mig 025) and hub access defaults ON (mig 169), so the client
// gets their Client Hub link in the confirmation email.

const FROM_EMAIL = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const leadId = String(body?.leadId || "");
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });

  const { data: lead } = await supabase
    .from("menu_leads")
    .select("id,email,token,status,quote,picks,contact,client_match,job_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  if (lead.job_id) return NextResponse.json({ error: "Already converted — job exists." }, { status: 400 });
  const quote = lead.quote as Quote | null;
  if (!quote?.lines?.length) return NextResponse.json({ error: "No quote on this lead." }, { status: 400 });

  const contact = (lead.contact || {}) as { name?: string; phone?: string | null; neededBy?: string | null };
  const punchOf = (key: string) => quote.punch.find((p) => p.key === key);

  // 1. Client — existing match, explicit pick, or create (portal token +
  // hub access arrive via triggers/defaults).
  let clientId: string = String(body?.clientId || lead.client_match || "");
  let createdClient = false;
  if (!clientId) {
    const name = String(body?.clientName || contact.name || lead.email.split("@")[0]).trim();
    if (!name) return NextResponse.json({ error: "clientName required for a new client." }, { status: 400 });
    const { data: newClient, error: cErr } = await supabase
      .from("clients")
      .insert({
        name,
        client_type: "brand",
        notes: `Created from menu quote (lead ${lead.id.slice(0, 8)}) on ${new Date().toISOString().slice(0, 10)}`,
      } as never)
      .select("id")
      .single();
    if (cErr || !newClient) return NextResponse.json({ error: cErr?.message || "Could not create client." }, { status: 500 });
    clientId = (newClient as { id: string }).id;
    createdClient = true;
  }

  // 2. Contact attach (idempotent).
  const { data: existingContact } = await supabase
    .from("contacts")
    .select("id")
    .eq("client_id", clientId)
    .ilike("email", lead.email)
    .maybeSingle();
  if (!existingContact) {
    await supabase.from("contacts").insert({
      client_id: clientId,
      name: contact.name || lead.email,
      email: lead.email,
      phone: contact.phone || null,
      is_primary: createdClient,
    } as never);
  }

  // 3. Job. Route from the ship punch ("hold at House Party" → stage);
  // in-hand date from the date punch when it parses.
  const shipText = String((punchOf("ship")?.payload as any)?.value || "");
  const shippingRoute = /hold|fulfil|house party|warehouse|stage/i.test(shipText) ? "stage" : "drop_ship";
  const dateVal = String((punchOf("date")?.payload as any)?.value || "");
  const targetShip = /^\d{4}-\d{2}-\d{2}$/.test(dateVal) ? dateVal : null;

  const artFiles = [
    ...(((punchOf("art")?.payload as any)?.files || []) as { filename: string; url?: string | null }[]),
    ...(((lead.picks as any)?.files || []) as { filename: string; url?: string | null; styleCode?: string | null; placement?: string | null }[]),
  ];
  const openPoints = quote.punch.filter((p) => p.required && p.status !== "done").map((p) => p.label);
  const noteLines = [
    `Build quote accepted ${quote.acceptedAt?.slice(0, 10) || ""} — total $${(quote.total || 0).toLocaleString()} (good through ${quote.validUntil}).`,
    shipText ? `Ship: ${shipText}` : null,
    openPoints.length ? `STILL OPEN on the client checklist: ${openPoints.join(", ")}` : "Client checklist complete.",
    artFiles.length ? "Client art files:" : null,
    ...artFiles.map((f) => `  • ${f.filename}${(f as any).placement ? ` (${(f as any).placement})` : ""}${f.url ? ` — ${f.url}` : ""}`),
    `Quote page: https://app.housepartydistro.com/intake (lead) · client link housepartydistro.com/build/${lead.token}`,
  ].filter(Boolean).join("\n");

  // job_type is NOT NULL — same default chain as quick-create.
  const { data: cRow } = await supabase.from("clients").select("client_type").eq("id", clientId).single();
  const validTypes = ["corporate", "brand", "artist", "tour", "webstore", "drop_ship"];
  const jobType = validTypes.includes((cRow as any)?.client_type) ? (cRow as any).client_type : "brand";

  const { data: job, error: jErr } = await supabase
    .from("jobs")
    .insert({
      client_id: clientId,
      job_type: jobType,
      title: quote.lines[0]?.label
        ? `${quote.lines[0].label}${quote.lines.length > 1 ? ` +${quote.lines.length - 1} more` : ""}`
        : "Menu order",
      phase: "intake",
      shipping_route: shippingRoute,
      target_ship_date: targetShip,
      notes: noteLines,
      type_meta: { menu_lead_id: lead.id, menu_quote_total: quote.total || 0 },
    } as never)
    .select("id, job_number")
    .single();
  if (jErr || !job) return NextResponse.json({ error: jErr?.message || "Job create failed." }, { status: 500 });
  const jobId = (job as { id: string }).id;

  // 4. Items per line × colorway + buy_sheet_lines from the punch grids.
  const grids = ((punchOf("sizes")?.payload as any)?.grids || {}) as Record<string, Record<string, number>>;
  let sortOrder = 0;
  for (let li = 0; li < quote.lines.length; li++) {
    const line = quote.lines[li];
    const colorways = line.colors.length ? line.colors : [null];
    for (const cw of colorways) {
      const grid = grids[gridKey(li, cw)];
      const splitQty = Math.round(line.qty / colorways.length);
      const isSized = !!line.styleCode; // custom fee lines get a single OS row
      const curved = isSized && !grid;
      const { data: item, error: iErr } = await supabase
        .from("items")
        .insert({
          job_id: jobId,
          name: cw ? `${line.label} - ${cw}` : line.label,
          blank_vendor: line.styleCode ? line.label : null,
          mockup_color: cw,
          sell_per_unit: line.unitPrice,
          sort_order: sortOrder++,
          notes: [line.note, curved ? "Sizes: standard curve seeded — client had not filled the grid; true up in the worksheet." : null]
            .filter(Boolean).join(" · ") || null,
        } as never)
        .select("id")
        .single();
      if (iErr || !item) return NextResponse.json({ error: iErr?.message || "Item create failed." }, { status: 500 });
      const itemId = (item as { id: string }).id;

      const sizes: Record<string, number> = grid && Object.values(grid).some((n) => n > 0)
        ? grid
        : curved
          ? distributeCurve(splitQty)
          : { OS: splitQty };
      const rows = Object.entries(sizes)
        .filter(([, q]) => Number(q) > 0)
        .map(([size, q]) => ({ item_id: itemId, size, qty_ordered: Number(q) }));
      // Stable size order for the worksheet.
      rows.sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size));
      if (rows.length) {
        const { error: bErr } = await supabase.from("buy_sheet_lines").insert(rows as never);
        if (bErr) return NextResponse.json({ error: `Buy sheet failed: ${bErr.message}` }, { status: 500 });
      }
    }
  }

  // 5. Close the loop on the lead.
  await supabase
    .from("menu_leads")
    .update({ status: "converted", job_id: jobId, updated_at: new Date().toISOString() } as never)
    .eq("id", lead.id);

  // 6. The stranger→family handoff: hub link in the confirmation email.
  const { data: clientRow } = await supabase
    .from("clients")
    .select("name, portal_token, client_hub_enabled")
    .eq("id", clientId)
    .single();
  const hubToken = (clientRow as any)?.portal_token;
  const firstName = (contact.name || "").trim().split(/\s+/)[0] || "there";
  try {
    await resendForSlug("hpd").emails.send({
      from: `House Party Distro <${FROM_EMAIL}>`,
      to: lead.email,
      replyTo: FROM_EMAIL,
      subject: "You're in — your order is rolling",
      html: renderBrandedEmail({
        heading: "Your order is officially in the works.",
        greeting: `Hi ${firstName},`,
        bodyHtml: `We are building your job now. Next step on our side: your proof — you approve it before anything prints.${openPoints.length ? `<br/><br/>Two seconds when you get a chance: <strong>${openPoints.join(", ")}</strong> — still open on <a href="https://housepartydistro.com/build/${lead.token}">your checklist</a>.` : ""}<br/><br/>From here on out, your House Party hub is home — orders, tracking, everything.`,
        cta: hubToken ? { label: "Open your hub", url: `https://app.housepartydistro.com/portal/client/${hubToken}` } : undefined,
        hint: "Reply to this email any time.",
      }),
    });
  } catch (err) {
    console.error("convert welcome email failed", err);
  }

  return NextResponse.json({
    ok: true,
    jobId,
    jobNumber: (job as any).job_number || null,
    clientId,
    createdClient,
  });
}
