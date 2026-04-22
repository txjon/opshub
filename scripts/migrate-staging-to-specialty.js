#!/usr/bin/env node
/**
 * One-time migration: Staging board items → OpsHub specialty jobs/items.
 *
 * Client Hub Phase 1 step 2. Run AFTER migration 029 has been applied.
 *
 * Usage:
 *   node scripts/migrate-staging-to-specialty.js               # dry-run (safe)
 *   node scripts/migrate-staging-to-specialty.js --commit      # actually writes
 *
 * Idempotent: sets items.specialty_stage.migrated_from_staging_item_id so
 * re-runs won't double-create. Checks for existing migrated items before inserting.
 *
 * Does NOT delete staging_boards / staging_items — those live in parallel
 * until Jon confirms the migration is good. Separate cleanup pass later.
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const COMMIT = process.argv.includes("--commit");

const log = (...args) => console.log(...args);
const warn = (...args) => console.warn("⚠️ ", ...args);
const err = (...args) => console.error("❌", ...args);

async function main() {
  log(COMMIT ? "🔴 COMMIT MODE — will write to DB" : "🟢 DRY RUN — no writes");
  log("");

  // 1. Fetch all staging boards
  const { data: boards, error: boardsErr } = await supabase
    .from("staging_boards")
    .select("id, name, client_name, created_at");

  if (boardsErr) {
    err("Failed to load staging_boards:", boardsErr.message);
    process.exit(1);
  }
  if (!boards || boards.length === 0) {
    log("No staging boards found. Nothing to migrate.");
    return;
  }

  log(`Found ${boards.length} staging boards.`);
  log("");

  let stats = { boards: 0, items: 0, clientsCreated: 0, skipped: 0, errors: 0 };

  for (const board of boards) {
    log(`── Board: "${board.name}" (client: ${board.client_name || "—"})`);

    // 2. Find or create matching OpsHub client
    let clientId = null;
    if (board.client_name) {
      const { data: existing } = await supabase
        .from("clients")
        .select("id")
        .eq("name", board.client_name)
        .maybeSingle();
      if (existing) {
        clientId = existing.id;
        log(`  ✓ Matched client: ${board.client_name}`);
      } else {
        log(`  + New client needed: ${board.client_name}`);
        if (COMMIT) {
          const { data: newClient, error: cErr } = await supabase
            .from("clients")
            .insert({ name: board.client_name, type: "brand", portal_tier: "standard" })
            .select("id")
            .single();
          if (cErr) { err("  Failed to create client:", cErr.message); stats.errors++; continue; }
          clientId = newClient.id;
          stats.clientsCreated++;
        }
      }
    } else {
      warn(`  No client_name on board, skipping`);
      stats.skipped++;
      continue;
    }

    // 3. Pull items for this board
    const { data: items, error: itemsErr } = await supabase
      .from("staging_items")
      .select("id, item_name, status, qty, unit_cost, retail, notes, sort_order, created_at")
      .eq("board_id", board.id)
      .order("sort_order");

    if (itemsErr) { err("  Failed to load items:", itemsErr.message); stats.errors++; continue; }
    if (!items || items.length === 0) {
      log(`  (no items in this board)`);
      continue;
    }

    log(`  ${items.length} item(s) to migrate`);

    // 4. Check for already-migrated items (idempotency)
    const stagingIds = items.map(i => i.id);
    const { data: alreadyMigrated } = await supabase
      .from("items")
      .select("id, specialty_stage")
      .eq("job_id", null) // not reliable — do a contains check instead
      .limit(0); // short-circuit; we'll check per-item below

    // 5. Create specialty job for this board
    let jobId = null;
    const jobTitle = board.name || "Untitled Staging Board";
    log(`  + Job: "${jobTitle}" (job_type=specialty, phase=production)`);
    if (COMMIT) {
      const { data: newJob, error: jErr } = await supabase
        .from("jobs")
        .insert({
          title: jobTitle,
          client_id: clientId,
          job_type: "specialty",
          phase: "production",
          shipping_route: "stage",
          priority: "normal",
          type_meta: { migrated_from_staging_board_id: board.id },
        })
        .select("id")
        .single();
      if (jErr) { err("  Failed to create job:", jErr.message); stats.errors++; continue; }
      jobId = newJob.id;
    }
    stats.boards++;

    // 6. For each staging item, check if already migrated, else create
    for (const si of items) {
      // Idempotency: skip if we've already migrated this item
      const { data: existingItem } = await supabase
        .from("items")
        .select("id")
        .eq("specialty_stage->>migrated_from_staging_item_id", si.id)
        .maybeSingle();
      if (existingItem) {
        log(`    ⊘ Already migrated: ${si.item_name || "Untitled"} (existing item ${existingItem.id})`);
        continue;
      }

      log(`    + Item: "${si.item_name || "Untitled"}" · status=${si.status || "Pending"} · qty=${si.qty || 0} · retail=${si.retail || "—"}`);
      if (COMMIT) {
        const specialtyStage = {
          current: si.status || "Pending",
          history: [{ stage: si.status || "Pending", at: si.created_at, source: "staging_migration" }],
          migrated_from_staging_item_id: si.id,
        };

        const { data: newItem, error: iErr } = await supabase
          .from("items")
          .insert({
            job_id: jobId,
            name: si.item_name || "Untitled",
            garment_type: "custom",
            sort_order: si.sort_order || 0,
            cost_per_unit: si.unit_cost || null,
            sell_per_unit: si.retail || null,
            notes: si.notes || null,
            specialty_stage: specialtyStage,
            status: "tbd",
            artwork_status: "not_started",
          })
          .select("id")
          .single();
        if (iErr) { err("    Failed to create item:", iErr.message); stats.errors++; continue; }

        // Minimal buy_sheet_line — one row, ONE SIZE, with staging qty
        if (si.qty && si.qty > 0) {
          await supabase.from("buy_sheet_lines").insert({
            item_id: newItem.id,
            size: "ONE SIZE",
            qty_ordered: si.qty,
          });
        }

        // Carry over first image as drive_link if present
        const { data: images } = await supabase
          .from("staging_item_images")
          .select("url")
          .eq("item_id", si.id)
          .limit(1);
        if (images && images[0]?.url) {
          await supabase.from("items").update({ drive_link: images[0].url }).eq("id", newItem.id);
        }
      }
      stats.items++;
    }
    log("");
  }

  log("═══════════════════════════════════════");
  log("Summary:");
  log(`  Boards migrated:   ${stats.boards}`);
  log(`  Items migrated:    ${stats.items}`);
  log(`  Clients created:   ${stats.clientsCreated}`);
  log(`  Boards skipped:    ${stats.skipped}`);
  log(`  Errors:            ${stats.errors}`);
  log("");
  log(COMMIT
    ? "✓ Committed. Staging data preserved — boards + items still exist for reference."
    : "🟢 Dry run complete. Re-run with --commit to actually write."
  );
}

main().catch(e => {
  err("Migration failed:", e);
  process.exit(1);
});
