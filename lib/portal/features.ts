// Client Hub feature grants (mig 132) — the single vocabulary for which
// add-on surfaces a client gets beyond the standard tier.
//
// STANDARD (every client, no grant needed): Home, Orders, Reorder —
// history, approvals, payments, the cart.
//
// Grants (clients.portal_features text[]):
//   pipeline — Pipeline tab: production visibility, revenue/profit insight,
//              drop planner, pull requests. This is staging + margin data;
//              fulfillment-tier clients only.
//   studio   — Product Development (design briefs). Currently hidden
//              globally pending rethink; grant pre-positions clients for
//              its return.

export type PortalFeature = "pipeline" | "studio";

export function hasFeature(features: string[] | null | undefined, f: PortalFeature): boolean {
  return Array.isArray(features) && features.includes(f);
}
