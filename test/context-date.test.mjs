import test from 'node:test';
import assert from 'node:assert/strict';

import { dateFromContext, parseListPage } from '../src/parse.js';

const BASE = 'https://example.com/news/';

test('dateFromContext reads a date printed after the link', () => {
  const html = '<li><a href="/news/1.html">某煤矿智能化工作面通过验收</a><span>2026-11-20</span></li>';
  const anchor = /<a\b[^>]*>[\s\S]*?<\/a>/.exec(html);
  const iso = dateFromContext(html, anchor.index, anchor.index + anchor[0].length);
  assert.equal(iso, '2026-11-20T00:00:00+08:00');
});

test('dateFromContext reads a date printed before the link', () => {
  const html = '<li><span>2026年11月18日</span><a href="/news/1.html">某煤矿安全生产会议召开</a></li>';
  const anchor = /<a\b[^>]*>[\s\S]*?<\/a>/.exec(html);
  const iso = dateFromContext(html, anchor.index, anchor.index + anchor[0].length);
  assert.equal(iso, '2026-11-18T00:00:00+08:00');
});

test('dateFromContext keeps the clock time when the row prints one', () => {
  const html = '<li><a href="/news/1.html">某煤矿智能化工作面通过验收</a><span>2026-11-25 9:45</span></li>';
  const anchor = /<a\b[^>]*>[\s\S]*?<\/a>/.exec(html);
  const iso = dateFromContext(html, anchor.index, anchor.index + anchor[0].length);
  assert.equal(iso, '2026-11-25T09:45:00+08:00');
});

test('dateFromContext falls back to midnight without a clock time', () => {
  const html = '<li><a href="/news/1.html">某煤矿智能化工作面通过验收</a><span>2026-11-25</span></li>';
  const anchor = /<a\b[^>]*>[\s\S]*?<\/a>/.exec(html);
  const iso = dateFromContext(html, anchor.index, anchor.index + anchor[0].length);
  assert.equal(iso, '2026-11-25T00:00:00+08:00');
});

test('dateFromContext ignores implausible years', () => {
  const html = '<li><a href="/news/1.html">标题标题标题标题</a><span>1999-01-01</span></li>';
  const anchor = /<a\b[^>]*>[\s\S]*?<\/a>/.exec(html);
  assert.equal(dateFromContext(html, anchor.index, anchor.index + anchor[0].length), undefined);
});

test('a list page dated only beside the link still parses', () => {
  const html = `
    <ul>
      <li><a href="/news/a.html">陕煤集团某矿业公司完成智能化改造</a><i>2026-11-25</i></li>
      <li><a href="/news/b.html">某煤矿开展瓦斯抽采专项检查</a><i>2026-11-24</i></li>
    </ul>`;
  const rows = parseListPage(html, { baseUrl: BASE, linkPattern: /\/news\/[ab]\.html$/ });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].publishedAt, '2026-11-25T00:00:00+08:00');
  assert.equal(rows[1].publishedAt, '2026-11-24T00:00:00+08:00');
});
