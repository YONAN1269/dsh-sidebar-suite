// dsh-sidebar-suite — host markup compatibility with DSH 0.2.2-rc.2.
//
// On 2026-11-12 the plugin was verified against a real DSH 0.2.2-rc.2 build
// over CDP: the service published, `[data-slot="sidebar.workspaces"]` was
// found, `resolveSidebar()` picked `nav.wtg9ga_panelList` inside
// `div.wtg9ga_scrollArea`, the control bar / tab strip / temp slot were all
// injected, third-party tab registration worked, the host config route
// answered 200, and the root child order stayed stable across samples.
//
// The markup contract did NOT change -- but the layout model did: rc.2 made
// div.scrollArea a CSS Grid with three columns AND four rows, pinning
// nav.panelList to row 2 and div.regionArea to row 4. 0.4.1 spanned the
// columns (fixing the 4px squeeze) but injected children were still
// auto-placed into an implicit row after both pinned panels. 0.4.2 moves the
// bar / tab strip into the flex div.scrollRegion above the grid; only a
// third-party tab page remains a grid item. See test_035 for the placement
// regression against the real two-level tree. This suite pins the class-name
// contract (semantic suffixes, never a generated hash) and the stylesheet.
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
  const css = doc.head.children
    .filter((el) => el.tagName === 'STYLE')
    .map((el) => el.textContent)
    .join('\n')
  return { tree, service, css }
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

  // ---- grid-based sidebar roots (rc.2) -----------------------------------
  // Only a third-party tab page is still a grid item: it must span all three
  // columns ("4px 264px 6px" on a real renderer) and give the two decorative
  // edge columns back as padding. The control bar and tab strip must NOT carry
  // a grid rule at all -- they live in div.scrollRegion, the flex parent.
  const gridRule = client.match(/\[data-dsbs-tabpanel\]\{grid-column:1\/-1;([^}]*)\}/)
  check('source: the tab page alone keeps a grid spanning rule', !!gridRule)
  check('source: the spanning rule uses grid-column:1/-1', !!gridRule)
  check('source: the spanning rule keeps the page inside the column',
    !!(gridRule && /min-width:\s*0/.test(gridRule[1]) && /max-width:\s*100%/.test(gridRule[1])))
  check('source: the spanning rule restores the host grid edge columns',
    !!(gridRule && /padding-left:\s*4px/.test(gridRule[1]) && /padding-right:\s*6px/.test(gridRule[1])))
  check('source: bar and strip are no longer grid items',
    !/\[data-dsbs-bar\],\[data-dsbs-tabs\],\[data-dsbs-tabpanel\]\{grid-column/.test(client))
  check('source: a flex header host is resolved above the grid',
    /\/scrollRegion\/\.test/.test(client) && /headerHost/.test(client))

  // ---- live: real rc.2 markup -------------------------------------------
  const rc2 = await variant('rc.2', {})
  check('rc.2: sidebarSuite service is published', !!(rc2 && rc2.service), rc2 && rc2.tags.join(','))
  const reportedVersion = (client.match(/var VERSION = '([^']+)'/) || [])[1]
  check('rc.2: service version matches the bundle VERSION',
    !!(rc2 && rc2.service && rc2.service.version === reportedVersion),
    rc2 && rc2.service && rc2.service.version)
  check('rc.2: control bar and tab strip are injected into the scroll root',
    !!(rc2 && rc2.tags.includes('bar') && rc2.tags.includes('tabs')), rc2 && rc2.tags.join(','))
  check('rc.2: bar and strip sit before the panels nav',
    !!(rc2 && rc2.tags.indexOf('bar') >= 0 && rc2.tags.indexOf('tabs') > rc2.tags.indexOf('bar')
      && rc2.tags.indexOf('nav') > rc2.tags.indexOf('tabs')), rc2 && rc2.tags.join(','))
  check('rc.2: host groups are preserved', !!(rc2 && rc2.tags.includes('nav') && rc2.tags.includes('region')),
    rc2 && rc2.tags.join(','))
  check('rc.2: the injected stylesheet carries the tab page grid rule',
    !!(rc2 && /\[data-dsbs-tabpanel\]\{grid-column:1\/-1/.test(rc2.css)))
  check('rc.2: the stylesheet no longer grids the control bar',
    !!(rc2 && !/\[data-dsbs-bar\],\[data-dsbs-tabs\],\[data-dsbs-tabpanel\]\{grid-column/.test(rc2.css)))

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
