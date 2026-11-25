/**
 * Feed report: what the panel would receive, per source and by month.
 * Usage: node scripts/report.mjs
 */

import { apply } from '../index.js';

const handlers = new Map();
const disposers = [];
apply({
  connection: { rpc: { handle(channel, handler) { handlers.set(channel, handler); return async () => handlers.delete(channel); } } },
  effect(factory) { const dispose = factory(); if (typeof dispose === 'function') disposers.push(dispose); return () => {}; },
});

const call = handlers.get('/coal-news');
const started = Date.now();
const feed = await call('feed', {});
const status = await call('status', {});
if (feed.ok !== true) {
  console.error('feed failed:', feed.error);
  process.exit(1);
}

const now = Date.now();
const items = feed.value.items;
console.log(`warm-up ${Date.now() - started}ms  items=${items.length}  stale=${feed.value.stale}  errors=${feed.value.errors.length}`);

const byCategory = {};
for (const item of items) byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
console.log('by category:', JSON.stringify(byCategory));

const byMonth = {};
for (const item of items) {
  const key = (item.publishedAt ?? item.fetchedAt ?? '').slice(0, 7);
  byMonth[key] = (byMonth[key] ?? 0) + 1;
}
console.log('by month:', Object.entries(byMonth).sort().map(([key, count]) => `${key}:${count}`).join('  '));

console.log('\nnewest 10:');
for (const item of items.slice(0, 10)) {
  const age = item.publishedAt ? Math.round((now - Date.parse(item.publishedAt)) / 86_400_000) : null;
  console.log(`  ${item.publishedAt?.slice(0, 10) ?? 'no-date'} ${String(age).padStart(3)}d [${item.category}] ${item.source} :: ${item.title.slice(0, 34)}`);
}

console.log('\nper source:');
for (const source of status.value.sources) {
  const rows = items.filter((item) => item.sourceId === source.id);
  console.log(`  ${source.id.padEnd(22)} rows=${String(rows.length).padStart(3)} err=${source.error ?? 'none'}`);
}

for (const dispose of disposers) await dispose();
process.exit(0);
