// dsh-sidebar-suite 0.4.2 — the control bar must not jump down the column
// when the user folds the extensions / workspaces group.
//
// On DSH 0.2.2-rc.2, folding re-parents the host panels: `nav.panelList` and
// the workspaces region end up inside a wrapper one level deeper. The old
// resolveSidebar() took whichever layer happened to hold the nav as `root`, so
// ensureBar() moved the injected bar into that deeper container -- visually
// below the list. This suite reproduces that exact DOM change against the real
// client bundle and pins the header to the outer scroll area.
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

function buildClient() {
  const tree = buildSidebar()
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
  return { tree, service: published.sidebarSuite || sandbox.window.__dshSidebarSuite, observers }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function tagOf(el) {
  if (el.hasAttribute('data-dsbs-bar')) return 'bar'
  if (el.hasAttribute('data-dsbs-tabs')) return 'tabs'
  if (el.hasAttribute('data-dsbs-tabpanel')) return 'panel'
  if (el.tagName === 'NAV') return 'nav'
  return el.className && /foldGroup/.test(el.className) ? 'wrapper' : 'region'
}
function tags(root) { return root.children.map(tagOf).join(',') }

async function main() {
  // ---- static: the fix must stay in the bundle ---------------------------
  check('source: resolves a stable scrollArea root', /\/scrollArea\/\.test/.test(client) && /scrollRoot !== root/.test(client))
  check('source: the bar is pinned as the first root child', /fx\.root\.firstChild !== bar/.test(client))
  check('source: the old append-to-bottom fallback is gone', !/fx\.root\.appendChild\(bar\)/.test(client))
  check('source: injected boxes have negative grid/flex order',
    /\[data-dsbs-bar\]\{order:-30\}/.test(client)
    && /\[data-dsbs-tabs\]\{order:-20\}/.test(client)
    && /\[data-dsbs-tabpanel\]\{order:-10\}/.test(client))
  check('source: a tab panel falls back to just under the header',
    /runtime\.tabStrip\.nextSibling/.test(client))

  const loop = buildClient()
  await settle()
  const { root, nav, region, doc } = loop.tree
  const bar = root.querySelector('[data-dsbs-bar]')

  check('expanded: a control bar exists', !!bar)
  check('expanded: bar is the first child of the scroll root',
    !!bar && root.firstChild === bar, tags(root))
  check('expanded: bar parent is the scroll root', !!bar && bar.parentNode === root)
  const expandedIndex = bar ? root.children.indexOf(bar) : -1

  // A consumer page must stay between the header and the host panels.
  loop.service.registerTab({
    id: 'fold-probe',
    title: '折叠探针',
    mount(container) { container.appendChild(doc.createElement('div')) },
  })
  await settle()
  loop.service.activateTab('fold-probe')
  await settle()
  check('expanded: tab strip and page follow the bar, before the host panels',
    /^bar,tabs,panel/.test(tags(root)), tags(root))

  // ---- the exact DOM change a fold triggers on rc.2 ----------------------
  // The host wraps both panels in a group container one level deeper. With the
  // old resolver, `root` became that wrapper and the bar was moved into it.
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
  check('folded: bar stayed in the outer scroll root', bar.parentNode === root, tags(root))
  check('folded: bar is still the first child', root.firstChild === bar, tags(root))
  check('folded: bar index did not move', root.children.indexOf(bar) === expandedIndex,
    expandedIndex + ' -> ' + root.children.indexOf(bar))
  check('folded: only one control bar survives', root.querySelectorAll('[data-dsbs-bar]').length === 1)
  check('folded: tab strip and page still follow the bar',
    /^bar,tabs,panel/.test(tags(root)), tags(root))
  check('folded: the host wrapper stays after the injected header',
    root.children.indexOf(wrapper) > root.children.indexOf(bar), tags(root))

  // ---- the host may also drop the nav entirely while collapsed -----------
  wrapper.removeChild(nav)
  if (observer) observer.callback([])
  await settle()
  await settle()
  check('nav removed: bar still pinned to the scroll root first slot',
    bar.parentNode === root && root.firstChild === bar, tags(root))

  // ---- no observer/paint feedback loop from the re-parenting -------------
  const before = root.children.length
  for (let i = 0; i < 20; i++) {
    if (observer) observer.callback([])
    await Promise.resolve()
    await Promise.resolve()
  }
  await settle()
  check('20 repaints do not change the root child count', root.children.length === before,
    before + ' -> ' + root.children.length)
  check('20 repaints leave the bar in slot 0', root.firstChild === bar, tags(root))

  console.log('')
  console.log(pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => { console.error('test_035 error:', error); process.exitCode = 1 })
