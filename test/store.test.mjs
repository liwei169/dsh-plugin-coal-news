import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore, newsId } from '../src/store.js';

function fakeClock(startIso = '2026-11-25T10:00:00+08:00') {
  let current = Date.parse(startIso);
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
  };
}

const SOURCE = { id: 's1', name: '测试源', category: 'safety', intervalMs: 600000 };

function row(title, url, extra = {}) {
  return { title, url, ...extra };
}

test('newsId is stable per url and differs across urls', () => {
  assert.equal(newsId('https://a/1'), newsId('https://a/1'));
  assert.notEqual(newsId('https://a/1'), newsId('https://a/2'));
});

test('ingest deduplicates across fetches', () => {
  const clock = fakeClock();
  const store = createStore({ now: clock.now });
  store.register(SOURCE);
  assert.equal(store.ingest('s1', [row('第一条', 'https://a/1'), row('第二条', 'https://a/2')]), 2);
  assert.equal(store.ingest('s1', [row('第一条', 'https://a/1'), row('第三条', 'https://a/3')]), 1);
  assert.equal(store.feed().total, 3);
});

test('feed filters by category, since, and limit, newest first', () => {
  const clock = fakeClock();
  const store = createStore({ now: clock.now });
  store.register(SOURCE);
  store.ingest('s1', [
    row('旧闻', 'https://a/old', { category: 'safety', publishedAt: '2026-11-20T00:00:00+08:00' }),
    row('新闻', 'https://a/new', { category: 'price', publishedAt: '2026-11-24T00:00:00+08:00' }),
    row('未标日期', 'https://a/none', { category: 'tech' }),
  ]);

  const all = store.feed();
  assert.equal(all.items.length, 3);
  assert.equal(all.items[0].title, '新闻', 'dated rows sort first');
  assert.equal(all.items.at(-1).title, '未标日期', 'undated rows fall below dated ones');
  const dated = all.items.filter((item) => item.publishedAt !== null && item.publishedAt !== undefined);
  assert.deepEqual(dated.map((item) => item.title), ['新闻', '旧闻']);

  assert.deepEqual(store.feed({ categories: ['price'] }).items.map((item) => item.title), ['新闻']);
  assert.deepEqual(store.feed({ since: '2026-11-22T00:00:00+08:00' }).items.map((item) => item.title), ['新闻']);
  assert.equal(store.feed({ limit: 1 }).items.length, 1);
  assert.equal(store.feed({ limit: 0 }).items.length, 1, 'limit floors at one');
});

test('a date-only row from today outranks a timed row from yesterday', () => {
  const clock = fakeClock('2026-11-25T16:00:00+08:00');
  const store = createStore({ now: clock.now });
  store.register(SOURCE);
  store.ingest('s1', [
    row('昨天的晚间稿', 'https://a/1', { publishedAt: '2026-11-24T21:30:00+08:00' }),
    row('今天的日期稿', 'https://a/2', { publishedAt: '2026-11-25T00:00:00+08:00' }),
  ]);
  assert.deepEqual(store.feed().items.map((item) => item.title), ['今天的日期稿', '昨天的晚间稿']);
});

test('a failing source keeps rows and reports stale', () => {
  const clock = fakeClock();
  const store = createStore({ now: clock.now });
  store.register(SOURCE);
  store.ingest('s1', [row('正常', 'https://a/1')]);
  assert.equal(store.feed().stale, false);

  store.fail('s1', 'HTTP 403');
  const feed = store.feed();
  assert.equal(feed.stale, true);
  assert.equal(feed.items.length, 1, 'cached rows survive a failure');
  assert.deepEqual(feed.errors.map((entry) => entry.name), ['测试源']);
  assert.equal(feed.errors[0].error, 'HTTP 403');

  store.ingest('s1', [row('恢复', 'https://a/2')]);
  assert.equal(store.feed().errors.length, 0, 'a success clears the error');
});

test('data older than three hours counts as stale', () => {
  const clock = fakeClock();
  const store = createStore({ now: clock.now });
  store.register(SOURCE);
  store.ingest('s1', [row('正常', 'https://a/1')]);
  clock.advance(4 * 3600000);
  assert.equal(store.feed().stale, true);
});

test('prune keeps the newest rows', () => {
  const clock = fakeClock();
  const store = createStore({ now: clock.now, maxItems: 2 });
  store.register(SOURCE);
  store.ingest('s1', [
    row('最旧', 'https://a/1', { publishedAt: '2026-11-01T00:00:00+08:00' }),
    row('中间', 'https://a/2', { publishedAt: '2026-11-02T00:00:00+08:00' }),
    row('最新', 'https://a/3', { publishedAt: '2026-11-03T00:00:00+08:00' }),
  ]);
  assert.deepEqual(store.feed().items.map((item) => item.title), ['最新', '中间']);
});

test('quotes snapshot survives a failed refresh', () => {
  const clock = fakeClock();
  const store = createStore({ now: clock.now });
  assert.equal(store.quoteSnapshot().stale, true);
  store.setQuotes([{ symbol: 'JM0', price: 1490 }]);
  assert.equal(store.quoteSnapshot().stale, false);
  store.failQuotes('timeout');
  const snapshot = store.quoteSnapshot();
  assert.equal(snapshot.stale, true);
  assert.equal(snapshot.error, 'timeout');
  assert.equal(snapshot.quotes.length, 1);
});

test('status lists every registered source', () => {
  const clock = fakeClock();
  const store = createStore({ now: clock.now });
  store.register({ id: 'a', name: 'A 源', category: 'policy', intervalMs: 1000 });
  store.register({ id: 'b', name: 'B 源', category: 'tech', intervalMs: 2000 });
  store.ingest('a', [row('一条', 'https://a/1')]);
  const status = store.status();
  assert.deepEqual(status.sources.map((source) => source.name), ['A 源', 'B 源']);
  assert.equal(status.sources[0].lastOkAt, '2026-11-25T02:00:00.000Z');
  assert.equal(status.items, 1);
});
