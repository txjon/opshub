# Command Center v2 — card catalog

The exhaustive list of card types that can appear on `/command-center-v2`,
organized by the three buckets + Today strip. Each card has a precise
**trigger** (when it appears), **clearing** (the action that makes it
disappear), **urgency tier**, and **deep-link** target.

Discipline: every card MUST have a clearing condition that maps to a real
action by a real role. No "info-only" cards except in the explicitly
marked `ok`-tier "at decorator" summary roll-up.

Source tables / fields referenced:
- `jobs.{ship_date, in_hands_date, quote_approved, quote_approved_at, quote_sent_at, phase, fulfillment_status, type_meta.po_sent_vendors, type_meta.invoice_sent_at}`
- `items.{pipeline_stage, blanks_order_cost, ship_tracking, received_at_hpd, artwork_status, garment_type, pipeline_timestamps}`
- `payment_records.{status, due_date, paid_date}`
- `decorator_assignments.{decorator_id, item_id}`
- `art_briefs.{state, source, sent_to_designer_at, client_aborted_at, updated_at, last_*_activity}` (see `lib/art-studio-v2.ts` for state machine)
- `clients.{id, created_at, status}`

---

## Bucket: Clients

The conversations we have with clients. What we owe them, what they owe us.

### past_ship_date
- **Trigger:** `jobs.ship_date < today AND phase NOT IN (complete, cancelled, on_hold)`
- **Clearing:** phase → complete, OR `ship_date` moved forward, OR phase → cancelled/on_hold
- **Urgency:** `critical` always (past-due is always critical)
- **Link:** `/jobs/[id]`

### awaiting_client_review
- **Trigger:** `jobs.quote_sent_at IS NOT NULL AND quote_approved = false AND quote_rejection_notes IS NULL AND phase != cancelled`
- **Clearing:** `quote_approved=true` OR `quote_rejection_notes` set (revision) OR phase → cancelled
- **Urgency:** `watch` if age ≤3d, `action` 3-7d, `critical` >7d (measured from `quote_sent_at`)
- **Link:** `/jobs/[id]` (Costing → Quote sub-tab)

### payment_overdue
- **Trigger:** `payment_records.status IN (sent, viewed, partial) AND due_date < today`
- **Clearing:** status → paid OR status → void
- **Urgency:** `action` if 1-7d overdue, `critical` if >7d
- **Link:** `/jobs/[id]` (Overview → Invoice section)

### proofs_awaiting_approval
- **Trigger:** Job has items where `artwork_status NOT IN (approved, rejected)` AND proofs have been sent (proof file uploaded with email sent) AND `quote_approved=true`
- **Clearing:** all items `artwork_status=approved` OR proof revision uploaded (resets to pending)
- **Urgency:** `watch` ≤3d, `action` 3-7d, `critical` >7d (measured from latest proof-sent timestamp)
- **Link:** `/jobs/[id]/art`

### new_lead
- **Trigger:** `clients.created_at >= now - 14d AND NOT EXISTS (jobs WHERE client_id = client.id)`
- **Clearing:** create first project for client OR mark client status → inactive
- **Urgency:** `action`
- **Link:** `/jobs/new?client=[id]`

---

## Bucket: Decorators

The conversations we have with decorators. POs to send, production to verify, exceptions.

### po_past_ship_date
- **Trigger:** `jobs.ship_date < today AND any item.pipeline_stage = in_production`
- **Clearing:** items → shipped (tracking entered) OR `ship_date` moved forward
- **Urgency:** `critical`
- **Link:** `/production?job=[id]`

### send_po
- **Trigger:** `phase = ready AND decorator V has items in this job AND V NOT IN type_meta.po_sent_vendors`
- **Clearing:** PO email sent for vendor V (auto-adds V to `po_sent_vendors`)
- **Urgency:** `action`
- **Link:** `/jobs/[id]/po`

### order_blanks
- **Trigger:** `phase = ready AND any apparel item has blanks_order_cost = 0 or NULL` (apparel = NOT in NON_GARMENT list from `lib/lifecycle.ts:61`)
- **Clearing:** all apparel items have `blanks_order_cost > 0`
- **Urgency:** `action`
- **Link:** `/jobs/[id]/blanks`

### needs_tracking
- **Trigger:** `item.pipeline_stage = in_production AND jobs.ship_date < today AND ship_tracking IS NULL`
- **Clearing:** `ship_tracking` entered (item auto-advances to shipped)
- **Urgency:** `critical`
- **Link:** `/production?job=[id]`

### verify_shipping
- **Trigger:** `item.pipeline_stage = in_production AND ship_date - today BETWEEN 0 AND 3 days AND ship_tracking IS NULL`
- **Clearing:** `ship_tracking` entered
- **Urgency:** `action` if ≤1d, `watch` if 2-3d
- **Link:** `/production?job=[id]`

### at_decorator (ok-tier summary, grouped by decorator)
- **Trigger:** group items where `pipeline_stage = in_production` by decorator
- **Clearing:** items → shipped (count decreases; row disappears at zero)
- **Urgency:** `ok` (info-only roll-up, intentionally exempt from the no-info-cards rule)
- **Link:** `/production?decorator=[id]`

---

## Bucket: Designers

The conversations we have with designers via Art Studio. Briefs awaiting review, in-flight work, handoff prep.

Powered by `art_briefs.state` + `lib/art-studio-v2.ts:resolveBrief`. Cards align with the resolver's `your_move` / `in_flight` / `delivered` sections.

### unread_message
- **Trigger:** `resolveBrief(brief).hasUnreadClient = true` (anyone — client or designer — acted more recently than HPD)
- **Clearing:** HPD posts message OR opens brief (updates `last_hpd_activity`)
- **Urgency:** `action`
- **Link:** `/art-studio/[briefId]`

### awaiting_hpd_review
- **Trigger:** `art_briefs.state = wip_review` (designer uploaded WIP)
- **Clearing:** HPD action — approve WIP, request revision, or forward to client
- **Urgency:** `action`
- **Link:** `/art-studio/[briefId]`

### new_client_request
- **Trigger:** `art_briefs.state = draft AND source = client`
- **Clearing:** HPD reviews + sends to designer OR repurposes
- **Urgency:** `action`
- **Link:** `/art-studio/[briefId]`

### final_to_print_prep
- **Trigger:** `art_briefs.state IN (final_approved, pending_prep)`
- **Clearing:** HPD marks `production_ready`, then `delivered`
- **Urgency:** `action`
- **Link:** `/art-studio/[briefId]`

### in_design
- **Trigger:** `art_briefs.state IN (sent, in_progress)` (handed to designer, no WIP yet)
- **Clearing:** designer uploads WIP → state → wip_review
- **Urgency:** `watch` ≤4d, `action` >4d (`stale`)
- **Link:** `/art-studio/[briefId]`

### with_client_review
- **Trigger:** `art_briefs.state = client_review`
- **Clearing:** client approves (→ final_approved) OR requests revision (→ revisions)
- **Urgency:** `watch` ≤3d, `action` >3d (`stale`)
- **Link:** `/art-studio/[briefId]`

### revisions_in_progress
- **Trigger:** `art_briefs.state = revisions`
- **Clearing:** designer uploads revision (→ wip_review or client_review depending on flow)
- **Urgency:** `watch` ≤4d, `action` >4d (`stale`)
- **Link:** `/art-studio/[briefId]`

---

## Today strip

Cross-cutting morning urgency above the three buckets. Three chips; each click-through to a filtered list.

### ships_today
- **Trigger:** `jobs.ship_date = today AND phase NOT IN (complete, cancelled, on_hold)`
- **Click:** filtered list of those jobs
- **Color:** blue

### in_transit
- **Trigger:** items with `pipeline_stage = shipped AND received_at_hpd = false` (en route from decorator → HPD on ship_through/stage routes). Note: we don't track ETA, so this is "outstanding" not "arriving today".
- **Click:** /receiving
- **Color:** purple
- **Alt rename:** "Incoming" — more accurate than "Receiving today" given we don't have ETA data. Confirm naming with Jon.

### stalled_7d
- **Trigger:** any item where the entry timestamp in `pipeline_timestamps[current_stage]` is >7d ago. Fallback: jobs where `updated_at` is >7d ago AND phase NOT IN (complete, cancelled, on_hold).
- **Click:** filtered list of stalled items
- **Color:** amber

---

## Sorting + grouping rules

- **Within a bucket:** sections appear in the order they're defined here (most-urgent first). Cards within a section are sorted: critical → action → watch → ok, with age as the tiebreaker (older first).
- **Bucket header hint line** (the one-liner under the bucket label) is generated from the section counts: e.g. "2 POs to send · 28 in production · 3 ship-status to verify".
- **Cards never silently disappear.** If a card clears, the page shows it crossed out briefly (or animates out) so the team sees the action register — important for trust.

---

## Open questions / gaps

1. **Proof email sent flag** — proofs_awaiting_approval card needs to know when the latest proof was emailed. Currently `item_files` doesn't track per-file email timestamps; we have `job_activity` log entries but parsing them is fragile. Decision needed: add `item_files.sent_to_client_at`, or use the activity log.
2. **Stalled detection** — `pipeline_timestamps` is populated only for items that hit each stage; brand-new items in `intake` won't have it. Need a fallback to `items.created_at` or `jobs.updated_at`.
3. **at_decorator card grouping** — should it group by decorator (current mockup) or by job? Current sample groups by decorator. Drake's call.
4. **Receiving / Incoming naming** — "Receiving today" is misleading (no ETA). Suggest "Incoming" or "In transit". Confirm with Jon.
5. **Phase 1 audit:** review with Drake — are there other cards he wants? Anything missing from his daily workflow?
