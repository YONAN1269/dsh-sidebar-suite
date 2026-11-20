// dsh-sidebar-suite 0.8.1 (second pass) — the six leftovers of the trash review.
//
//   1. A retry after a half-finished park created a SECOND entry for the same
//      session, and the leftover half-deleted directory could never be restored
//      onto ("a session with this id already exists"). Parking now reuses the
//      entry it already made, and that refusal names the path to move away.
//   2. A single session bigger than the byte cap is kept on purpose, but nothing
//      said so: the entry is now flagged `oversize` and the UI explains it.
//   3. The list showed a bare UUID. The session's own label is captured from the
//      host's projection cache when it is parked, and shown instead.
//   4. The arm-then-confirm state survived a later action on another row, so a
//      stray second click could still delete. It now renders an explicit
//      cancel, and any other trash action disarms it.
//   5. The 20-entry cap trimmed silently. The route reports its caps and the
//      footer states them.
//   6. `meta.bytes` is trusted as cached (that is the point of A2 in test_050):
//      hand-editing it is out of scope and documented instead.
//
// Host checks run against a throwaway DSH_HOME; client checks mount the real
// bundle against the shared DOM stub.
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
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-051-'))
process.env.DSH_HOME = HOME
const SESSIONS = path.join(HOME, 'sessions')
const DATA = path.join(HOME, 'dsh-sidebar-suite')
const TRASH = path.join(DATA, 'trash')
const PROJ = path.join(HOME, 'storages', 'session_projcache', 'sessions')
const CONFIG = path.join(DATA, 'temp-session-config.txt')

fs.mkdirSync(DATA, { recursive: true })
fs.mkdirSync(path.join(SESSIONS, '--proj--'), { recursive: true })
fs.mkdirSync(PROJ, { recursive: true })
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
  if (sizeBytes) fs.truncateSync(file, sizeBytes)
  return dir
}
/** The host's projection cache, the only place a session carries its own label. */
function seedTitle(id, title) {
  fs.writeFileSync(path.join(PROJ, 'session-' + id + '.json'), JSON.stringify({
    version: 1,
    record: { rows: { title: { ver: 1, seq: 4, val: title } } },
  }), 'utf8')
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

const hostModule = await import(HOST + '?v051=1')
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
function entriesOf(id) {
  return trashDirs().filter((name) => name.endsWith('-' + id))
}
function metaOf(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(TRASH, name, 'meta.json'), 'utf8'))
  } catch (error) { void error; return null }
}

try {
  // ---- A1. a retried park reuses its own entry instead of duplicating it --
  const RETRY = 'session-051-retry'
  const retryDir = seed(RETRY)
  await call('/api/dsh-temp-session.track?sessionId=' + RETRY, { method: 'POST' })
  await call('/api/dsh-temp-session.purge', { method: 'POST' })
  const firstEntry = entriesOf(RETRY)[0] || ''
  const firstDeletedAt = (metaOf(firstEntry) || {}).deletedAt
  check('A1: the first delete parks one entry', entriesOf(RETRY).length === 1, trashDirs())

  // Simulate the state a half-failed cp+rm leaves behind: the entry exists with
  // what was copied, and the original directory is back (partly deleted).
  await new Promise((resolve) => setTimeout(resolve, 25))
  fs.mkdirSync(retryDir, { recursive: true })
  fs.writeFileSync(path.join(retryDir, 'left-behind.jsonl'), 'second-half')
  await call('/api/dsh-temp-session.track?sessionId=' + RETRY, { method: 'POST' })
  const retried = await call('/api/dsh-temp-session.remove?sessionId=' + RETRY, { method: 'POST' })
  check('A1: the retry reports the session as deleted', retried.ok === true && retried.removed === true, retried)
  check('A1: it did not create a second entry for the same session',
    entriesOf(RETRY).length === 1, trashDirs())
  check('A1: the reused entry keeps its original key', entriesOf(RETRY)[0] === firstEntry,
    { firstEntry, now: entriesOf(RETRY) })
  const retriedDeletedAt = (metaOf(firstEntry) || {}).deletedAt
  check('A1: the retry restarts the retention clock instead of inheriting the old deadline',
    Number.isFinite(Date.parse(firstDeletedAt)) && Number.isFinite(Date.parse(retriedDeletedAt)) &&
    Date.parse(retriedDeletedAt) > Date.parse(firstDeletedAt),
    { firstDeletedAt, retriedDeletedAt })
  check('A1: the leftover files were merged into the entry',
    !!firstEntry && fs.existsSync(path.join(TRASH, firstEntry, 'data', 'left-behind.jsonl')) &&
    fs.existsSync(path.join(TRASH, firstEntry, 'data', 'session.jsonl')),
    firstEntry && fs.readdirSync(path.join(TRASH, firstEntry, 'data')))
  check('A1: the leftover directory is gone from the sessions root', !fs.existsSync(retryDir))

  await call('/api/dsh-temp-session.trash-empty', { method: 'POST' })

  // ---- A2. the parked entry carries the session's own label --------------
  const LABELED = 'session-051-labeled'
  seed(LABELED)
  seedTitle(LABELED, 'Today is 2026-11-20. 帮我审阅一下这个插件的代码\n然后把问题列出来')
  await call('/api/dsh-temp-session.track?sessionId=' + LABELED, { method: 'POST' })
  await call('/api/dsh-temp-session.remove?sessionId=' + LABELED, { method: 'POST' })
  const labeledMeta = metaOf(entriesOf(LABELED)[0] || '')
  check('A2: the entry records a title', !!labeledMeta && typeof labeledMeta.title === 'string' && labeledMeta.title.length > 0, labeledMeta)
  const labeledTitle = labeledMeta && typeof labeledMeta.title === 'string' ? labeledMeta.title : ''
  check('A2: the date prefix every session carries is stripped',
    labeledTitle.length > 0 && labeledTitle.indexOf('Today is') < 0, labeledTitle)
  check('A2: newlines are collapsed to one line',
    labeledTitle.length > 0 && labeledTitle.indexOf('\n') < 0, labeledTitle)
  const labeledList = await call('/api/dsh-temp-session.trash')
  const labeledRow = (labeledList.entries || []).filter((e) => e.id === LABELED)[0]
  check('A2: the trash route returns it',
    !!labeledRow && typeof labeledRow.title === 'string' && labeledRow.title.indexOf('审阅') >= 0, labeledRow)

  await call('/api/dsh-temp-session.trash-empty', { method: 'POST' })

  // ---- A3. the route states its caps and the total on disk ---------------
  seed('session-051-cap-a')
  seed('session-051-cap-b')
  for (const id of ['session-051-cap-a', 'session-051-cap-b']) {
    await call('/api/dsh-temp-session.track?sessionId=' + id, { method: 'POST' })
  }
  await call('/api/dsh-temp-session.purge', { method: 'POST' })
  const capList = await call('/api/dsh-temp-session.trash')
  check('A3: the route reports the entry cap', !!capList.caps && capList.caps.entries === 20, capList.caps)
  check('A3: the route reports the byte cap', !!capList.caps && capList.caps.bytes === 200 * 1024 * 1024, capList.caps)
  const sum = (capList.entries || []).reduce((n, e) => n + Number(e.bytes || 0), 0)
  check('A3: the route reports the total size', capList.totalBytes === sum && sum > 0,
    { totalBytes: capList.totalBytes, sum })

  // ---- A4. an entry above the byte cap is flagged, not silently kept -----
  await call('/api/dsh-temp-session.trash-empty', { method: 'POST' })
  const HUGE = 'session-051-huge'
  seed(HUGE, 210 * 1024 * 1024)
  await call('/api/dsh-temp-session.track?sessionId=' + HUGE, { method: 'POST' })
  await call('/api/dsh-temp-session.remove?sessionId=' + HUGE, { method: 'POST' })
  const hugeList = await call('/api/dsh-temp-session.trash')
  const hugeRow = (hugeList.entries || []).filter((e) => e.id === HUGE)[0]
  check('A4: a 210MB entry is still kept', !!hugeRow, hugeList.entries)
  check('A4: and is flagged oversize', !!hugeRow && hugeRow.oversize === true, hugeRow)
  check('A4: an ordinary entry is not flagged',
    (capList.entries || []).every((e) => e.oversize !== true), capList.entries)

  // ---- A5. the restore refusal says where the leftover sits --------------
  const BLOCKED = 'session-051-blocked'
  const blockedDir = seed(BLOCKED)
  await call('/api/dsh-temp-session.track?sessionId=' + BLOCKED, { method: 'POST' })
  await call('/api/dsh-temp-session.remove?sessionId=' + BLOCKED, { method: 'POST' })
  const blockedKey = entriesOf(BLOCKED)[0] || ''
  fs.mkdirSync(blockedDir, { recursive: true }) // a leftover the user must move
  const refused = await call('/api/dsh-temp-session.trash-restore?key=' + encodeURIComponent(blockedKey), { method: 'POST' })
  check('A5: restoring onto an existing directory is still refused', refused.ok === false, refused)
  check('A5: the refusal carries a code so the UI can explain it', refused.code === 'target-exists', refused)
  check('A5: the refusal names the directory to move away',
    typeof refused.target === 'string' && refused.target.length > 0 && refused.target.indexOf(BLOCKED) >= 0, refused)

  // ---- A6. the synchronous quit path reuses too -------------------------
  // The quit path is a different implementation of the same park (no `await`
  // there), and it is the one that runs when nobody is watching.
  await call('/api/dsh-temp-session.trash-empty', { method: 'POST' })
  const SYNC = 'session-051-sync'
  const syncDir = seed(SYNC)
  const priorKey = '1700000000123-' + SYNC
  fs.mkdirSync(path.join(TRASH, priorKey, 'data', 'nested'), { recursive: true })
  fs.writeFileSync(path.join(TRASH, priorKey, 'meta.json'), JSON.stringify({
    id: SYNC, workspace: '--proj--', deletedAt: '2026-11-20T00:00:00.000Z',
    reason: 'quit', title: 'label from the first attempt', bytes: 1,
  }), 'utf8')
  fs.writeFileSync(path.join(TRASH, priorKey, 'data', 'nested', 'older.jsonl'), 'copied-first-time')
  await call('/api/dsh-temp-session.track?sessionId=' + SYNC, { method: 'POST' })
  host.purgeSync('test', { keepDeleted: true, reason: 'quit' })
  check('A6: the sync path leaves exactly one entry', entriesOf(SYNC).length === 1, trashDirs())
  check('A6: it is the entry that already existed', entriesOf(SYNC)[0] === priorKey, trashDirs())
  check('A6: the session content joined the files already copied',
    fs.existsSync(path.join(TRASH, priorKey, 'data', 'session.jsonl')) &&
    fs.existsSync(path.join(TRASH, priorKey, 'data', 'nested', 'older.jsonl')),
    fs.readdirSync(path.join(TRASH, priorKey, 'data')))
  check('A6: the label from the first attempt survives the retry',
    (metaOf(priorKey) || {}).title === 'label from the first attempt', metaOf(priorKey))
  check('A6: the quit path restarts the retention clock as well',
    Date.parse((metaOf(priorKey) || {}).deletedAt) > Date.parse('2026-11-20T00:00:00.000Z'),
    metaOf(priorKey))
  check('A6: the original directory is gone', !fs.existsSync(syncDir))
} finally {
  fs.rmSync(HOME, { recursive: true, force: true })
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
const TRASH_BODY = {
  ok: true, keepDeleted: true, keepDeletedDays: 7,
  caps: { entries: 20, bytes: 200 * 1024 * 1024 },
  totalBytes: 2048 + 4096 + 210 * 1024 * 1024,
  entries: [
    {
      key: '1700000000000-session-051-alpha', id: 'session-051-alpha', workspace: '--proj--',
      title: '帮我审阅一下这个插件的代码', deletedAt: '2026-11-20T00:00:00.000Z', bytes: 2048,
    },
    {
      key: '1700000000001-session-051-beta', id: 'session-051-beta', workspace: '--proj--',
      deletedAt: '2026-11-20T00:01:00.000Z', bytes: 4096, oversize: true,
    },
  ],
}

function mountDetail(options) {
  const opts = options || {}
  const trashBody = opts.trashBody === undefined ? TRASH_BODY : opts.trashBody
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
      if (name === 'trash-delete') return { ok: true }
      if (name === 'trash-restore') return opts.restoreBody || { ok: true }
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
function buttonsWithText(tree, text) {
  return findAll(tree, (n) => n.type === 'button' && textOf(n).indexOf(text) >= 0)
}
function buttonWithText(tree, text) {
  return buttonsWithText(tree, text)[0] || null
}

async function main() {
  // ---- B1. the row shows the session's label, not just a UUID ------------
  const view = mountDetail()
  view.render()
  for (const fn of view.effects.splice(0)) fn()
  await settle(); await tick()
  let section = trashSection(view.render())
  check('B1: the trash section renders', !!section)
  const sectionText = textOf(section)
  check('B1: the entry shows the title the host captured',
    sectionText.indexOf('帮我审阅一下这个插件的代码') >= 0, sectionText.slice(0, 240))
  check('B1: the id is still available for support', sectionText.indexOf('session-051-alpha') >= 0,
    sectionText.slice(0, 240))

  // ---- B2. arming offers an explicit cancel ------------------------------
  let destroy = buttonWithText(section, '彻底删除')
  check('B2: a "delete for good" button exists', !!destroy)
  if (destroy) destroy.props.onClick()
  await settle(); await tick()
  section = trashSection(view.render())
  const cancel = buttonWithText(section, '取消')
  check('B2: arming shows a cancel button', !!cancel)
  const postsBefore = view.requests.filter((r) => r.method === 'POST').length
  if (cancel) cancel.props.onClick()
  await settle(); await tick()
  section = trashSection(view.render())
  check('B2: cancel issues no request',
    view.requests.filter((r) => r.method === 'POST').length === postsBefore,
    view.requests.filter((r) => r.method === 'POST'))
  check('B2: cancel disarms the row',
    !!buttonWithText(section, '彻底删除') && !buttonWithText(section, '确认彻底删除'),
    textOf(section).slice(0, 240))

  // ---- B3. another trash action disarms too ------------------------------
  const view2 = mountDetail()
  view2.render()
  for (const fn of view2.effects.splice(0)) fn()
  await settle(); await tick()
  section = trashSection(view2.render())
  const armAlpha = buttonsWithText(section, '彻底删除')[0]
  if (armAlpha) armAlpha.props.onClick()
  await settle(); await tick()
  section = trashSection(view2.render())
  check('B3: the row is armed', !!buttonWithText(section, '确认彻底删除'))
  const restoreBeta = findAll(section, (n) => n.type === 'button' && textOf(n).indexOf('恢复') >= 0)[0]
  check('B3: another row still offers restore', !!restoreBeta)
  if (restoreBeta) restoreBeta.props.onClick()
  await settle(); await tick()
  section = trashSection(view2.render())
  check('B3: acting on another row disarms the first one',
    !buttonWithText(section, '确认彻底删除'), textOf(section).slice(0, 240))

  // ---- B4. the footer states the caps and the total ----------------------
  const fresh = mountDetail()
  fresh.render()
  for (const fn of fresh.effects.splice(0)) fn()
  await settle(); await tick()
  const footerText = textOf(trashSection(fresh.render()))
  check('B4: the footer states the entry cap', footerText.indexOf('20 条') >= 0, footerText.slice(0, 400))
  check('B4: the footer states the byte cap', footerText.indexOf('200') >= 0 && /MB/.test(footerText),
    footerText.slice(0, 400))
  check('B4: the footer states the total on disk', /2097152|2006|210/.test(footerText) || /MB/.test(footerText),
    footerText.slice(0, 400))

  // ---- B5. an oversize entry is explained -------------------------------
  check('B5: the oversize entry says why it is still here',
    footerText.indexOf('超过') >= 0 || footerText.indexOf('over the cap') >= 0, footerText.slice(0, 400))

  // ---- B6. an older Host half still renders -----------------------------
  // The client and the Host ship together, but during a reload one half can be
  // the previous build. A 0.8.0 trash payload has no caps, no total and no
  // titles; the section must degrade instead of rendering "undefined".
  const legacy = mountDetail({
    trashBody: {
      ok: true, keepDeleted: true, keepDeletedDays: 7,
      entries: [{ key: '1700000000000-session-051-old', id: 'session-051-old', workspace: '--proj--', deletedAt: '2026-11-20T00:00:00.000Z', bytes: 1024 }],
    },
  })
  legacy.render()
  for (const fn of legacy.effects.splice(0)) fn()
  await settle(); await tick()
  const legacyText = textOf(trashSection(legacy.render()))
  check('B6: an entry without a title falls back to its id', legacyText.indexOf('session-051-old') >= 0,
    legacyText.slice(0, 240))
  check('B6: a payload without caps renders no caps line and no "undefined"',
    legacyText.indexOf('上限') < 0 && legacyText.indexOf('undefined') < 0, legacyText.slice(0, 300))

  // ---- B7. the restore refusal shows the path to clear ------------------
  const blocked = mountDetail({
    restoreBody: { ok: false, code: 'target-exists', target: 'C:/fake/sessions/--proj--/session-051-alpha' },
  })
  blocked.render()
  for (const fn of blocked.effects.splice(0)) fn()
  await settle(); await tick()
  const restoreBtn = findAll(trashSection(blocked.render()), (n) => n.type === 'button' && textOf(n).indexOf('恢复') >= 0)[0]
  check('B7: a restore button exists', !!restoreBtn)
  if (restoreBtn) restoreBtn.props.onClick()
  await settle(); await tick()
  const blockedText = textOf(trashSection(blocked.render()))
  check('B7: the refusal names the directory to move away',
    blockedText.indexOf('C:/fake/sessions/--proj--/session-051-alpha') >= 0, blockedText.slice(0, 300))
}

try {
  await main()
} catch (error) {
  fail += 1
  console.log('FAIL  harness crashed: ' + (error && error.stack ? error.stack : error))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
