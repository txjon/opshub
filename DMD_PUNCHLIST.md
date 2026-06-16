# Dark Matter Dynamics (DMD) — Setup Punch List

Living checklist of out-of-band items **Jon** must do (the parts code can't).
Maintained by Claude across the DMD tenant build. `[ ]` = todo, `[x]` = done.

See `project_dmd_tenant` memory for the full build plan/phases.

---

## Domains / DNS
- [ ] **Vercel:** add `app.darkmatterdynamics.co` as a domain on the opshub project.
- [ ] **DNS:** point `app.darkmatterdynamics.co` → Vercel (CNAME/A per Vercel's instructions).
- [ ] (dev) `dmd.localhost:3000` works automatically in Chrome — no hosts file needed.

## Email (Resend)
- [ ] **Verify the `darkmatterdynamics.co` sending domain in Resend** (DKIM/SPF DNS records).
      Until done, DMD quote/PO/invoice emails will NOT send.
- [ ] Decide: reuse the existing `RESEND_API_KEY`, or a DMD-restricted key
      `RESEND_API_KEY_DMD` (HPD/IHM pattern). If separate → add the env var (below).
- [ ] Confirm the from-addresses seeded are the ones you want:
      `hello@`, `production@`, `billing@` `@darkmatterdynamics.co`.

## QuickBooks (Phase 2 — needs the multi-tenant QB code first)
- [ ] **Connect DMD's QuickBooks** via the in-app OAuth flow once Phase 2 ships
      (stores DMD's realm + tokens scoped to company_id).
- [ ] Confirm DMD's QB company/realm exists and you have admin access.

## Environment variables (Vercel)
- [ ] _(maybe)_ `RESEND_API_KEY_DMD` — only if using a separate Resend key for DMD.
- [ ] QB: no new env needed if realm/tokens are stored per-company in DB (the Phase 2
      plan). The shared `QB_CLIENT_ID/SECRET/WEBHOOK_VERIFIER_TOKEN` cover all realms.
      → confirmed once Phase 2 lands.

## Database / SQL (most already applied by Claude via service role)
- [x] `companies` row for DMD seeded (slug=dmd, prefix=DMD, QB provider, addresses,
      departments labs/contacts/settings) + Jon owner membership. *(scripts/seed-dmd.cjs)*
- [ ] **Confirm bill-to address suite + zip** — seeded as "6280 S Valley View Blvd,
      Las Vegas, NV" (incomplete). Update via Settings or tell Claude.
- [ ] **Google Drive folder** for DMD: create the root folder, share with the service
      account, then set `companies.drive_folder_id` (so art files file under DMD).

## Assets
- [ ] **Outlined DMD logo SVG** — re-export from Illustrator with **Type → Create
      Outlines** (current export has live GothamBlack text Browserless can't render).
      Claude is using a temporary system-font placeholder until then.
- [~] **favicon-dmd.svg** — placeholder "DMD" monogram created; swap for the
      branded mark when ready.

## Deferred (needs Jon present to test)
- [ ] **Cut-and-sew item auto-default** — new DMD items auto-set garment_type to
      "custom" (flat per-unit, no blank). The MODEL already works (pick "Custom"
      type → accessory costing layout, no blank gate, no "No blank" nag). Auto-
      defaulting it touches the buy-sheet add path (saving-sensitive), so left for
      a session where Jon can verify saving. For now: pick "Custom" type manually.

---

_Last updated by Claude: Phase 1a + 1b shipped to dev (tenant scaffolding,
all routing centralized in lib/tenants.ts, no-blank nag suppressed, favicon
placeholder). Cut-sew auto-default deferred; Phase 2 (QB multi-tenancy) next._
