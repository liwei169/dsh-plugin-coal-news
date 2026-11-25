import test from 'node:test';
import assert from 'node:assert/strict';

import { collectAnchors, dateFromUrl, decodeEntities, parseListPage, plainText, resolveUrl } from '../src/parse.js';

const BASE = 'https://www.chinamine-safety.gov.cn/xw/mkaqjcxw/';

const PAGE = `
<div class="list">
  <a href="./202611/t20261123_740431.shtml" title="原标题">国家矿山安全监察局党组理论学习中心组深入学习研讨</a>
  <a href="/zfxxgk/fdzdgknr/tzgg/202611/t20261113_739341.shtml">关于降低煤矿一级安全生产标准化等级的公告 2026-11-13</a>
  <a href="javascript:void(0)">分享</a>
  <a href="/index.html">首页</a>
  <a href="./202611/t20261123_740431.shtml">重复条目重复条目重复条目</a>
  <a href="https://www.nea.gov.cn/20261118/3b255c14a250476faa893612d435a6a1/c.html">国家能源局关于加快推动流域水风光一体化发展的指导意见</a>
  <a href="./202611/t20261120_740000.shtml">某煤矿发生瓦斯爆炸事故造成人员伤亡 &amp; 救援结束</a>
</div>`;

test('decodeEntities handles named and numeric forms', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &nbsp;&#x8d44;'), 'a & b <c>  资');
});

test('plainText strips markup and collapses whitespace', () => {
  assert.equal(plainText('<span>煤 矿</span>\n  安全'), '煤 矿 安全');
});

test('resolveUrl keeps http(s) targets and drops javascript links', () => {
  assert.equal(resolveUrl(BASE, './a.shtml'), 'https://www.chinamine-safety.gov.cn/xw/mkaqjcxw/a.shtml');
  assert.equal(resolveUrl(BASE, 'javascript:void(0)'), undefined);
  assert.equal(resolveUrl(BASE, '#top'), undefined);
});

test('dateFromUrl understands the three site layouts', () => {
  assert.equal(dateFromUrl('https://www.chinamine-safety.gov.cn/xw/202611/t20261123_740431.shtml'), '2026-11-23T00:00:00+08:00');
  assert.equal(dateFromUrl('https://www.ccoalnews.cn/content/202611/23/c301823.html'), '2026-11-23T00:00:00+08:00');
  assert.equal(dateFromUrl('https://www.nea.gov.cn/20261118/3b255c14a250476faa893612d435a6a1/c.html'), '2026-11-18T00:00:00+08:00');
  assert.equal(dateFromUrl('https://example.com/article/1'), undefined);
});

test('collectAnchors falls back to the title attribute', () => {
  const rows = collectAnchors('<a href="/a" title="标题来自属性"></a>', BASE);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '标题来自属性');
});

test('parseListPage keeps article links, drops nav rows, and deduplicates', () => {
  const rows = parseListPage(PAGE, { baseUrl: BASE, linkPattern: /\.shtml$/ });
  const urls = rows.map((row) => row.url);
  assert.equal(new Set(urls).size, urls.length, 'no duplicate urls');
  assert.equal(rows.length, 3, 'javascript, index and the duplicate are dropped');
  assert.ok(rows.some((row) => row.title.includes('瓦斯爆炸')), 'the third article link is kept');
  const notice = rows.find((row) => row.title.includes('标准化等级'));
  assert.equal(notice.title, '关于降低煤矿一级安全生产标准化等级的公告');
  assert.equal(notice.publishedAt, '2026-11-13T00:00:00+08:00');
  assert.ok(rows.every((row) => row.url.startsWith('https://')));
});

test('parseListPage sorts newest first and honours title filters', () => {
  const rows = parseListPage(PAGE, { baseUrl: BASE, linkPattern: /\.shtml$/, titleFilter: /煤矿/ });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.title.includes('煤矿')));

  const excluded = parseListPage(PAGE, { baseUrl: BASE, linkPattern: /\.shtml$/, titleExclude: /煤矿/ });
  assert.equal(excluded.length, 1);
  assert.ok(!excluded[0].title.includes('煤矿'));
});

test('parseListPage rejects short titles', () => {
  const html = '<a href="/a.shtml">短</a><a href="/b.shtml">这是一个足够长的新闻标题</a>';
  const rows = parseListPage(html, { baseUrl: BASE, linkPattern: /\.shtml$/ });
  assert.equal(rows.length, 1);
});
