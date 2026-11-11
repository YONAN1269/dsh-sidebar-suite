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

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const client = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

// ---------------------------------------------------------------- selectors
// Supports exactly what the bundle asks for: tag, [attr], [attr="v"],
// [attr*="v"], [attr^="v"], descendant combinator and comma lists.
function splitTop(selector, separator) {
  const out = []
  let depth = 0
  let quote = ''
  let current = ''
  for (const ch of selector) {
    if (quote) {
      current += ch
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue }
    if (ch === '[') depth += 1
    if (ch === ']') depth -= 1
    if (ch === separator && depth === 0) { out.push(current); current = ''; continue }
    current += ch
  }
  out.push(current)
  return out.map((part) => part.trim()).filter(Boolean)
}

function parseCompound(compound) {
  const match = /^([a-zA-Z][\w-]*|\*)?/.exec(compound)
  const tag = match && match[1] && match[1] !== '*' ? match[1].toUpperCase() : null
  const attrs = []
  const rest = compound.slice(match ? match[0].length : 0)
  const re = /\[([^\]=^$*]+)(?:([\]=^$*]+)"([^"]*)")?\]/g
  let found
  while ((found = re.exec(rest))) {
    attrs.push({ name: found[1].trim(), op: found[2] || null, value: found[3] })
  }
  return { tag, attrs }
}

function matchCompound(el, compound) {
  const { tag, attrs } = parseCompound(compound)
  if (tag && el.tagName !== tag) return false
  for (const attr of attrs) {
    const value = el.getAttribute(attr.name)
    if (value == null) return false
    if (attr.op == null) continue
    const wanted = attr.value
    if (attr.op === '=') { if (value !== wanted) return false }
    else if (attr.op === '*=') { if (value.indexOf(wanted) < 0) return false }
    else if (attr.op === '^=') { if (value.indexOf(wanted) !== 0) return false }
    else if (attr.op === '$=') { if (!value.endsWith(wanted)) return false }
  }
  return true
}

function matchSelector(el, selector) {
  for (const group of splitTop(selector, ',')) {
    const parts = splitTop(group, ' ')
    if (!matchCompound(el, parts[parts.length - 1])) continue
    let index = parts.length - 2
    let node = el.parentNode
    while (index >= 0) {
      if (!node || node.tagName === '#DOCUMENT') break
      if (matchCompound(node, parts[index])) index -= 1
      node = node.parentNode
    }
    if (index < 0) return true
  }
  return false
}

// ---------------------------------------------------------------- fake DOM
function makeStyle() {
  return {
    cssText: '',
    setProperty(name, value) { this[name] = value },
    getPropertyValue(name) { return this[name] || '' },
    removeProperty(name) { delete this[name] },
  }
}

class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase()
    this.ownerDocument = doc || null
    this.children = []
    this.parentNode = null
    this.attributes = {}
    this.style = makeStyle()
    this.className = ''
    this.id = ''
    this.listeners = {}
    this._text = ''
    this._html = ''
    this.offsetHeight = 0
    this.offsetWidth = 0
  }

  get parentElement() { return this.parentNode && this.parentNode.tagName === '#DOCUMENT' ? null : this.parentNode }
  get firstChild() { return this.children[0] || null }
  get lastChild() { return this.children[this.children.length - 1] || null }
  get nextSibling() {
    if (!this.parentNode) return null
    const list = this.parentNode.children
    const i = list.indexOf(this)
    return i >= 0 && i + 1 < list.length ? list[i + 1] : null
  }
  get previousSibling() {
    if (!this.parentNode) return null
    const list = this.parentNode.children
    const i = list.indexOf(this)
    return i > 0 ? list[i - 1] : null
  }

  get textContent() {
    if (this.children.length) return this.children.map((child) => child.textContent).join('')
    return this._text
  }
  set textContent(value) {
    this._text = String(value == null ? '' : value)
    for (const child of this.children) child.parentNode = null
    this.children = []
  }

  get innerHTML() { return this._html }
  set innerHTML(value) {
    this._html = String(value == null ? '' : value)
    if (this._html === '') {
      for (const child of this.children) child.parentNode = null
      this.children = []
    }
  }

  appendChild(child) {
    if (!child) return child
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.children.push(child)
    this._notify(child)
    return child
  }

  insertBefore(child, reference) {
    if (!child) return child
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    if (!reference) { this.children.push(child); this._notify(child); return child }
    const index = this.children.indexOf(reference)
    if (index < 0) this.children.push(child)
    else this.children.splice(index, 0, child)
    this._notify(child)
    return child
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) {
      this.children.splice(index, 1)
      child.parentNode = null
      this._notify(child)
    }
    return child
  }

  remove() { if (this.parentNode) this.parentNode.removeChild(this) }

  _notify(child) {
    if (this.ownerDocument && this.ownerDocument.__onMutation) this.ownerDocument.__onMutation(this, child)
  }

  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) {
    if (name === 'class') return this.className || null
    if (name === 'id') return this.id || null
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null
  }
  removeAttribute(name) { delete this.attributes[name] }
  hasAttribute(name) { return this.getAttribute(name) != null }

  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(handler)
  }
  removeEventListener(type, handler) {
    const list = this.listeners[type]
    if (!list) return
    const index = list.indexOf(handler)
    if (index >= 0) list.splice(index, 1)
  }
  dispatchEvent(event) {
    event.target = event.target || this
    event.currentTarget = this
    if (typeof event.preventDefault !== 'function') event.preventDefault = () => {}
    if (typeof event.stopPropagation !== 'function') event.stopPropagation = () => {}
    const list = (this.listeners[event.type] || []).slice()
    for (const handler of list) handler.call(this, event)
    return true
  }
  click() { this.dispatchEvent({ type: 'click', bubbles: true }) }
  focus() {}

  contains(node) {
    let current = node
    while (current) {
      if (current === this) return true
      current = current.parentNode
    }
    return false
  }

  closest(selector) {
    let node = this
    while (node && node.tagName !== '#DOCUMENT') {
      if (matchSelector(node, selector)) return node
      node = node.parentNode
    }
    return null
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 292, bottom: 600, width: 292, height: 600, x: 0, y: 0 }
  }

  querySelectorAll(selector) {
    const out = []
    const walk = (node) => {
      for (const child of node.children) {
        if (matchSelector(child, selector)) out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
}

class Doc {
  constructor() {
    this.tagName = '#DOCUMENT'
    this.children = []
    this.parentNode = null
    this.listeners = {}
    this.documentElement = this._make('html')
    this.head = this._make('head')
    this.body = this._make('body')
    this.documentElement.appendChild(this.head)
    this.documentElement.appendChild(this.body)
    this.__onMutation = null
  }
  _make(tag) {
    const el = new El(tag, this)
    el.parentNode = this
    this.children.push(el)
    return el
  }
  createElement(tag) { return new El(tag, this) }
  appendChild(el) { el.parentNode = this; this.children.push(el); return el }
  removeChild(el) {
    const index = this.children.indexOf(el)
    if (index >= 0) this.children.splice(index, 1)
    el.parentNode = null
    return el
  }
  getElementById(id) {
    return this.documentElement.querySelector('[id="' + id + '"]')
  }
  querySelector(selector) { return this.documentElement.querySelector(selector) }
  querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector) }
  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(handler)
  }
  removeEventListener(type, handler) {
    const list = this.listeners[type]
    if (!list) return
    const index = list.indexOf(handler)
    if (index >= 0) list.splice(index, 1)
  }
  dispatchEvent(event) {
    for (const handler of (this.listeners[event.type] || []).slice()) handler(event)
    return true
  }
  getComputedStyle() { return { display: 'block', position: 'static' } }
}

// A DSH sidebar reduced to its contract: a root whose children are the panels
// `nav.panelList` and a region wrapper holding the workspaces slot.
function buildSidebar() {
  const doc = new Doc()
  const root = doc.createElement('div')
  root.setAttribute('data-dsbs-test-root', '')
  const nav = doc.createElement('nav')
  nav.className = 'panelList'
  nav.appendChild(doc.createElement('div'))
  const region = doc.createElement('div')
  const workspaces = doc.createElement('div')
  workspaces.setAttribute('data-slot', 'sidebar.workspaces')
  region.appendChild(workspaces)
  root.appendChild(nav)
  root.appendChild(region)
  doc.body.appendChild(root)
  return { doc, root, nav, region, workspaces }
}

// ---------------------------------------------------------------- instance
// The bundle keeps intervals alive for as long as it runs. Unref every timer
// the sandbox hands out, so a finished test lets the process exit on its own
// instead of lingering until the parent kills it.
const unrefTimer = (timer) => {
  if (timer && typeof timer.unref === 'function') timer.unref()
  return timer
}
const sbTimeout = (fn, ms, ...rest) => unrefTimer(setTimeout(fn, ms, ...rest))
const sbInterval = (fn, ms, ...rest) => unrefTimer(setInterval(fn, ms, ...rest))

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

  // ==== 5. layouts a and c keep the strip =================================
  const modeButton = (mode) => root.querySelector('[data-dsbs-btn="mode-' + mode + '"]')
  modeButton('a').click()
  await settle()
  check('layout a keeps the strip visible',
    !root.querySelector('[data-dsbs-tabs]').hasAttribute('hidden'))
  check('layout a drops the built-in entries (folding, not paging, is its job)',
    tabIds(root.querySelector('[data-dsbs-tabs]')).join(',') === 'demo,notes',
    '[' + tabIds(root.querySelector('[data-dsbs-tabs]')).join(' ') + ']')
  check('layout a still lets a tab own the column', service.getActiveTab() === 'demo' && nav.hasAttribute('inert'))

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

  // ==== 6. a broken consumer cannot take the sidebar down =================
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

  // ==== 7. unregister =====================================================
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

  // ==== 8. paint() must be idempotent =====================================
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

  // ==== 9. teardown =======================================================
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
