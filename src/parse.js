/**
 * HTML list-page parsing shared by every news source.
 *
 * Chinese industry and government sites render their column pages on the
 * server as plain anchors, so one small parser covers them all as long as the
 * source declares which links are articles.
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  ldquo: '“',
  rdquo: '”',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  times: '×',
  rarr: '→',
};

const SKIP_TITLE = /^(更多|更多>>|下一页|上一页|首页|尾页|返回|打印|关闭|登录|注册|English)$/;
const TRAILING_DATE = /[\s\u3000]*\d{4}-\d{1,2}-\d{1,2}[\s\u3000]*$/;

const URL_DATE_PATTERNS = [
  /\/t(\d{4})(\d{2})(\d{2})_\d+/,        // /202611/t20261123_740427.shtml
  /(?:\/content)?\/(\d{4})(\d{2})\/(\d{2})\//, // /content/202611/23/c300318.html
  /(\d{4})(\d{2})(\d{2})\//,              // /20261118/<hash>/c.html
  /(\d{4})-(\d{2})\/(\d{2})\//,
  /(\d{4})\/(\d{2})\/(\d{2})\//,
];

/** Decode HTML entities, including numeric forms. */
export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Strip tags and collapse whitespace into one readable line. */
export function plainText(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Resolve a page href against its document URL.
 * @returns absolute URL, or undefined for non-http(s) targets.
 */
export function resolveUrl(base, href) {
  if (typeof href !== 'string' || href === '' || href.startsWith('#') || href.startsWith('javascript:')) return undefined;
  try {
    const url = new URL(href, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return undefined;
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const pad = (n) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}T00:00:00+08:00`;
}

/**
 * Derive a publication date from the article URL, the usual place Chinese
 * CMSs encode it.
 * @returns ISO timestamp at Asia/Shanghai midnight, or undefined.
 */
export function dateFromUrl(url) {
  for (const pattern of URL_DATE_PATTERNS) {
    const match = pattern.exec(url);
    if (match) {
      const iso = isoDate(match[1], match[2], match[3]);
      if (iso !== undefined) return iso;
    }
  }
  return undefined;
}

/** Derive a publication date written in the visible text. */
export function dateFromText(text) {
  const match = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  return match ? isoDate(match[1], match[2], match[3]) : undefined;
}

/** Collect every anchor on the page with its resolved target. */
export function collectAnchors(html, baseUrl) {
  const anchors = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const attrs = match[1];
    const href = /href\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
    const url = resolveUrl(baseUrl, href);
    if (url === undefined) continue;
    const titleAttr = /title\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
    const text = plainText(match[2]);
    anchors.push({
      url,
      title: text !== '' ? text : plainText(decodeEntities(titleAttr ?? '')),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return anchors;
}

const CONTEXT_DATE_PATTERNS = [
  /(\d{4})-(\d{1,2})-(\d{1,2})/,
  /(\d{4})年(\d{1,2})月(\d{1,2})日/,
  /(\d{4})\.(\d{1,2})\.(\d{1,2})/,
  /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
];

const EARLIEST_YEAR = 2015;

/** A clock time printed immediately after the date, such as ` 9:45` or `&nbsp;14:05`. */
const TIME_SUFFIX = /^[\s\u3000|·\-–]{0,4}(\d{1,2}):(\d{2})(?!\d)/;

/** Build an Asia/Shanghai timestamp from a date and an optional clock time. */
function isoStamp(year, month, day, hour, minute) {
  const date = isoDate(year, month, day);
  if (date === undefined) return undefined;
  if (hour === undefined || minute === undefined) return date;
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return date;
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.slice(0, 10)}T${pad(h)}:${pad(m)}:00+08:00`;
}

/**
 * Find the publication time a list row prints beside its link.
 *
 * Chinese CMSs very often put the date in the neighbouring cell rather than in
 * the URL, so without this a whole site looks undated. When the row also prints
 * a clock time (`2026-11-25 9:45`) it is used, so today's rows do not all look
 * like midnight. The window is small and the year is validated to keep
 * neighbouring rows from leaking in.
 *
 * @param html - page source.
 * @param start - anchor start offset.
 * @param end - anchor end offset.
 * @returns ISO timestamp at Asia/Shanghai time, or undefined.
 */
export function dateFromContext(html, start, end) {
  const windows = [
    html.slice(end, Math.min(html.length, end + 260)),
    html.slice(Math.max(0, start - 160), start),
  ];
  const latestYear = new Date().getFullYear() + 1;
  for (const window of windows) {
    for (const pattern of CONTEXT_DATE_PATTERNS) {
      const match = pattern.exec(window);
      if (match === null) continue;
      const year = Number(match[1]);
      if (year < EARLIEST_YEAR || year > latestYear) continue;
      const after = window.slice(match.index + match[0].length);
      const time = TIME_SUFFIX.exec(after);
      const iso = time === null
        ? isoStamp(match[1], match[2], match[3])
        : isoStamp(match[1], match[2], match[3], time[1], time[2]);
      if (iso !== undefined) return iso;
    }
  }
  return undefined;
}

/**
 * Parse one column page into news rows.
 *
 * @param html - page source.
 * @param options.baseUrl - document URL used to resolve relative hrefs.
 * @param options.linkPattern - regular expression an article href must match.
 * @param options.titleFilter - optional regular expression a title must match.
 * @param options.titleExclude - optional regular expression that drops a title.
 * @param options.minTitleLength - shortest acceptable title.
 * @returns rows without duplicates, newest first when dates exist.
 */
export function parseListPage(html, {
  baseUrl,
  linkPattern,
  titleFilter,
  titleExclude,
  minTitleLength = 8,
} = {}) {
  const seen = new Set();
  const rows = [];
  for (const anchor of collectAnchors(html, baseUrl)) {
    if (linkPattern !== undefined && !linkPattern.test(anchor.url)) continue;
    const title = anchor.title.replace(TRAILING_DATE, '').trim();
    if (title.length < minTitleLength || SKIP_TITLE.test(title)) continue;
    if (titleFilter !== undefined && !titleFilter.test(title)) continue;
    if (titleExclude !== undefined && titleExclude.test(title)) continue;
    if (seen.has(anchor.url)) continue;
    seen.add(anchor.url);
    // A URL date is the most reliable, but it only carries the day. When the
    // row prints a clock time on that same day, the more precise value wins.
    const fromUrl = dateFromUrl(anchor.url);
    const fromText = dateFromText(anchor.title);
    const fromContext = dateFromContext(html, anchor.start, anchor.end);
    const candidates = [fromUrl, fromText, fromContext].filter((value) => value !== undefined);
    const first = candidates[0];
    const precise = candidates.find((value) => !value.endsWith('T00:00:00+08:00'));
    const publishedAt = precise !== undefined && first !== undefined && precise.slice(0, 10) === first.slice(0, 10)
      ? precise
      : first;
    rows.push({ url: anchor.url, title, ...publishedAt === undefined ? {} : { publishedAt } });
  }
  rows.sort((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0));
  return rows;
}
