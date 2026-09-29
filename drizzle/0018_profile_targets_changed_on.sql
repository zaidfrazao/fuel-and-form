-- FUEL-136 — the targets become editable in /settings, so they can move.
--
-- One nullable column, so the code already deployed — which selects an explicit
-- column list and never names it — reads and writes exactly as before. `null`
-- is the honest value for every existing row: the targets there are the seed
-- script's, and no change has been made in the app.
--
-- Idempotent only in the sense drizzle's journal gives it; a re-run is refused
-- by the column already existing.

ALTER TABLE "profiles" ADD COLUMN "targets_changed_on" date;
