/**
 * Continuing qty = what physically goes to the customer = Delivered − Samples.
 *
 * "Delivered" is the qty source the caller already chose (typically
 * received_qtys for ship_through/stage, ship_qtys for drop_ship).
 * "Samples" is items.sample_qtys — per-size units pulled at HPD before
 * outbound shipment (QA / photoshoot / client comp / etc.).
 *
 * Drop-ship items never pass through receiving so sample_qtys is empty —
 * calling this on drop-ship paths is a no-op.
 *
 * NOTE: damaged units are NOT deducted here. Today the receiver is expected
 * to manually decrement Delivered for damaged pieces; condition is metadata
 * only. If we add a per-size damage column later, deduct it here too.
 */
export function deductSamples(
  delivered: Record<string, number> | null | undefined,
  samples: Record<string, number> | null | undefined,
): Record<string, number> {
  const d = delivered || {};
  const s = samples || {};
  const out: Record<string, number> = {};
  for (const [size, qty] of Object.entries(d)) {
    out[size] = Math.max(0, (qty || 0) - (s[size] || 0));
  }
  return out;
}
