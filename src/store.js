/**
 * In-memory feed store: deduplication, ordering, pruning, and source health.
 *
 * The store is a derived cache — nothing here is durable — so a restart simply
 * refetches. Keeping it dependency-free keeps the published plugin installable
 * from npm without resolving any Harness-internal package.
 */

import { createHash } from 'node:crypto';

/** Stable identity for an article URL. */
export function newsId(url) {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

/** A row whose source printed only a date carries midnight, not a real time. */
const DAY_ONLY = /T00:00:00\+08:00$/;

/**
 * Sort key: publication time when known, else the end of that day for a
 * date-only row (capped at now) so today's date-only rows still rank above
 * yesterday's timed ones, and zero for undated rows so they sink to the bottom.
 */
function stamp(item, current = Date.now()) {
  if (typeof item.publishedAt !== 'string' || item.publishedAt === '') return 0;
  const parsed = Date.parse(item.publishedAt);
  if (!Number.isFinite(parsed)) return 0;
  return DAY_ONLY.test(item.publishedAt) ? Math.min(parsed + 86_399_999, current) : parsed;
}

/**
 * Create one feed store.
 * @param options.now - injectable clock for tests.
 * @param options.maxItems - hard cap on retained articles.
 */
export function createStore({ now = () => Date.now(), maxItems = 1200 } = {}) {
  const items = new Map();
  const sources = new Map();
  let quotes = [];
  let quotesAt = 0;
  let quotesError = null;
  let lastIngestAt = 0;

  function sourceState(id) {
    let state = sources.get(id);
    if (state === undefined) {
      state = {
        id,
        name: id,
        category: 'tech',
        intervalMs: 600000,
        lastOkAt: 0,
        lastErrorAt: 0,
        error: null,
        failures: 0,
        added: 0,
      };
      sources.set(id, state);
    }
    return state;
  }

  function prune() {
    if (items.size <= maxItems) return;
    const ordered = [...items.values()].sort((a, b) => stamp(a, now()) - stamp(b, now()));
    for (const item of ordered.slice(0, items.size - maxItems)) items.delete(item.id);
  }

  return {
    /** Declare a source so `status` lists it before its first fetch. */
    register(definition) {
      const state = sourceState(definition.id);
      state.name = definition.name ?? state.name;
      state.category = definition.category ?? state.category;
      state.intervalMs = definition.intervalMs ?? state.intervalMs;
      return state;
    },

    /**
     * Merge freshly parsed rows for one source.
     * @param sourceId - declaring source id.
     * @param rows - rows carrying url, title, category, and optional publishedAt.
     * @returns how many new articles were added.
     */
    ingest(sourceId, rows) {
      const state = sourceState(sourceId);
      const at = new Date(now()).toISOString();
      let added = 0;
      for (const row of rows) {
        const id = newsId(row.url);
        if (items.has(id)) continue;
        items.set(id, {
          id,
          title: row.title,
          url: row.url,
          source: row.source ?? state.name,
          sourceId,
          category: row.category ?? state.category,
          publishedAt: row.publishedAt ?? null,
          fetchedAt: at,
        });
        added += 1;
      }
      state.lastOkAt = now();
      state.failures = 0;
      state.error = null;
      state.added += added;
      if (added > 0) lastIngestAt = state.lastOkAt;
      prune();
      return added;
    },

    /** Record one failed fetch, keeping the previously collected rows. */
    fail(sourceId, message) {
      const state = sourceState(sourceId);
      state.failures += 1;
      state.lastErrorAt = now();
      state.error = String(message ?? '未知错误');
      return state;
    },

    /** Replace the quote snapshot. */
    setQuotes(list) {
      quotes = Array.isArray(list) ? list : [];
      quotesAt = now();
      quotesError = null;
    },

    /** Record a quote failure without dropping the previous snapshot. */
    failQuotes(message) {
      quotesError = String(message ?? '未知错误');
    },

    /**
     * Query the feed for the browser.
     * @param query.categories - category allowlist; empty or absent means all.
     * @param query.since - ISO timestamp lower bound.
     * @param query.limit - maximum rows returned.
     */
    feed({ categories, since, limit = 200 } = {}) {
      const sinceMs = since === undefined ? Number.NaN : Date.parse(since);
      const wanted = Array.isArray(categories) && categories.length > 0 ? new Set(categories) : undefined;
      const rows = [...items.values()]
        .filter((item) => wanted === undefined || wanted.has(item.category))
        .filter((item) => !Number.isFinite(sinceMs) || stamp(item, now()) > sinceMs)
        .sort((a, b) => stamp(b, now()) - stamp(a, now()))
        .slice(0, Math.max(1, Math.min(500, limit)));
      const errors = [...sources.values()]
        .filter((state) => state.error !== null)
        .map((state) => ({
          id: state.id,
          name: state.name,
          error: state.error,
          lastErrorAt: state.lastErrorAt > 0 ? new Date(state.lastErrorAt).toISOString() : null,
        }));
      const fetchedAt = new Date(lastIngestAt > 0 ? lastIngestAt : now()).toISOString();
      const ageMs = lastIngestAt > 0 ? now() - lastIngestAt : Number.POSITIVE_INFINITY;
      return {
        items: rows,
        fetchedAt,
        ageMs: Number.isFinite(ageMs) ? ageMs : null,
        stale: errors.length > 0 || !Number.isFinite(ageMs) || ageMs > 3 * 3600000,
        errors,
        total: items.size,
      };
    },

    /** Current quote snapshot. */
    quoteSnapshot() {
      return {
        quotes,
        fetchedAt: quotesAt > 0 ? new Date(quotesAt).toISOString() : null,
        stale: quotesError !== null || quotesAt === 0,
        error: quotesError,
      };
    },

    /** Source health for the panel footer and the `status` endpoint. */
    status() {
      const list = [...sources.values()].map((state) => ({
        id: state.id,
        name: state.name,
        category: state.category,
        intervalMs: state.intervalMs,
        lastOkAt: state.lastOkAt > 0 ? new Date(state.lastOkAt).toISOString() : null,
        lastErrorAt: state.lastErrorAt > 0 ? new Date(state.lastErrorAt).toISOString() : null,
        error: state.error,
        failures: state.failures,
        added: state.added,
      }));
      return {
        sources: list,
        items: items.size,
        quotes: quotes.length,
        cacheAgeMs: lastIngestAt > 0 ? now() - lastIngestAt : null,
        now: new Date(now()).toISOString(),
      };
    },
  };
}

