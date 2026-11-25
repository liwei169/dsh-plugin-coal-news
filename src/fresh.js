/**
 * Freshness gate.
 *
 * Government columns keep a sidebar of old documents and case libraries list
 * years-old rulings next to current news. A panel that mixes them reads as
 * stale, so every source is cut to a publishing window at ingest time.
 */

/**
 * Keep rows published inside the window; undated rows are always kept.
 *
 * @param rows - parsed rows carrying an optional `publishedAt` ISO date.
 * @param options.now - current time in ms.
 * @param options.maxAgeDays - window length; a non-positive value disables it.
 * @returns the rows inside the window.
 */
export function filterFresh(rows, { now = Date.now(), maxAgeDays = Number.POSITIVE_INFINITY } = {}) {
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return rows;
  const cutoff = now - maxAgeDays * 86_400_000;
  return rows.filter((row) => {
    if (typeof row.publishedAt !== 'string' || row.publishedAt === '') return true;
    const stamp = Date.parse(row.publishedAt);
    return !Number.isFinite(stamp) || stamp >= cutoff;
  });
}
