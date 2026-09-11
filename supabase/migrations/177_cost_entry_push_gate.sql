-- 177: the QB-push gates for cost_entries live in the database (Sep 11 2026).
--
-- /api/qb/bill refused pre-OpsHub close-outs and card charges in JavaScript.
-- A select list that never loaded `source` made the pre-OpsHub check compare
-- against undefined for a week; three Icon close-outs went to QB as Bill
-- #33846 (deleted by hand). Same class as the type_meta wipe: an invariant
-- that only holds if every code path remembers it. Now the row itself refuses:
--   • source = 'pre_opshub'      — settled years before AP existed; costing only
--   • bill_method = 'credit_card' — the card feed already books the expense
-- Stamping such a row with a QB bill id is rejected regardless of the writer.
-- The legacy 'paid-verified' marker (Jon-attested batch history) is not a push.

create or replace function cost_entries_push_gate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.qb_bill_id is null or new.qb_bill_id = 'paid-verified' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.qb_bill_id is not distinct from new.qb_bill_id then
    return new;
  end if;
  if new.source = 'pre_opshub' then
    raise exception 'QB push refused: cost entry % is a pre-OpsHub close-out (billed and paid before AP existed) — recorded for job costing only, never a QB Bill.', new.id
      using errcode = 'check_violation';
  end if;
  if new.bill_method = 'credit_card' then
    raise exception 'QB push refused: cost entry % is a card charge — the expense arrives through the card feed; a QB Bill on top would double-book it.', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists cost_entries_push_gate on cost_entries;
create trigger cost_entries_push_gate before insert or update of qb_bill_id on cost_entries
  for each row execute function cost_entries_push_gate();
