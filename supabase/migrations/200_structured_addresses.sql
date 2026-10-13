-- 200: structured addresses (Oct 13 2026).
--
-- Addresses were one free-text field; QuickBooks, labels and sales tax need
-- street / city / state / ZIP. The PARTS are now the truth. The old text
-- columns (client_locations.address, clients.billing_address) become a
-- DERIVED display copy, rebuilt by trigger from the parts, so every existing
-- reader (PDFs, portals, boards) keeps working byte-for-byte and nothing that
-- picks WHICH address to use changes.
--
-- Rows the backfill couldn't split keep their old text with empty parts
-- ("needs review"). Once none are left, the text columns become GENERATED
-- and these triggers go away.

alter table public.client_locations
  add column if not exists addr_name    text,   -- name / company line on the label
  add column if not exists addr_line1   text,
  add column if not exists addr_line2   text,
  add column if not exists addr_city    text,
  add column if not exists addr_state   text,
  add column if not exists addr_zip     text,
  add column if not exists addr_country text not null default 'US';

alter table public.clients
  add column if not exists bill_name    text,
  add column if not exists bill_line1   text,
  add column if not exists bill_line2   text,
  add column if not exists bill_city    text,
  add column if not exists bill_state   text,
  add column if not exists bill_zip     text,
  add column if not exists bill_country text not null default 'US';

-- ONE formatter (lib/address.ts formatAddress is its twin; keep in lockstep)
create or replace function public.format_address(n text, l1 text, l2 text, city text, st text, zip text, country text)
returns text language sql immutable as $$
  select array_to_string(array_remove(array[
    nullif(btrim(n), ''), nullif(btrim(l1), ''), nullif(btrim(l2), ''),
    nullif(btrim(concat_ws(' ', nullif(btrim(concat_ws(', ', nullif(btrim(city), ''), nullif(btrim(st), ''))), ''), nullif(btrim(zip), ''))), ''),
    case when coalesce(nullif(btrim(country), ''), 'US') <> 'US' then btrim(country) end
  ], null), E'\n')
$$;

-- parts set → text is rebuilt; a writer changing ONLY the text on a row that
-- has parts is refused (it would be silently overwritten otherwise)
create or replace function public.client_locations_address_sync() returns trigger language plpgsql as $$
begin
  if new.addr_line1 is not null and btrim(new.addr_line1) <> '' then
    if tg_op = 'UPDATE' and new.address is distinct from old.address
       and (new.addr_name, new.addr_line1, new.addr_line2, new.addr_city, new.addr_state, new.addr_zip, new.addr_country)
           is not distinct from (old.addr_name, old.addr_line1, old.addr_line2, old.addr_city, old.addr_state, old.addr_zip, old.addr_country) then
      raise exception 'Addresses are saved by their parts now (street, city, state, ZIP). Reload the page and try again.';
    end if;
    new.address := public.format_address(new.addr_name, new.addr_line1, new.addr_line2, new.addr_city, new.addr_state, new.addr_zip, new.addr_country);
  end if;
  return new;
end $$;
drop trigger if exists trg_client_locations_address_sync on public.client_locations;
create trigger trg_client_locations_address_sync before insert or update on public.client_locations
  for each row execute function public.client_locations_address_sync();

create or replace function public.clients_billing_address_sync() returns trigger language plpgsql as $$
begin
  if new.bill_line1 is not null and btrim(new.bill_line1) <> '' then
    if tg_op = 'UPDATE' and new.billing_address is distinct from old.billing_address
       and (new.bill_name, new.bill_line1, new.bill_line2, new.bill_city, new.bill_state, new.bill_zip, new.bill_country)
           is not distinct from (old.bill_name, old.bill_line1, old.bill_line2, old.bill_city, old.bill_state, old.bill_zip, old.bill_country) then
      raise exception 'Billing addresses are saved by their parts now (street, city, state, ZIP). Reload the page and try again.';
    end if;
    new.billing_address := public.format_address(new.bill_name, new.bill_line1, new.bill_line2, new.bill_city, new.bill_state, new.bill_zip, new.bill_country);
  end if;
  return new;
end $$;
drop trigger if exists trg_clients_billing_address_sync on public.clients;
create trigger trg_clients_billing_address_sync before insert or update on public.clients
  for each row execute function public.clients_billing_address_sync();
