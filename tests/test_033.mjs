// dsh-sidebar-suite — observer feedback loop regression.
//
// test_031 drives the MutationObserver callback by hand, a fixed 60 times, so
// it can only prove "repaints do not add nodes". It cannot prove that a repaint
// leaves the observed root ALONE: a repaint that merely moves an existing node
// still fires the observer, and in a real browser that starts a microtask
// chain (paint -> mutation -> scheduleSync -> paint) that never returns to the
// event loop. That is exactly what hung DSH on "Loading plugins..." with a
// renderer pinned at 100%: ensureBar() demanded that the bar sit immediately
// before the panels nav, but the 0.3.0 tab strip sits between them, so every
// paint moved the bar and the strip moved it back.
//
// This suite makes the DOM stub deliver observer callbacks the way a browser
// does, then checks that one ordinary host mutation settles instead of
// spinning. A hard cap stops the test itself from hanging on a regression.
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { El, Doc, buildSidebar, matchSelector, sbTimeout, sbInterval } from './dom-stub.mjs'

void El; void Doc; void matchSelector

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const client = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function buildClient() {
  const tree = buildSidebar()
  const doc = tree.doc
  const storage = new Map()
  const observers = []
  const feedback = { mutations: 0, tripped: false, live: false }

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

  // A real MutationObserver delivers one callback per microtask checkpoint
  // after any childList change on the observed node. Delivering it straight
  // from the mutation is a stricter test (it also rules out synchronous
  // recursion) and keeps the two realms' microtask queues out of the picture.
  doc.__onMutation = (target) => {
    if (!feedback.live || target !== tree.root) return
    feedback.mutations += 1
    if (feedback.mutations > 200) { feedback.tripped = true; return }
    for (const observer of observers) {
      if (observer.targets.indexOf(target) >= 0) observer.callback([], observer)
    }
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

  const ReactStub = { createElement: () => null, useState: (value) => [value, () => {}], useEffect() {}, Fragment: 'Fragment' }
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
  return { tree, service, observers, feedback, sandbox }
}

function order(root) {
  return root.children.map((child) => {
    if (child.hasAttribute('data-dsbs-bar')) return 'bar'
    if (child.hasAttribute('data-dsbs-tabs')) return 'strip'
    if (child.hasAttribute('data-dsbs-tabpanel')) return 'panel'
    if (child.tagName === 'NAV') return 'nav'
    return 'region'
  }).join(',')
}

function arm(loop) {
  loop.feedback.mutations = 0
  loop.feedback.tripped = false
  loop.feedback.live = true
}

function disarm(loop) {
  loop.feedback.live = false
}

async function exercise(loop, label) {
  arm(loop)
  const observer = loop.observers.find((entry) => entry.targets.length)
  const before = order(loop.tree.root)
  if (observer) observer.callback([])
  await settle()
  const mutations = loop.feedback.mutations
  const tripped = loop.feedback.tripped
  const after = order(loop.tree.root)
  disarm(loop)

  check(label + ': one host mutation does not start a feedback loop', !tripped && mutations === 0,
    tripped ? 'hit the 200-mutation cap (renderer would hang)' : mutations + ' unexpected root mutations')
  check(label + ': root child order is unchanged', before === after, before + ' -> ' + after)
}

async function main() {
  // ==== 1. the plain sidebar, no third-party tab ==========================
  {
    const loop = buildClient()
    await settle()
    const observer = loop.observers.find((entry) => entry.targets.length)
    check('the sidebar installs a MutationObserver on its root', !!observer)
    check('the control bar, strip and host groups all coexist',
      order(loop.tree.root).indexOf('bar') >= 0 && order(loop.tree.root).indexOf('strip') >= 0
      && order(loop.tree.root).indexOf('nav') >= 0, order(loop.tree.root))
    await exercise(loop, 'plain sidebar')
    loop.sandbox.window.__dshSidebarSuite && disarm(loop)
  }

  // ==== 2. a registered tab owns the column ===============================
  {
    const loop = buildClient()
    await settle()
    const dispose = loop.service.registerTab({
      id: 'loop-check',
      title: 'Loop check',
      mount(container) { container.appendChild(loop.tree.doc.createElement('div')) },
    })
    loop.service.activateTab('loop-check')
    await settle()
    check('the active tab panel joins the root', order(loop.tree.root).indexOf('panel') >= 0, order(loop.tree.root))
    await exercise(loop, 'active plugin tab')
    dispose()
  }

  // ==== 3. all three layouts ===============================================
  {
    const loop = buildClient()
    await settle()
    for (const mode of ['b', 'c', 'n']) {
      const button = loop.tree.root.querySelector('[data-dsbs-btn="mode-' + mode + '"]')
      if (button) button.click()
      await settle()
      await exercise(loop, 'layout ' + mode)
    }
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
