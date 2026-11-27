// dsh-sidebar-suite 0.8.1 — trash review fixes.
//
// 0.8.0 shipped a recoverable-delete feature with four holes that this file
// locks down:
//   1. A session bigger than the 200MB cap was parked and pruned in the same
//      call: "removed: 1" while nothing stayed in the trash.
//   2. Retention ran after every single park, so a batch delete walked the whole
//      trash N times (seconds on the synchronous quit path).
//   3. The two irreversible buttons of the trash section had no confirmation,
//      and the section disappeared entirely when keep-deleted was switched off,
//      stranding the entries on disk.
//   4. Copy said "cannot be undone" / "Removed N" about data that was in fact
//      recoverable.
//
// Host checks run against a throwaway DSH_HOME; client checks mount the real
// bundle against the shared DOM stub with a routing fetch.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildSidebar, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOST = pathToFileURL(path.join(ROOT, 'lib', 'temp-session-host.mjs')).href
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
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-050-'))
process.env.DSH_HOME = HOME
const SESSIONS = path.join(HOME, 'sessions')
const DATA = path.join(HOME, 'dsh-sidebar-suite')
const TRASH = path.join(DATA, 'trash')
const CONFIG = path.join(DATA, 'temp-session-config.txt')

fs.mkdirSync(DATA, { recursive: true })
fs.mkdirSync(path.join(SESSIONS, '--proj--'), { recursive: true })
fs.writeFileSync(CONFIG, [
  'DELETE_ON_EXIT=on',
  'SCHEDULE_DELETE=off',
  'MAX_KEPT=200',
  'KEEP_DELETED=on',
  'KEEP_DELETED_DAYS=7',
  '',
].join('\n'), 'utf8')

function seed(id, sizeBytes) {
  const dir = path.join(SESSIONS, '--proj--', id)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'session.jsonl')
  fs.writeFileSync(file, 'transcript-of-' + id)
  if (sizeBytes) fs.truncateSync(file, sizeBytes) // sparse: reports size, costs nothing
  return dir
}

const routes = new Map()
const fetchRegistry = {
  register(route) {
    if (routes.has(route.path)) throw new Error('already registered ' + route.path)
    routes.set(route.path, route)
    return async () => routes.delete(route.path)
  },
}
const hostCtx = {
  connection: { fetch: fetchRegistry },
  get(name) {
    if (name === 'connection') return hostCtx.connection
    if (name === 'workspaceRegistry') return { archiveSession: async () => true }
    return undefined
  },
  logger: { debug() {}, warn() {}, info() {}, error() {} },
}

const hostModule = await import(HOST + '?v050=1')
const host = hostModule.createTempSessionHost(hostCtx)
host.register(hostCtx)

async function call(p, init) {
  const route = routes.get(String(p).split('?')[0])
  if (!route) throw new Error('no route for ' + p)
  const res = await route.fetch(new Request('http://dsh.invalid' + p, init))
  return res.json()
}

function trashDirs() {
  try {
    return fs.readdirSync(TRASH, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch (error) { void error; return [] }
}
function entryOf(id) {
  return trashDirs().filter((name) => name.endsWith('-' + id))[0] || ''
}

try {
  // ---- A1. a session larger than the byte cap stays recoverable ----------
  const BIG = 'session-050-big'
  seed(BIG, 210 * 1024 * 1024)
  await call('/api/dsh-temp-session.track?sessionId=' + BIG, { method: 'POST' })
  const purgedBig = await call('/api/dsh-temp-session.purge', { method: 'POST' })
  const bigEntry = entryOf(BIG)
  check('A1: a 210MB session is still reported as removed', purgedBig.removed === 1, purgedBig)
  check('A1: it is in the trash instead of being deleted outright', bigEntry.length > 0, trashDirs())
  const afterBig = await call('/api/dsh-temp-session.trash')
  check('A1: the trash route lists it', (afterBig.entries || []).some((e) => e.id === BIG), afterBig.entries)
  check('A1: its transcript is readable from the entry',
    !!bigEntry && fs.existsSync(path.join(TRASH, bigEntry, 'data', 'session.jsonl')))
  check('A1: the entry records its size in bytes',
    !!bigEntry && Number(JSON.parse(fs.readFileSync(path.join(TRASH, bigEntry, 'meta.json'), 'utf8')).bytes) === 210 * 1024 * 1024)

  await call('/api/dsh-temp-session.trash-empty', { method: 'POST' })

  // ---- A2. the size is cached, so listing does not re-walk the data ------
  const CACHED = 'session-050-cached'
  seed(CACHED, 1024)
  await call('/api/dsh-temp-session.track?sessionId=' + CACHED, { method: 'POST' })
  await call('/api/dsh-temp-session.purge', { method: 'POST' })
  const cachedEntry = entryOf(CACHED)
  const parkedBytes = cachedEntry
    ? Number(JSON.parse(fs.readFileSync(path.join(TRASH, cachedEntry, 'meta.json'), 'utf8')).bytes)
    : -1
  // Grow the parked payload. If the listing walked the data it would report the
  // new size; a cached size proves the walk was skipped.
  if (cachedEntry) {
    const payload = path.join(TRASH, cachedEntry, 'data', 'later.bin')
    fs.writeFileSync(payload, 'x')
    fs.truncateSync(payload, 40 * 1024 * 1024)
  }
  const cachedList = await call('/api/dsh-temp-session.trash')
  const cachedRow = (cachedList.entries || []).filter((e) => e.id === CACHED)[0]
  check('A2: the parked entry records a size', parkedBytes >= 1024, parkedBytes)
  check('A2: listing reports the cached size, not a fresh walk',
    !!cachedRow && cachedRow.bytes === parkedBytes, cachedRow)

  await call('/api/dsh-temp-session.trash-empty', { method: 'POST' })

  // ---- A3. one batch delete prunes once, not once per session -----------
  const beforePrunes = (await call('/api/dsh-temp-session.status')).trash.prunes
  for (let i = 0; i < 3; i += 1) {
    seed('session-050-batch-' + i)
    await call('/api/dsh-temp-session.track?sessionId=session-050-batch-' + i, { method: 'POST' })
  }
  await call('/api/dsh-temp-session.purge', { method: 'POST' })
  const afterPrunes = (await call('/api/dsh-temp-session.status')).trash.prunes
  check('A3: 3 sessions in one purge cost exactly one retention pass',
    afterPrunes - beforePrunes === 1, { beforePrunes, afterPrunes })
  check('A3: all three are parked', trashDirs().length === 3, trashDirs())

  // ---- A4. the entry cap still trims the oldest -------------------------
  await call('/api/dsh-temp-session.trash-empty', { method: 'POST' })
  for (let i = 0; i < 25; i += 1) {
    seed('session-050-cap-' + i)
    await call('/api/dsh-temp-session.track?sessionId=session-050-cap-' + i, { method: 'POST' })
  }
  await call('/api/dsh-temp-session.purge', { method: 'POST' })
  const capped = trashDirs()
  check('A4: 25 deletions leave 20 entries', capped.length === 20, capped.length)
  check('A4: the oldest ones are the ones dropped',
    !capped.some((name) => name.endsWith('-session-050-cap-0')) &&
    capped.some((name) => name.endsWith('-session-050-cap-24')),
    capped)

  // ---- A5. emptying reports what it could not remove --------------------
  const emptied = await call('/api/dsh-temp-session.trash-empty', { method: 'POST' })
  check('A5: empty reports removed and failed separately',
    emptied.ok === true && emptied.removed === 20 && emptied.failed === 0, emptied)

  // ---- A6. the trash route sees a hand-edited config file ---------------
  fs.writeFileSync(CONFIG, [
    'DELETE_ON_EXIT=on',
    'SCHEDULE_DELETE=off',
    'MAX_KEPT=200',
    'KEEP_DELETED=off',
    'KEEP_DELETED_DAYS=3',
    '',
  ].join('\n'), 'utf8')
  const offList = await call('/api/dsh-temp-session.trash')
  check('A6: hand-editing KEEP_DELETED=off is reflected without a restart',
    offList.keepDeleted === false && offList.keepDeletedDays === 3, offList)
} finally {
  process.removeAllListeners('exit')
  try { fs.rmSync(HOME, { recursive: true, force: true }) }
  catch (error) { console.error('CLEANUP_FAIL ' + HOME + ' ' + error.code + ' ' + error.message) }
}

// ---------------------------------------------------------------------------
// Part B — client half
// ---------------------------------------------------------------------------
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

const STATUS = {
  ok: true,
  env: { plugin: '0.8.1', dshClient: '0.2.2-rc.5', node: '24.9.0', platform: 'win32' },
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
const TRASH_ENTRIES = [
  { key: '1700000000000-session-050-alpha', id: 'session-050-alpha', workspace: '--proj--', deletedAt: '2026-11-20T00:00:00.000Z', bytes: 2048 },
  { key: '1700000000001-session-050-beta', id: 'session-050-beta', workspace: '--proj--', deletedAt: '2026-11-20T00:01:00.000Z', bytes: 4096 },
]

function mountDetail(options) {
  const opts = options || {}
  const trashBody = opts.trashBody === undefined
    ? { ok: true, keepDeleted: true, keepDeletedDays: 7, entries: TRASH_ENTRIES }
    : opts.trashBody
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
    const body = (function () {
      if (name === 'status') return STATUS
      if (name === 'config') return POLICY
      if (name === 'trash') return trashBody
      if (name === 'list') return { ok: true, ids: [], count: 0 }
      if (name === 'trash-delete' || name === 'trash-restore') return { ok: true }
      if (name === 'trash-empty') return { ok: true, removed: 2, failed: 0 }
      return { ok: true }
    })()
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
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
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
    requests, configEntry, effects,
    reset() { stateIdx = 0 },
    render() { stateIdx = 0; return configEntry.component() },
  }
}

function trashSection(tree) {
  return findAll(tree, (n) => !!(n.props && n.props['data-dsbs-trash']))[0] || null
}
function buttonWithText(tree, text) {
  return findAll(tree, (n) => n.type === 'button' && textOf(n).indexOf(text) >= 0)[0] || null
}

async function main() {
  // ---- B0. source guards -------------------------------------------------
  // Only the user-facing hint matters; the implementation comments are allowed
  // to describe the concept with the same words.
  const hintLines = SRC.split('\n').filter((line) => line.indexOf("'temp.menu.delete.hint':") >= 0)
  check('source: the row-menu hint no longer promises the data is gone',
    hintLines.length === 2 &&
    hintLines.every((line) => line.indexOf('无法恢复') < 0 && line.indexOf('cannot be undone') < 0) &&
    hintLines.every((line) => line.indexOf('回收站') >= 0 || line.indexOf('trash') >= 0),
    hintLines)
  check('source: the delete toast says the session moved to the trash',
    SRC.includes("'temp.menu.deleted': '临时会话已移到最近删除。'"))
  check('source: cleanup copy distinguishes "moved to trash" from "removed"',
    SRC.includes("'options.purgedTrash':"))
  check('source: the health badge verifies the trash routes too',
    SRC.includes("'trash', 'trash-restore', 'trash-delete', 'trash-empty',"))

  // ---- B1. two-step confirm on "delete for good" ------------------------
  const view = mountDetail()
  view.render()
  for (const fn of view.effects.splice(0)) fn()
  await settle(); await tick()
  let tree = view.render()
  let section = trashSection(tree)
  check('B1: the section renders with entries', !!section && textOf(section).indexOf('session-050-alpha') >= 0)

  let destroy = buttonWithText(section, '彻底删除')
  check('B1: a "delete for good" button exists', !!destroy)
  const beforeClicks = view.requests.filter((r) => r.method === 'POST').length
  destroy.props.onClick()
  await settle(); await tick()
  check('B1: the first click issues no destructive request',
    view.requests.filter((r) => r.method === 'POST').length === beforeClicks, view.requests.filter((r) => r.method === 'POST'))

  tree = view.render()
  section = trashSection(tree)
  const armed = buttonWithText(section, '确认彻底删除')
  check('B1: the button asks again instead', !!armed)
  if (armed) armed.props.onClick()
  await settle(); await tick()
  const deleteCalls = view.requests.filter((r) => r.method === 'POST' && r.url.indexOf('trash-delete') >= 0)
  check('B1: the second click sends exactly one delete', deleteCalls.length === 1, deleteCalls)
  check('B1: it carries the entry key', deleteCalls.length === 1 && deleteCalls[0].url.indexOf('session-050-alpha') >= 0,
    deleteCalls[0] && deleteCalls[0].url)

  // ---- B2. empty asks twice too -----------------------------------------
  const view2 = mountDetail()
  view2.render()
  for (const fn of view2.effects.splice(0)) fn()
  await settle(); await tick()
  let tree2 = view2.render()
  let empty = buttonWithText(trashSection(tree2), '清空')
  check('B2: an "empty" button exists', !!empty)
  if (empty) empty.props.onClick()
  await settle(); await tick()
  check('B2: the first click issues no request',
    view2.requests.filter((r) => r.method === 'POST').length === 0, view2.requests)
  const armedEmpty = buttonWithText(trashSection(view2.render()), '确认清空')
  check('B2: it asks again instead', !!armedEmpty)
  if (armedEmpty) armedEmpty.props.onClick()
  await settle(); await tick()
  check('B2: the second click empties the trash',
    view2.requests.filter((r) => r.method === 'POST' && r.url.indexOf('trash-empty') >= 0).length === 1,
    view2.requests.filter((r) => r.method === 'POST'))

  // ---- B3. entries stay reachable when keep-deleted is off --------------
  const offView = mountDetail({
    trashBody: { ok: true, keepDeleted: false, keepDeletedDays: 7, entries: TRASH_ENTRIES },
  })
  offView.render()
  for (const fn of offView.effects.splice(0)) fn()
  await settle(); await tick()
  const offSection = trashSection(offView.render())
  const offText = textOf(offSection)
  check('B3: switching keep-deleted off still lists the stranded entries',
    offText.indexOf('session-050-alpha') >= 0, offText.slice(0, 160))
  check('B3: and still offers a way to empty them',
    !!buttonWithText(offSection, '清空'),
    offText.slice(0, 160))
  check('B3: while saying future deletions are permanent',
    offText.indexOf('之后删除即彻底移除') >= 0, offText.slice(0, 200))

  // ---- B4. toggling keep-deleted refreshes the section immediately ------
  const liveView = mountDetail()
  liveView.render()
  for (const fn of liveView.effects.splice(0)) fn()
  await settle(); await tick()
  const liveTree = liveView.render()
  const keepRow = findAll(liveTree, (n) => Array.isArray(n.children) &&
    n.children.some((c) => textOf(c).indexOf('删除后保留') >= 0) &&
    n.children.some((c) => !!c && c.type === 'button'))[0]
  check('B4: the keep-deleted switch row exists', !!keepRow)
  if (keepRow) {
    const trashGetsBefore = liveView.requests.filter((r) => r.method === 'GET' && r.url.indexOf('dsh-temp-session.trash') >= 0).length
    const toggle = keepRow.children.filter((c) => !!c && c.type === 'button')[0]
    toggle.props.onClick()
    await settle(); await tick()
    const configPost = liveView.requests.filter((r) => r.method === 'POST' && r.url.indexOf('dsh-temp-session.config') >= 0)[0]
    check('B4: the switch posts keepDeleted=false',
      !!configPost && configPost.body.indexOf('"keepDeleted":false') >= 0, configPost)
    const trashGetsAfter = liveView.requests.filter((r) => r.method === 'GET' && r.url.indexOf('dsh-temp-session.trash') >= 0).length
    check('B4: and re-reads the trash so the section cannot show the old policy',
      trashGetsAfter > trashGetsBefore, { trashGetsBefore, trashGetsAfter })
  }
}

try {
  await main()
} catch (error) {
  fail += 1
  console.log('FAIL  harness crashed: ' + (error && error.stack ? error.stack : error))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
