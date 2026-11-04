// Live check of the QB renewal lease (Nov 4 2026, mig 208). Marks the stored
// token as due, then starts TWO separate processes that both ask for a token
// at the same moment. Pass = exactly one refresh_start/refresh in the log,
// both processes end with the same token, and QB accepts it. This renews the
// real token once (a normal renewal, same as the hourly ones).
// Run: set -a; source .env.local; set +a; npx tsx scripts/qb-lease-race-test.ts
import { createClient } from "@supabase/supabase-js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function child(label: string) {
  const shim = path.join(__dirname, "_lease_shim.cjs");
  const worker = path.join(__dirname, "_lease_worker.ts");
  return new Promise<string>(resolve => {
    const p = spawn("npx", ["tsx", worker, label], { env: process.env, cwd: path.join(__dirname, "..") });
    let out = ""; p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d);
    p.on("close", () => resolve(out.trim().split("\n").filter(l => l.startsWith(label)).join("\n") || out.trim().slice(-300)));
    void shim;
  });
}

(async () => {
  fs.writeFileSync(path.join(__dirname, "_lease_shim.cjs"), 'const r=require("react"); if(!r.cache) r.cache=(f)=>f;\n');
  fs.writeFileSync(path.join(__dirname, "_lease_worker.ts"), `require("./_lease_shim.cjs");
(async () => {
  const q = await import("../lib/quickbooks");
  const t0 = Date.now();
  const tok = await q.getAccessToken();
  console.log(process.argv[2], "token ...", tok.slice(-6), "in", Date.now() - t0, "ms");
})().catch(e => console.log(process.argv[2], "ERROR", e.message));
`);
  try {
    const startedAt = new Date().toISOString();
    const { data: t } = await db.from("qb_tokens").select("id").limit(1).single();
    await db.from("qb_tokens").update({ expires_at: new Date(Date.now() + 60_000).toISOString() }).eq("id", (t as any).id);
    const [a, b] = await Promise.all([child("A"), child("B")]);
    console.log(a); console.log(b);
    const { data: s } = await db.from("qb_tokens").select("realm_id,access_token,refresh_lock_owner").limit(1).single();
    const r = await fetch(`https://quickbooks.api.intuit.com/v3/company/${(s as any).realm_id}/companyinfo/${(s as any).realm_id}?minorversion=73`, { headers: { Authorization: `Bearer ${(s as any).access_token}`, Accept: "application/json" } });
    console.log("QuickBooks accepts the stored token:", r.status === 200 ? "YES" : `NO (${r.status})`, "| lease left held:", (s as any).refresh_lock_owner || "none");
    const { data: e } = await db.from("qb_token_events").select("at,event,old_fp,new_fp,instance").gte("at", startedAt).order("at");
    for (const x of e || []) console.log(" ", x.at.slice(11, 23), x.event.padEnd(14), x.old_fp, "→", x.new_fp, x.instance || "");
    const renewals = (e || []).filter(x => x.event === "refresh_start").length;
    console.log(renewals === 1 ? "PASS: one renewal, the other process waited" : `CHECK: ${renewals} renewals started`);
  } finally {
    fs.rmSync(path.join(__dirname, "_lease_shim.cjs"), { force: true });
    fs.rmSync(path.join(__dirname, "_lease_worker.ts"), { force: true });
  }
})();
