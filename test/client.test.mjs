import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

/** Minimal React stand-in: enough to render the component once, no DOM. */
function fakeReact() {
  return {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity) };
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}];
    },
    useEffect() {},
    useRef(value) {
      return { current: value };
    },
  };
}

function loadClient({ storage = {}, session = {}, language = 'zh-CN' } = {}) {
  let registration;
  const window = { __ModuleLoader__: { load(spec) { registration = spec; } } };
  const context = vm.createContext({
    window,
    console,
    navigator: { language },
    localStorage: {
      getItem(key) {
        return Object.hasOwn(storage, key) ? storage[key] : null;
      },
      setItem() {},
    },
    sessionStorage: {
      getItem(key) {
        return Object.hasOwn(session, key) ? session[key] : null;
      },
      setItem() {},
      removeItem() {},
    },
  });
  vm.runInContext(SOURCE, context, { filename: 'client.js' });
  assert.ok(registration, 'client module registers itself with the module loader');
  assert.equal(registration.id, 'dsh-plugin-coal-news');
  const react = fakeReact();
  const plugin = registration.factory((name) => {
    assert.equal(name, 'react', 'the factory only requires react');
    return react;
  });
  return plugin;
}

function fakeCtx() {
  const registrations = [];
  return {
    registrations,
    ctx: {
      slots: {
        inject(owner, factory) {
          assert.equal(owner, 'shell.overlay');
          factory();
        },
        register(options, component) {
          registrations.push({ options, component });
        },
      },
      connection: { rpc: { call: async () => ({ ok: true, value: { items: [], quotes: [] } }) } },
    },
  };
}

function texts(node, out = []) {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (node === null || node === undefined || typeof node !== 'object') return out;
  for (const child of node.children ?? []) texts(child, out);
  return out;
}

function findByClass(node, className) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined;
  const own = String(node.props?.className ?? '');
  if (own.split(/\s+/).includes(className)) return node;
  for (const child of node.children ?? []) {
    const found = findByClass(child, className);
    if (found !== undefined) return found;
  }
  return undefined;
}

test('apply registers one panel in the shell overlay', () => {
  const plugin = loadClient();
  const { ctx, registrations } = fakeCtx();
  plugin.apply(ctx);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].options.name, 'shell.overlay');
  assert.equal(registrations[0].options.id, 'coal-news');
  assert.equal(typeof registrations[0].component, 'function');
  assert.deepEqual(plugin.inject.join(','), 'slots,connection');
});

test('panel renders the 腾盛推荐 title, badge, tabs, and loading state', () => {
  const plugin = loadClient();
  const { ctx, registrations } = fakeCtx();
  plugin.apply(ctx);
  const rendered = texts(registrations[0].component());
  assert.ok(rendered.includes('腾盛推荐'), 'title');
  assert.ok(rendered.includes('煤矿资讯'), 'badge');
  assert.ok(rendered.includes('正在获取最新资讯…'), 'loading state');
  for (const label of ['全部', '科技', '安全', '价格', '政策', '综合']) {
    assert.ok(rendered.includes(label), label);
  }
  assert.ok(rendered.includes('30 秒刷新'), 'refresh hint');
});

test('panel renders a cached snapshot instead of the loading state', () => {
  const snapshot = {
    items: [
      {
        id: 'x1',
        title: '陕西榆林一煤矿因重大隐患被责令停产整顿',
        url: 'https://example.com/1',
        source: '国家矿山安全监察局',
        category: 'safety',
        publishedAt: '2026-11-25T01:00:00+08:00',
        fetchedAt: '2026-11-25T02:00:00+08:00',
      },
    ],
    quotes: [{ symbol: 'JM0', name: '焦煤主连', price: 1490, changePct: 5.49, updatedAt: '2026-11-25T11:30:00+08:00' }],
    updatedAt: Date.parse('2026-11-25T11:00:00+08:00'),
    stale: false,
  };
  const plugin = loadClient({ storage: { 'dsh.coal-news.snapshot.v1': JSON.stringify(snapshot) } });
  const { ctx, registrations } = fakeCtx();
  plugin.apply(ctx);
  const rendered = texts(registrations[0].component());
  assert.ok(rendered.some((line) => line.includes('陕西榆林')), 'cached headline renders');
  assert.ok(rendered.includes('焦煤主连'), 'cached quote renders');
  assert.ok(!rendered.includes('正在获取最新资讯…'), 'no loading state with a snapshot');
  assert.ok(rendered.some((line) => line.includes('+5.49')), 'signed percent');
});

test('english locale uses its own copy', () => {
  const plugin = loadClient({ language: 'en-US' });
  const { ctx, registrations } = fakeCtx();
  plugin.apply(ctx);
  const rendered = texts(registrations[0].component());
  assert.ok(rendered.includes('Tengsheng picks'));
  assert.ok(rendered.includes('Coal news'));
});

test('collapsed snapshot keeps only the header', () => {
  const plugin = loadClient({ storage: { 'dsh.coal-news.collapsed.v1': 'true' } });
  const { ctx, registrations } = fakeCtx();
  plugin.apply(ctx);
  const rendered = texts(registrations[0].component());
  assert.ok(rendered.includes('腾盛推荐'));
  assert.ok(!rendered.includes('全部'), 'tabs are hidden while collapsed');
});

test('a saved drag position renders as an inline offset', () => {
  const plugin = loadClient({ storage: { 'dsh.coal-news.position.v1': JSON.stringify({ left: 120, top: 80 }) } });
  const { ctx, registrations } = fakeCtx();
  plugin.apply(ctx);
  const tree = registrations[0].component();
  assert.equal(tree.props.style.left, 120);
  assert.equal(tree.props.style.top, 80);
  assert.equal(tree.props.style.bottom, 'auto');
});

test('without a saved position the panel keeps its default corner', () => {
  const plugin = loadClient();
  const { ctx, registrations } = fakeCtx();
  plugin.apply(ctx);
  const tree = registrations[0].component();
  assert.equal(tree.props.style, undefined);
  assert.match(tree.props.className, /dsh-coal-news/);
  assert.ok(!tree.props.className.includes('is-collapsed'));
});

test('a bottom-anchored position keeps the panel growing upward', () => {
  const plugin = loadClient({ storage: { 'dsh.coal-news.position.v1': JSON.stringify({ left: 640, bottom: 24 }) } });
  const { ctx, registrations } = fakeCtx();
  plugin.apply(ctx);
  const tree = registrations[0].component();
  assert.equal(tree.props.style.left, 640);
  assert.equal(tree.props.style.bottom, 24);
  assert.equal(tree.props.style.top, 'auto');
});

test('a right-anchored position follows the right edge when the window grows', () => {
  const plugin = loadClient({ storage: { 'dsh.coal-news.position.v1': JSON.stringify({ right: 24, bottom: 16 }) } });
  const { ctx, registrations } = fakeCtx();
  plugin.apply(ctx);
  const tree = registrations[0].component();
  assert.equal(tree.props.style.right, 24);
  assert.equal(tree.props.style.bottom, 16);
  assert.equal(tree.props.style.left, 'auto');
  assert.equal(tree.props.style.top, 'auto');
});

test('the header exposes a close control', () => {
  const plugin = loadClient();
  const { ctx, registrations } = fakeCtx();
  plugin.apply(ctx);
  const tree = registrations[0].component();
  const close = findByClass(tree, 'dcn-close');
  assert.ok(close !== undefined, 'close button rendered');
  assert.equal(close.props.type, 'button');
  assert.ok(String(close.props['aria-label'] ?? '').length > 0, 'close is labelled');
});

test('a closed session renders no panel and no restore affordance', () => {
  const plugin = loadClient({ session: { 'dsh.coal-news.closed.session.v1': '1' } });
  const { ctx, registrations } = fakeCtx();
  plugin.apply(ctx);
  assert.equal(registrations[0].component(), null);
});

test('a fresh session renders the panel again', () => {
  const plugin = loadClient({ session: {} });
  const { ctx, registrations } = fakeCtx();
  plugin.apply(ctx);
  const tree = registrations[0].component();
  assert.notEqual(tree, null);
  assert.ok(texts(tree).includes('腾盛推荐'));
});
