// One-off (Oct 14 2026): record + approve resale certs already on file.
// Approving = the normal OpsHub path (reviewCertificate): marks the QuickBooks
// customer tax exempt with the resale number. Safe to re-run (skips certs
// already recorded for the same file).
import { createClient } from "@supabase/supabase-js";
import { reviewCertificate } from "../lib/client-info";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const certs = [
  { name: "Spiritus Systems", client: "f51dda6b-72b6-4c7f-8975-5a719aa5ee0f", file: "cbbecf7a-8a12-4d08-9289-a1e2f2c8f804", state: "NC", permit: "601005867", issued: "2024-10-03" },
  { name: "Silencer Co", client: "b68cfbb6-fbc9-401a-8c9a-21a4cd5cddf1", file: "2153a974-9b28-4a5a-974b-64d921adb70e", state: "UT", permit: "15896136-003-STC", issued: null },
  { name: "Low Rollers Club LLC", client: "0565be8c-2a29-4880-a635-29e50ddc2e2e", file: "813b9e24-b8b0-4b91-8d04-f671b470299c", state: "NV", permit: "2400016713350", issued: "2024-10-02" },
  { name: "Illicit Provisions", client: "5441673e-2052-4d59-8838-ead270141560", file: "46ff0d60-97a7-44b7-8f0d-077975751149", state: "NC", permit: "601284506", issued: "2026-06-12" },
  { name: "Forward Observations Group", client: "df6df73a-dd64-4c8f-86e9-7ea4e6af1ff1", file: "5f6ecd57-bb92-48f1-940c-25b50220bc06", state: "NV", permit: "NV20201919076", issued: "2020-10-19" },
];
(async () => {
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  const jon = users.users.find(u => u.email?.toLowerCase() === "jon@housepartydistro.com");
  if (!jon) throw new Error("no jon user");
  for (const c of certs) {
    const { data: ex } = await db.from("client_tax_certificates").select("id, status").eq("client_id", c.client).eq("client_file_id", c.file);
    let id = ex?.[0]?.id;
    if (ex?.[0] && ex[0].status !== "pending") { console.log(c.name, "already", ex[0].status); continue; }
    if (!id) {
      const { data: row, error } = await db.from("client_tax_certificates").insert({ client_id: c.client, state: c.state, permit_number: c.permit, issued_on: c.issued, client_file_id: c.file, status: "pending" }).select("id").single();
      if (error) { console.log(c.name, "INSERT ERR", error.message); continue; }
      id = row!.id;
    }
    try { const r = await reviewCertificate(db as any, id, "approve", jon.id, "Approved from cert on file (Oct 14 2026 cleanup)"); console.log(c.name, "->", r.qb); }
    catch (e: any) { console.log(c.name, "APPROVE FAILED (left pending):", e.message); }
  }
})();
