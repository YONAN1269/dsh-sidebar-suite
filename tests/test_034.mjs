// dsh-sidebar-suite — host markup compatibility with DSH 0.2.2-rc.2.
//
// On 2026-11-12 the plugin was verified against a real DSH 0.2.2-rc.2 build
// over CDP: the service published, `[data-slot="sidebar.workspaces"]` was
// found, `resolveSidebar()` picked `nav.wtg9ga_panelList` inside
// `div.wtg9ga_scrollArea`, the control bar / tab strip / temp slot were all
// injected, third-party tab registration worked, the host config route
// answered 200, and the root child order stayed stable across samples.
//
// No runtime change was needed. This suite pins that contract so a future DSH
// rebuild (which changes the CSS-module hash prefix) cannot silently break the
// sidebar: it proves the client keys off semantic suffixes and the workspaces
// slot, never off a full generated class name.
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { buildSidebar, matchSelector, sbTimeout, sbInterval } from './dom-stub.mjs'

void matchSelector

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const client = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// The real rc.2 values, kept here as the reference sample.
const RC2 = {
  root: 'wtg9ga_scrollArea',
  nav: 'wtg9ga_panelList',
  region: 'wtg9ga_regionArea',
}

function buildClient(overrides) {
  const o = overrides || {}
  const tree = buildSidebar()
  if (o.rootClass !== undefined) tree.root.className = o.rootClass
  if (o.navClass !== undefined) tree.nav.className = o.navClass
  if (o.regionClass !== undefined) tree.region.className = o.regionClass
  if (o.noWorkspaces) tree.workspaces.remove()
  const doc = tree.doc
  const storage = new Map()
  // Deliberately inert: this suite checks host recognition, not the observer
  // feedback loop (that is test_033's job). A live callback here would also
  // let a repaint reschedule itself during these variants.
  doc.__onMutation = () => {}

  class MutationObserverStub {
    constructor(cb) { this.callback = cb; this.targets = [] }
    observe(target) { this.targets.push(target) }
    disconnect() { this.targets = [] }
    takeRecords() { return [] }
  }
  class ResizeObserverStub {
    constructor(cb) { this.callback = cb }
    observe() {}
    disconnect() {}
  }

  const sandbox = {
    window: {
      __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
      getComputedStyle: () => ({ position: 'static', display: 'block' }),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
      open() { return null },
    },
    document: doc,
    navigator: { language: 'zh-CN', clipboard: { writeText: () => Promise.resolve() } },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    fetch: async () => new Response('{}', { status: 404 }),
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: MutationObserverStub,
    ResizeObserver: ResizeObserverStub,
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
    requestAnimationFrame: (cb) => sbTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console,
  }
  sandbox.window.document = doc
  sandbox.window.localStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(client, sandbox, { filename: 'client.js' })

  const ReactStub = { createElement: () => null, useState: (v) => [v, () => {}], useEffect() {}, Fragment: 'Fragment' }
  const mod = sandbox.__entry.factory(() => ReactStub)
  const published = {}
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe() { return () => {} }, register() { return () => {} } },
    effect(fn) { return fn() },
    get() { return undefined },
    inject(deps, callback) {
      if (typeof callback === 'function') callback({ slots: { inject() {}, register() { return () => {} } }, configForms: undefined })
    },
    provide(name, value) { published[name] = value },
  }
  mod.apply(ctx)
  const service = published.sidebarSuite || sandbox.window.__dshSidebarSuite
  return { tree, service }
}

function tags(root) {
  return root.children.map((child) => {
    if (child.hasAttribute('data-dsbs-bar')) return 'bar'
    if (child.hasAttribute('data-dsbs-tabs')) return 'tabs'
    if (child.hasAttribute('data-dsbs-tabpanel')) return 'panel'
    if (child.tagName === 'NAV') return 'nav'
    return 'region'
  })
}

async function variant(label, overrides) {
  let loop
  try { loop = buildClient(overrides) }
  catch (error) { check(label + ': client boots without throwing', false, error.message); return null }
  await settle()
  return { label, ...loop, tags: tags(loop.tree.root) }
}

async function main() {
  // ---- static: never pin a generated DSH class name ----------------------
  check('source: does not hardcode DSH 0.2.2 CSS-module hash "wtg9ga_"', !client.includes('wtg9ga_'))
  check('source: does not hardcode any other opaque CSS-module class', !/\b[a-z]{5,7}_(scrollArea|regionArea|panelList)\b/.test(client))
  check('source: matches the semantic "panelList" suffix', /\/panelList\//.test(client))
  check('source: resolves the sidebar from the workspaces slot',
    client.includes('[data-slot="sidebar.workspaces"]'))
  check('source: keeps the region-parent fallback when no nav matches',
    /regionArea\.parentElement/.test(client))

  // ---- live: real rc.2 markup -------------------------------------------
  const rc2 = await variant('rc.2', {})
  check('rc.2: sidebarSuite service is published', !!(rc2 && rc2.service), rc2 && rc2.tags.join(','))
  check('rc.2: service version is 0.4.0', !!(rc2 && rc2.service && rc2.service.version === '0.4.0'))
  check('rc.2: control bar and tab strip are injected into the scroll root',
    !!(rc2 && rc2.tags.includes('bar') && rc2.tags.includes('tabs')), rc2 && rc2.tags.join(','))
  check('rc.2: bar and strip sit before the panels nav',
    !!(rc2 && rc2.tags.indexOf('bar') >= 0 && rc2.tags.indexOf('tabs') > rc2.tags.indexOf('bar')
      && rc2.tags.indexOf('nav') > rc2.tags.indexOf('tabs')), rc2 && rc2.tags.join(','))
  check('rc.2: host groups are preserved', !!(rc2 && rc2.tags.includes('nav') && rc2.tags.includes('region')),
    rc2 && rc2.tags.join(','))

  // ---- live: a different CSS-module hash prefix --------------------------
  const rehash = await variant('rehashed', {
    rootClass: 'zz99x_scrollArea', navClass: 'zz99x_panelList', regionClass: 'zz99x_regionArea',
  })
  check('rehashed: a new CSS-module prefix still resolves the sidebar',
    !!(rehash && rehash.tags.includes('bar') && rehash.tags.includes('tabs')), rehash && rehash.tags.join(','))

  // ---- live: pure generated names (known graceful degradation) -----------
  const opaque = await variant('opaque', {
    rootClass: 'zz99x_d4e5f6', navClass: 'zz99x_a1b2c3', regionClass: 'zz99x_g7h8i9',
  })
  check('opaque: no semantic class names do not crash the client', !!opaque)
  check('opaque: control bar still appears (region-parent fallback)',
    !!(opaque && opaque.tags.includes('bar')), opaque && opaque.tags.join(','))

  // ---- live: no workspaces slot means "not our sidebar" ------------------
  const absent = await variant('no-slot', { noWorkspaces: true })
  check('no-slot: client boots without throwing', !!absent)
  check('no-slot: nothing is injected into an unrelated page',
    !!(absent && !absent.tags.includes('bar') && !absent.tags.includes('tabs')), absent && absent.tags.join(','))

  console.log('')
  console.log(pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => { console.error('test_034 error:', error); process.exitCode = 1 })
