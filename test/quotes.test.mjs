import test from 'node:test';
import assert from 'node:assert/strict';

import { parseQuotePayload } from '../src/quotes.js';

// Shape returned by hq.sinajs.cn after GBK decoding, trimmed to the fields we read.
const PAYLOAD = [
  'var hq_str_nf_JM0="焦煤连续,113000,1420.000,1490.000,1414.000,0.000,1489.500,1490.000,1490.000,0.000,1412.500,24,660,443339.000,681034,连,焦煤,2026-11-25,1,*";',
  'var hq_str_nf_J0="焦炭连续,113000,1962.500,2046.000,1960.000,0.000,2045.000,2045.500,2045.000,0.000,1962.000,1,5,50579.000,40247,连,焦炭,2026-11-25,1,*";',
  'var hq_str_nf_ZC0="";',
].join('\n');

test('parseQuotePayload keeps live contracts and skips empty ones', () => {
  const quotes = parseQuotePayload(PAYLOAD);
  assert.equal(quotes.length, 2, 'ZC0 has no data and is dropped');
  const [jm, j] = quotes;
  assert.equal(jm.symbol, 'JM0');
  assert.equal(jm.name, '焦煤主连');
  assert.equal(jm.price, 1490);
  assert.equal(jm.previous, 1412.5);
  assert.equal(jm.change, 77.5);
  assert.equal(jm.changePct, 5.49);
  assert.equal(jm.updatedAt, '2026-11-25T11:30:00+08:00');
  assert.equal(j.price, 2045);
  assert.equal(j.changePct, 4.23);
});

test('parseQuotePayload ignores unknown contracts', () => {
  const quotes = parseQuotePayload('var hq_str_nf_XX0="未知,113000,1,1,1,0,0,0,1,0,1";');
  assert.equal(quotes.length, 0);
});
