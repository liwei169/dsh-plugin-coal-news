/**
 * Host half of the coal-news plugin.
 *
 * Fetches every source on its own schedule, keeps one in-memory cache, and
 * answers the browser through a generic Connection RPC channel. The panel is
 * the only consumer, so the channel is read-only apart from `refresh`.
 */

import { createStore } from './src/store.js';
import { classify } from './src/classify.js';
import { filterFresh } from './src/fresh.js';
import { fetchText } from './src/http.js';
import { parseListPage } from './src/parse.js';
import { fetchQuotes } from './src/quotes.js';
import { DEFAULT_MAX_AGE_DAYS, QUOTE_INTERVAL_MS, SOURCES } from './src/sources.js';

/** Logical channel the browser posts to; also the source of the route path. */
const CHANNEL = '/coal-news';
/** How long a first `feed` call waits for the cold start before answering. */
const FIRST_LOAD_WAIT_MS = 12000;
/** Upper bound for the quote wait on a cold panel. */
const QUOTES_WAIT_MS = 6000;

/** Host services this plugin cannot work without. */
export const inject = ['connection'];

function describe(error) {
  if (error instanceof Error) return error.message;
  return String(error ?? '未知错误');
}

export function apply(ctx) {
  const store = createStore();
  for (const definition of SOURCES) store.register(definition);

  const timers = new Set();
  const inflight = new Map();
  let quotesInflight = null;
  let disposed = false;
  let firstLoad;

  const later = (fn, delay) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, delay);
    timers.add(timer);
    return timer;
  };

  const sleep = (ms) => new Promise((resolve) => later(resolve, ms));

  const refreshSource = (definition) => {
    if (disposed) return Promise.resolve(0);
    const running = inflight.get(definition.id);
    if (running !== undefined) return running;
    const task = (async () => {
      try {
        const pageUrls = [definition.url];
        if (definition.pages > 0 && typeof definition.pageUrl === 'function') {
          for (let index = 1; index <= definition.pages; index += 1) {
            pageUrls.push(definition.pageUrl(definition.url, index));
          }
        }
        const responses = await Promise.allSettled(pageUrls.map((url) => fetchText(url, { timeoutMs: 9000 })));
        const parsed = [];
        const seen = new Set();
        let failures = 0;
        for (const response of responses) {
          if (response.status !== 'fulfilled') {
            failures += 1;
            continue;
          }
          for (const row of parseListPage(response.value.text, {
            baseUrl: definition.url,
            linkPattern: definition.linkPattern,
            titleFilter: definition.titleFilter,
            titleExclude: definition.titleExclude,
          })) {
            if (seen.has(row.url)) continue;
            seen.add(row.url);
            parsed.push(row);
          }
        }
        if (parsed.length === 0) {
          throw new Error(failures === pageUrls.length ? '全部页面请求失败' : '未解析到条目（栏目结构可能已变更）');
        }
        // Old documents and case libraries must not make the panel read as stale.
        const fresh = filterFresh(parsed, {
          maxAgeDays: definition.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
        }).filter((row) => definition.requireDate !== true || row.publishedAt !== undefined);
        return store.ingest(definition.id, fresh.map((row) => ({
          ...row,
          source: definition.name,
          category: classify(row.title, definition.category),
        })));
      } catch (error) {
        store.fail(definition.id, describe(error));
        return 0;
      } finally {
        inflight.delete(definition.id);
      }
    })();
    inflight.set(definition.id, task);
    return task;
  };

  const refreshQuotes = () => {
    if (disposed) return Promise.resolve(0);
    if (quotesInflight !== null) return quotesInflight;
    quotesInflight = (async () => {
      try {
        const quotes = await fetchQuotes();
        if (quotes.length === 0) throw new Error('行情接口未返回有效合约');
        store.setQuotes(quotes);
        return quotes.length;
      } catch (error) {
        store.failQuotes(describe(error));
        return 0;
      } finally {
        quotesInflight = null;
      }
    })();
    return quotesInflight;
  };

  const schedule = (definition, delay) => {
    if (disposed) return;
    later(async () => {
      await refreshSource(definition);
      schedule(definition, Math.round(definition.intervalMs * (0.85 + Math.random() * 0.3)));
    }, delay);
  };

  const scheduleQuotes = (delay) => {
    if (disposed) return;
    later(async () => {
      await refreshQuotes();
      scheduleQuotes(Math.round(QUOTE_INTERVAL_MS * (0.85 + Math.random() * 0.3)));
    }, delay);
  };

  /**
   * Cold start: fetch every source once, staggered, plus quotes. Reused by every
   * endpoint so the panel's first paint is data rather than an empty list.
   */
  const kickoff = () => {
    if (firstLoad !== undefined) return firstLoad;
    const initial = SOURCES.map((definition, index) => new Promise((resolve) => {
      later(() => resolve(refreshSource(definition)), index * 150);
    }));
    initial.push(new Promise((resolve) => {
      later(() => resolve(refreshQuotes()), 600);
    }));
    firstLoad = Promise.all(initial).then(() => undefined);
    return firstLoad;
  };

  const awaitFirstLoad = async (timeoutMs) => {
    kickoff();
    if (timeoutMs <= 0) return;
    await Promise.race([firstLoad, sleep(timeoutMs)]);
  };

  /** One endpoint dispatch; every failure becomes an explicit `ok: false`. */
  const handle = async (endpoint, payload) => {
    switch (endpoint) {
      case 'feed': {
        await awaitFirstLoad(payload?.wait === false ? 0 : FIRST_LOAD_WAIT_MS);
        return { ok: true, value: store.feed(payload ?? {}) };
      }
      case 'quotes': {
        await awaitFirstLoad(QUOTES_WAIT_MS);
        return { ok: true, value: store.quoteSnapshot() };
      }
      case 'status': {
        return { ok: true, value: store.status() };
      }
      case 'refresh': {
        const wanted = Array.isArray(payload?.sources) ? new Set(payload.sources) : null;
        for (const definition of SOURCES) {
          if (wanted !== null && !wanted.has(definition.id)) continue;
          void refreshSource(definition);
        }
        void refreshQuotes();
        return { ok: true, value: { accepted: true } };
      }
      default:
        return {
          ok: false,
          error: { code: 'coal-news/unknown-endpoint', message: `未知接口 ${endpoint}`, details: {} },
        };
    }
  };

  ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
    try {
      return await handle(endpoint, payload ?? {});
    } catch (error) {
      return {
        ok: false,
        error: { code: 'coal-news/internal', message: describe(error), details: {} },
      };
    }
  });

  // Warm the cache immediately so the first panel paint has data, then keep each
  // source on its own schedule for as long as the plugin stays loaded.
  kickoff();
  for (const definition of SOURCES) {
    schedule(definition, definition.intervalMs);
  }
  scheduleQuotes(QUOTE_INTERVAL_MS);

  ctx.effect(() => () => {
    disposed = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    inflight.clear();
  });
}
