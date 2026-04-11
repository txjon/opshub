# OpsHub Master Roadmap

Everything discussed, planned, or identified — consolidated and deduplicated.
Items marked [SHIPPED] are built. Everything else is open.

---

## 1. QUOTING & SALES

- [ ] Quick Quote calculator — ballpark pricing without a full job build
- [ ] Quote follow-up alerts — auto-surface quotes with no response after 3 days
- [ ] Quote sent log on Quote tab — show when/to whom quote was sent
- [ ] Quote PDF — mockup thumbnails per item
- [ ] Quote PDF — "sales tax TBD" disclaimer
- [ ] Quote re-send clears rejection notes [SHIPPED]
- [ ] Pricing intelligence Phase 1 — log every pricing decision (inputs + outputs)
- [ ] Pricing intelligence Phase 2 — surface suggestions ("last time you priced this at...")
- [ ] Pricing intelligence Phase 3 — auto-price based on historical patterns

## 2. CLIENT PORTAL & COMMUNICATION

- [x] Client portal — magic link, quote/proof view, payment status [SHIPPED]
- [ ] Portal proof approval — approve/reject in modal, status flows back
- [ ] Portal reorder — "order this again" from history, pre-filled, adjustable quantities
- [ ] Portal order status — client sees where their order is without asking
- [ ] Portal mockup thumbnails per item [SHIPPED partial — needs Drive thumbnail fix]
- [ ] Portal — filter out internal activity logs (PSD processing, item creation)
- [ ] Portal — payment received shows paid amount
- [ ] Stripe payment links — branded client-facing payments (ACH, card, Apple/Google Pay)
- [ ] Client intake form — public-facing on HPD website, feeds into new job
- [ ] HPD website — services, portfolio, 6-step guided intake form, portal access
- [ ] Proof approval via magic links (no login required)

## 3. CLIENT EMAILS (AUTOMATED)

- [x] Quote email with Approve button + Portal link [SHIPPED]
- [x] Invoice email with Pay Now + Portal link [SHIPPED]
- [x] Payment received — auto-send PAID-stamped invoice PDF [SHIPPED]
- [x] Order shipped — auto-send packing slip PDF [SHIPPED]
- [ ] Quote follow-up — auto-send if no response in X days
- [ ] Payment reminder — auto-send when overdue
- [ ] Proof follow-up — auto-send if proofs pending approval
- [ ] Delivery confirmation — auto-send after delivery
- [ ] Revised proof notification — auto-notify client when new proof uploaded

## 4. EMAIL PIPELINE

- [x] Outbound email from OpsHub (quote, PO, invoice, compose) [SHIPPED]
- [x] Gmail inbound capture — 5-min poll, parse replies, route to project [SHIPPED]
- [ ] Inbound email routing to correct tab (production, overview) — partially broken
- [ ] Full email thread view on project detail
- [ ] Unified inbox — website inquiries + email + portal events + QB payments in one stream

## 5. COSTING & PRICING

- [x] Shared pricing engine in lib/pricing.ts [SHIPPED]
- [x] Invoice PDF uses shared pricing (was duplicate with wrong buffer) [SHIPPED]
- [x] Cotton Collective 10% blank buffer [SHIPPED]
- [x] Costing lock prevents buy sheet edits [SHIPPED]
- [ ] Costing templates per decorator — pick decorator, pre-fill finishing/packaging/setup/specialty
- [ ] Post-job P&L — compare quoted sell vs actual blank cost + actual PO cost
- [ ] Smart re-costing — PSD re-upload auto-updates costing locations + recalculates
- [ ] Blank cost variance tracking — post-purchasing updated total/margin

## 6. PRODUCTION & DECORATORS

- [x] Standalone production page with decorator grouping [SHIPPED]
- [x] Packing slip upload + in-app viewer [SHIPPED]
- [x] Completed projects section (recently, last 7d, last 30d) [SHIPPED]
- [x] Ship All with tracking copy [SHIPPED]
- [ ] Decorator portal — packing slip upload + shipped qty entry by decorator
- [ ] Decorator portal — confirm PO received, mark in production, flag issues
- [ ] Decorator scorecard — turnaround time, on-time rate, issue frequency, cost trends
- [ ] Decorator turnaround tracking — auto-calculated from pipeline timestamps
- [ ] PO PDF overflow to 2 pages with many items
- [ ] PO email reply routing to production tab
- [ ] Bulk "mark project shipped" from production page

## 7. RECEIVING & WAREHOUSE

- [x] Return to Production from receiving [SHIPPED]
- [x] Packing slip viewer on receiving page [SHIPPED]
- [x] Photo upload per item on receiving [SHIPPED]
- [x] Outside shipments logging [SHIPPED — needs DB migration run]
- [ ] Receiving qty mismatch alerts — red banner when received != shipped
- [ ] Auto-create fulfillment project when stage-route items all received
- [ ] Cannot delete fulfillment project
- [ ] Bulk "mark received" [SHIPPED]

## 8. SHIPPING & FULFILLMENT

- [x] HPD packing slip PDF — route-aware (drop ship vs ship-through) [SHIPPED]
- [ ] Ship-through: outbound tracking + mark shipped + auto-email to client
- [ ] Fulfillment: ShipStation command center integration (daily logs, pipeline view)
- [ ] Distro billing — rate cards per client, auto-invoice based on activity
- [ ] E-Comm storefront management (placeholder page exists)

## 9. QUICKBOOKS & PAYMENTS

- [x] QB invoice push with product mapping [SHIPPED]
- [x] QB payment webhook — auto-record payment [SHIPPED]
- [x] QB payment link on invoice email [SHIPPED]
- [ ] Auto-generate invoice numbers (format TBD)
- [ ] AR aging view — who owes, how long
- [ ] Payment overdue auto-email to client
- [ ] QB invoice auto-create on quote approval (streamline flow)

## 10. PRODUCT BUILDER & BUY SHEET

- [x] PSD drop → auto-create items with print locations [SHIPPED]
- [x] Multi-file PSD+mockup drop [SHIPPED]
- [x] Cotton Collective picker [SHIPPED]
- [x] S&S search-as-you-type [SHIPPED]
- [x] Searchable colors on all pickers [SHIPPED]
- [ ] Batch blank assignment — select multiple items, assign same blank
- [ ] Size curve memory — remember last distribution per client/project type
- [ ] Art file templates — common mockup positions per garment type
- [ ] Bulk Create grid (shelved — needs debugging)
- [ ] Drag-to-reorder items

## 11. ART & PROOFS

- [x] Per-item file upload to Drive [SHIPPED]
- [x] Proof generator with live preview [SHIPPED]
- [ ] Proof modal with approve/reject (not Drive redirect)
- [ ] Don't auto-send proofs on generation — need review first
- [ ] Send revised proof auto-notifies client
- [ ] Taylor revisions view — cross-project visibility into revision requests
- [ ] Proof PDF file size — investigate compression (10MB limit risk)

## 12. DASHBOARD & COMMAND CENTER

- [x] 23 alert types with actionable cards [SHIPPED]
- [x] Auto-refresh on tab visibility [SHIPPED]
- [ ] Dashboard actions must log to job_activity server-side
- [ ] Dashboard doesn't refresh after state changes (quote approval, etc.)
- [ ] Missing address alert — flag projects missing client delivery address

## 13. REPORTS & INSIGHTS

- [x] Revenue, margins, turnaround, CSV exports [SHIPPED]
- [x] Cash flow forecast, payments attention section [SHIPPED]
- [ ] Client health — growing/shrinking/inactive clients
- [ ] Capacity view — work per decorator, average turnaround, overload
- [ ] Seasonal patterns / trend analysis
- [ ] Reorder prediction

## 14. GOD MODE (OWNER DASHBOARD)

- [ ] Revenue, margins, AR aging, cash flow — one screen
- [ ] Client LTV, revenue forecast
- [ ] Capacity tracking, bottlenecks, team workload
- [ ] Margin targets vs actuals
- [ ] Cross-company view (HPD + touring company)

## 15. MULTI-COMPANY

- [ ] Touring company — separate OpsHub deployment, same code
- [ ] Shared warehouse — touring company creates fulfillment requests, HPD receives/ships
- [ ] God Mode spans both companies
- [ ] Evaluate: team scale, revenue scale, client expectations, decorator count

## 16. INFRASTRUCTURE & PLATFORM

- [ ] Permissions refactor — role-based access enforcement (blocked on team meeting)
- [ ] Scheduled alerts cron [SHIPPED — /api/cron/alerts]
- [ ] Soft-delete items/projects instead of hard delete
- [ ] Drive stale cleanup — 90+ day inactive projects auto-archive
- [ ] Drive folder rename on item rename [SHIPPED]
- [ ] Drive folder archive on item/project delete [SHIPPED]
- [ ] Old ApprovalsPaymentTab.jsx — can delete (no longer imported)
- [ ] Remove old decoration panel code behind {false && ...}

## 17. ACTIVE BUGS / KNOWN ISSUES

- [ ] LA Apparel pricing: duplicate rows for some styles
- [ ] In-hands date not persisting on Overview tab
- [ ] PO PDF overflow with many items
- [ ] Vendor portal actions have no OpsHub handlers (flag issue, confirm PO)
- [ ] Dashboard card refresh after actions
- [ ] Client portal refresh after proof approval
