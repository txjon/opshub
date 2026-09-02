-- 169: Client Hub cutover complete (Sep 2 2026) — all 81 clients flipped
-- client_hub_enabled=true; new clients are born hub-on so the dark-launch
-- backlog never regrows. Dark-launch remains available per client by
-- flipping the flag off.
alter table clients alter column client_hub_enabled set default true;
