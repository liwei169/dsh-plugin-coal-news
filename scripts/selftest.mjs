/**
 * Manual end-to-end check for the Host half.
 *
 * Runs the real plugin against the real sources with a stand-in Cordis context,
 * then prints what the panel would receive. Not part of the test suite (it
 * needs the network); run it with `node scripts/selftest.mjs`.
 */

import { apply } from '../index.js';

const handlers = new Map();
const disposers = [];

const ctx = {
  connection: {
    rpc: {
      handle(channel, handler) {
        handlers.set(channel, handler);
        return async () => {
          handlers.delete(channel);
        };
      },
    },
  },
  effect(factory) {
    const dispose = factory();
    if (typeof dispose === 'function') disposers.push(dispose);
    return () => {};
  },
};

apply(ctx);

const handler = handlers.get('/coal-news');
if (handler === undefined) {
  console.error('FAIL: no /coal-news handler registered');
  process.exit(1);
}

const started = Date.now();
const [feed, quotes, status] = await Promise.all([
  handler('feed', {}),
  handler('quotes', {}),
  handler('status', {}),
]);

console.log(`elapsed=${Date.now() - started}ms`);
if (feed.ok !== true) {
  console.error('FAIL feed:', feed.error);
  process.exit(1);
}

const items = feed.value.items;
const byCategory = items.reduce((acc, item) => {
  acc[item.category] = (acc[item.category] ?? 0) + 1;
  return acc;
}, {});
console.log(`items=${items.length} total=${feed.value.total} stale=${feed.value.stale} categories=${JSON.stringify(byCategory)}`);
console.log(`errors=${JSON.stringify(feed.value.errors)}`);
for (const item of items.slice(0, 8)) {
  console.log(`  [${item.category}] ${item.publishedAt ?? '-'} ${item.source} :: ${item.title.slice(0, 42)}`);
}
console.log('quotes:', JSON.stringify(quotes.value.quotes.map((q) => ({ s: q.symbol, p: q.price, c: q.changePct }))));
console.log('sources:', status.value.sources.map((s) => `${s.id}:${s.error === null ? 'ok' : 'ERR ' + s.error}`).join(' | '));

for (const dispose of disposers) await dispose();
process.exit(feed.value.items.length > 0 ? 0 : 1);
