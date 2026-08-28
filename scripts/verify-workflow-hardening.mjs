#!/usr/bin/env node
/**
 * Local, dependency-free static verification for the service workflow hardening.
 * Usage: node scripts/verify-workflow-hardening.mjs
 * For full D1 execution, apply migrations with your normal local Wrangler setup first.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = {
  migration: resolve(root, 'migrations/0002_workflow_hardening.sql'),
  workflow: resolve(root, 'functions/_shared/workflows.ts'),
  route: resolve(root, 'functions/api/[[path]].ts'),
  generic: resolve(root, 'functions/_shared/db.ts'),
};
const content = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await readFile(path, 'utf8')])));
const expectations = [
  ['migration retains versioned books', /CREATE TABLE IF NOT EXISTS order_books/],
  ['migration retains mutual locks', /CREATE TABLE IF NOT EXISTS order_generation_locks/],
  ['migration normalizes club athletes', /CREATE TABLE IF NOT EXISTS registration_athletes/],
  ['migration normalizes individual events', /CREATE TABLE IF NOT EXISTS individual_registration_events/],
  ['migration makes current order stale', /trg_order_book_stale_after_registration_change/],
  ['workflow validates competition status', /competitionOpen\(/],
  ['workflow rejects duplicate athlete events', /DUPLICATE_ENTRY/],
  ['workflow limits review job size', /MAX_REVIEW_IDS = 50/],
  ['workflow uses status guarded review updates', /status = 'pending'/],
  ['workflow publishes an order version only after entries', /status = 'published', is_current = 1/],
  ['route exposes club registration command', /createClubRegistration/],
  ['route exposes individual registration command', /createIndividualRegistration/],
  ['route exposes review command', /reviewBatch/],
  ['route exposes order book command', /generateOrderBook/],
  ['generic API blocks workflow writes', /WORKFLOW_ENDPOINT_REQUIRED/],
];
const sources = [content.migration, content.workflow, content.route, content.generic].join('\n');
const failed = expectations.filter(([, pattern]) => !pattern.test(sources));
for (const [name] of expectations) console.log(`${failed.some(([failedName]) => failedName === name) ? 'FAIL' : 'PASS'} ${name}`);
if (failed.length) {
  console.error(`\n${failed.length} verification assertion(s) failed.`);
  process.exit(1);
}
console.log('\nWorkflow hardening static verification passed.');
