// dsh-sidebar-suite 0.8.5 — quick wins: keep-all, cleanup visibility, and
// abortable temp calls.
//
// Part A drives the REAL Host half: /keep-all promotes the whole list in one
// store write and leaves the directories alone.
// Part B mounts the real client bundle against the shared DOM stub: the
// detail page renders the keep-all button and the two cleanup-info lines the
// status payload always carried, and a manual purge immediately updates the
// "last cleanup" line. The abort hardening is a source guard (the stub fetch
// ignores init).
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { buildSidebar, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const CLIENT = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')
const HOST = ROOT + '/lib/temp-session-host.mjs'

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  →  ' + extra : '')) }
}
const settle = () => new Promise((r) => setTimeout(r, 0))
const tick = () => new Promise((r) => setTimeout(r, 20))

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

// ---- Part A: the Host half keeps everything in one call -------------------
{
  const HOME = fs.mkdtempSync(path.join(tmpdir(), 'dsbs-057-'))
  process.env.DSH_HOME = HOME
  try {
  const seedSession = (id) => {
    const dir = path.join(HOME, 'sessions', '--proj--', id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), 'x')
    fs.mkdirSync(path.join(HOME, 'storages', 'session_projcache', 'sessions'), { recursive: true })
    fs.writeFileSync(path.join(HOME, 'storages', 'session_projcache', 'sessions', 'session-' + id + '.json'), '{}')
    return dir
  }
  const routes = new Map()
  const hostCtx = {
    connection: { fetch: { register(route) { routes.set(route.path, route); return async () => routes.delete(route.path) } } },
    get(name) { return name === 'connection' ? hostCtx.connection : undefined },
  }
  const { createTempSessionHost } = await import(pathToFileURL(HOST).href)
  const host = createTempSessionHost(hostCtx)
  host.register(hostCtx)
  const call = async (p, init) => {
    const route = routes.get(String(p).split('?')[0])
    if (!route) throw new Error('no route for ' + p)
    const res = await route.fetch(new Request('http://dsh.invalid' + p, init))
    return res.json()
  }
  const ID1 = '35711111111111111111111111111111'
  const ID2 = '35722222222222222222222222222222'
  const dir1 = seedSession(ID1)
  const dir2 = seedSession(ID2)
  await call('/api/dsh-temp-session.track?sessionId=' + ID1, { method: 'POST' })
  await call('/api/dsh-temp-session.track?sessionId=' + ID2, { method: 'POST' })

  const empty = await call('/api/dsh-temp-session.untrack?sessionId=' + ID2, { method: 'POST' })
  await call('/api/dsh-temp-session.track?sessionId=' + ID2, { method: 'POST' })
  void empty
  const kept = await call('/api/dsh-temp-session.keep-all', { method: 'POST' })
  check('host: keep-all reports how many it promoted', kept.ok === true && kept.kept === 2, JSON.stringify(kept))
  check('host: keep-all empties the tracking store',
    (await call('/api/dsh-temp-session.list')).count === 0)
  check('host: keep-all is keep, not delete — directories survive',
    fs.existsSync(dir1) && fs.existsSync(dir2))
  const again = await call('/api/dsh-temp-session.keep-all', { method: 'POST' })
  check('host: a second keep-all is an idempotent no-op',
    again.ok === true && again.kept === 0, JSON.stringify(again))
  const store = JSON.parse(fs.readFileSync(path.join(HOME, 'dsh-sidebar-suite', 'temp-sessions.json'), 'utf8'))
  check('host: the store file reflects the emptied list', Array.isArray(store.sessions) && store.sessions.length === 0)
  } finally {
    process.removeAllListeners('exit')
    try { fs.rmSync(HOME, { recursive: true, force: true }) }
    catch (error) { console.error('CLEANUP_FAIL ' + HOME + ' ' + error.code + ' ' + error.message) }
  }
}

// ---- Part B: the client half ----------------------------------------------

const NOW = Date.now()
const LAST_PURGE = {
  reason: 'process-exit',
  at: new Date(NOW - 3600 * 1000).toISOString(),
  tried: 3, removed: 2, zombies: 1, hidden: 0, skipped: 0, failed: [],
}
const SCHEDULE = {
  enabled: true, at: '03:00',
  nextRunAt: new Date(NOW + 24 * 3600 * 1000).toISOString(),
  lastRunAt: null, retryAt: null, managed: true,
}
const CONFIG_BODY = JSON.stringify({
  ok: true,
  showButton: true, inChatMode: 'hide', buttonStyle: 'pair',
  expandAllSessions: true, rowMenu: true,
  deleteOnExit: true, scheduleDelete: true, scheduleTime: '03:00',
  maxKept: 20, keepDeleted: true, keepDeletedDays: 7,
  configRevision: 5,
  configFile: 'C:/Users/x/.dsh/dsh-sidebar-suite/temp-session-config.txt',
})
const STATUS_BODY = JSON.stringify({
  ok: true,
  env: { plugin: '0.8.5', dshClient: '0.2.2-rc.5', node: '24.9.0', platform: 'win32' },
  routes: { registered: 14, errors: [], paths: [
    '/api/dsh-temp-session.status', '/api/dsh-temp-session.list', '/api/dsh-temp-session.config',
    '/api/dsh-temp-session.track', '/api/dsh-temp-session.untrack', '/api/dsh-temp-session.keep-all',
    '/api/dsh-temp-session.remove', '/api/dsh-temp-session.purge', '/api/dsh-temp-session.probe',
    '/api/dsh-temp-session.paths', '/api/dsh-temp-session.trash', '/api/dsh-temp-session.trash-restore',
    '/api/dsh-temp-session.trash-delete', '/api/dsh-temp-session.trash-empty',
  ] },
  tempCount: 2, deleteOnExit: true,
  lastPurge: LAST_PURGE,
  schedule: SCHEDULE,
})
const ROWS = [{ id: 'session-abc123', title: '帮我审阅插件' }]

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

  const storage = new Map()
  class MutationObserverStub {
    constructor(cb) { this.cb = cb }
    observe() {}
    disconnect() {}
    takeRecords() { return [] }
  }
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }
  let stateIdx = 0
  const stateOverrides = []
  const effects = []
  const calls = []
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
  const host = {
    __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
    getComputedStyle: () => ({ position: 'static', display: 'block' }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    open() { return null },
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
  }
  const reply = (body, status) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json' },
  })
  let trackedRows = ROWS.map((entry) => ({ id: entry.id, title: entry.title }))
  const fetchStub = async (input, init) => {
    const url = String(input && input.url ? input.url : input)
    const method = String((init && init.method) || 'GET').toUpperCase()
    calls.push({ url: url, method: method, body: init && init.body ? String(init.body) : '' })
    const routePath = url.replace(/^https?:\/\/[^/]+\/?/, '')
    if (routePath.indexOf('dsh-temp-session.config') >= 0) {
      if (method === 'POST') {
        const patch = {}
        try { Object.assign(patch, JSON.parse((init && init.body) || '{}')) } catch (error) { void error }
        return reply(Object.assign(JSON.parse(CONFIG_BODY), patch, {
          ok: true, schedule: SCHEDULE,
        }))
      }
      return reply(CONFIG_BODY)
    }
    if (routePath.indexOf('dsh-temp-session.status') >= 0) return reply(STATUS_BODY)
    if (routePath.indexOf('dsh-temp-session.list') >= 0) {
      const titled = url.indexOf('titles=1') >= 0
      return reply({
        ok: true,
        ids: trackedRows.map((e) => e.id),
        count: trackedRows.length,
        maxKept: 20,
        entries: titled ? trackedRows : undefined,
      })
    }
    if (routePath.indexOf('dsh-temp-session.keep-all') >= 0) {
      const n = trackedRows.length
      trackedRows = []
      return reply({ ok: true, kept: n, ids: [], count: 0 })
    }
    if (routePath.indexOf('dsh-temp-session.purge') >= 0) {
      trackedRows = []
      return reply(Object.assign({ ok: true }, LAST_PURGE, {
        reason: 'manual', at: new Date(Date.now()).toISOString(),
      }))
    }
    if (routePath.indexOf('dsh-temp-session.untrack') >= 0 || routePath.indexOf('dsh-temp-session.remove') >= 0) {
      trackedRows = []
      return reply({ ok: true, ids: [], count: 0 })
    }
    if (routePath.indexOf('dsh-temp-session.trash') >= 0) {
      return reply({ ok: true, keepDeleted: true, keepDeletedDays: 7, caps: { entries: 20, bytes: 200 * 1024 * 1024 }, totalBytes: 0, entries: [] })
    }
    return reply({ ok: true })
  }
  const sandbox = {
    window: host,
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
    MutationObserver: MutationObserverStub,
    ResizeObserver: ResizeObserverStub,
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
  vm.runInContext(CLIENT, sandbox, { filename: 'client.js' })

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
    doc, configEntry, stateOverrides, effects, calls,
    resetStateIdx() { stateIdx = 0 },
  }
}

async function main() {
  // ---- source guards ------------------------------------------------------
  check('source: the timeout watchdog aborts the underlying fetch',
    CLIENT.includes('controller = new AbortController()') &&
    CLIENT.includes('controller.abort()') &&
    CLIENT.includes('init.signal = controller.signal'))
  check('source: keep-all is a required health route',
    CLIENT.includes("'untrack', 'keep-all',"))

  // ---- detail page: keep-all + cleanup info -------------------------------
  const m = mountDetail()
  const Component = m.configEntry.component
  Component()
  for (const fn of m.effects.splice(0)) fn()
  await settle(); await tick()
  m.resetStateIdx()
  const rendered = Component()
  const flat = JSON.stringify(rendered)

  const keepAllButton = findAll(rendered, (n) => !!(n.props && n.props['data-dsbs-keep-all'] !== undefined))[0]
  check('detail: the keep-all button renders beside the section title', !!keepAllButton)
  check('detail: the keep-all button is labelled bilingually',
    !!keepAllButton && String(keepAllButton.children[0]).indexOf('全部保留') === 0)

  const lastPurgeLine = findAll(rendered, (n) => !!(n.props && n.props['data-dsbs-last-purge'] !== undefined))[0]
  check('detail: the last-cleanup line renders', !!lastPurgeLine)
  if (lastPurgeLine) {
    const text = String(lastPurgeLine.children[0])
    check('detail: the last-cleanup line sums removed + zombies', text.includes('3/3'), text)
    check('detail: the last-cleanup line names the reason', text.includes('process-exit'), text)
  }
  const nextRunLine = findAll(rendered, (n) => !!(n.props && n.props['data-dsbs-next-run'] !== undefined))[0]
  check('detail: the next-run line renders', !!nextRunLine)
  if (nextRunLine) {
    const text = String(nextRunLine.children[0])
    check('detail: the next-run line shows the scheduled target when enabled',
      text.indexOf('下次定时清理') === 0 && !text.endsWith('off'), text)
  }

  // ---- keep-all action (PD-13: two-step confirm) --------------------------
  if (keepAllButton) {
    keepAllButton.props.onClick()
    await settle(); await tick()
    check('detail: first click only arms the keep-all button, no POST yet',
      !m.calls.some((c) => c.method === 'POST' && c.url.indexOf('dsh-temp-session.keep-all') >= 0))
    m.resetStateIdx()
    const armedButton = findAll(Component(), (n) => !!(n.props && n.props['data-dsbs-keep-all'] !== undefined))[0]
    check('detail: armed button shows the click-again confirm hint',
      !!armedButton && String(armedButton.children[0]).indexOf('再点一次') === 0,
      armedButton && String(armedButton.children[0]))
    armedButton.props.onClick()
    await settle(); await tick()
    check('detail: second click POSTs the dedicated route',
      m.calls.some((c) => c.method === 'POST' && c.url.indexOf('dsh-temp-session.keep-all') >= 0))
    m.resetStateIdx()
    const after = JSON.stringify(Component())
    check('detail: the emptied list shows the none-message', after.includes('现在没有临时会话'))
    check('detail: the keep-all result is stated',
      m.stateOverrides.some((v) => typeof v === 'string' && v.indexOf('已全部保留') === 0))
    check('detail: no TEMP rows remain in the sidebar',
      !m.doc.querySelector('[data-dsbs-temp-row]'))
    check('detail: the keep-all button retires on an empty list',
      !findAll(Component(), (n) => !!(n.props && n.props['data-dsbs-keep-all'] !== undefined)).length)
  }

  // ---- a manual purge immediately updates the last-cleanup line -----------
  m.resetStateIdx()
  const rendered2 = Component()
  const purgeButton = findAll(rendered2, (n) => n.type === 'button' &&
    String(JSON.stringify(n.children)).indexOf('立即清理临时会话') >= 0)[0]
  check('detail: the manual purge button exists', !!purgeButton)
  if (purgeButton) {
    purgeButton.props.onClick()
    await settle(); await tick()
    m.resetStateIdx()
    const line = findAll(Component(), (n) => !!(n.props && n.props['data-dsbs-last-purge'] !== undefined))[0]
    check('detail: the purge report reaches the last-cleanup line immediately',
      !!line && String(line.children[0]).includes('manual'), line && String(line.children[0]))
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
