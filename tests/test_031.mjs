// dsh-sidebar-suite 0.3.0 — third-party tabs, rendered for real.
//
// test_030 talks to the service without a DOM: it proves the registry works
// before anything is painted. This file is the other half. It builds a sidebar
// that satisfies the host contract `resolveSidebar()` looks for, runs the real
// bundle against it, and then drives the painted UI the way a user would:
// click a tab, click it again, switch layouts, unregister.
//
// Why a hand-written DOM instead of jsdom: the bundle only touches a dozen DOM
// methods, and keeping the suite dependency-free means CI can run it with a
// bare `node`. The stub below therefore implements exactly the surface in use
// (see the selector list, which is every string the bundle queries for).
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { El, Doc, buildSidebar, matchSelector, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const client = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

function buildClient(options) {
  const settings = options || {}
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
    navigator: { language: settings.language || 'zh-CN', clipboard: { writeText: () => Promise.resolve() } },
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

  const ReactStub = { createElement: () => null, useState: (value) => [value, () => {}], useEffect() {}, Fragment: 'Fragment' }
  const mod = sandbox.__entry.factory(() => ReactStub)

  const published = {}
  const ctx = {
    locale: { getSnapshot: () => ({ active: settings.language || 'zh-CN' }), subscribe() { return () => {} }, register() { return () => {} } },
    // A real host runs the effect and keeps the disposer for unload — calling
    // the disposer here would tear the plugin down on startup.
    effect(fn) { return fn() },
    get() { return undefined },
    inject(deps, callback) {
      if (settings.injectNeverFires) return
      if (typeof callback === 'function') callback({ slots: { inject() {}, register() { return () => {} } }, configForms: undefined })
    },
    provide(name, value) { published[name] = value },
  }
  mod.apply(ctx)
  const ctxService = published.sidebarSuite
  const windowService = sandbox.window.__dshSidebarSuite
  const service = ctxService || windowService
  return { tree, service, ctxService, windowService, published, storage, observers, sandbox }
}

// Sync is scheduled on a microtask; a macrotask boundary settles it.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function tabIds(strip) {
  return strip.querySelectorAll('button').map((button) => button.getAttribute('data-dsbs-tabid'))
}

// ---------------------------------------------------------------- the tests
async function main() {
  // ==== 1. publish timing ==================================================
  {
    const never = buildClient({ injectNeverFires: true })
    // ctx.provide() must never be reached from apply()'s own body: that shape
    // stalls the plugin loader on "Loading plugins..." forever.
    check('inject callback never fires -> the ctx service stays unpublished',
      never.ctxService === undefined, 'ctxService=' + never.ctxService)
    check('the window handle is separate and still there for plain-script consumers',
      typeof never.windowService === 'object')
  }

  {
    const instance = buildClient()
    check('inject callback fires -> ctx.provide("sidebarSuite") ran',
      instance.ctxService === instance.service)
    check('the same object is reachable on window for plain-browser consumers',
      instance.windowService === instance.service)
  }

  // ==== 2. the strip ======================================================
  const app = buildClient()
  const service = app.service
  const { doc, root, nav, region } = app.tree

  await settle()
  const strip = root.querySelector('[data-dsbs-tabs]')
  check('with no consumers the strip exists but stays hidden', !!strip && strip.hasAttribute('hidden'))
  check('the control bar is still inserted as a direct child of the root',
    !!root.querySelector('[data-dsbs-bar]') && root.querySelector('[data-dsbs-bar]').parentNode === root)

  const demoMounts = []
  const notesMounts = []
  let demoCleanups = 0
  service.registerTab({
    id: 'demo',
    title: { zh: '演示页', en: 'Demo' },
    order: 10,
    badge: 'NEW',
    mount(container, tab) {
      demoMounts.push(tab.id)
      const node = doc.createElement('div')
      node.textContent = '演示页内容'
      container.appendChild(node)
      return () => { demoCleanups += 1 }
    },
  })
  service.registerTab({
    id: 'notes',
    title: { zh: '便签', en: 'Notes' },
    order: 20,
    mount(container) {
      notesMounts.push('notes')
      const node = doc.createElement('div')
      node.textContent = '便签内容'
      container.appendChild(node)
    },
  })
  await settle()

  const liveStrip = root.querySelector('[data-dsbs-tabs]')
  check('registering makes the strip visible', !liveStrip.hasAttribute('hidden'))
  check('the strip sits directly under the control bar',
    liveStrip.previousSibling === root.querySelector('[data-dsbs-bar]'))
  check('built-in groups and consumer tabs share one row, built-ins first',
    tabIds(liveStrip).join(',') === 'ext,ws,demo,notes', '[' + tabIds(liveStrip).join(' ') + ']')
  check('layout b marks a built-in as selected while the groups own the column',
    liveStrip.querySelector('[data-dsbs-tabid="ext"]').getAttribute('aria-selected') === 'true')
  check('title is resolved through the active language', /演示页/.test(liveStrip.querySelector('[data-dsbs-tabid="demo"]').textContent))
  check('badge is rendered next to the label',
    !!liveStrip.querySelector('[data-dsbs-tabid="demo"] [data-dsbs-tabbadge]'))
  check('the tab button carries role=tab and the strip role=tablist',
    liveStrip.getAttribute('role') === 'tablist' && liveStrip.querySelector('[data-dsbs-tabid="demo"]').getAttribute('role') === 'tab')
  check('nothing is mounted before the tab is opened', demoMounts.length === 0 && notesMounts.length === 0)

  // ==== 3. open a tab =====================================================
  liveStrip.querySelector('[data-dsbs-tabid="demo"]').click()
  await settle()
  const panel = root.querySelector('[data-dsbs-tabpanel="demo"]')
  check('clicking a tab activates it', service.getActiveTab() === 'demo')
  check('the container is inserted into the sidebar root and shown',
    !!panel && panel.parentNode === root && panel.getAttribute('data-dsbs-visible') === 'true')
  check('mount() runs on first activation only', demoMounts.length === 1, 'mounts=' + demoMounts.length)
  check('the container holds what the consumer painted', /演示页内容/.test(panel.textContent))
  check('both host groups step aside', nav.hasAttribute('inert') && region.hasAttribute('inert'))
  check('the html flag is set for CSS that cannot see the DOM tree',
    doc.documentElement.getAttribute('data-dsbs-ptab') === 'true')
  check('the active tab is marked selected',
    liveStrip.querySelector('[data-dsbs-tabid="demo"]').getAttribute('aria-selected') === 'true')
  check('the choice is persisted so a reload lands on the same page',
    app.storage.get('dsh-sidebar-suite:active-tab') === 'demo')

  // ==== 4. clicking the same tab goes back ================================
  root.querySelector('[data-dsbs-tabs]').querySelector('[data-dsbs-tabid="demo"]').click()
  await settle()
  check('clicking the active tab returns to the host groups', service.getActiveTab() === null)
  check('the panels group is interactive again (layout b keeps only the chosen group visible)',
    !nav.hasAttribute('inert'))
  check('the container is hidden, not destroyed',
    root.querySelector('[data-dsbs-tabpanel="demo"]').getAttribute('data-dsbs-visible') === 'false')
  check('remounting does not happen on a second visit',
    (service.activateTab('demo'), true) && demoMounts.length === 1)

  // ==== 5. layouts n and c keep the strip =================================
  const modeButton = (mode) => root.querySelector('[data-dsbs-btn="mode-' + mode + '"]')
  modeButton('n').click()
  await settle()
  check('official default keeps the strip visible',
    !root.querySelector('[data-dsbs-tabs]').hasAttribute('hidden'))
  check('official default drops the built-in entries (it is not a paging model)',
    tabIds(root.querySelector('[data-dsbs-tabs]')).join(',') === 'demo,notes',
    '[' + tabIds(root.querySelector('[data-dsbs-tabs]')).join(' ') + ']')
  check('official default still lets a tab own the column', service.getActiveTab() === 'demo' && nav.hasAttribute('inert'))

  modeButton('c').click()
  await settle()
  check('layout c keeps the strip visible',
    !root.querySelector('[data-dsbs-tabs]').hasAttribute('hidden'))
  check('layout c keeps the tab container mounted',
    root.querySelector('[data-dsbs-tabpanel="demo"]').getAttribute('data-dsbs-visible') === 'true')

  modeButton('b').click()
  await settle()
  check('back in layout b the built-ins return to the strip',
    tabIds(root.querySelector('[data-dsbs-tabs]')).join(',') === 'ext,ws,demo,notes')

  // ==== 6. a built-in click notifies subscribers too ======================
  // A consumer that keeps state (a timer, a canvas, a poll) relies on
  // `subscribe` to learn it left the screen. Losing the column to a built-in
  // page is the same event, so it has to produce the same notification.
  check('a demo tab owns the column before the built-ins are clicked',
    service.getActiveTab() === 'demo')
  const heard = []
  const stopListening = service.subscribe((tabs, reason, activeId) => {
    heard.push({ reason: reason, activeId: activeId })
  })
  root.querySelector('[data-dsbs-tabs]').querySelector('[data-dsbs-tabid="ext"]').click()
  await settle()
  check('clicking a built-in page gives the column back to the host groups',
    service.getActiveTab() === null)
  check('subscribers hear about it as a normal switch',
    heard.length === 1 && heard[0].reason === 'active' && heard[0].activeId === null,
    JSON.stringify(heard))
  heard.length = 0
  root.querySelector('[data-dsbs-tabs]').querySelector('[data-dsbs-tabid="ws"]').click()
  await settle()
  check('moving between two built-ins does not pretend a consumer tab moved',
    heard.length === 0, JSON.stringify(heard))
  // Put the layout back where this test found it: layout b keeps `nav` inert
  // whenever the workspaces group owns the column, and the later sections
  // assume the panels group is the visible one.
  root.querySelector('[data-dsbs-tabs]').querySelector('[data-dsbs-tabid="ext"]').click()
  await settle()
  stopListening()
  service.activateTab('demo')
  await settle()

  // ==== 7. a broken consumer cannot take the sidebar down =================
  service.registerTab({ id: 'broken', title: '坏掉', mount() { throw new Error('boom') } })
  await settle()
  const brokenButton = root.querySelector('[data-dsbs-tabs]').querySelector('[data-dsbs-tabid="broken"]')
  check('a tab that throws on mount still gets a button', !!brokenButton)
  brokenButton.click()
  await settle()
  const brokenPanel = root.querySelector('[data-dsbs-tabpanel="broken"]')
  check('the failure is reported inside its own container',
    !!brokenPanel && /boom/.test(brokenPanel.textContent))
  check('the rest of the sidebar survives', !!root.querySelector('[data-dsbs-bar]') && nav.hasAttribute('inert'))
  service.unregisterTab('broken')
  await settle()

  // ==== 8. unregister =====================================================
  service.unregisterTab('demo')
  await settle()
  check('unregistering removes the container', !root.querySelector('[data-dsbs-tabpanel="demo"]'))
  check('unregistering runs the consumer cleanup', demoCleanups === 1, 'cleanups=' + demoCleanups)
  check('the column falls back to the host groups', service.getActiveTab() === null)
  check('a stale tab id in storage cannot keep the column hostage',
    app.storage.get('dsh-sidebar-suite:active-tab') === undefined)
  check('the strip stays while one consumer is left', !root.querySelector('[data-dsbs-tabs]').hasAttribute('hidden'))

  service.unregisterTab('notes')
  await settle()
  check('the last unregister hides the strip again, so 0.2.x users see no change',
    root.querySelector('[data-dsbs-tabs]').hasAttribute('hidden'))
  check('the panels group is back to normal', !nav.hasAttribute('inert'))

  // ==== 9. paint() must be idempotent =====================================
  // paint() installs a MutationObserver on the sidebar root. If a single paint
  // inserted a node every time it ran, the observer would re-trigger it forever
  // and peg the renderer — exactly the failure mode that is invisible in tests
  // and instantly fatal in production. Drive the observer by hand and require
  // the tree to stop changing.
  {
    const loop = buildClient()
    await settle()
    loop.service.registerTab({
      id: 'idle',
      title: '静置',
      mount(container) { container.appendChild(loop.tree.doc.createElement('div')) },
    })
    await settle()
    loop.service.activateTab('idle')
    await settle()

    const observer = loop.observers.find((entry) => entry.targets.length)
    const rootChildren = loop.tree.root.children.length
    const stripButtons = loop.tree.root.querySelector('[data-dsbs-tabs]').querySelectorAll('button').length
    const panelChildren = loop.tree.root.querySelector('[data-dsbs-tabpanel="idle"]').children.length

    for (let i = 0; i < 60; i++) {
      if (observer) observer.callback([])
      await Promise.resolve()
      await Promise.resolve()
    }

    check('a paint that mutates the tree is what would spin the observer, so one is installed',
      !!observer)
    check('60 observer-driven repaints do not add a single root child',
      loop.tree.root.children.length === rootChildren,
      rootChildren + ' -> ' + loop.tree.root.children.length)
    check('the strip keeps exactly the same buttons after 60 repaints',
      loop.tree.root.querySelector('[data-dsbs-tabs]').querySelectorAll('button').length === stripButtons)
    check('the active container is not re-populated by repaint',
      loop.tree.root.querySelector('[data-dsbs-tabpanel="idle"]').children.length === panelChildren,
      panelChildren + ' -> ' + loop.tree.root.querySelector('[data-dsbs-tabpanel="idle"]').children.length)
    check('only one control bar survives repeated paints',
      loop.tree.root.querySelectorAll('[data-dsbs-bar]').length === 1)
  }

  // ==== 10. teardown ======================================================
  {
    const bye = buildClient()
    await settle()
    let cleaned = 0
    bye.service.registerTab({ id: 'x', title: 'X', mount() { return () => { cleaned += 1 } } })
    await settle()
    bye.service.activateTab('x')
    await settle()
    await bye.sandbox.__entry.factory(() => null) // no-op, keeps linters quiet
    // The owner teardown runs when a second apply takes over the sidebar.
    const second = buildClient()
    await settle()
    check('a second instance starts clean', second.service.getTabs().length === 0)
    check('the first instance still has its own registry', bye.service.getTabs().length === 1)
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('test_031 crashed:', error)
  process.exitCode = 1
})
