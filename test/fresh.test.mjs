import test from 'node:test';
import assert from 'node:assert/strict';

import { filterFresh } from '../src/fresh.js';

const NOW = Date.parse('2026-11-25T12:00:00+08:00');

function row(publishedAt, title = '标题') {
  return publishedAt === undefined ? { title } : { title, publishedAt };
}

test('filterFresh drops rows older than the window', () => {
  const rows = [
    row('2026-11-24T00:00:00+08:00'),
    row('2026-11-05T00:00:00+08:00'),
    row('2025-12-03T00:00:00+08:00'),
    row('2021-10-21T00:00:00+08:00'),
  ];
  assert.equal(filterFresh(rows, { now: NOW, maxAgeDays: 21 }).length, 2);
  assert.equal(filterFresh(rows, { now: NOW, maxAgeDays: 30 }).length, 2);
  assert.equal(filterFresh(rows, { now: NOW, maxAgeDays: 400 }).length, 3);
});

test('filterFresh keeps rows without a date', () => {
  const rows = [row(undefined, '无日期'), row('2020-01-01T00:00:00+08:00', '旧闻')];
  assert.deepEqual(filterFresh(rows, { now: NOW, maxAgeDays: 7 }).map((entry) => entry.title), ['无日期']);
});

test('filterFresh keeps the boundary and can be disabled', () => {
  const boundary = new Date(NOW - 3 * 86_400_000).toISOString();
  const rows = [row(boundary, '边界')];
  assert.equal(filterFresh(rows, { now: NOW, maxAgeDays: 3 }).length, 1);
  assert.equal(filterFresh(rows, { now: NOW, maxAgeDays: 0 }).length, 1);
  assert.equal(filterFresh(rows, { now: NOW, maxAgeDays: Number.POSITIVE_INFINITY }).length, 1);
});
