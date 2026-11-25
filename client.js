/**
 * Browser half of the coal-news plugin.
 *
 * Renders the bottom-left panel and polls the Host every 30 seconds. All
 * network work happens on the Host; this module only talks to it through the
 * Connection RPC channel, so it behaves the same in the Web page and in the
 * Desktop shell.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-coal-news',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    const CHANNEL = '/coal-news';
    const POLL_MS = 30_000;
    const SNAPSHOT_KEY = 'dsh.coal-news.snapshot.v1';
    const COLLAPSED_KEY = 'dsh.coal-news.collapsed.v1';
    const POSITION_KEY = 'dsh.coal-news.position.v1';
    const CATEGORY_KEYS = ['all', 'tech', 'safety', 'price', 'policy', 'other'];

    const TEXT = {
      zh: {
        title: '腾盛推荐',
        badge: '煤矿资讯',
        refresh: '刷新',
        collapse: '收起',
        expand: '展开',
        loading: '正在获取最新资讯…',
        error: '暂时取不到数据',
        retry: '重试',
        empty: '该分类暂无更新',
        updated: '更新于',
        stale: '部分数据可能已过期',
        sourcesDown: '个来源不可用',
        refreshHint: '30 秒刷新',
        dragHint: '按住标题可拖动，双击复位',
        close: '关闭',
        open: '打开煤矿资讯',
        justNow: '刚刚',
        minutesAgo: (n) => `${n} 分钟前`,
        hoursAgo: (n) => `${n} 小时前`,
        daysAgo: (n) => `${n} 天前`,
        categories: { all: '全部', tech: '科技', safety: '安全', price: '价格', policy: '政策', other: '综合' },
      },
      en: {
        title: 'Tengsheng picks',
        badge: 'Coal news',
        refresh: 'Refresh',
        collapse: 'Collapse',
        expand: 'Expand',
        loading: 'Loading the latest…',
        error: 'No data right now',
        retry: 'Retry',
        empty: 'Nothing in this category',
        updated: 'Updated',
        stale: 'Some data may be stale',
        sourcesDown: 'sources unavailable',
        refreshHint: 'every 30s',
        dragHint: 'Drag the title to move, double-click to reset',
        close: 'Close',
        open: 'Open coal news',
        justNow: 'just now',
        minutesAgo: (n) => `${n} min ago`,
        hoursAgo: (n) => `${n} h ago`,
        daysAgo: (n) => `${n} d ago`,
        categories: { all: 'All', tech: 'Tech', safety: 'Safety', price: 'Price', policy: 'Policy', other: 'More' },
      },
    };

    const STYLES = `
.dsh-coal-news {
  position: absolute;
  left: calc(16px + env(safe-area-inset-left, 0px));
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
  width: 344px;
  max-width: calc(100vw - 32px);
  max-height: min(540px, calc(100vh - 140px));
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
  font-size: 13px;
  line-height: 20px;
  pointer-events: auto;
  overflow: hidden;
}
.dsh-coal-news.is-collapsed { width: auto; min-width: 196px; }
.dcn-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  flex: 0 0 auto;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.dsh-coal-news.is-dragging { user-select: none; }
.dsh-coal-news.is-dragging .dcn-head { cursor: grabbing; }
.dsh-coal-news.is-dragging { transition: none; }
.dcn-close { font-size: 15px; line-height: 20px; }
.dcn-pill-wrap {
  position: absolute;
  left: calc(16px + env(safe-area-inset-left, 0px));
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  pointer-events: auto;
}
.dcn-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-separator-secondary, rgba(128, 128, 128, 0.25));
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dcn-pill:hover { background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12)); }
.dcn-pill-label { white-space: nowrap; }
.dsh-coal-news:not(.is-collapsed) .dcn-head {
  border-bottom: 1px solid var(--dsw-alias-separator-secondary, rgba(128, 128, 128, 0.18));
}
.dcn-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #e8a33d;
  box-shadow: 0 0 6px rgba(232, 163, 61, 0.65);
}
.dcn-title { font-size: 14px; font-weight: 600; letter-spacing: 0.02em; }
.dcn-badge {
  flex: 0 0 auto;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-separator-secondary, rgba(128, 128, 128, 0.28));
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}
.dcn-spacer { flex: 1 1 auto; }
.dcn-icon {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 13px;
  line-height: 22px;
  cursor: pointer;
}
.dcn-icon:hover { background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12)); color: var(--dsw-alias-label-primary); }
.dcn-icon:disabled { opacity: 0.55; cursor: default; }
.dcn-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 10px 4px; flex: 0 0 auto; }
.dcn-tab {
  padding: 1px 9px;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.1));
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
}
.dcn-tab[aria-selected="true"] { background: rgba(232, 163, 61, 0.16); color: #d98b22; font-weight: 600; }
.dcn-quotes { display: flex; gap: 6px; padding: 6px 10px 2px; overflow-x: auto; flex: 0 0 auto; }
.dcn-quote {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.08));
  white-space: nowrap;
  font-size: 12px;
}
.dcn-quote-name { color: var(--dsw-alias-label-secondary); }
.dcn-quote-price { font-weight: 600; font-variant-numeric: tabular-nums; }
.dcn-up { color: #e5484d; }
.dcn-down { color: #2fa96b; }
.dcn-list { flex: 1 1 auto; overflow-y: auto; padding: 2px 4px 4px; }
.dcn-item { display: block; padding: 7px 8px; border-radius: 8px; color: inherit; text-decoration: none; }
.dcn-item:hover { background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.1)); }
.dcn-item-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  line-height: 19px;
}
.dcn-item-meta {
  margin-top: 2px;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dcn-state, .dcn-empty {
  padding: 16px 12px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  text-align: center;
}
.dcn-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 8px;
  flex: 0 0 auto;
  border-top: 1px solid var(--dsw-alias-separator-secondary, rgba(128, 128, 128, 0.18));
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
}
.dcn-warn { color: #d98b22; }
.dcn-retry {
  border: 0;
  background: transparent;
  color: #d98b22;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 0 2px;
}
`;

    function pickText() {
      let language = 'zh';
      try {
        language = (typeof navigator !== 'undefined' && navigator.language)
          || (typeof document !== 'undefined' && document.documentElement.lang)
          || 'zh';
      } catch {
        language = 'zh';
      }
      return /^zh/i.test(language) ? TEXT.zh : TEXT.en;
    }

    function readJson(key) {
      try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(key);
        return raw === null ? null : JSON.parse(raw);
      } catch {
        return null;
      }
    }

    function writeJson(key, value) {
      try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // A full or disabled storage must not break the panel.
      }
    }

    function readSnapshot() {
      const parsed = readJson(SNAPSHOT_KEY);
      if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.items)) return null;
      return {
        items: parsed.items.slice(0, 300),
        quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
        updatedAt: Number(parsed.updatedAt) || 0,
        stale: Boolean(parsed.stale),
      };
    }

    function readCollapsed() {
      return readJson(COLLAPSED_KEY) === true;
    }

    function readPosition() {
      const parsed = readJson(POSITION_KEY);
      if (parsed === null || typeof parsed !== 'object') return null;
      const left = Number(parsed.left);
      if (!Number.isFinite(left)) return null;
      // A bottom anchor keeps the panel's lower edge fixed, so expanding grows
      // upward instead of running off the bottom of the screen.
      const bottom = Number(parsed.bottom);
      if (Number.isFinite(bottom)) return { left, bottom };
      const top = Number(parsed.top);
      return Number.isFinite(top) ? { left, top } : null;
    }

    /** Inline offset for a stored position; undefined keeps the CSS corner. */
    function positionStyle(position) {
      if (position === null) return undefined;
      return position.bottom !== undefined
        ? { left: position.left, bottom: position.bottom, top: 'auto' }
        : { left: position.left, top: position.top, bottom: 'auto' };
    }

    /**
     * Keep a panel position inside the overlay it lives in.
     * @param position - requested offset in the parent's coordinates.
     * @param element - the panel element, already rendered at that position.
     */
    function clampPosition(position, element) {
      if (element === null || element === undefined) return position;
      const rect = element.getBoundingClientRect();
      const parent = element.offsetParent;
      const parentRect = parent === null || parent === undefined ? null : parent.getBoundingClientRect();
      const width = parentRect === null ? window.innerWidth : parentRect.width;
      const height = parentRect === null ? window.innerHeight : parentRect.height;
      const maxLeft = Math.max(8, width - rect.width - 8);
      const maxBottom = Math.max(8, height - rect.height - 8);
      const left = Math.min(Math.max(8, position.left), maxLeft);
      return position.bottom !== undefined
        ? { left, bottom: Math.min(Math.max(8, position.bottom), maxBottom) }
        : { left, top: Math.min(Math.max(8, position.top), maxBottom) };
    }

    async function rpc(ctx, endpoint, payload, signal) {
      const result = await ctx.connection.rpc.call(CHANNEL, endpoint, payload, signal);
      if (result === undefined || result.ok !== true) {
        throw new Error(result?.error?.message ?? 'Host 未返回结果');
      }
      return result.value;
    }

    function relative(stamp, now, text) {
      if (!Number.isFinite(stamp) || stamp <= 0) return '';
      const diff = Math.max(0, now - stamp);
      if (diff < 60_000) return text.justNow;
      if (diff < 3_600_000) return text.minutesAgo(Math.floor(diff / 60_000));
      if (diff < 86_400_000) return text.hoursAgo(Math.floor(diff / 3_600_000));
      if (diff < 7 * 86_400_000) return text.daysAgo(Math.floor(diff / 86_400_000));
      return new Date(stamp).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });
    }

    function clock(stamp) {
      if (!Number.isFinite(stamp) || stamp <= 0) return '';
      return new Date(stamp).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function itemMeta(item, now, text) {
      const when = relative(Date.parse(item.publishedAt ?? item.fetchedAt ?? ''), now, text);
      return when === '' ? String(item.source ?? '') : `${item.source} · ${when}`;
    }

    function createPanel(ctx) {
      return function CoalNewsPanel() {
        const text = pickText();
        const [initial] = useState(readSnapshot);
        const [items, setItems] = useState(() => initial?.items ?? []);
        const [quotes, setQuotes] = useState(() => initial?.quotes ?? []);
        const [stale, setStale] = useState(() => initial?.stale ?? false);
        const [errors, setErrors] = useState([]);
        const [message, setMessage] = useState(null);
        const [status, setStatus] = useState(() => (initial === null ? 'loading' : 'ready'));
        const [updatedAt, setUpdatedAt] = useState(() => initial?.updatedAt ?? 0);
        const [category, setCategory] = useState('all');
        const [collapsed, setCollapsed] = useState(readCollapsed);
        const [refreshing, setRefreshing] = useState(false);
        const [now, setNow] = useState(() => Date.now());
        const [position, setPosition] = useState(readPosition);
        const [dragging, setDragging] = useState(false);
        const [closed, setClosed] = useState(false);

        const quotesRef = useRef(quotes);
        quotesRef.current = quotes;
        const itemsRef = useRef(items);
        itemsRef.current = items;
        const collapsedRef = useRef(collapsed);
        collapsedRef.current = collapsed;
        const closedRef = useRef(closed);
        closedRef.current = closed;
        const pausedRef = useRef(false);
        const controllerRef = useRef(null);
        const skipCollapseEffect = useRef(true);
        const panelRef = useRef(null);
        const dragRef = useRef(null);
        const positionRef = useRef(position);
        positionRef.current = position;

        const load = async ({ manual = false } = {}) => {
          controllerRef.current?.abort();
          const controller = new AbortController();
          controllerRef.current = controller;
          if (manual) setRefreshing(true);
          try {
            if (manual) {
              await rpc(ctx, 'refresh', {}, controller.signal).catch(() => undefined);
              // Give the Host a moment to finish the fan-out before reading the cache.
              await new Promise((resolve) => setTimeout(resolve, 2000));
              if (controller.signal.aborted) return;
            }
            const [feed, quote] = await Promise.allSettled([
              rpc(ctx, 'feed', {}, controller.signal),
              rpc(ctx, 'quotes', {}, controller.signal),
            ]);
            if (controller.signal.aborted) return;
            const nextQuotes = quote.status === 'fulfilled' ? quote.value.quotes ?? [] : null;
            if (nextQuotes !== null) setQuotes(nextQuotes);
            if (feed.status === 'fulfilled') {
              const value = feed.value;
              setItems(value.items ?? []);
              setStale(Boolean(value.stale));
              setErrors(value.errors ?? []);
              setMessage(null);
              setStatus('ready');
              const stamp = Date.now();
              setUpdatedAt(stamp);
              setNow(stamp);
              writeJson(SNAPSHOT_KEY, {
                items: value.items ?? [],
                quotes: nextQuotes ?? quotesRef.current,
                updatedAt: stamp,
                stale: Boolean(value.stale),
              });
            } else {
              setMessage(feed.reason instanceof Error ? feed.reason.message : '无法连接 Host');
              setStatus(itemsRef.current.length > 0 ? 'ready' : 'error');
            }
          } finally {
            if (manual) setRefreshing(false);
          }
        };

        useEffect(() => {
          void load();
          const timer = setInterval(() => {
            if (pausedRef.current || collapsedRef.current || closedRef.current) return;
            void load();
          }, POLL_MS);
          const ticker = setInterval(() => setNow(Date.now()), POLL_MS);
          const onVisibility = () => {
            pausedRef.current = typeof document !== 'undefined' && document.visibilityState === 'hidden';
            if (!pausedRef.current && !closedRef.current) void load();
          };
          pausedRef.current = typeof document !== 'undefined' && document.visibilityState === 'hidden';
          if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
          return () => {
            clearInterval(timer);
            clearInterval(ticker);
            if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
            controllerRef.current?.abort();
          };
        }, []);

        useEffect(() => {
          if (skipCollapseEffect.current) {
            skipCollapseEffect.current = false;
            return;
          }
          writeJson(COLLAPSED_KEY, collapsed);
          if (!collapsed) void load();
        }, [collapsed]);

        // Keep a restored position inside the window, and migrate an older
        // top anchor that sits in the lower half to a bottom anchor so it
        // expands upward like a freshly dragged panel.
        useEffect(() => {
          if (positionRef.current === null) return;
          const normalize = () => {
            const element = panelRef.current;
            if (element === null) return;
            setPosition((current) => {
              if (current === null) return current;
              const rect = element.getBoundingClientRect();
              const parent = element.offsetParent;
              const parentRect = parent === null ? null : parent.getBoundingClientRect();
              const parentTop = parentRect?.top ?? 0;
              const parentHeight = parentRect?.height ?? window.innerHeight;
              const relativeTop = rect.top - parentTop;
              if (current.top !== undefined && relativeTop + rect.height / 2 > parentHeight / 2) {
                const next = { left: current.left, bottom: Math.max(8, parentHeight - (relativeTop + rect.height)) };
                writeJson(POSITION_KEY, next);
                return next;
              }
              return clampPosition(current, element);
            });
          };
          normalize();
          window.addEventListener('resize', normalize);
          return () => window.removeEventListener('resize', normalize);
        }, []);

        const beginDrag = (event) => {
          if (event.button !== undefined && event.button !== 0) return;
          const element = panelRef.current;
          if (element === null) return;
          if (event.target instanceof Element && event.target.closest('button') !== null) return;
          const rect = element.getBoundingClientRect();
          const parent = element.offsetParent;
          const parentRect = parent === null ? null : parent.getBoundingClientRect();
          const startLeft = rect.left - (parentRect?.left ?? 0);
          const startTop = rect.top - (parentRect?.top ?? 0);
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startLeft,
            startTop,
            width: rect.width,
            height: rect.height,
            maxLeft: Math.max(8, (parentRect?.width ?? window.innerWidth) - rect.width - 8),
            maxTop: Math.max(8, (parentRect?.height ?? window.innerHeight) - rect.height - 8),
          };
          setPosition({ left: startLeft, top: startTop });
          setDragging(true);
          element.setPointerCapture?.(event.pointerId);
          event.preventDefault();
        };

        const moveDrag = (event) => {
          const drag = dragRef.current;
          if (drag === null || event.pointerId !== drag.pointerId) return;
          const left = Math.min(Math.max(8, drag.startLeft + event.clientX - drag.startX), drag.maxLeft);
          const top = Math.min(Math.max(8, drag.startTop + event.clientY - drag.startY), drag.maxTop);
          setPosition({ left, top });
        };

        const endDrag = (event) => {
          const drag = dragRef.current;
          if (drag === null) return;
          dragRef.current = null;
          panelRef.current?.releasePointerCapture?.(event.pointerId);
          setDragging(false);
          const element = panelRef.current;
          if (element === null) return;
          // Re-anchor on whichever edge is closer: a panel resting near the
          // bottom must grow upward when it expands, or it leaves the screen.
          const rect = element.getBoundingClientRect();
          const parent = element.offsetParent;
          const parentRect = parent === null ? null : parent.getBoundingClientRect();
          const parentLeft = parentRect?.left ?? 0;
          const parentTop = parentRect?.top ?? 0;
          const parentWidth = parentRect?.width ?? window.innerWidth;
          const parentHeight = parentRect?.height ?? window.innerHeight;
          const maxLeft = Math.max(8, parentWidth - rect.width - 8);
          const maxEdge = Math.max(8, parentHeight - rect.height - 8);
          const left = Math.min(Math.max(8, rect.left - parentLeft), maxLeft);
          const relativeTop = rect.top - parentTop;
          const relativeBottom = parentHeight - (rect.bottom - parentTop);
          const next = relativeTop + rect.height / 2 > parentHeight / 2
            ? { left, bottom: Math.min(Math.max(8, relativeBottom), maxEdge) }
            : { left, top: Math.min(Math.max(8, relativeTop), maxEdge) };
          setPosition(next);
          writeJson(POSITION_KEY, next);
        };

        const resetPosition = () => {
          setPosition(null);
          writeJson(POSITION_KEY, null);
        };

        const visible = category === 'all' ? items : items.filter((item) => item.category === category);
        const errorTitle = errors.map((entry) => `${entry.name}: ${entry.error}`).join('\n');

        const sectionProps = {
          ref: panelRef,
          className: `dsh-coal-news${collapsed ? ' is-collapsed' : ''}${dragging ? ' is-dragging' : ''}`,
          'aria-label': `${text.title} ${text.badge}`,
          style: positionStyle(position),
          onPointerMove: moveDrag,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
        };

        const header = h(
          'header',
          {
            className: 'dcn-head',
            title: text.dragHint,
            onPointerDown: beginDrag,
            onDoubleClick: resetPosition,
          },
          h('span', { className: 'dcn-dot', 'aria-hidden': 'true' }),
          h('span', { className: 'dcn-title' }, text.title),
          h('span', { className: 'dcn-badge' }, text.badge),
          h('span', { className: 'dcn-spacer' }),
          h('button', {
            type: 'button',
            className: 'dcn-icon',
            title: text.refresh,
            'aria-label': text.refresh,
            disabled: refreshing,
            onClick: () => void load({ manual: true }),
          }, refreshing ? '·' : '⟳'),
          h('button', {
            type: 'button',
            className: 'dcn-icon',
            title: collapsed ? text.expand : text.collapse,
            'aria-label': collapsed ? text.expand : text.collapse,
            'aria-expanded': String(!collapsed),
            onClick: () => setCollapsed((value) => !value),
          }, collapsed ? '▴' : '▾'),
          h('button', {
            type: 'button',
            className: 'dcn-icon dcn-close',
            title: text.close,
            'aria-label': text.close,
            onClick: () => setClosed(true),
          }, '×'),
        );

        if (closed) {
          return h(
            'div',
            { className: 'dcn-pill-wrap', style: positionStyle(position) },
            h('style', null, STYLES),
            h(
              'button',
              {
                type: 'button',
                className: 'dcn-pill',
                title: text.open,
                'aria-label': text.open,
                onClick: () => {
                  setClosed(false);
                  void load();
                },
              },
              h('span', { className: 'dcn-dot', 'aria-hidden': 'true' }),
              h('span', { className: 'dcn-pill-label' }, text.badge),
            ),
          );
        }

        if (collapsed) {
          return h('section', sectionProps, h('style', null, STYLES), header);
        }

        const tabs = h(
          'div',
          { className: 'dcn-tabs', role: 'tablist' },
          CATEGORY_KEYS.map((key) => h('button', {
            key,
            type: 'button',
            role: 'tab',
            className: 'dcn-tab',
            'aria-selected': String(category === key),
            onClick: () => setCategory(key),
          }, text.categories[key])),
        );

        const quoteRow = quotes.length === 0 ? null : h(
          'div',
          { className: 'dcn-quotes' },
          quotes.map((quote) => h(
            'span',
            { key: quote.symbol, className: 'dcn-quote', title: quote.updatedAt ?? '' },
            h('span', { className: 'dcn-quote-name' }, quote.name),
            h('span', { className: 'dcn-quote-price' }, String(quote.price)),
            h('span', {
              className: quote.changePct > 0 ? 'dcn-up' : quote.changePct < 0 ? 'dcn-down' : '',
            }, `${quote.changePct > 0 ? '+' : ''}${quote.changePct.toFixed(2)}%`),
          )),
        );

        let body;
        if (status === 'loading') {
          body = h('div', { className: 'dcn-state' }, text.loading);
        } else if (status === 'error') {
          body = h(
            'div',
            { className: 'dcn-state' },
            h('div', null, message ?? text.error),
            h('button', { type: 'button', className: 'dcn-retry', onClick: () => void load() }, text.retry),
          );
        } else if (visible.length === 0) {
          body = h('div', { className: 'dcn-empty' }, text.empty);
        } else {
          body = h(
            'div',
            { className: 'dcn-list' },
            visible.map((item) => h(
              'a',
              {
                key: item.id,
                className: 'dcn-item',
                href: item.url,
                target: '_blank',
                rel: 'noreferrer noopener',
                title: item.title,
              },
              h('div', { className: 'dcn-item-title' }, item.title),
              h('div', { className: 'dcn-item-meta' }, itemMeta(item, now, text)),
            )),
          );
        }

        const footer = h(
          'footer',
          { className: 'dcn-foot' },
          h('span', null, updatedAt > 0 ? `${text.updated} ${clock(updatedAt)}` : text.loading),
          stale ? h('span', { className: 'dcn-warn' }, `· ${text.stale}`) : null,
          errors.length > 0
            ? h('span', { className: 'dcn-warn', title: errorTitle }, `· ${errors.length} ${text.sourcesDown}`)
            : null,
          h('span', { className: 'dcn-spacer' }),
          h('span', null, text.refreshHint),
        );

        return h(
          'section',
          sectionProps,
          h('style', null, STYLES),
          header,
          tabs,
          quoteRow,
          body,
          footer,
        );
      };
    }

    return {
      inject: ['slots', 'connection'],
      /**
       * Register the news panel in the shell overlay.
       * @param ctx - client plugin context.
       */
      apply(ctx) {
        const Panel = createPanel(ctx);
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'coal-news',
          order: 60,
        }, Panel));
      },
    };
  },
});
