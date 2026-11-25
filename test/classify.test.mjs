import test from 'node:test';
import assert from 'node:assert/strict';

import { classify } from '../src/classify.js';

const CASES = [
  ['国家矿山安全监察局关于近期矿山典型事故和违法案件情况的通报', 'safety'],
  ['某矿发生瓦斯爆炸事故造成 3 人被困', 'safety'],
  ['陕西榆林一煤矿因重大隐患被责令停产整顿', 'safety'],
  ['关于进一步加强国有煤矿企业安全生产工作的意见', 'policy'],
  ['国家矿山安全监察局关于印发《煤矿安全监管监察行政处罚裁量权基准》的通知', 'policy'],
  ['关于公开征求《非煤矿山企业安全生产许可证实施办法》意见的函', 'policy'],
  ['CCTD 秦皇岛动力煤价格指数环比下跌 12 元/吨', 'price'],
  ['山西：日运煤超 120 万吨 大秦铁路保供迎峰度冬', 'price'],
  ['煤矿智能化开采技术取得突破', 'tech'],
  ['5G 无人化采煤工作面投入运行', 'tech'],
];

test('classify maps real headlines to the four tabs', () => {
  for (const [title, expected] of CASES) {
    assert.equal(classify(title), expected, title);
  }
});

test('classify falls back to the source category', () => {
  assert.equal(classify('中国煤炭地质总局召开年度工作会议', 'tech'), 'tech');
  assert.equal(classify('中国煤炭地质总局召开年度工作会议', 'policy'), 'policy');
});
