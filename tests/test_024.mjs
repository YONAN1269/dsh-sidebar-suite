// dsh-sidebar-suite 0.2.4 — always-expanded session list + config switch.
//
// Part A runs the real Host half against a throwaway DSH_HOME and exercises the
// new EXPAND_ALL_SESSIONS key (parse / status / save / GET+POST route).
// Part B runs the real client bundle in a vm sandbox with a tiny DOM that
// returns host-style overflow buttons, and asserts that the plugin presses them
// until every group is expanded, hides the button via CSS, and honours `off`.
import fs from 'node:fs'
import vm from 'node:vm'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

// Relocatable: <repo>/tests -> <repo>. No machine-specific paths (CI-safe).
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const CLIENT = ROOT + '/lib/client.js'
const HOST = ROOT + '/lib/temp-session-host.mjs'
const CONFIG = ROOT + '/temp-session-config.txt'
const originalConfig = readFileSync(CONFIG, 'utf8')
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsbs-024-'))

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  →  ' + extra : '')) }
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json' },
  })
}

// ---- Part A: the Host half ------------------------------------------------
function makeCtx(registered) {
  return {
    get(name) {
      if (name === 'connection') return { fetch: { register(spec) { registered.push(spec) } } }
      if (name === 'workspaceRegistry') return { archiveSession: async () => true }
      return null
    },
    logger: { debug() {}, warn() {}, info() {}, error() {} },
  }
}

try {
  const hostModule = await import(pathToFileURL(HOST).href)
  const registered = []
  const host = hostModule.createTempSessionHost(makeCtx(registered))
  host.register(makeCtx(registered))

  check('config: file documents the new switch', /^# 会话列表是否默认全部展开/m.test(originalConfig))
  check('config: default is on', /^EXPAND_ALL_SESSIONS=on$/m.test(originalConfig))
  check('backend: status exposes expandAllSessions', host.status().expandAllSessions === true)
  check('backend: publicConfig exposes expandAllSessions', host.publicConfig().expandAllSessions === true)
  check('backend: probe carries the config', host.probe().config.expandAllSessions === true)

  const saved = host.saveConfig({ expandAllSessions: false })
  const offFile = readFileSync(CONFIG, 'utf8')
  check('config: save reported ok', saved && saved.ok === true)
  check('config: off written verbatim', /^EXPAND_ALL_SESSIONS=off$/m.test(offFile))
  check('config: comments survive the write', offFile.includes('# off = 保持 DSH 原来的折叠行为'))
  check('config: unrelated key survives', /^TEMP_BUTTON_STYLE=pair$/m.test(offFile))
  check('config: no duplicate lines', (offFile.match(/^EXPAND_ALL_SESSIONS=/gm) || []).length === 1)
  check('backend: in-memory config switched off', host.state.config.expandAllSessions === false)
  check('backend: status switched off', host.status().expandAllSessions === false)

  const configRoute = registered.find((r) => r.path === '/api/dsh-temp-session.config')
  check('route: config route still registered', !!configRoute)
  if (configRoute) {
    const getRes = await configRoute.fetch(new Request('http://localhost/api/dsh-temp-session.config'))
    const getBody = await getRes.json()
    check('route: GET reports off', getBody.expandAllSessions === false, JSON.stringify(getBody))
    const postRes = await configRoute.fetch(new Request('http://localhost/api/dsh-temp-session.config', {
      method: 'POST',
      body: JSON.stringify({ expandAllSessions: true }),
    }))
    const postBody = await postRes.json()
    check('route: POST switches back on', postBody.expandAllSessions === true, JSON.stringify(postBody))
    check('route: POST persisted to file', /^EXPAND_ALL_SESSIONS=on$/m.test(readFileSync(CONFIG, 'utf8')))
  }

  // A hand-edited file wins on the next boot (re-parse through register()).
  writeFileSync(CONFIG, readFileSync(CONFIG, 'utf8').replace(/^EXPAND_ALL_SESSIONS=.*$/m, 'EXPAND_ALL_SESSIONS=off'), 'utf8')
  host.register(makeCtx([]))
  check('config: hand-edited off is read on boot', host.status().expandAllSessions === false)
} finally {
  writeFileSync(CONFIG, originalConfig, 'utf8')
}

// ---- Part B: a minimal DOM -----------------------------------------------
function makeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    style: {},
    className: '',
    textContent: '',
    parentNode: null,
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

/** A host-style overflow button: needs `needed` presses before it says true. */
function makeOverflow(key, needed) {
  const el = makeEl('button')
  el.setAttribute('data-row-key', 'overflow:' + key)
  el.setAttribute('aria-expanded', needed === 0 ? 'true' : 'false')
  el.clicks = 0
  el.click = function () {
    this.clicks += 1
    if (this.clicks >= needed) this.setAttribute('aria-expanded', 'true')
  }
  return el
}

function buildClient(fetchImpl, overflowButtons) {
  const doc = {
    baseURI: 'http://localhost/app/',
    documentElement: makeEl('html'),
    body: makeEl('body'),
    head: makeEl('head'),
    getElementById() { return null },
    querySelector() { return null },
    querySelectorAll(selector) {
      if (String(selector).indexOf('overflow:') >= 0) return overflowButtons
      return []
    },
    createElement: makeEl,
    addEventListener() {}, removeEventListener() {},
  }
  const requests = []
  const storage = new Map()
  const sandbox = {
    window: {
      __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
      getComputedStyle: () => ({ position: 'static' }),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      setTimeout, clearTimeout, setInterval, clearInterval,
    },
    document: doc,
    navigator: { language: 'zh-CN', clipboard: { writeText() { return Promise.resolve() } } },
    localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    fetch: async (url, init) => {
      requests.push({ url: String(url), method: (init && init.method) || 'GET' })
      return fetchImpl(url, init)
    },
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console,
  }
  sandbox.window.document = doc
  sandbox.window.localStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(CLIENT, 'utf8'), sandbox, { filename: 'client.js' })

  // React is deliberately unavailable: the sidebar half must work on its own,
  // and this keeps the scenario free of detail-page noise.
  const mod = sandbox.__entry.factory(() => null)
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'zh-CN' }) },
    effect(fn) { return fn() }, // keep disposers alive; nothing is torn down here
    get() { return undefined },
    inject() {},
  }
  mod.apply(ctx)
  const styles = doc.head.children.filter((n) => n.textContent && n.textContent.indexOf('data-dsbs-expand-all') >= 0)
  return { doc, html: doc.documentElement, css: styles.length ? styles[0].textContent : '', requests }
}

function fetcher(statusBody) {
  return async (url) => {
    const text = String(url)
    if (text.includes('dsh-temp-session.status')) return jsonResponse(statusBody || { ok: true, expandAllSessions: true })
    if (text.includes('dsh-temp-session.list')) return jsonResponse({ ok: true, ids: [], count: 0 })
    if (text.includes('dsh-temp-session.config')) return jsonResponse({ ok: true, deleteOnExit: true, scheduleDelete: false, scheduleTime: '03:00' })
    return new Response('not found', { status: 404 })
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- scenario 1: switch on, two folded groups + one already expanded -----
const groupA = makeOverflow('ws-a', 1)
const groupB = makeOverflow('ws-b', 3)
const groupC = makeOverflow('ws-c', 0)
const on = buildClient(fetcher({ ok: true, expandAllSessions: true }), [groupA, groupB, groupC])
check('css: overflow button is hidden when enabled', on.css.includes('html[data-dsbs-expand-all="true"] button[data-row-key^="overflow:"]'))
await wait(900)
check('expand: html flag is on', on.html.getAttribute('data-dsbs-expand-all') === 'true', String(on.html.getAttribute('data-dsbs-expand-all')))
check('expand: one-batch group expanded', groupA.clicks === 1 && groupA.getAttribute('aria-expanded') === 'true', String(groupA.clicks))
check('expand: three-batch group expanded', groupB.clicks === 3 && groupB.getAttribute('aria-expanded') === 'true', String(groupB.clicks))
check('expand: already-expanded group untouched', groupC.clicks === 0, String(groupC.clicks))
await wait(450)
check('expand: clicking stops once everything is shown', groupA.clicks === 1 && groupB.clicks === 3, groupA.clicks + '/' + groupB.clicks)
check('expand: status was fetched', on.requests.some((r) => r.url.includes('dsh-temp-session.status')))

// ---- scenario 2: switch off, host folding untouched ----------------------
const offA = makeOverflow('off-a', 1)
const off = buildClient(fetcher({ ok: true, expandAllSessions: false }), [offA])
await wait(500)
check('off: html flag removed', off.html.getAttribute('data-dsbs-expand-all') === null, String(off.html.getAttribute('data-dsbs-expand-all')))
check('off: host button never pressed', offA.clicks === 0, String(offA.clicks))
check('off: CSS rule still scoped by the flag', off.css.includes('data-dsbs-expand-all'))

// ---- scenario 3: Host half unreachable → safe default is still on --------
const deadA = makeOverflow('dead-a', 2)
const dead = buildClient(async () => new Response('not found', { status: 404 }), [deadA])
await wait(900)
check('dead: default on is used', dead.html.getAttribute('data-dsbs-expand-all') === 'true', String(dead.html.getAttribute('data-dsbs-expand-all')))
check('dead: sessions still expanded', deadA.clicks === 2 && deadA.getAttribute('aria-expanded') === 'true', String(deadA.clicks))

// ---- the real CSS/JS must agree with the host's DOM contract -------------
const src = readFileSync(CLIENT, 'utf8')
check('contract: selector matches host data-row-key', src.includes('button[data-row-key^="overflow:"]'))
check('contract: only aria-expanded=false is pressed', src.includes("button.getAttribute('aria-expanded') === 'true') continue"))
check('contract: config key is documented in the file', /EXPAND_ALL_SESSIONS=on/.test(readFileSync(CONFIG, 'utf8')))

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
