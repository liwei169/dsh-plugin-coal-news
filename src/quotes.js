/**
 * Coal-related futures quotes.
 *
 * Sina's domestic futures endpoint (`nf_` prefix) answers one plain-text block
 * per contract in GBK, needs a finance referer, and carries the trading date.
 * It is the only outbound call in this plugin that runs at the 30–60 second
 * tier; news sources stay on their own slower schedule.
 */

const REFERER = 'https://finance.sina.com.cn';
const ENDPOINT = 'https://hq.sinajs.cn/list=';

/** Contracts shown in the panel; a contract without a live price is dropped. */
export const QUOTE_SYMBOLS = [
  { code: 'nf_JM0', symbol: 'JM0', name: '焦煤主连', unit: '元/吨' },
  { code: 'nf_J0', symbol: 'J0', name: '焦炭主连', unit: '元/吨' },
  { code: 'nf_ZC0', symbol: 'ZC0', name: '动力煤主连', unit: '元/吨' },
];

function num(field) {
  const value = Number.parseFloat(field);
  return Number.isFinite(value) ? value : 0;
}

/** Decode the GBK payload without pulling in a dependency. */
function decodeGbk(buffer) {
  try {
    return new TextDecoder('gb18030').decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

/**
 * Parse a Sina quote payload into panel-ready quotes.
 * @param text - decoded `var hq_str_...="..."` lines.
 * @param symbols - expected contracts, in display order.
 */
export function parseQuotePayload(text, symbols = QUOTE_SYMBOLS) {
  const blocks = new Map();
  const re = /var hq_str_(nf_[A-Za-z0-9]+)="([^"]*)"/g;
  let match;
  while ((match = re.exec(text)) !== null) blocks.set(match[1], match[2]);
  const quotes = [];
  for (const symbol of symbols) {
    const body = blocks.get(symbol.code);
    if (body === undefined || body.trim() === '') continue;
    const fields = body.split(',');
    if (fields.length < 18) continue;
    const price = num(fields[8]);
    const previous = num(fields[10]);
    if (price <= 0) continue;
    const change = previous > 0 ? price - previous : 0;
    const changePct = previous > 0 ? (change / previous) * 100 : 0;
    const time = String(fields[1] ?? '').padStart(6, '0');
    const date = String(fields[17] ?? '').trim();
    const stamp = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{6}$/.test(time)
      ? `${date}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+08:00`
      : null;
    quotes.push({
      symbol: symbol.symbol,
      name: symbol.name,
      unit: symbol.unit,
      price,
      open: num(fields[2]),
      high: num(fields[3]),
      low: num(fields[4]),
      previous,
      change: Number(change.toFixed(2)),
      changePct: Number(changePct.toFixed(2)),
      updatedAt: stamp,
    });
  }
  return quotes;
}

/**
 * Fetch the current quotes.
 * @param options.signal - caller cancellation.
 * @param options.timeoutMs - request timeout.
 */
export async function fetchQuotes({ signal, timeoutMs = 6000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`超时（${timeoutMs}ms）`)), timeoutMs);
  const forwardAbort = () => controller.abort(signal.reason);
  if (signal !== undefined) {
    if (signal.aborted) forwardAbort();
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }
  try {
    const response = await fetch(ENDPOINT + QUOTE_SYMBOLS.map((symbol) => symbol.code).join(','), {
      signal: controller.signal,
      headers: {
        referer: REFERER,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        accept: '*/*',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = decodeGbk(Buffer.from(await response.arrayBuffer()));
    return parseQuotePayload(text);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
