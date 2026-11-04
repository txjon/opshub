-- 209: magic link for the Pick & Pack Rate Card (fulfillment-only pricing,
-- pick and pack only; receiving/storage billed separately). Served by
-- /d/[token] like the prospectuses (mig 153).
insert into doc_links (token, doc, label) values
  ('pp-92cde50a69b72098b8aab80950e57ecd', 'hpd-pick-pack-rate-card.html', 'general — pick & pack rate card')
on conflict (token) do nothing;
