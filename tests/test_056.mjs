// dsh-sidebar-suite 0.8.4 — full-review pass: optimistic rollback, the active
// temp-session manager, the count tooltips and the copyable config path.
//
// Part A drives the REAL Host half against a throwaway DSH_HOME and asserts the
// `?titles=1` opt-in on the list route (bare shape unchanged for the sidebar).
// Part B mounts the real client bundle against the shared DOM stub and a
// recording React stub, then checks the behaviours this version promises:
// a rejected settings save rolls the optimistic value back, the detail page
// renders and drives the temp-session manager, the Temp button tooltip carries
// the live count, and the config path is a copy button.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { buildSidebar, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const CLIENT = ROOT + '/lib/client.js'
const HOST = ROOT + '/lib/temp-session-host.mjs'
const SRC = fs.readFileSync(CLIENT, 'utf8')

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

// ---- Part A: the Host half answers ?titles=1 ------------------------------
{
  const HOME = fs.mkdtempSync(path.join(tmpdir(), 'dsbs-056-'))
  process.env.DSH_HOME = HOME
  try {
  const seedSession = (id, title) => {
    const dir = path.join(HOME, 'sessions', '--proj--', id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), 'x')
    fs.mkdirSync(path.join(HOME, 'storages', 'session_projcache', 'sessions'), { recursive: true })
    const body = title
      ? JSON.stringify({ record: { rows: { title: { val: title } } } })
      : '{}'
    fs.writeFileSync(path.join(HOME, 'storages', 'session_projcache', 'sessions', 'session-' + id + '.json'), body)
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

  const ID1 = '15611111111111111111111111111111'
  const ID2 = '25622222222222222222222222222222'
  seedSession(ID1, '今天天气不错')
  seedSession(ID2, '') // a session without a usable projection title

  await call('/api/dsh-temp-session.track?sessionId=' + ID1, { method: 'POST' })
  await call('/api/dsh-temp-session.track?sessionId=' + ID2, { method: 'POST' })

  // A1: the bare shape the sidebar polls must not grow a per-entry payload.
  const bare = await call('/api/dsh-temp-session.list')
  check('host: bare list keeps ids/count and no entries', bare.ok === true &&
    Array.isArray(bare.ids) && bare.ids.length === 2 && bare.count === 2 && bare.entries === undefined,
    JSON.stringify(bare))

  // A2: the detail page's opt-in carries labels from the projection cache.
  const titled = await call('/api/dsh-temp-session.list?titles=1')
  check('host: ?titles=1 returns entries', titled.ok === true && Array.isArray(titled.entries) && titled.entries.length === 2,
    JSON.stringify(titled))
  const first = titled.entries.find((e) => e.id === ID1)
  const second = titled.entries.find((e) => e.id === ID2)
  check('host: the projected title is returned', !!first && first.title === '今天天气不错', first && first.title)
  check('host: a missing cache degrades to an empty title, not an error',
    !!second && second.title === '', second)
  check('host: ?titles=1 still returns the flat ids list', Array.isArray(titled.ids) && titled.ids.length === 2)
  check('host: ?titles=1 exposes maxKept for the cap line', titled.maxKept === 20, String(titled.maxKept))
  } finally {
    process.removeAllListeners('exit')
    try { fs.rmSync(HOME, { recursive: true, force: true }) }
    catch (error) { console.error('CLEANUP_FAIL ' + HOME + ' ' + error.code + ' ' + error.message) }
  }
}

// ---- Part B: the client half ----------------------------------------------

const CONFIG_BODY = JSON.stringify({
  ok: true,
  showButton: true, inChatMode: 'hide', buttonStyle: 'pair',
  expandAllSessions: true, rowMenu: true,
  deleteOnExit: true, scheduleDelete: false, scheduleTime: '03:00',
  maxKept: 20, keepDeleted: true, keepDeletedDays: 7,
  configRevision: 5,
  configFile: 'C:/Users/x/.dsh/dsh-sidebar-suite/temp-session-config.txt',
})
const STATUS_BODY = JSON.stringify({
  ok: true,
  env: { plugin: '0.8.4', dshClient: '0.2.2-rc.5', node: '24.9.0', platform: 'win32' },
  routes: { registered: 14, errors: [], paths: [
    '/api/dsh-temp-session.status', '/api/dsh-temp-session.list', '/api/dsh-temp-session.config',
    '/api/dsh-temp-session.track', '/api/dsh-temp-session.untrack', '/api/dsh-temp-session.keep-all', '/api/dsh-temp-session.remove',
    '/api/dsh-temp-session.purge', '/api/dsh-temp-session.probe', '/api/dsh-temp-session.paths',
    '/api/dsh-temp-session.trash', '/api/dsh-temp-session.trash-restore', '/api/dsh-temp-session.trash-delete',
    '/api/dsh-temp-session.trash-empty',
  ] },
  tempCount: 2,
  deleteOnExit: true,
})
const TEMP_LIST = [{ id: 'session-abc123', title: '帮忙写个正则' }]

function mountDetail(options) {
  const opts = options || {}
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
  let failNextConfigPost = false
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
  // The tracked list the list endpoints serve. untrack/remove empty it, so the
  // keep/delete flows can prove the section follows the host's answer.
  let trackedRows = TEMP_LIST.map((entry) => ({ id: entry.id, title: entry.title }))
  const fetchStub = async (input, init) => {
    const url = String(input && input.url ? input.url : input)
    const method = String((init && init.method) || 'GET').toUpperCase()
    calls.push({ url: url, method: method, body: init && init.body ? String(init.body) : '' })
    const routePath = url.replace(/^https?:\/\/[^/]+\/?/, '')
    if (routePath.indexOf('dsh-temp-session.config') >= 0) {
      if (method === 'POST') {
        if (failNextConfigPost) return reply({ ok: false, error: 'config write failed: boom' }, 500)
        const patch = {}
        try { Object.assign(patch, JSON.parse((init && init.body) || '{}')) } catch (error) { void error }
        return reply(Object.assign(JSON.parse(CONFIG_BODY), patch, { ok: true }))
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
    if (routePath.indexOf('dsh-temp-session.untrack') >= 0) {
      trackedRows = []
      return reply({ ok: true, ids: [], count: 0 })
    }
    if (routePath.indexOf('dsh-temp-session.remove') >= 0) {
      trackedRows = []
      return reply({ ok: true, removed: true, hidden: false, ids: [], count: 0 })
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
    doc, tree, configEntry, stateOverrides, effects, calls, ReactStub,
    setFailNextConfigPost(v) { failNextConfigPost = v },
    resetStateIdx() { stateIdx = 0 },
  }
}

async function main() {
  // ---- 0. source guards --------------------------------------------------
  check('source: the hard-coded CJK measure word is gone',
    !SRC.includes("' 条 · '") && SRC.includes("'trash.countUnit':"))
  check('source: the settings save can roll back its optimistic value',
    SRC.includes('function persist(patch)') && SRC.includes('var previous = policy') &&
    SRC.includes('setPolicy(previous)'))
  check('source: the dead data-dsbs-quick attribute is no longer written',
    !SRC.includes("setAttribute('data-dsbs-quick'"))
  check('source: the bar tooltip only carries the degraded-mode notice',
    SRC.includes('var localNotice = config.local ? t(\'bar.local\') : \'\''))
  check('source: the config poll re-reads the temp id list on a revision bump',
    SRC.includes('// 0.8.4: a revision bump usually means the plugin host came back'))
  check('source: the temp-session manager dictionary exists',
    SRC.includes("'tempList.title':") && SRC.includes("'tempList.keep':") && SRC.includes("'tempList.confirm':"))
  check('source: the config path is offered as a copy button',
    SRC.includes("'data-dsbs-config-path'") && SRC.includes("'options.copyPath':") &&
    SRC.includes('function copyConfigPath()'))
  check('source: the Temp tooltip count suffix exists',
    SRC.includes("'temp.countSuffix':") && SRC.includes('tempCountKnown >= 0'))

  // ---- 1. settings save failure rolls the optimistic value back ----------
  const m = mountDetail()
  const Component = m.configEntry.component
  Component() // register the useEffect bodies
  for (const fn of m.effects.splice(0)) fn()
  await settle(); await tick()

  const policyLoaded = m.stateOverrides.some((v) => !!v && typeof v === 'object' && v.deleteOnExit === true && v.maxKept === 20)
  check('detail: the policy payload reached component state', policyLoaded)

  // The onQuit row is h('div', {key: t('policy.onQuit')}, span, button).
  m.resetStateIdx()
  const onQuitRow = findAll(Component(), (n) => !!(n.props && n.props.key === '退出 DSH 时删除'))[0]
  check('detail: the delete-on-quit toggle row exists', !!onQuitRow)
  if (onQuitRow) {
    const toggle = findAll(onQuitRow, (n) => n.type === 'button')[0]
    check('detail: the toggle starts pressed', !!toggle && toggle.props['aria-pressed'] === 'true')
    m.setFailNextConfigPost(true)
    toggle.props.onClick()
    // Before the POST answers, the optimistic value must be visible.
    const optimistic = m.stateOverrides.some((v) => !!v && typeof v === 'object' && v.deleteOnExit === false)
    check('detail: the click applies optimistically first', optimistic)
    await settle(); await tick()
    // The rejected save must NOT leave the switch flipped.
    const rolledBack = m.stateOverrides.some((v) => !!v && typeof v === 'object' && v.deleteOnExit === true) &&
      !m.stateOverrides.some((v) => !!v && typeof v === 'object' && v.deleteOnExit === false)
    check('detail: a rejected save rolls the value back', rolledBack)
    check('detail: the failure is stated, not silent',
      m.stateOverrides.some((v) => typeof v === 'string' && v.indexOf('保存失败') === 0),
      JSON.stringify(m.stateOverrides.filter((v) => typeof v === 'string').slice(0, 4)))
    check('detail: the failing POST actually happened',
      m.calls.some((c) => c.method === 'POST' && c.url.indexOf('dsh-temp-session.config') >= 0))
  }

  // ---- 2. the active temp-session section renders and drives -------------
  m.resetStateIdx()
  let rendered = Component()
  const flat = JSON.stringify(rendered)
  check('detail: the temp-session section exists', flat.includes('当前临时会话'), flat.slice(0, 200))
  check('detail: the section explains the quit behaviour', flat.includes('tempList.help') || flat.includes('退出 DSH 时会被删除'))
  check('detail: the temp row shows the projected title', flat.includes('帮忙写个正则'))
  check('detail: the row falls back to the id for the meta line', flat.includes('session-abc123'))
  check('detail: keep and delete actions are present',
    flat.includes('保留为正式会话 / Keep') && flat.includes('立即删除 / Delete now'))
  check('detail: the count line shows 1 with the cap',
    flat.includes('共 / total: 1') && flat.includes('上限 / cap: 20'), '')
  check('detail: no bare CJK measure word reaches the page',
    !flat.includes(' 条 · '))

  // Keep action: POST untrack, the section reloads empty, the status line says so.
  const keepButton = findAll(rendered, (n) => n.type === 'button' && String(JSON.stringify(n.children)).indexOf('保留为正式会话') >= 0)[0]
  check('detail: the keep button is clickable', !!keepButton && typeof keepButton.props.onClick === 'function')
  if (keepButton) {
    keepButton.props.onClick()
    await settle(); await tick()
    check('detail: keep POSTs untrack',
      m.calls.some((c) => c.method === 'POST' && c.url.indexOf('dsh-temp-session.untrack') >= 0))
    m.resetStateIdx()
    rendered = Component()
    const afterKeep = JSON.stringify(rendered)
    check('detail: the kept session leaves the list', !afterKeep.includes('帮忙写个正则'))
    check('detail: the kept message is shown', afterKeep.includes('已保留为正式会话'))
    // With no rows left the section says so instead of printing a count line.
    check('detail: an emptied list shows the none-message', afterKeep.includes('现在没有临时会话'))
  }

  // ---- 3. the config path is a copy button -------------------------------
  m.resetStateIdx()
  rendered = Component()
  const pathButton = findAll(rendered, (n) => !!(n.props && n.props['data-dsbs-config-path'] !== undefined))[0]
  check('detail: the config path renders as a button', !!pathButton)
  if (pathButton) {
    check('detail: the path text is the config file', String(pathButton.children[0]) === 'C:/Users/x/.dsh/dsh-sidebar-suite/temp-session-config.txt')
    pathButton.props.onClick()
    await settle(); await tick()
    check('detail: clicking copies and flashes the confirmation',
      m.stateOverrides.some((v) => typeof v === 'string' && v.indexOf('路径已复制') === 0))
  }

  // ---- 4. the Temp button tooltip carries the live count ------------------
  // m has already kept its one session away (count 0); m2 is mounted below.
  const tempButton = m.doc.querySelector('[data-dsbs-btn="temp"]')
  check('sidebar: the Temp button is mounted', !!tempButton)
  if (tempButton) {
    // 0.8.11 — the zh dictionary now owns its count suffix; the old "N active"
    // half was English leaking into the Chinese UI.
    check('sidebar: the tooltip follows the actions (0 after keep)',
      String(tempButton.title || '').indexOf('0 个临时会话') >= 0 &&
      String(tempButton.title || '').indexOf('active') < 0,
      String(tempButton.title || ''))
    check('sidebar: the tooltip still explains what a temp session is',
      String(tempButton.title || '').indexOf('deleted when you quit') >= 0 ||
      String(tempButton.title || '').indexOf('退出 DSH 时删除') >= 0)
  }

  // ---- 5. two-step confirm guards the delete -----------------------------
  // Re-mount with one row armed: the first click must only arm, the second
  // must fire the remove POST.
  const m2 = mountDetail()
  const Component2 = m2.configEntry.component
  Component2()
  for (const fn of m2.effects.splice(0)) fn()
  await settle(); await tick()
  // The Temp tooltip on a mount that did not act yet shows the list's count.
  const tempButton2 = m2.doc.querySelector('[data-dsbs-btn="temp"]')
  check('sidebar: the second mount has its Temp button', !!tempButton2)
  if (tempButton2) {
    check('sidebar: the tooltip shows the live count from the list (1)',
      String(tempButton2.title || '').indexOf('1 个临时会话') >= 0 &&
      String(tempButton2.title || '').indexOf('active') < 0,
      String(tempButton2.title || ''))
  }
  m2.resetStateIdx()
  const rendered2 = Component2()
  const deleteButton = findAll(rendered2, (n) => n.type === 'button' && String(JSON.stringify(n.children)).indexOf('立即删除') >= 0)[0]
  check('detail: the delete button exists for the armed flow', !!deleteButton)
  if (deleteButton) {
    deleteButton.props.onClick()
    await settle()
    const armedOnly = !m2.calls.some((c) => c.method === 'POST' && c.url.indexOf('dsh-temp-session.remove') >= 0)
    check('detail: the first click only arms, no POST yet', armedOnly)
    m2.resetStateIdx()
    const armedRender = Component2()
    check('detail: the armed row asks for confirmation',
      JSON.stringify(armedRender).includes('确认删除？ / Really delete?'))
    const confirmButton = findAll(armedRender, (n) => n.type === 'button' && String(JSON.stringify(n.children)).indexOf('确认删除') >= 0)[0]
    check('detail: a confirm button replaces the delete button', !!confirmButton)
    if (confirmButton) {
      confirmButton.props.onClick()
      await settle(); await tick()
      check('detail: the second click POSTs remove',
        m2.calls.some((c) => c.method === 'POST' && c.url.indexOf('dsh-temp-session.remove') >= 0))
      check('detail: the deleted message points at the trash',
        m2.stateOverrides.some((v) => typeof v === 'string' && v.indexOf('已移入最近删除') === 0))
    }
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
