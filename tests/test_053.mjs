// dsh-sidebar-suite 0.8.1 (fourth pass, part two) — independent review leftovers.
//
//   1. `purgeOnExit` promised to re-read KEEP_DELETED_DAYS synchronously but
//      only passed KEEP_DELETED, so a hand edit made just before quitting was
//      measured against the stale in-memory retention window.
//   2. `purgeSync` returned early when nothing was tracked, skipping the
//      retention pass entirely: a machine with no temporary sessions never
//      cleared its expired trash on exit.
//   3. Changing the retention DAYS in the detail page sent the new value but
//      did not re-read the trash list, so the visible entries kept their old
//      deadlines until the page was reopened.
//
// Host checks use a throwaway DSH_HOME; the client half mounts the real bundle
// against the shared DOM stub. No user data is touched.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildSidebar, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOST = pathToFileURL(path.join(ROOT, 'lib', 'temp-session-host.mjs')).href + '?v053=1'
const SRC = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra === undefined ? '' : '  ->  ' + JSON.stringify(extra))) }
}
const settle = () => new Promise((r) => setTimeout(r, 0))
const tick = () => new Promise((r) => setTimeout(r, 20))

// ---------------------------------------------------------------------------
// Part A — host half
// ---------------------------------------------------------------------------
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-053-'))
process.env.DSH_HOME = HOME
const SESSIONS = path.join(HOME, 'sessions')
const PROJ = path.join(HOME, 'storages', 'session_projcache', 'sessions')
const DATA = path.join(HOME, 'dsh-sidebar-suite')
const TRASH = path.join(DATA, 'trash')
const CONFIG = path.join(DATA, 'temp-session-config.txt')
fs.mkdirSync(PROJ, { recursive: true })
fs.mkdirSync(DATA, { recursive: true })
fs.mkdirSync(path.join(SESSIONS, '--proj--'), { recursive: true })
const writeConfig = (days) => fs.writeFileSync(CONFIG, [
  'DELETE_ON_EXIT=on', 'SCHEDULE_DELETE=off', 'KEEP_DELETED=on',
  `KEEP_DELETED_DAYS=${days}`, '',
].join('\n'), 'utf8')
writeConfig(7)

const routes = new Map()
const registry = { register(r) { routes.set(r.path, r); return async () => routes.delete(r.path) } }
const ctx = {
  connection: { fetch: registry },
  get(n) {
    if (n === 'connection') return ctx.connection
    if (n === 'workspaceRegistry') return { archiveSession: async () => true }
    return undefined
  },
  logger: { debug() {}, warn() {}, info() {}, error() {} },
}
const mod = await import(HOST)
const host = mod.createTempSessionHost(ctx)
host.register(ctx)
// A read route awaits the one-shot boot gate (ensureReady is not exported).
await call('/api/dsh-temp-session.status')

async function call(p, init) {
  const route = routes.get(String(p).split('?')[0])
  if (!route) throw new Error('no route for ' + p)
  const res = await route.fetch(new Request('http://dsh.invalid' + p, init))
  return res.json()
}
/** A trash entry aged `days` days, with a tiny payload and an explicit size. */
let entryCounter = 0
function agedEntry(id, days) {
  const key = `${Date.now() + entryCounter++}-${id}`
  const dir = path.join(TRASH, key)
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'data', 'x.jsonl'), 'x')
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    id, workspace: '--proj--', title: id,
    deletedAt: new Date(Date.now() - days * 86400 * 1000).toISOString(),
    reason: 'delete', bytes: 64,
  }), 'utf8')
  return key
}
function entryKeys(id) {
  try {
    return fs.readdirSync(TRASH, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.endsWith('-' + id))
      .map((e) => e.name)
  } catch (error) { void error; return [] }
}

try {
  // ---- A1. a config edit seconds before quitting must be honoured --------
  const stale = agedEntry('stale-deadline', 3)
  const live = 'still-within-window'
  const liveDir = path.join(SESSIONS, '--proj--', live)
  fs.mkdirSync(liveDir, { recursive: true })
  fs.writeFileSync(path.join(liveDir, 'x.jsonl'), 'x')
  await call('/api/dsh-temp-session.track?sessionId=' + live, { method: 'POST' })
  // The file says 1 day; the in-memory cache still says 7.
  writeConfig(1)
  host.purgeOnExit()
  check('A1: the exit path uses the freshly written retention window',
    entryKeys('stale-deadline').length === 0, entryKeys('stale-deadline'))
  check('A1: an entry inside the fresh window is still recoverable',
    entryKeys(live).length === 1, entryKeys(live))

  // ---- A2. quitting with no tracked sessions still applies retention -----
  // Well past any window, so this assertion is about "did retention run at
  // all" and does not depend on which config value happens to be cached.
  const orphan = agedEntry('orphan-expired', 30)
  host.purgeSync('process-exit')
  check('A2: an empty tracked list does not skip the retention pass',
    entryKeys('orphan-expired').length === 0, entryKeys('orphan-expired'))
  check('A2: the other entry was not collateral damage',
    entryKeys(live).length === 1, entryKeys(live))
} finally {
  process.removeAllListeners('exit')
  try { fs.rmSync(HOME, { recursive: true, force: true }) }
  catch (error) { console.error('CLEANUP_FAIL ' + HOME + ' ' + error.code + ' ' + error.message) }
}

// ---------------------------------------------------------------------------
// Part B — client half: changing DAYS must refresh the visible list
// ---------------------------------------------------------------------------
function findAll(node, pred, out) {
  const found = out || []
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) { for (const item of node) findAll(item, pred, found); return found }
  if (pred(node)) found.push(node)
  if (node.children) findAll(node.children, pred, found)
  return found
}

const STATUS = {
  ok: true, env: { plugin: '0.8.1', dshClient: '0.2.2-rc.5', node: '22.22.2', platform: 'win32' },
  routes: {
    registered: 13, errors: [],
    paths: ['status', 'list', 'config', 'track', 'untrack', 'remove', 'purge', 'probe', 'paths',
      'trash', 'trash-restore', 'trash-delete', 'trash-empty'].map((n) => '/api/dsh-temp-session.' + n),
  },
  tempCount: 0, trash: { prunes: 0, kept: 0, bytes: 0 },
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
  caps: { entries: 20, bytes: 200 * 1024 * 1024 }, totalBytes: 2048,
  entries: [{
    key: '1700000000000-days', id: 'days-session', workspace: '--proj--',
    title: 'a recoverable session', deletedAt: '2026-11-20T00:00:00.000Z', bytes: 2048,
  }],
}

function mountDetail() {
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
    requests.push({
      url: target, method: (init && init.method) || 'GET',
      body: init && typeof init.body === 'string' ? init.body : '',
    })
    const name = (target.split('dsh-temp-session.')[1] || '').split('?')[0]
    const body = name === 'status' ? STATUS : name === 'config' ? POLICY
      : name === 'trash' ? TRASH_BODY
        : name === 'list' ? { ok: true, ids: [], count: 0 } : { ok: true }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const host0 = {
    __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
    getComputedStyle: () => ({ position: 'static', display: 'block' }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    open() { return null },
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
  }
  const sandbox = {
    window: host0, document: doc,
    navigator: { language: 'zh-CN', clipboard: { writeText: () => Promise.resolve() } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    fetch: fetchStub, Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: class { constructor(cb) { this.cb = cb } observe() {} disconnect() {} takeRecords() { return [] } },
    ResizeObserver: class { observe() {} disconnect() {} },
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
    requestAnimationFrame: (cb) => sbTimeout(cb, 0), cancelAnimationFrame: (id) => clearTimeout(id),
    console,
    require(name) { return name === 'react' ? ReactStub : null },
  }
  sandbox.window.document = doc
  sandbox.window.localStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox, { filename: 'client.js' })
  const bundle = sandbox.__entry.factory(() => ReactStub)
  const registered = []
  const slots = { inject(name, cb) { if (typeof cb === 'function') cb() }, register(spec, component) { registered.push({ spec, component }); return () => {} } }
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe() { return () => {} }, register() { return () => {} } },
    effect(fn) { return fn() },
    get() { return undefined },
    inject(deps, cb) { if (typeof cb === 'function') cb({ slots, configForms: undefined }) },
    provide() {},
  }
  bundle.apply(ctx)
  const configEntry = registered.find((r) => r.spec && r.spec.name === 'plugins.bundle.config')
  return {
    requests, effects,
    render() { stateIdx = 0; return configEntry.component() },
  }
}

async function clientChecks() {
  const view = mountDetail()
  view.render()
  for (const fn of view.effects.splice(0)) fn()
  await settle(); await tick()
  const before = view.requests.filter((r) => r.method === 'GET' && r.url.indexOf('dsh-temp-session.trash') >= 0).length
  const tree = view.render()
  const daysInput = findAll(tree, (n) => n.type === 'input' && n.props &&
    String(n.props.type) === 'number' && Number(n.props.max) === 365)[0]
  check('B1: the retention-days input is present', !!daysInput)
  if (daysInput && typeof daysInput.props.onChange === 'function') {
    daysInput.props.onChange({ target: { value: '3' } })
    await settle(); await tick()
    const after = view.requests.filter((r) => r.method === 'GET' && r.url.indexOf('dsh-temp-session.trash') >= 0).length
    check('B1: changing the days re-reads the trash list', after > before, { before, after })
    const saved = view.requests.filter((r) => r.method === 'POST' && r.url.indexOf('dsh-temp-session.config') >= 0)
    check('B1: and still saves the new value', saved.length === 1 && saved[0].body.indexOf('"keepDeletedDays":3') >= 0, saved)
  }
}

await clientChecks()

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
