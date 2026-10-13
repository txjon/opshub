// One-time backfill for mig 200: split stored address text into parts.
//   npx tsx --env-file=.env.local scripts/backfill-addresses-200.ts          (dry run)
//   npx tsx --env-file=.env.local scripts/backfill-addresses-200.ts --apply
// Old text is copied to address_backup_200 first (reversible). Rows that
// don't parse confidently are LEFT ALONE (old text kept, parts empty) and
// listed for a person to fix.
import { createClient } from "@supabase/supabase-js";
import { cleanAddr, locAddrCols, billAddrCols, parseAddressText as parse, type Addr } from "../lib/address";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes("--apply");
// Hand-checked splits (Oct 13 2026) for rows the parser can't read. Each is
// the SAME text re-arranged, or completed from an identical street line on
// another record (noted). Keyed kind:id.
const HPD_DOCK = { line1: "4670 W Silverado Ranch Blvd", line2: "STE 120", city: "Las Vegas", state: "NV", zip: "89139", country: "US" };   // 9 records agree (1 says 89118)
const PRIVATEER = { name: "Derek Rhodes / Privateer Group", line1: "425 C Ave", line2: "", city: "Coronado", state: "CA", zip: "92118", country: "US" };
const CLEARED_HOT = { name: "Sam Laliberte / Cleared Hot Inc", line1: "3783 Dundonald Dr", line2: "", city: "Petawawa", state: "ON", zip: "K8H 2V8", country: "Canada" };
const MIICRO = { name: "", line1: "12302 Dusk Blue Way", line2: "Unit 3", city: "Las Vegas", state: "NV", zip: "89183", country: "US" };   // city/ZIP from the identical street on Low Rollers Club
const HEAVEN = { name: "13TH HEAVEN", line1: "933 Ponderosa Pine Dr.", line2: "", city: "El Paso", state: "TX", zip: "79927", country: "US" };   // ZIP from the identical street on Violentia / Bravo Actual
const OVERRIDES: Record<string, Addr> = {
  "location:5f91218a-a886-45ac-b0e2-bf3624838203": cleanAddr(PRIVATEER), "billing:8fe12838-80ad-426d-88bf-155ad9ca3300": cleanAddr(PRIVATEER),
  "location:39bdba73-db66-49e1-9979-41b17de9df16": cleanAddr(CLEARED_HOT), "billing:bced8ea2-a57d-457d-85bb-f0ced38a78e4": cleanAddr(CLEARED_HOT),
  "billing:930e488c-0b0e-43ca-bdc3-6e617ad96183": cleanAddr({ name: "3DMILITARYASSETS LLC", line1: "3101 N Central Ave", line2: "Ste 183 #5654", city: "Phoenix", state: "AZ", zip: "85012", country: "US" }),
  "location:9225208a-7622-40fa-948a-d8cbd2c2bdf0": cleanAddr({ name: "", ...HPD_DOCK }), "billing:1e35f6f5-e566-45a6-8ec1-2c9dc18d3ac2": cleanAddr({ name: "", ...HPD_DOCK }),
  "location:2c739c9f-8407-4c45-8cb6-cf697f923ba0": cleanAddr(MIICRO), "billing:3f6ddbd0-bff9-4f09-a256-eb95d21f7016": cleanAddr(MIICRO),
  "location:0c446c9e-cc9e-4086-9ad8-b713fda2bbbc": cleanAddr(HEAVEN), "billing:362cbc72-fd5c-4acf-a02f-d251581e7f79": cleanAddr(HEAVEN),
};

(async () => {
  const locs: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from("client_locations").select("id, client_id, job_id, label, address, active, addr_line1, clients(name), jobs!client_locations_job_id_fkey(id, job_number)").order("id").range(f, f + 999);
    if (error) throw error; locs.push(...(data || [])); if (!data || data.length < 1000) break;
  }
  const { data: cls, error: cErr } = await db.from("clients").select("id, name, billing_address, bill_line1").order("id").range(0, 4999);
  if (cErr) throw cErr;

  type Row = { kind: "location" | "billing"; id: string; old: string; r: ReturnType<typeof parse>; meta: any };
  const rows: Row[] = [
    ...locs.filter(l => l.address && !l.addr_line1).map(l => ({ kind: "location" as const, id: l.id, old: l.address, r: parse(l.address), meta: l })),
    ...(cls || []).filter((c: any) => c.billing_address && !c.bill_line1).map((c: any) => ({ kind: "billing" as const, id: c.id, old: c.billing_address, r: parse(c.billing_address), meta: c })),
  ];
  for (const x of rows) { const o = OVERRIDES[`${x.kind}:${x.id}`]; if (o && !x.r.ok) x.r = { ok: true, a: o }; }
  const ok = rows.filter(x => x.r.ok), bad = rows.filter(x => !x.r.ok);
  console.log(`${rows.length} to split: ${ok.length} clean, ${bad.length} need a person`);
  console.log(JSON.stringify(bad.map(x => ({ kind: x.kind, id: x.id, client: x.kind === "billing" ? x.meta.name : x.meta.clients?.name, clientId: x.kind === "billing" ? x.id : x.meta.client_id, job: x.meta.jobs?.job_number || null, active: x.kind === "billing" ? true : x.meta.active, label: x.meta.label || "Billing", old: x.old, why: (x.r as any).why }))));
  if (process.argv.includes("--show")) for (const x of ok) console.log(JSON.stringify(x.old), "=>", JSON.stringify((x.r as any).a));
  if (!APPLY) { console.log("dry run — nothing written"); return; }

  const { error: bErr } = await db.rpc("exec_sql", { sql: `create table if not exists public.address_backup_200 (kind text not null, row_id uuid not null, old_text text, backed_up_at timestamptz not null default now(), primary key (kind, row_id)); alter table public.address_backup_200 enable row level security; grant all on public.address_backup_200 to service_role;` });
  if (bErr) throw bErr;
  for (let i = 0; i < ok.length; i += 200) {
    const { error } = await db.from("address_backup_200" as any).upsert(ok.slice(i, i + 200).map(x => ({ kind: x.kind, row_id: x.id, old_text: x.old })), { onConflict: "kind,row_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  let n = 0;
  for (const x of ok) {
    const a = (x.r as any).a as Addr;
    const { error } = x.kind === "location"
      ? await db.from("client_locations").update(locAddrCols(a)).eq("id", x.id)
      : await db.from("clients").update(billAddrCols(a)).eq("id", x.id);
    if (error) throw new Error(`${x.kind} ${x.id}: ${error.message}`);
    n++;
  }
  console.log(`applied ${n}`);
})().catch(e => { console.error(e); process.exit(1); });
