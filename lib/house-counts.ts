// Sidebar counts under The House (Jon, Sep 16 2026): a greyed number next to
// Intake / Projects / The Studio / Production, each = things needing a human
// move ON THAT PAGE, open until handled. (The pink pillar badge stays the
// inbox count — external words waiting; total here is for reference.)
//
//   intake     — new intake submissions + menu leads asking for a quote or
//                accepted and not yet converted (the /intake actionable queues)
//   projects   — intake / pending / ready jobs whose stage signal is ours
//                (act/late) — the amber/red edges on /projects; production
//                jobs belong to the Production number
//   studio     — brief words / new ideas waiting (the inbox's brief items)
//   production — vendor flags (inbox) + vendor risk (late / confirm ship-by),
//                the same cards The House's Production block shows
import { deriveProjectStage } from "@/lib/project-stage";
import { loadInbox, type InboxItem } from "@/lib/inbox";
import { vendorRiskFor, houseToday, houseSoon } from "@/lib/house-model";

export type HouseCounts = { intake: number; projects: number; studio: number; production: number; total: number };

export async function loadHouseCounts(sb: any, companyId: string, companySlug: string, inbox?: InboxItem[]): Promise<HouseCounts> {
  const items = inbox ?? await loadInbox(sb, companyId);
  const [subs, leads, jobs] = await Promise.all([
    sb.from("intake_submissions").select("id", { count: "exact", head: true })
      .eq("company_slug", companySlug).eq("status", "new")
      .then((r: any) => r.count || 0),
    sb.from("menu_leads").select("id", { count: "exact", head: true })
      .eq("company_id", companyId).in("status", ["quote_requested", "accepted"]).is("job_id", null)
      .then((r: any) => r.count || 0),
    sb.from("jobs")
      .select("id, phase, shipping_route, payment_terms, quote_approved, target_ship_date, type_meta, costing_data, payment_records(status), items(id, pipeline_stage, artwork_status, blanks_order_cost, blanks_order_number, decorator_assignments(decorators(name, short_code)))")
      .eq("company_id", companyId)
      .in("phase", ["intake", "pending", "ready", "production"])
      .then((r: any) => (r.data || []) as any[]),
  ]);

  const jobList: any[] = jobs;
  // Projects = the front of the spine only (intake / pending / ready). A job at
  // the presses is Production's number — counting it here too made the two
  // sections overlap and the pillar sum lie.
  const projects = jobList.filter((j: any) => {
    if (j.phase === "production") return false;
    const sig = deriveProjectStage(j, undefined, j.items || [], j.payment_records || []).signal;
    return sig === "act" || sig === "late";
  }).length;

  const today = houseToday(), soon = houseSoon();
  const vendorRisk = jobList.filter((j: any) => vendorRiskFor(j, today, soon)).length;
  const vendorFlags = items.filter(i => i.kind === "vendor").length;
  const studio = items.filter(i => i.kind === "brief").length;

  const counts = { intake: subs + leads, projects, studio, production: vendorRisk + vendorFlags };
  return { ...counts, total: counts.intake + counts.projects + counts.studio + counts.production };
}
