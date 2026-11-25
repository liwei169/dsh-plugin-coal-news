/**
 * Title-based category assignment.
 *
 * A source declares the column it mostly publishes; the first matching rule
 * below overrides that default, so one column can still feed several tabs.
 * Order matters: a real accident headline is `safety` even when the document is
 * a 通知, while a rulebook or an opinion is `policy` even when it talks about
 * safety, and enforcement wording alone sits between the two.
 */

const RULES = [
  // An actual incident is safety news whatever document form it arrives in.
  ['safety', /事故|矿难|瓦斯|透水|火灾|冲击地压|顶板|坍塌|冒顶|爆炸|伤亡|被困|救援|突水|溃泥/],
  // Issued documents are policy news.
  ['policy', /通知|意见|办法|条例|规定|标准|公告|规划|政策|印发|征求|方案|部署|细则|指南|纲要/],
  // Enforcement and supervision without an incident.
  ['safety', /停产|隐患|通报|警示|执法|监察|处罚|违法|非法|整顿|超能力|超层越界|标准化等级/],
  // Technology wording wins over market wording: "智能化工作面产量" is tech news.
  ['tech', /智能|数字化|数字|智慧|信息化|科技|技术|装备|创新|研发|专利|大模型|5G|自动化|首台|示范|攻关|科研|充填|洗选|甲烷|减排|开采|机器人|无人/],
  ['price', /价格|指数|报价|煤价|涨|跌|库存|长协|期货|现货|港口|秦皇岛|成交|供需|产量|运价|进口|出口|发运|运输|铁路|销量|销售|保供|迎峰|冬储|供应|需求|运力|调运|吨|供暖|电厂|用电|发电/],
];

/**
 * Classify one headline.
 * @param title - article title.
 * @param fallback - category to use when no rule matches.
 * @returns one of `tech`, `safety`, `price`, `policy`.
 */
export function classify(title, fallback = 'other') {
  const text = String(title ?? '');
  for (const [category, pattern] of RULES) {
    if (pattern.test(text)) return category;
  }
  return fallback;
}
