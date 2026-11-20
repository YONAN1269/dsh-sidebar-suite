// dsh-sidebar-suite 0.8.2 — reliability watchdogs and visible busy states.
//
// The Host can accept a request and never answer (restart, hung proxy). Before
// this pass only `status` had a watchdog: a hung POST left purge/trash buttons
// disabled forever, and a hung GET left the section permanently "Loading…".
// This test drives the real client bundle with a fetch stub that never settles
// for selected routes, and a recording timer sandbox that fires only the 20s
// watchdog — no production test hooks.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { buildSidebar, sbTimeout } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const SRC = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')
const DETAIL = fs.readFileSync(ROOT + '/DETAIL.md', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra === undefined ? '' : '  ->  ' + JSON.stringify(extra))) }
}
const settle = () => new Promise((r) => setTimeout(r, 0))

function makeTimers() {
  let next = 1
  const timers = []
  return {
    setTimeout(fn, ms) { const id = next; next += 1; timers.push({ id, fn, ms }); return id },
    clearTimeout(id) {
      const i = timers.findIndex((t) => t.id === id)
      if (i >= 0) timers.splice(i, 1)
    },
    setInterval() { const id = next; next += 1; return id },
    clearInterval() {},
    pending(ms) { return timers.filter((t) => ms === undefined || t.ms === ms).length },
    fireTimeout(ms) {
      const due = timers.filter((t) => t.ms === ms)
      for (const timer of due) {
        const i = timers.indexOf(timer)
        if (i >= 0) timers.splice(i, 1)
        timer.fn()
      }
      return due.length
    },
  }
}

function findAll(node, pred, out) {
  const found = out || []
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const item of node) findAll(item, pred, found)
    return found
  }
  if (pred(node)) found.push(node)
  if (node.children) findAll(node.children, pred, found)
  return found
}
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (node.children) return node.children.map(textOf).join(' ')
  return ''
}
function trashSection(tree) {
  return findAll(tree, (n) => !!(n.props && n.props['data-dsbs-trash']))[0] || null
}
function buttonsWithText(tree, text) {
  return findAll(tree, (n) => n.type === 'button' && textOf(n).indexOf(text) >= 0)
}
function buttonWithText(tree, text) {
  return buttonsWithText(tree, text)[0] || null
}

const STATUS = {
  ok: true,
  env: { plugin: '0.8.2', dshClient: '0.2.2-rc.5', node: '24.9.0', platform: 'win32' },
  routes: {
    registered: 13, errors: [],
    paths: ['status', 'list', 'config', 'track', 'untrack', 'remove', 'purge', 'probe', 'paths',
      'trash', 'trash-restore', 'trash-delete', 'trash-empty'].map((n) => '/api/dsh-temp-session.' + n),
  },
  tempCount: 0,
  trash: { prunes: 0, kept: 0, bytes: 0 },
}
const POLICY = {
  ok: true, showButton: true, inChatMode: 'hide', buttonStyle: 'pair',
  expandAllSessions: true, rowMenu: true, deleteOnExit: true, scheduleDelete: false,
  scheduleTime: '03:00', maxKept: 20, keepDeleted: true, keepDeletedDays: 7,
  configFile: 'C:/fake/temp-session-config.txt', configRevision: 3, configReloads: 1,
  configReloadSource: 'boot', found: true,
  schedule: { enabled: false, time: '03:00', nextRunAt: null, lastRunAt: null },
}
const TRASH_BODY = {
  ok: true, keepDeleted: true, keepDeletedDays: 7,
  caps: { entries: 20, bytes: 200 * 1024 * 1024 },
  totalBytes: 2048,
  entries: [{
    key: '1700000000000-session-054-alpha', id: 'session-054-alpha', workspace: '--proj--',
    title: '审阅一下可靠性', deletedAt: '2026-11-20T00:00:00.000Z', bytes: 2048,
  }],
}

function mountDetail(options) {
  const opts = options || {}
  const timers = makeTimers()
  const tree = buildSidebar()
  const doc = tree.doc
  const row = doc.createElement('div')
  row.setAttribute('class', 'wtg9ga_newSessionRow')
  const hostButton = doc.createElement('button')
  hostButton.setAttribute('class', 'wtg9ga_newSession')
  const outlet = doc.createElement('div')
  outlet.setAttribute('data-slot', 'sidebar.session.action')
  const seat = doc.createElement('div')
  seat.setAttribute('data-dsbs-temp-anchor', '')
  seat.setAttribute('data-dsbs-temp-slot', '')
  row.appendChild(hostButton)
  row.appendChild(outlet)
  outlet.appendChild(seat)
  tree.root.appendChild(row)

  const requests = []
  const storage = new Map()
  let stateIdx = 0
  const stateOverrides = []
  const effects = []
  const ReactStub = {
    createElement(type, props) {
      return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
    },
    useState(initial) {
      const i = stateIdx++
      const value = stateOverrides[i] === undefined ? initial : stateOverrides[i]
      const setter = (next) => {
        stateOverrides[i] = typeof next === 'function' ? next(stateOverrides[i]) : next
      }
      return [value, setter]
    },
    useEffect(fn) { effects.push(fn) },
    Fragment: 'Fragment',
  }
  const fetchStub = async (url, init) => {
    const target = String(url)
    const method = (init && init.method) || 'GET'
    requests.push({ url: target, method, body: init && typeof init.body === 'string' ? init.body : '' })
    const name = (target.split('dsh-temp-session.')[1] || '').split('?')[0]
    if (opts.hangRoutes && opts.hangRoutes.has(method + ':' + name)) {
      return new Promise(() => {})
    }
    const body = (function () {
      if (name === 'status') return STATUS
      if (name === 'config') return POLICY
      if (name === 'trash') return TRASH_BODY
      if (name === 'list') return { ok: true, ids: [], count: 0 }
      return { ok: true }
    })()
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const host0 = {
    __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
    getComputedStyle: () => ({ position: 'static', display: 'block' }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    open() { return null },
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
  }
  const sandbox = {
    window: host0,
    document: doc,
    navigator: { language: 'zh-CN', clipboard: { writeText: () => Promise.resolve() } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    fetch: fetchStub,
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: class { constructor(cb) { this.cb = cb } observe() {} disconnect() {} takeRecords() { return [] } },
    ResizeObserver: class { observe() {} disconnect() {} },
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    requestAnimationFrame: (cb) => sbTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console,
    require(name) { return name === 'react' ? ReactStub : null },
  }
  sandbox.window.document = doc
  sandbox.window.localStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox, { filename: 'client.js' })

  const mod = sandbox.__entry.factory(() => ReactStub)
  const registered = []
  const slots = {
    inject(name, cb) { if (typeof cb === 'function') cb() },
    register(spec, component) { registered.push({ spec, component }); return () => {} },
  }
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe() { return () => {} }, register() { return () => {} } },
    effect(fn) { return fn() },
    get() { return undefined },
    inject(deps, cb) { if (typeof cb === 'function') cb({ slots, configForms: undefined }) },
    provide() {},
  }
  mod.apply(ctx)
  const configEntry = registered.find((r) => r.spec && r.spec.name === 'plugins.bundle.config')
  return {
    requests, effects, timers,
    reset() { stateIdx = 0 },
    render() { stateIdx = 0; return configEntry.component() },
  }
}

async function ready(options) {
  const view = mountDetail(options)
  view.render()
  for (const fn of view.effects.splice(0)) fn()
  await settle(); await settle()
  return view
}

const POST_SNIPPETS = [
  "api/dsh-temp-session.track?sessionId=' + encodeURIComponent(id), { method: 'POST', timeoutMs: WRITE_TIMEOUT_MS }",
  "api/dsh-temp-session.untrack?sessionId=' + encodeURIComponent(id), { method: 'POST', timeoutMs: WRITE_TIMEOUT_MS }",
  "api/dsh-temp-session.remove?sessionId=' + encodeURIComponent(id), { method: 'POST', timeoutMs: WRITE_TIMEOUT_MS }",
  "tempCall('api/dsh-temp-session.config', { method: 'POST', body: JSON.stringify(patch), timeoutMs: WRITE_TIMEOUT_MS })",
  "tempCall('api/dsh-temp-session.purge', { method: 'POST', timeoutMs: WRITE_TIMEOUT_MS })",
  "tempCall(path + query, { method: 'POST', timeoutMs: WRITE_TIMEOUT_MS })",
]

async function main() {
  // ---- A1. source guard: every side-effecting POST has a watchdog --------
  check('A1: all six POSTs pass WRITE_TIMEOUT_MS',
    POST_SNIPPETS.every((s) => SRC.indexOf(s) >= 0),
    POST_SNIPPETS.map((s, i) => [i, SRC.indexOf(s) >= 0]))

  // ---- A2/A3. trash action: visible busy, then released on timeout ------
  const trashView = await ready({ hangRoutes: new Set(['POST:trash-delete']) })
  let section = trashSection(trashView.render())
  const arm = buttonWithText(section, '彻底删除')
  check('A2: the delete-for-good button exists', !!arm)
  if (arm) arm.props.onClick()
  await settle(); await settle()
  section = trashSection(trashView.render())
  const confirm = buttonWithText(section, '确认彻底删除')
  check('A2: the armed button exists', !!confirm)
  if (confirm) confirm.props.onClick()
  await settle(); await settle()
  section = trashSection(trashView.render())
  const busyText = textOf(section)
  console.log('UI-SNAPSHOT trash-busy-head: ' + JSON.stringify(busyText.slice(0, 320)))
  console.log('UI-SNAPSHOT trash-busy-tail: ' + JSON.stringify(busyText.slice(-240)))
  check('A2: busy text is visible while the POST hangs', busyText.indexOf('处理中') >= 0,
    busyText.slice(0, 320))
  const busyButton = buttonWithText(section, '彻底删除')
  check('A2: the button is disabled while busy', !!busyButton && busyButton.props.disabled === true,
    busyButton && busyButton.props)

  const firedTrash = trashView.timers.fireTimeout(20000)
  await settle(); await settle()
  section = trashSection(trashView.render())
  const timedOutText = textOf(section)
  check('A3: the trash watchdog fired', firedTrash > 0, firedTrash)
  check('A3: the button is usable again after timeout',
    !!(buttonWithText(section, '彻底删除')) && buttonWithText(section, '彻底删除').props.disabled !== true)
  check('A3: the timeout wording says to check before retrying',
    timedOutText.indexOf('操作失败') >= 0 && timedOutText.indexOf('操作超时') >= 0,
    timedOutText.slice(0, 320))

  // ---- A4. purge: "purging" text is replaced by the timeout wording -----
  const purgeView = await ready({ hangRoutes: new Set(['POST:purge']) })
  let purgeBtn = buttonWithText(purgeView.render(), '立即清理临时会话')
  check('A4: the purge button exists', !!purgeBtn)
  if (purgeBtn) purgeBtn.props.onClick()
  await settle(); await settle()
  const purgingBtn = buttonWithText(purgeView.render(), '清理中')
  check('A4: purge shows its busy text', !!purgingBtn && purgingBtn.props.disabled === true,
    purgingBtn && textOf(purgingBtn))
  const firedPurge = purgeView.timers.fireTimeout(20000)
  await settle(); await settle()
  const purgeTree = purgeView.render()
  purgeBtn = buttonWithText(purgeTree, '立即清理临时会话')
  const purgeText = textOf(purgeTree)
  check('A4: the purge watchdog fired', firedPurge > 0, firedPurge)
  check('A4: purge is clickable again after timeout', !!purgeBtn && purgeBtn.props.disabled !== true)
  check('A4: purge timeout wording matches trash',
    purgeText.indexOf('清理失败') >= 0 && purgeText.indexOf('操作超时') >= 0,
    purgeText.slice(0, 320))

  // ---- A5. config save: saving -> failed + timeout wording ---------------
  const cfgView = await ready({ hangRoutes: new Set(['POST:config']) })
  const keepRow = findAll(cfgView.render(), (n) => Array.isArray(n.children) &&
    n.children.some((c) => textOf(c).indexOf('删除后保留') >= 0) &&
    n.children.some((c) => !!c && c.type === 'button'))[0] || null
  const toggle = keepRow ? keepRow.children.filter((c) => !!c && c.type === 'button')[0] : null
  check('A5: the keep-deleted switch exists', !!toggle)
  if (toggle) toggle.props.onClick()
  await settle(); await settle()
  check('A5: saving is visible before the watchdog fires',
    textOf(cfgView.render()).indexOf('保存中') >= 0)
  const firedConfig = cfgView.timers.fireTimeout(20000)
  await settle(); await settle()
  const cfgText = textOf(cfgView.render())
  check('A5: the config watchdog fired', firedConfig > 0, firedConfig)
  check('A5: save failure carries the timeout wording',
    cfgText.indexOf('保存失败') >= 0 && cfgText.indexOf('操作超时') >= 0,
    cfgText.slice(0, 400))

  // ---- A6. a normal success must not be killed by the watchdog -----------
  const okView = await ready()
  const okBtn = buttonWithText(okView.render(), '立即清理临时会话')
  if (okBtn) okBtn.props.onClick()
  await settle(); await settle()
  const okText = textOf(okView.render())
  check('A6: the successful purge is reported', okText.indexOf('已移入最近删除') >= 0,
    okText.slice(0, 400))
  check('A6: no watchdog timer is left behind', okView.timers.pending(20000) === 0,
    okView.timers.pending(20000))

  // ---- A7. dictionary hygiene: one busy key, no dead leftovers -----------
  check('A7: one busy key and one timeout key exist',
    SRC.indexOf("'trash.working':") >= 0 && SRC.indexOf("'op.timeout':") >= 0)
  check('A7: the three dead busy keys are gone',
    ["'trash.emptying':", "'trash.restoring':", "'trash.deleting':"]
      .every((k) => SRC.indexOf(k) < 0))

  // ---- A8. the doc matches the code that refreshes the host list ---------
  const delStart = SRC.indexOf('function deleteTempSession')
  const delEnd = SRC.indexOf('function applyTempIdList')
  const deleteFn = delStart >= 0 && delEnd > delStart ? SRC.slice(delStart, delEnd) : ''
  check('A8: delete still refreshes the host session list',
    deleteFn.indexOf('refreshHostSessions()') >= 0)
  check('A8: DETAIL.md no longer claims a silent skip',
    DETAIL.indexOf('静默跳过') < 0)
}

try {
  await main()
} catch (error) {
  fail += 1
  console.log('FAIL  harness crashed: ' + (error && error.stack ? error.stack : error))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
