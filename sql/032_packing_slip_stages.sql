-- Add packing_slip and receiving_photo stages to item_files
alter table item_files drop constraint item_files_stage_check;
alter table item_files add constraint item_files_stage_check
  check (stage in ('client_art','vector','mockup','proof','print_ready','packing_slip','receiving_photo'));
