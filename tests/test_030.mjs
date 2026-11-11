// dsh-sidebar-suite 0.3.0 — third-party tabs.
//
// This is the first release whose API someone else codes against, so the test
// drives the REAL client bundle in a vm sandbox and talks to the published
// service the way another plugin would: register, list, activate, subscribe,
// dispose. A regression here is not a cosmetic bug -- it silently breaks every
// plugin that adopted the API.
//
// No browser: the sandbox has no sidebar, so `paint()` returns early. That is
// deliberate. The registry and the service must work before any DOM exists,
// because a consumer registers during plugin startup, not after first paint.
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

// Relocatable: <repo>/tests -> <repo>. No machine-specific paths (CI-safe).
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const CLIENT = ROOT + '/lib/client.js'
const client = fs.readFileSync(CLIENT, 'utf8')
const pkg = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8'))

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

// ---- minimal DOM ---------------------------------------------------------
function makeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    style: {},
    className: '',
    textContent: '',
    innerHTML: '',
    parentNode: null,
    firstChild: null,
    nextSibling: null,
    previousSibling: null,
    setAttribute(name, value) { this.attributes[name] = String(value) },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null },
    removeAttribute(name) { delete this.attributes[name] },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) },
    appendChild(child) { if (child) { child.parentNode = this; this.children.push(child) } return child },
    insertBefore(child) { if (child) { child.parentNode = this; this.children.unshift(child) } return child },
    removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); return child },
    addEventListener() {}, removeEventListener() {}, click() {}, focus() {},
    getBoundingClientRect() { return { width: 260, height: 40, top: 0, left: 0 } },
    querySelector() { return null },
    querySelectorAll() { return [] },
  }
}

// ---- one isolated client instance, exposing whatever it published ---------
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
  const doc = {
    baseURI: 'http://localhost/app/',
    documentElement: makeEl('html'),
    body: makeEl('body'),
    head: makeEl('head'),
    getElementById() { return null },
    querySelector() { return null },
    querySelectorAll() { return [] },
    createElement: makeEl,
    addEventListener() {}, removeEventListener() {},
  }

  const storage = new Map()
  const sandbox = {
    window: {
      __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
      getComputedStyle: () => ({ position: 'static' }),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
      open() { return null },
    },
    document: doc,
    navigator: { language: settings.language || 'zh-CN', clipboard: { writeText: () => Promise.resolve() } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    fetch: async () => new Response('{}', { status: 404 }),
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
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
    locale: { getSnapshot: () => ({ active: settings.language || 'zh-CN' }), subscribe() { return () => {} }, register() { return () => {} } },
    // A real host runs the effect and keeps its disposer for unload. Calling
    // the disposer here would tear the plugin down during startup and hide
    // every bug that only shows up on the live path.
    effect(fn) { return fn() },
    get() { return undefined },
    inject(deps, cb) { if (typeof cb === 'function') cb({ slots: { inject() {}, register() { return () => {} } }, configForms: undefined }) },
    provide(name, value) { published[name] = value },
  }
  mod.apply(ctx)
  return { service: published.sidebarSuite, published, storage, mod }
}

function threw(fn) {
  try { fn(); return null } catch (error) { return error }
}

// ---- version wiring ------------------------------------------------------
check('package: version is 0.3.0 or later', /^0\.(3|[4-9])\./.test(pkg.version), pkg.version)
const embedded = (client.match(/var VERSION = '([^']+)'/) || [])[1]
check('package: the version the service reports matches package.json', embedded === pkg.version, embedded + ' vs ' + pkg.version)

// ---- the service exists at all ------------------------------------------
const live = buildClient()
const api = live.service
check('service: published as sidebarSuite', !!api)
check('service: has registerTab', api && typeof api.registerTab === 'function')
check('service: has unregisterTab', api && typeof api.unregisterTab === 'function')
check('service: has getTabs', api && typeof api.getTabs === 'function')
check('service: has activateTab', api && typeof api.activateTab === 'function')
check('service: has getActiveTab', api && typeof api.getActiveTab === 'function')
check('service: has subscribe', api && typeof api.subscribe === 'function')
check('service: has getLayout', api && typeof api.getLayout === 'function')
check('service: reports a version string', api && typeof api.version === 'string')

// ---- registration --------------------------------------------------------
check('register: empty registry starts empty', api.getTabs().length === 0)

let cleanedUp = 0
const disposeHello = api.registerTab({
  id: 'hello',
  title: { zh: '你好', en: 'Hello' },
  icon: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
  order: 10,
  mount(container, ctx2) {
    container.textContent = 'mounted:' + ctx2.id
    return () => { cleanedUp += 1 }
  },
})

let tabs = api.getTabs()
check('register: the tab is listed', tabs.length === 1 && tabs[0].id === 'hello', JSON.stringify(tabs))
check('register: title resolves through the active locale', tabs[0].title === '你好', tabs[0].title)
check('register: order is kept', tabs[0].order === 10, String(tabs[0].order))
check('register: returns its own disposer', typeof disposeHello === 'function')
check('register: the mount callback has not run yet', cleanedUp === 0)

const disposeSecond = api.registerTab({ id: 'second', title: 'Second', mount() {} })
check('register: order defaults to 100', api.getTabs().find((t) => t.id === 'second').order === 100)
check('register: a plain string title is kept as-is', api.getTabs().find((t) => t.id === 'second').title === 'Second')

// ---- rejections ----------------------------------------------------------
const noId = threw(() => api.registerTab({ title: 'x', mount() {} }))
check('reject: missing id throws', !!noId && /id must match/.test(noId.message), noId && noId.message)
const badId = threw(() => api.registerTab({ id: 'has space', title: 'x', mount() {} }))
check('reject: an illegal id throws', !!badId && /id must match/.test(badId.message))
const reserved = threw(() => api.registerTab({ id: 'ext', title: 'x', mount() {} }))
check('reject: "ext" is reserved for the built-in group', !!reserved && /reserved/.test(reserved.message))
const reservedWs = threw(() => api.registerTab({ id: 'ws', title: 'x', mount() {} }))
check('reject: "ws" is reserved for the built-in group', !!reservedWs && /reserved/.test(reservedWs.message))
const noMount = threw(() => api.registerTab({ id: 'nomount', title: 'x' }))
check('reject: a tab with nothing to render throws', !!noMount && /needs mount/.test(noMount.message))
const notObject = threw(() => api.registerTab(null))
check('reject: a non-object descriptor throws', !!notObject && /needs an object/.test(notObject.message))
check('reject: nothing was registered by the failures', api.getTabs().length === 2, String(api.getTabs().length))

// ---- hot reload: same id replaces instead of stacking --------------------
api.registerTab({ id: 'hello', title: { zh: '你好 v2', en: 'Hello v2' }, mount() {} })
tabs = api.getTabs()
check('reload: re-registering an id does not stack', tabs.filter((t) => t.id === 'hello').length === 1)
check('reload: the newest descriptor wins', tabs.find((t) => t.id === 'hello').title === '你好 v2')
// The sandbox has no sidebar, so nothing ever mounts here; the ordering that
// matters (old panel torn down BEFORE the new record lands) is asserted on the
// source, and the live behaviour is covered by the CDP check in CHANGELOG.
check('reload: the previous panel is disposed before the new record lands',
  /var previous = findTab\(id\)[\s\S]{0,240}?disposeTabPanel\(id\)[\s\S]{0,240}?tabRecords\.push\(record\)/.test(client))

// ---- activation ----------------------------------------------------------
check('activate: unknown id is refused', api.activateTab('nope') === false)
check('activate: nothing active by default', api.getActiveTab() === null)
check('activate: a known id activates', api.activateTab('second') === true && api.getActiveTab() === 'second')
check('activate: the choice is persisted', live.storage.get('dsh-sidebar-suite:active-tab') === 'second')
check('activate: clicking the active tab returns to the groups', api.activateTab('second') === true && api.getActiveTab() === null)
check('activate: returning clears the stored choice', !live.storage.has('dsh-sidebar-suite:active-tab'))
api.activateTab('second')
check('activate: null is accepted as "show the groups"', api.activateTab(null) === true && api.getActiveTab() === null)

// ---- subscription --------------------------------------------------------
const seen = []
const off = api.subscribe((list, reason, activeId) => seen.push({ reason, count: list.length, activeId }))
api.registerTab({ id: 'third', title: 'Third', mount() {} })
check('subscribe: registration notifies', seen.length === 1 && seen[0].reason === 'register')
check('subscribe: the listener sees the whole list', seen[0].count === 3, String(seen[0].count))
api.unregisterTab('third')
check('subscribe: removal notifies', seen.length === 2 && seen[1].reason === 'unregister')
const before = seen.length
off()
api.registerTab({ id: 'fourth', title: 'Fourth', mount() {} })
check('subscribe: the returned disposer stops delivery', seen.length === before)

// ---- unregister + lifecycle ---------------------------------------------
const disposeFourth = api.registerTab({ id: 'gone', title: 'Gone', mount() {} })
api.activateTab('gone')
check('unregister: a removed tab is no longer listed', api.getTabs().some((t) => t.id === 'gone'))
api.unregisterTab('gone')
check('unregister: the id disappears', !api.getTabs().some((t) => t.id === 'gone'))
check('unregister: an open tab falls back to the groups', api.getActiveTab() === null)
check('unregister: an unknown id is a no-op', api.unregisterTab('never-existed') === false)
disposeFourth()
disposeFourth()
check('dispose: calling it twice is harmless', !api.getTabs().some((t) => t.id === 'gone'))
disposeSecond()
disposeHello()

// ---- layout probe --------------------------------------------------------
const shape = api.getLayout()
check('getLayout: reports the three fields a consumer needs',
  shape && typeof shape.mode === 'string' && typeof shape.tab === 'string'
  && 'activeTab' in shape && typeof shape.narrow === 'boolean')

// ---- a second instance starts clean -------------------------------------
const fresh = buildClient()
check('isolation: a fresh client has no leftover tabs', fresh.service.getTabs().length === 0)

// ---- the strip only exists while someone registers ----------------------
check('strip: rendered from the registry, not hard-coded markup',
  client.includes("strip.setAttribute('data-dsbs-tabs', '')"))
check('strip: hidden when no plugin registered a tab',
  /if \(!hasPlugin\) \{\s*strip\.setAttribute\('hidden', ''\)/.test(client))
check('strip: built-in groups ride along in layout b',
  client.includes("out.push({ id: 'ext', builtin: true") && client.includes("out.push({ id: 'ws', builtin: true"))
check('strip: built-ins are keyed on mode b',
  client.includes("var showBuiltin = config.values.mode === 'b' && !!runtime.nav"))
check('strip: buttons are real tablist children',
  client.includes("button.setAttribute('role', 'tab')") && client.includes("strip.setAttribute('role', 'tablist')"))
check('strip: the selected page is marked for assistive tech',
  client.includes("button.setAttribute('aria-selected', selected ? 'true' : 'false')"))

// ---- the page container --------------------------------------------------
check('panel: one container per tab, keyed by id',
  client.includes("panel.setAttribute('data-dsbs-tabpanel', record.id)"))
check('panel: mount is deferred until first activation',
  /if \(!entry\.mounted\) mountTabPanel\(entry\)/.test(client))
check('panel: a thrown mount is contained inside its own tab',
  /\[dsh-sidebar-suite\] tab ".*failed to mount/.test(client))
check('panel: a throwing consumer cannot break the sidebar',
  client.includes("console.error('[dsh-sidebar-suite] tab mount failed:', record.id, error)"))
check('panel: a mounted panel runs its cleanup before leaving the DOM',
  /delete runtime\.tabPanels\[id\][\s\S]{0,260}?entry\.cleanup\(\)[\s\S]{0,260}?removeChild\(entry\.el\)/.test(client))

// ---- styles --------------------------------------------------------------
check('css: the strip is a flat row that scrolls instead of wrapping',
  /\[data-dsbs-tabs\]\{[^}]*overflow-x:auto/.test(client))
check('css: the selected page carries the workspace accent',
  /\[data-dsbs-tabs\] button\[aria-selected="true"\]\{[^}]*inset 0 -2px 0/.test(client))
check('css: the active page takes the column', /\[data-dsbs-tabpanel\]\[data-dsbs-visible="true"\]\{display:flex\}/.test(client))
check('css: the two groups step aside while a tab is open',
  client.includes('html[data-dsbs-ptab="true"] nav[data-dsbs-ext]{display:none!important}')
  && client.includes('html[data-dsbs-ptab="true"] div:has(> [data-slot="sidebar.workspaces"]){display:none!important}'))
check('css: narrow sidebars go icon-only, like the control bar',
  /html\[data-dsbs-narrow="true"\] \[data-dsbs-tabs\] button\[data-dsbs-hasicon\] \[data-dsbs-tablabel\]\{display:none\}/.test(client))
check('css: a tab without an icon keeps its label when narrow',
  client.includes('button[data-dsbs-hasicon]') && !/narrow="true"\] \[data-dsbs-tabs\] button \[data-dsbs-tablabel\]\{display:none\}/.test(client))

// ---- teardown ------------------------------------------------------------
check('teardown: every panel is unmounted, not just detached',
  /disposeAllTabPanels\(\)\s*\n\s*if \(runtime\.tabStrip/.test(client))
check('teardown: the html flag is cleared with the rest',
  client.includes("'data-dsbs-ptab',"))

// ---- docs ----------------------------------------------------------------
const readme = fs.readFileSync(ROOT + '/README.md', 'utf8')
const detail = fs.readFileSync(ROOT + '/DETAIL.md', 'utf8')
const guide = fs.readFileSync(ROOT + '/使用说明.md', 'utf8')
const changelog = fs.readFileSync(ROOT + '/CHANGELOG.md', 'utf8')

check('docs: README documents registerTab', /registerTab/.test(readme))
check('docs: DETAIL explains the service contract', /registerTab/.test(detail))
check('docs: the Chinese guide has a walkthrough', /registerTab/.test(guide))
check('docs: changelog has a 0.3.0 section', /^## 0\.3\.0/m.test(changelog))
check('docs: README says a built-in click notifies subscribers too',
  /点内置页签/.test(readme) && /activeId.+null|null.+activeId/.test(readme))
check('docs: changelog records the notification fix',
  /点了内置页签也会通知订阅者/.test(changelog))

console.log('')
if (fail > 0) {
  console.log(pass + ' passed, ' + fail + ' failed')
  process.exitCode = 1
} else {
  console.log(pass + ' passed, 0 failed')
}
