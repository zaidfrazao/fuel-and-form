/**
 * Drizzle schema — the nine tables from the PRD's Data Model.
 *
 * Intentionally empty. FUEL-6 wires the connection and the migration pipeline;
 * FUEL-13 defines the tables and generates the first migration. This file
 * exists now so `drizzle.config.ts` and the `db` generics have a stable target
 * from the start, which makes FUEL-13 a pure addition rather than a rewire.
 */

export {};
