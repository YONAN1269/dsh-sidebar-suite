// dsh-sidebar-suite 0.4.2 — the control bar must stay ABOVE the list, in
// every fold state, on DSH 0.2.2-rc.2's grid sidebar.
//
// Verified against the host's own SidebarRoot.tsx / SidebarRoot.module.css:
//   div.scrollRegion  flex column
//     > div.scrollArea  display:grid; grid-template-rows: 8px max-content 2px max-content
//         > nav.panelList  grid-row: 2
//         > div.regionArea grid-row: 4  (owns [data-slot="sidebar.workspaces"])
// A child injected into scrollArea with no explicit grid-row is auto-placed
// into a NEW implicit row after both pinned host panels -- the bar renders
// under the entire list. `order` cannot beat an explicit grid-row, which is
// why the first 0.4.2 attempt (order:-30 + firstChild) did nothing on a real
// renderer. The header now lives in scrollRegion, one level ABOVE the grid.
//
// This suite drives the real client bundle against a DOM stub that reproduces
// that exact tree. Run it once with the published 0.4.1 client.js to see the
// placement assertions fail.
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { buildSidebar, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const client = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

function buildClient(source = client) {
  // gridHost:true is essential: without the scrollRegion parent the test only
  // exercises the old flex root and cannot catch grid auto-placement.
  const tree = buildSidebar({ gridHost: true })
  const doc = tree.doc
  const storage = new Map()
  const observers = []

  class MutationObserverStub {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this) }
    observe(target) { this.targets.push(target) }
    disconnect() { this.targets = [] }
    takeRecords() { return [] }
  }
  class ResizeObserverStub {
    constructor(callback) { this.callback = callback }
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
  vm.runInContext(source, sandbox, { filename: 'client.js' })

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
  return { tree, service: published.sidebarSuite || sandbox.window.__dshSidebarSuite, observers }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function tagOf(el) {
  if (el.hasAttribute('data-dsbs-bar')) return 'bar'
  if (el.hasAttribute('data-dsbs-tabs')) return 'tabs'
  if (el.hasAttribute('data-dsbs-tabpanel')) return 'panel'
  if (el.className && /scrollArea/.test(el.className)) return 'grid'
  if (el.className && /scrollRegion/.test(el.className)) return 'host'
  if (el.tagName === 'NAV') return 'nav'
  return el.className && /foldGroup/.test(el.className) ? 'wrapper' : 'region'
}
function tags(root) { return root.children.map(tagOf).join(',') }
function before(a, b) {
  if (!a || !b || a.parentNode !== b.parentNode) return false
  const list = a.parentNode.children
  return list.indexOf(a) >= 0 && list.indexOf(b) >= 0 && list.indexOf(a) < list.indexOf(b)
}

async function main() {
  // ---- static: the fix must stay in the bundle ---------------------------
  check('source: resolves both scrollArea and its flex parent',
    /\/scrollArea\/\.test/.test(client) && /\/scrollRegion\/\.test/.test(client))
  check('source: exposes a dedicated headerHost outside the grid',
    /headerHost/.test(client) && /fx\.headerHost \|\| fx\.root/.test(client))
  check('source: bar is anchored on the scrolling viewport, not a nav',
    /fx\.scrollArea && fx\.scrollArea\.parentNode === host/.test(client))
  check('source: the old append-to-bottom bar fallback is gone',
    !/fx\.root\.appendChild\(bar\)/.test(client) && !/host\.appendChild\(bar\)/.test(client))
  check('source: only the tab page is still a grid item',
    /\[data-dsbs-tabpanel\]\{grid-column:1\/-1/.test(client)
    && !/\[data-dsbs-bar\],\[data-dsbs-tabs\],\[data-dsbs-tabpanel\]\{grid-column/.test(client))
  check('source: documents why order cannot beat a pinned grid-row',
    /grid-row/.test(client) && /`order` cannot/.test(client))

  const loop = buildClient()
  await settle()
  const { root, scrollRegion, nav, region, doc } = loop.tree
  const bar = doc.querySelector('[data-dsbs-bar]')

  check('tree: stub really has a flex host above the grid',
    !!scrollRegion && root.parentNode === scrollRegion && !!root.className.match(/scrollArea/))
  check('expanded: a control bar exists', !!bar)
  // THE regression: a bar inside scrollArea is a grid item and lands in an
  // implicit row after the host panels. It must NOT be a grid item at all.
  check('expanded: bar is NOT a child of the CSS-grid scrollArea',
    !!bar && bar.parentNode !== root, bar && bar.parentNode && bar.parentNode.className)
  check('expanded: bar lives in the flex header host',
    !!bar && bar.parentNode === scrollRegion)
  check('expanded: bar sits above the scrolling viewport',
    !!bar && before(bar, root), tags(scrollRegion))

  // A consumer page stays in the grid, but the bar and tab strip stay out.
  loop.service.registerTab({
    id: 'fold-probe',
    title: '折叠探针',
    mount(container) { container.appendChild(doc.createElement('div')) },
  })
  await settle()
  loop.service.activateTab('fold-probe')
  await settle()
  const strip = doc.querySelector('[data-dsbs-tabs]')
  const panel = doc.querySelector('[data-dsbs-tabpanel]')
  check('expanded: tab strip also lives outside the grid',
    !!strip && strip.parentNode === scrollRegion && strip.parentNode !== root)
  check('expanded: header order is bar, tabs, then the grid viewport',
    /^bar,tabs,grid/.test(tags(scrollRegion)), tags(scrollRegion))
  check('expanded: a consumer page stays inside the grid viewport',
    !!panel && panel.parentNode === root, tags(root))

  // ---- the exact DOM change a fold triggers on rc.2 ----------------------
  // The host wraps both panels in a group container one level deeper. The old
  // resolver took whichever layer happened to hold the nav as `root`.
  const wrapper = doc.createElement('div')
  wrapper.className = 'wtg9ga_foldGroup'
  root.appendChild(wrapper)
  wrapper.appendChild(nav)
  wrapper.appendChild(region)

  const observer = loop.observers.find((entry) => entry.targets.length)
  if (observer) observer.callback([])
  await settle()
  await settle()

  check('folded: nav really is one level deeper now', nav.parentNode === wrapper)
  check('folded: bar stayed in the flex header host',
    bar.parentNode === scrollRegion, tags(scrollRegion))
  check('folded: bar is still above the grid viewport',
    before(bar, root), tags(scrollRegion))
  check('folded: only one control bar survives',
    doc.querySelectorAll('[data-dsbs-bar]').length === 1)
  check('folded: header order is unchanged',
    /^bar,tabs,grid/.test(tags(scrollRegion)), tags(scrollRegion))
  check('folded: host wrapper stays inside the grid, below the header',
    wrapper.parentNode === root, tags(root))

  // ---- the host may also drop the nav entirely while collapsed -----------
  wrapper.removeChild(nav)
  if (observer) observer.callback([])
  await settle()
  await settle()
  check('nav removed: bar still in the flex host, above the grid',
    bar.parentNode === scrollRegion && before(bar, root), tags(scrollRegion))

  // ---- no observer/paint feedback loop from the re-parenting -------------
  const beforeCount = scrollRegion.children.length
  for (let i = 0; i < 20; i++) {
    if (observer) observer.callback([])
    await Promise.resolve()
    await Promise.resolve()
  }
  await settle()
  check('20 repaints do not change the header host child count',
    scrollRegion.children.length === beforeCount,
    beforeCount + ' -> ' + scrollRegion.children.length)
  check('20 repaints leave the header in the same order',
    /^bar,tabs,grid/.test(tags(scrollRegion)), tags(scrollRegion))

  console.log('')
  console.log(pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => { console.error('test_035 error:', error); process.exitCode = 1 })
