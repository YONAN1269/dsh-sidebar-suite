// Offline end-to-end test for dsh-sidebar-suite 0.2.0 (native temporary session).
//
// Host half: tracked ids, real directory deletion, startup purge, store file.
// Client half: the Temp button creates a native session through uiWorkspace,
// opens it, tracks it, and tags its sidebar row — with no self-drawn window.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

// Relocatable: tests live in <repo>/tests, so ROOT is one directory up.
// No absolute machine paths — this has to run unchanged on GitHub Actions.
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOME = fs.mkdtempSync(path.join(tmpdir(), 'dsbs-020-'))

const fail = []
const check = (name, ok, extra) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)))
  if (!ok) fail.push(name)
}

process.env.DSH_HOME = HOME
fs.rmSync(HOME, { recursive: true, force: true })
fs.mkdirSync(path.join(HOME, 'sessions', '--proj--'), { recursive: true })

const seedSession = (id) => {
  const dir = path.join(HOME, 'sessions', '--proj--', id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), 'x')
  fs.mkdirSync(path.join(HOME, 'storages', 'session_projcache', 'sessions'), { recursive: true })
  fs.writeFileSync(path.join(HOME, 'storages', 'session_projcache', 'sessions', 'session-' + id + '.json'), '{}')
  return dir
}

// ---------------------------------------------------------------- Host ----
const routes = new Map()
const fetchRegistry = {
  register(route) {
    if (routes.has(route.path)) throw new Error('connection: exact Fetch route "' + route.path + '" is already registered')
    routes.set(route.path, route)
    return async () => routes.delete(route.path)
  },
}
const hostCtx = { connection: { fetch: fetchRegistry }, get(name) { return name === 'connection' ? hostCtx.connection : undefined } }

const { createTempSessionHost } = await import(pathToFileURL(ROOT + '/lib/temp-session-host.mjs').href)
const host = createTempSessionHost(hostCtx)
host.register(hostCtx)

check('host: 8 routes registered', host.state.routes.registered === 8, host.state.routes)
check('host: no route errors', host.state.routes.errors.length === 0, host.state.routes.errors)
host.register(hostCtx)
check('host: re-register keeps 8 routes (idempotent)', host.state.routes.registered === 8, host.state.routes.registered)
check('host: config parsed', host.state.config.found === true && host.state.config.deleteOnExit === true && host.state.config.maxKept === 20, host.state.config)
check('host: button style defaults to pair', host.state.config.buttonStyle === 'pair', host.state.config.buttonStyle)

const call = async (p, init) => {
  const route = routes.get(String(p).split('?')[0])
  if (!route) throw new Error('no route for ' + p)
  const res = await route.fetch(new Request('http://dsh.invalid' + p, init))
  return res.json()
}

const ID1 = '11111111-1111-1111-1111-111111111111'
const dir1 = seedSession(ID1)
const tracked = await call('/api/dsh-temp-session.track?sessionId=' + ID1, { method: 'POST' })
check('host: track accepts a session id', tracked.ok === true && tracked.count === 1, tracked)
const listed = await call('/api/dsh-temp-session.list')
check('host: list returns the tracked id', listed.ids.length === 1 && listed.ids[0] === ID1, listed)
const storeFile = path.join(HOME, 'dsh-sidebar-suite', 'temp-sessions.json')
check('host: store file written under DSH home', fs.existsSync(storeFile) && JSON.parse(fs.readFileSync(storeFile, 'utf8')).sessions[0] === ID1)
check('host: bad id rejected', (await call('/api/dsh-temp-session.track?sessionId=..%2F..%2Fetc')).ok === false)

const purged = await call('/api/dsh-temp-session.purge', { method: 'POST' })
check('host: purge deletes the session directory', purged.removed === 1 && !fs.existsSync(dir1), purged)
check('host: purge clears the projection cache', !fs.existsSync(path.join(HOME, 'storages', 'session_projcache', 'sessions', 'session-' + ID1 + '.json')))
check('host: purge empties the store', JSON.parse(fs.readFileSync(storeFile, 'utf8')).sessions.length === 0)
check('host: tracked list empty after purge', (await call('/api/dsh-temp-session.list')).count === 0)

const ID2 = '22222222-2222-2222-2222-222222222222'
seedSession(ID2)
await call('/api/dsh-temp-session.track?sessionId=' + ID2, { method: 'POST' })
await call('/api/dsh-temp-session.untrack?sessionId=' + ID2, { method: 'POST' })
check('host: untrack forgets without deleting', (await call('/api/dsh-temp-session.list')).count === 0 && fs.existsSync(path.join(HOME, 'sessions', '--proj--', ID2)))

const probe = await call('/api/dsh-temp-session.probe')
check('host: probe declares native-window mode', probe.mode === 'native-session' && probe.usesNativeWindow === true && probe.createsOwnWindow === false, probe.mode)
check('host: probe exposes the quit hook', probe.processExitHook === true)
check('host: probe paths point into DSH home', probe.sessionsRoot === path.join(HOME, 'sessions').replace(/\\/g, '\\'), probe.sessionsRoot)

// Startup pass: a store left over from a previous run must be deleted on boot.
const ID3 = '33333333-3333-3333-3333-333333333333'
const dir3 = seedSession(ID3)
fs.writeFileSync(storeFile, JSON.stringify({ version: 1, sessions: [ID3] }))
const fresh = await import(pathToFileURL(ROOT + '/lib/temp-session-host.mjs').href + '?fresh=1')
const routes2 = new Map()
const hostCtx2 = { connection: { fetch: { register: (r) => { routes2.set(r.path, r); return async () => {} } } }, get: () => undefined }
fresh.createTempSessionHost(hostCtx2).register(hostCtx2)
const waitFor = async (predicate, ms = 3000) => {
  const started = Date.now()
  while (Date.now() - started < ms) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}
const storeEmpty = () => {
  try { return JSON.parse(fs.readFileSync(storeFile, 'utf8')).sessions.length === 0 } catch (error) { return false }
}
await waitFor(() => !fs.existsSync(dir3) && storeEmpty())
check('host: previous-run temp session deleted at startup', !fs.existsSync(dir3), fs.existsSync(dir3))
check('host: store emptied after startup purge', storeEmpty())

// ----------------------------------------------------------------- DOM ----
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parentNode = null
    this.attrs = {}
    this.listeners = {}
    this.style = { _p: {}, setProperty(k, v) { this._p[k] = v }, removeProperty(k) { delete this._p[k] } }
    this.hidden = false
    this.textContent = ''
    this.title = ''
    this.value = ''
    this.className = ''
    this.disabled = false
    this.isConnected = true
  }
  get parentElement() { return this.parentNode }
  get firstChild() { return this.children[0] || null }
  get lastChild() { return this.children[this.children.length - 1] || null }
  get nextSibling() {
    if (!this.parentNode) return null
    return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null
  }
  get nextElementSibling() { return this.nextSibling }
  get previousElementSibling() {
    if (!this.parentNode) return null
    return this.parentNode.children[this.parentNode.children.indexOf(this) - 1] || null
  }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c)
    const i = ref ? this.children.indexOf(ref) : -1
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c)
    c.parentNode = this
    return c
  }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v) }
  getAttribute(k) {
    if (k === 'class' && !Object.prototype.hasOwnProperty.call(this.attrs, k)) return this.className || null
    return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null
  }
  removeAttribute(k) { delete this.attrs[k] }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) }
  focus() { doc.activeElement = this }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn) }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn) }
  dispatch(type, event) { for (const fn of this.listeners[type] || []) fn(event) }
  click() { this.dispatch('click', { preventDefault() {}, stopPropagation() {} }) }
  getBoundingClientRect() { return { width: 260, height: 640, top: 0, left: 0, right: 260, bottom: 640 } }
  querySelectorAll(sel) { return queryAll(this, sel) }
  querySelector(sel) { return queryAll(this, sel)[0] || null }
}

function descendants(node, out = []) {
  for (const c of node.children || []) { out.push(c); descendants(c, out) }
  return out
}
function matchSimple(el, sel) {
  const m = /^([a-zA-Z]*)((?:\[[^\]]+\])*)$/.exec(sel.trim())
  if (!m) return false
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false
  for (const raw of m[2].match(/\[[^\]]+\]/g) || []) {
    const inner = raw.slice(1, -1)
    const eq = inner.search(/[=]/)
    if (eq < 0) { if (!el.hasAttribute(inner)) return false; continue }
    const opChar = inner[eq - 1]
    const op = opChar === '*' ? '*=' : opChar === '^' ? '^=' : '='
    const key = inner.slice(0, op === '=' ? eq : eq - 1)
    const value = inner.slice(eq + 1).replace(/^["']|["']$/g, '')
    const actual = el.getAttribute(key) || ''
    if (op === '*=' ? !actual.includes(value) : op === '^=' ? !actual.startsWith(value) : actual !== value) return false
  }
  return true
}
function queryAll(root, selector) {
  const out = []
  for (const part of selector.split(',')) {
    const chain = part.trim().split(/\s+/).filter(Boolean)
    let current = [root]
    for (const seg of chain) {
      const next = []
      for (const node of current) for (const child of descendants(node)) if (matchSimple(child, seg)) next.push(child)
      current = next
    }
    for (const n of current) if (!out.includes(n)) out.push(n)
  }
  return out
}

const docRoot = new El('#document')
const htmlEl = new El('html')
const headEl = new El('head')
const bodyEl = new El('body')
docRoot.appendChild(htmlEl)
htmlEl.appendChild(headEl)
htmlEl.appendChild(bodyEl)
htmlEl.lang = 'zh-CN'
const doc = docRoot
doc.documentElement = htmlEl
doc.head = headEl
doc.body = bodyEl
doc.baseURI = 'http://dsh.invalid/'
doc.activeElement = bodyEl
doc.hidden = false
doc.createElement = (tag) => new El(tag)
doc.querySelector = (sel) => queryAll(docRoot, sel)[0] || null
doc.querySelectorAll = (sel) => queryAll(docRoot, sel)
doc.getElementById = (id) => descendants(docRoot).find((n) => n.getAttribute('id') === id) || null
doc.addEventListener = El.prototype.addEventListener.bind(docRoot)
doc.removeEventListener = El.prototype.removeEventListener.bind(docRoot)
doc.dispatchEvent = (ev) => El.prototype.dispatch.call(docRoot, ev.type, ev)

const sidebarRoot = new El('div')
sidebarRoot.className = 'wtg9ga_root'
bodyEl.appendChild(sidebarRoot)
sidebarRoot.appendChild(new El('div')) // top strip
// Real host markup: root > row[data-window-drag] > brand > identity[aria-hidden,2 kids]
//               > seat > [data-slot="sidebar.brand.name"] > name  (the slot anchor)
const logoRow = new El('div')
logoRow.setAttribute('data-window-drag', '')
const brandEl = new El('button')
const brandIdentity = new El('div')
brandIdentity.setAttribute('aria-hidden', 'true')
const brandSeat = new El('div')
const brandSlot = new El('span')
brandSlot.setAttribute('data-slot', 'sidebar.brand.name')
const brandName = new El('span')
sidebarRoot.appendChild(logoRow)
logoRow.appendChild(brandEl)
brandEl.appendChild(brandIdentity)
brandIdentity.appendChild(brandSeat)
brandIdentity.appendChild(new El('img'))
brandSeat.appendChild(brandSlot)
brandSlot.appendChild(brandName)
const newSessionBtn = new El('button')
newSessionBtn.className = 'wtg9ga_newSession'
newSessionBtn.type = 'button'
sidebarRoot.appendChild(newSessionBtn)
const extNav = new El('nav')
extNav.className = 'wtg9ga_panelList'
sidebarRoot.appendChild(extNav)
const regionArea = new El('div')
sidebarRoot.appendChild(regionArea)
const wsSlot = new El('div')
wsSlot.setAttribute('data-slot', 'sidebar.workspaces')
regionArea.appendChild(wsSlot)
const listArea = new El('div')
regionArea.appendChild(listArea)
const row1 = new El('div')
row1.setAttribute('data-row-key', 'session:temp-alpha')
listArea.appendChild(row1)
const rowOther = new El('div')
rowOther.setAttribute('data-row-key', 'session:ordinary-beta')
listArea.appendChild(rowOther)

// Fake client service the host exposes as `uiWorkspace`.
const NEW_ID = 'temp-alpha'
const uiCalls = []
const uiWorkspaceService = {
  mainReference: { sessionId: 'existing-1' },
  workspaces: {
    list: { getSnapshot: () => ({ phase: 'ready', items: [{ workspaceId: 'ws-1', sessionIds: ['existing-1'] }] }) },
  },
  sessions: { list: { getSnapshot: () => ({ phase: 'ready', ids: ['existing-1'], byId: {} }) } },
  async createNamed(request) {
    uiCalls.push(['createNamed', request])
    return NEW_ID
  },
  openSession(id) { uiCalls.push(['openSession', id]) },
  startSession(id) { uiCalls.push(['startSession', id]) },
}

const storage = new Map()
const sandbox = {
  window: {
    __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
    getComputedStyle: () => ({ position: 'static' }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  },
  document: doc,
  navigator: { language: 'zh-CN' },
  localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
  fetch: async (url, init) => {
    const u = new URL(String(url))
    const route = routes.get(u.pathname)
    if (!route) return new Response('not found', { status: 404 })
    return route.fetch(new Request(String(url), init))
  },
  Request, Response, URL, URLSearchParams, Event: class { constructor(type) { this.type = type } },
  KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
  setTimeout, clearTimeout, setInterval, clearInterval,
  console,
}
sandbox.window.document = doc
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(ROOT + '/lib/client.js', 'utf8'), sandbox, { filename: 'client.js' })

const mod = sandbox.__entry.factory(() => { throw new Error('no react') })
const disposers = []
const ctx = {
  locale: { getSnapshot: () => ({ active: 'zh-CN' }) },
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
  get(name) { return name === 'uiWorkspace' ? uiWorkspaceService : undefined },
}
mod.apply(ctx)

const tempBtn = doc.querySelector('[data-dsbs-btn="temp"]')
const tempSlot = doc.querySelector('[data-dsbs-temp-slot]')
check('client: Temp button created', !!tempBtn)
check('client: Temp button lives in its own slot element', !!tempBtn && !!tempSlot && tempBtn.parentNode === tempSlot)
check('client: slot sits right after New Session', !!tempSlot && tempSlot.parentNode === sidebarRoot && sidebarRoot.children[sidebarRoot.children.indexOf(newSessionBtn) + 1] === tempSlot)
// dsh-deepseek-chat only adapts a sidebar whose root has exactly one direct
// <button>; a second one makes it report "当前侧栏不兼容" and refuse to switch.
check(
  'client: sidebar root keeps a single top-level <button>',
  sidebarRoot.children.filter((n) => n.tagName === 'BUTTON').length === 1,
  sidebarRoot.children.map((n) => n.tagName)
)
check('client: no self-drawn window exists', doc.querySelector('[data-dsbs-temp]') === null && doc.querySelector('[data-dsbs-temp-scrim]') === null)

await new Promise((r) => setTimeout(r, 40)) // status + list
tempBtn.click()
await new Promise((r) => setTimeout(r, 80))

const createCall = uiCalls.find((c) => c[0] === 'createNamed')
check('client: creates a native session in the current workspace', !!createCall && createCall[1].workspaceId === 'ws-1', createCall)
check('client: does not reuse a blank (no sessionId passed)', !!createCall && createCall[1].sessionId === undefined)
check('client: opens the new session in the native window', uiCalls.some((c) => c[0] === 'openSession' && c[1] === NEW_ID), uiCalls)
check('client: no window/dialog element was added', doc.querySelector('[data-dsbs-temp]') === null)
check('client: row is tagged as temporary', row1.getAttribute('data-dsbs-temp-row') === '1', row1.getAttribute('data-dsbs-temp-row'))
check('client: row badge text comes from the locale', row1.getAttribute('data-dsbs-temp-badge') === '临时', row1.getAttribute('data-dsbs-temp-badge'))
check('client: an ordinary row is untouched', rowOther.hasAttribute('data-dsbs-temp-row') === false)
const afterCreate = await call('/api/dsh-temp-session.list')
check('client: the id was reported to the host', afterCreate.ids.includes(NEW_ID), afterCreate)
check('client: toast confirms deletion on quit', (() => {
  const toast = doc.querySelector('[data-dsbs-temp-toast]')
  return !!toast && /退出 DSH/.test(toast.textContent)
})())

// A later row (list re-render) must be tagged by the heartbeat too.
const row2 = new El('div')
row2.setAttribute('data-row-key', 'session:' + NEW_ID)
listArea.appendChild(row2)
mod.__noop = null
await new Promise((r) => setTimeout(r, 1700))
check('client: freshly rendered temp row is tagged', row2.getAttribute('data-dsbs-temp-row') === '1')

// ---- coexistence with dsh-deepseek-chat (CHAT / HARNESS switcher) ----
const chatMark = new El('div')
chatMark.setAttribute('data-dsh-chat-content', '')
bodyEl.appendChild(chatMark)
await new Promise((r) => setTimeout(r, 1700))
check('client: CHAT mode hides the Temp button', htmlEl.getAttribute('data-dsbs-chat-mode') === 'true', htmlEl.getAttribute('data-dsbs-chat-mode'))
check('client: CHAT mode also drops the New-Session override flag', (() => {
  // the CSS rule is gated on html:not([data-dsbs-chat-mode]); the flag is the contract
  return htmlEl.getAttribute('data-dsbs-chat-mode') === 'true'
})())
bodyEl.removeChild(chatMark)
await new Promise((r) => setTimeout(r, 1700))
check('client: back to HARNESS restores the button', htmlEl.getAttribute('data-dsbs-chat-mode') === null)

for (const d of disposers) { try { d() } catch (e) { void e } }
check('client: teardown removes the Temp button', doc.querySelector('[data-dsbs-btn="temp"]') === null)
check('client: teardown clears row tags', row1.hasAttribute('data-dsbs-temp-row') === false && row2.hasAttribute('data-dsbs-temp-row') === false)
check('client: teardown removes the toast', doc.querySelector('[data-dsbs-temp-toast]') === null)

// ---- dsh-deepseek-chat must still recognise this sidebar -------------------
// Its adapter walks the brand chain and refuses the sidebar when the root holds
// anything but ONE direct <button>. Run its real shipped code on the DOM our
// client just produced.
// Optional host plugin: present on the author's machine, absent in CI.
// Set DSH_CHAT_CLIENT to run the compatibility checks against another install.
const CHAT_CLIENT = process.env.DSH_CHAT_CLIENT || path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-deepseek-chat', 'lib', 'client.js'
)
if (fs.existsSync(CHAT_CLIENT)) {
  const chatSrc = fs.readFileSync(CHAT_CLIENT, 'utf8')
  const from = chatSrc.indexOf('function attachSidebarAdapter(')
  let depth = 0
  let to = -1
  for (let p = chatSrc.indexOf('{', from); p < chatSrc.length; p++) {
    if (chatSrc[p] === '{') depth++
    else if (chatSrc[p] === '}' && --depth === 0) { to = p + 1; break }
  }
  const factory = new Function(
    'MutationObserver',
    'Node',
    chatSrc.slice(from, to) + '\nreturn attachSidebarAdapter'
  )
  const quiet = function () { this.observe = () => {}; this.disconnect = () => {} }
  const attach = factory(quiet, class {})
  const adapter = attach(brandName, () => ({ chat: false, canCreate: true }), () => {})
  check('compat: dsh-deepseek-chat accepts the sidebar', adapter !== null)
  check(
    'compat: the sidebar root still has exactly one <button>',
    sidebarRoot.children.filter((n) => n.tagName === 'BUTTON').length === 1,
    sidebarRoot.children.map((n) => n.tagName)
  )
  if (adapter) adapter.dispose()
} else {
  console.log('SKIP compat checks: dsh-deepseek-chat is not installed')
}

fs.rmSync(HOME, { recursive: true, force: true })
console.log('\n' + (fail.length ? 'FAILED: ' + fail.join(' | ') : 'ALL CHECKS PASSED'))
process.exit(fail.length ? 1 : 0)
