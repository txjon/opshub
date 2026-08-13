"use client";
import { useState } from "react";
import { T, font, mono } from "@/lib/theme";

// CS Desk — customer-service FAQ + copy-paste response templates (Abigail's
// working surface for FOG storefront support). Templates match the published
// FOG policies word-for-word on every number; if a policy changes, change it
// here too. FOG copy rule: no em-dashes in anything customers receive.
// Bracketed [PLACEHOLDERS] get filled in before sending.

type Template = {
  key: string;
  title: string;
  when: string;      // internal guidance: when to use / what to check first
  body: string;      // the customer-facing reply
};
type Group = { label: string; items: Template[] };

const GROUPS: Group[] = [
  {
    label: "Where's my order",
    items: [
      {
        key: "status-instock",
        title: "In-stock order status",
        when: "Order has no release or pre-order items. Check whether it shipped before replying.",
        body: `Hey [FIRST NAME], thanks for reaching out. In-stock orders ship within 1 to 2 business days, and you'll get a tracking email the moment yours is on its way. Tracking can take up to 24 hours to show movement after that. If you don't see a tracking email within 2 business days of ordering, reply here and we'll take a look.`,
      },
      {
        key: "status-release",
        title: "Release order status",
        when: "Order contains a limited release item. Releases ship 3 to 5 business days after the release closes, oldest orders first.",
        body: `Hey [FIRST NAME], release orders ship within 3 to 5 business days after the release closes, in the order they were received. You'll get tracking by email as soon as yours ships. Thanks for grabbing one before it sold out.`,
      },
      {
        key: "status-preorder",
        title: "Pre-order status",
        when: "Check the pre-order's close date and expected window before replying.",
        body: `Hey [FIRST NAME], pre-orders ship 4 to 6 weeks from the pre-order close date, and the expected window is shown on the product page. You'll get tracking the moment it ships. If the window ever moves, we'll email everyone affected.`,
      },
      {
        key: "tracking-stuck",
        title: "Tracking not moving",
        when: "Under the trace thresholds (7 business days domestic, 21 international), reassure. Past them, use Lost in transit instead.",
        body: `Hey [FIRST NAME], tracking can take up to 24 hours to show movement after the label is created, and carriers sometimes go quiet for a stretch mid-route. If it hasn't updated in 7 business days domestically or 21 business days internationally, reply here and we'll open a trace with the carrier right away.`,
      },
    ],
  },
  {
    label: "Changes & cancellations",
    items: [
      {
        key: "change-size",
        title: "Change size / color / item",
        when: "Check if it shipped first. Unshipped: flag the order and try. Shipped: point at returns.",
        body: `Hey [FIRST NAME], we can't guarantee changes after an order is placed, but if it hasn't shipped yet we'll do our best. I've flagged your order now. If we can make the swap before it ships you'll get a confirmation from us, and if not, the easiest path is a return for a refund once it arrives.`,
      },
      {
        key: "fix-address",
        title: "Fix a wrong address",
        when: "Unshipped: correct it in the order before the label is bought. Shipped: we can't reroute; reship is at customer's cost.",
        body: `Hey [FIRST NAME], thanks for catching that. If your order hasn't shipped yet we'll correct the address now. Once a package is with the carrier we can't reroute it, so a quick heads-up like this is exactly right.`,
      },
      {
        key: "cancel-preorder",
        title: "Cancel a pre-order",
        when: "Always yes before it ships. Cancel in Shopify, refund in full, then send.",
        body: `Hey [FIRST NAME], done. Pre-orders can be cancelled any time before they ship for a full refund, no questions asked. The refund goes back to your original payment method; depending on your bank it can take a few business days to appear.`,
      },
      {
        key: "cancel-order",
        title: "Cancel a regular order",
        when: "Unshipped: cancel and refund. Shipped: returns path.",
        body: `Hey [FIRST NAME], if your order hasn't shipped yet we'll cancel and refund it in full; I'm on it and you'll get a confirmation shortly. If it already slipped out the door, you can return it for a refund once it arrives.`,
      },
    ],
  },
  {
    label: "Returns & exchanges",
    items: [
      {
        key: "how-to-return",
        title: "How to start a return",
        when: "Windows: 30 days in-stock, 14 days releases and pre-orders, from delivery. Delete the window that doesn't apply.",
        body: `Hey [FIRST NAME], happy to help. Returns are accepted within [30 days / 14 days] of delivery as long as the item is unused, unworn, unwashed, with tags attached, and in its original packaging. Ship it to [RETURN ADDRESS] with your order number inside, and reply here with tracking once it's on the way. The refund goes to your original payment method once we receive and inspect it. Original shipping isn't refundable, and there are no restocking fees.`,
      },
      {
        key: "exchange-instock",
        title: "Exchange, size in stock",
        when: "Check the shelf first. Only promise what is physically there.",
        body: `Hey [FIRST NAME], we can do that. We still have the [SIZE] available, so send yours back within the return window (unused, unworn, tags attached) and we'll ship the new size once your return lands. Reply with your order number and I'll set it up.`,
      },
      {
        key: "exchange-soldout",
        title: "Exchange, size sold out",
        when: "Releases aren't restocked. Refund is the answer; say why.",
        body: `Hey [FIRST NAME], I wish we could. That release sold out, and our releases are made in limited quantities, so there's no backstock to exchange into. Send it back within the return window and we'll refund you in full. If the piece ever comes back around, you'll see it on the site first.`,
      },
      {
        key: "refund-timing",
        title: "Where's my refund",
        when: "Confirm the refund was actually issued in Shopify before sending.",
        body: `Hey [FIRST NAME], your refund was issued to your original payment method. Banks usually post it within 3 to 5 business days, occasionally up to 10 depending on the card. If it hasn't appeared after that, reply here and we'll chase it with the processor.`,
      },
    ],
  },
  {
    label: "Problems",
    items: [
      {
        key: "damaged",
        title: "Damaged, defective, or wrong item",
        when: "We cover everything on our mistakes. Photos within 7 days of delivery; replace if available, refund if not.",
        body: `Hey [FIRST NAME], sorry about that, that's on us. Reply with photos of the item and the packaging within 7 days of delivery and we'll make it right: a replacement if we still have it, or a full refund if we don't. Either way it costs you nothing.`,
      },
      {
        key: "marked-delivered",
        title: "Marked delivered but missing",
        when: "48-hour wait from the scan, report within 14 days. Most turn up.",
        body: `Hey [FIRST NAME], frustrating, let's find it. Carriers sometimes scan a package delivered a little before it actually arrives, and packages get set somewhere unexpected: porches, side doors, neighbors, mailrooms. Give it 48 hours from the delivery scan and check around; most turn up. If it's still missing after that, reply here within 14 days of the scan and we'll make it right.`,
      },
      {
        key: "lost",
        title: "Lost in transit",
        when: "Send after opening the carrier trace. Thresholds: 7 business days domestic, 21 international with no movement.",
        body: `Hey [FIRST NAME], we've opened a trace with the carrier. Traces can take up to 10 business days to resolve. If the package is confirmed lost we'll replace it if we still have the item, or refund you in full if we don't. We'll keep you posted either way.`,
      },
    ],
  },
  {
    label: "International",
    items: [
      {
        key: "duties",
        title: "Duties and import charges",
        when: "We don't collect duties at checkout. Their government sets them; we can't waive them.",
        body: `Hey [FIRST NAME], prices at checkout don't include import duties or taxes. Your country may charge them on delivery; they're set by your government, not by us, and we can't calculate or waive them. One honest tip: if you refuse the package, the refund only covers the goods, so it's almost always cheaper to pay the charge than to refuse delivery. Checking your country's import rules before ordering is the safest bet.`,
      },
      {
        key: "option-missing",
        title: "Shipping option missing at checkout",
        when: "Usually correct behavior: PO Box, APO/FPO/DPO, or a suspended country removes options on purpose.",
        body: `Hey [FIRST NAME], that's the site working as intended rather than a glitch. Shipping options only appear when the carrier can actually deliver to your address. UPS can't serve PO Boxes or APO/FPO/DPO addresses, so those need a USPS option. And if no international option appears at all, mail service to your country is most likely suspended right now. Those restrictions change, so it's worth checking back.`,
      },
      {
        key: "intl-slow",
        title: "International order taking long",
        when: "Flat Rate is 7 to 21 business days once it leaves the US. Trace at 21 with no movement.",
        body: `Hey [FIRST NAME], international transit varies a lot by destination, and customs in the receiving country can add time. Flat Rate runs 7 to 21 business days once the package leaves the US. If tracking hasn't moved in 21 business days, reply here and we'll open a trace with the carrier.`,
      },
    ],
  },
];

const QUICK_LINKS = [
  { label: "Shipping Policy (live)", href: "https://forwardobservations.com/policies/shipping-policy" },
  { label: "Refund Policy (live)", href: "https://forwardobservations.com/policies/refund-policy" },
  { label: "FOG Shipping — Operator Reference", href: "/references/fog-shipping" },
];

export default function CsDeskPage() {
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (key: string, text: string) => {
    const done = () => {
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? null : c)), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  };

  const needle = q.trim().toLowerCase();
  const groups = needle
    ? GROUPS.map(g => ({
        ...g,
        items: g.items.filter(t =>
          (t.title + " " + t.when + " " + t.body).toLowerCase().includes(needle)
        ),
      })).filter(g => g.items.length > 0)
    : GROUPS;

  return (
    <div style={{ fontFamily: font, color: T.text, maxWidth: 760, margin: "0 auto", paddingBottom: 40 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, letterSpacing: "-0.02em" }}>CS Desk</h1>
      <p style={{ fontSize: 12, color: T.faint, marginBottom: 16 }}>
        FOG customer service: copy-paste replies that match the published policies. Fill the [BRACKETS] before sending.
      </p>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        {QUICK_LINKS.map(l => (
          <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11.5, fontWeight: 700, color: T.blue, textDecoration: "none" }}
            onMouseEnter={e => { e.currentTarget.style.textDecoration = "underline"; }}
            onMouseLeave={e => { e.currentTarget.style.textDecoration = "none"; }}
          >{l.label} ↗</a>
        ))}
      </div>

      <div style={{
        background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
        padding: "12px 14px", marginBottom: 18,
      }}>
        <div style={{
          fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase",
          color: T.amber, marginBottom: 6,
        }}>Before you reply</div>
        <p style={{ fontSize: 12.5, lineHeight: 1.6, color: T.text, margin: 0 }}>
          Pull the order first and check whether it shipped; half these answers change on that fact alone.
          Premium shipping orders (UPS Ground, UPS 2-Day, International Express) ship exactly the named service.
          Releases ship oldest order first, so "my friend got theirs" usually means they ordered earlier.
        </p>
      </div>

      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search replies… (refund, duties, sold out, address)"
        style={{
          width: "100%", boxSizing: "border-box", padding: "10px 14px", marginBottom: 20,
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
          color: T.text, fontSize: 13, fontFamily: font, outline: "none",
        }}
      />

      {groups.length === 0 && (
        <p style={{ fontSize: 12.5, color: T.muted }}>
          Nothing matches "{q}". Try a shorter word, or answer it fresh and tell Jon to add a template.
        </p>
      )}

      {groups.map(group => (
        <div key={group.label} style={{ marginBottom: 26 }}>
          <div style={{
            fontSize: 10, fontWeight: 800, color: T.muted, textTransform: "uppercase",
            letterSpacing: "0.08em", marginBottom: 8,
          }}>{group.label}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {group.items.map(t => (
              <div key={t.key} style={{
                background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "13px 15px",
              }}>
                <div style={{
                  display: "flex", alignItems: "baseline", justifyContent: "space-between",
                  gap: 12, flexWrap: "wrap", marginBottom: 4,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{t.title}</div>
                  <button
                    onClick={() => copy(t.key, t.body)}
                    style={{
                      background: copied === t.key ? "transparent" : T.accent,
                      color: copied === t.key ? T.green : "#0a0a0a",
                      border: copied === t.key ? `1px solid ${T.green}` : "1px solid transparent",
                      borderRadius: 999, padding: "5px 14px", fontSize: 11, fontWeight: 800,
                      fontFamily: font, cursor: "pointer", whiteSpace: "nowrap",
                    }}
                  >{copied === t.key ? "✓ Copied" : "Copy"}</button>
                </div>
                <div style={{ fontSize: 11, color: T.faint, marginBottom: 10 }}>{t.when}</div>
                <div style={{
                  fontSize: 12.5, lineHeight: 1.65, color: T.muted, whiteSpace: "pre-wrap",
                  borderLeft: `3px solid ${T.border}`, paddingLeft: 12,
                }}>{t.body}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <p style={{ fontSize: 11, color: T.faint, fontFamily: mono }}>
        Templates mirror the published policies. If a policy number changes, this page changes with it.
      </p>
    </div>
  );
}

function fallbackCopy(text: string, done: () => void) {
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); done(); } catch { /* leave silently */ }
  document.body.removeChild(ta);
}
