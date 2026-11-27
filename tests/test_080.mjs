// dsh-sidebar-suite 1.1.5 — settings-page state transitions not covered by
// test_056 / test_057. Those suites drive the temp-session manager and the
// rollback path; this one drives three higher-risk interactions through the
// shared DOM stub and a closure-backed React stub, asserting the actual state
// machine rather than source strings:
//
//   A. focus-test button: click -> busy (disabled, no result line) -> the
//      focus-window POST fires -> response lands -> busy exits, result shows.
//   B. update-check button: click -> `checking` state -> update-check POST
//      fires -> response lands -> settles to `current`, busy gone.
//   C. focus-on-launch toggle: starts off -> click -> the config controller
//      mutate() writes focusOnLaunch=true -> the pressed state follows.
//
// Runs entirely offline against a vm sandbox; no real DSH host, no network.
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { buildSidebar, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const SRC = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
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
  env: { plugin: '1.1.5', dshClient: '0.2.2-rc.5', node: '24.9.0', platform: 'win32' },
  routes: { registered: 14, errors: [], paths: [] },
  tempCount: 0,
  deleteOnExit: true,
})

function mountDetail() {
  const tree = buildSidebar()
  const doc = tree.doc

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

  const effects = []
  const calls = []
  const mutateCalls = []
  // Config-form controller stub: the settings page reads focusOnLaunch through
  // it, and the toggle writes through mutate(). No subscription push needed.
  const controller = {
    snapshot: { value: { focusOnLaunch: false, mode: 'n' } },
    getSnapshot() { return this.snapshot },
    mutate(ops) { mutateCalls.push(ops); return true },
  }
  const configForms = { get() { return controller } }

  // Closure-backed useState: each hook keeps its own slot; resetHooks() reopens
  // the cursor before a manual re-render so the next render replays hooks in
  // the same order and reads updated values.
  const stubStates = []
  let hookIdx = 0
  const ReactStub = {
    createElement(type, props) {
      return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
    },
    useState(initial) {
      const i = hookIdx++
      if (stubStates[i] === undefined) stubStates[i] = typeof initial === 'function' ? initial() : initial
      const setter = (next) => {
        stubStates[i] = typeof next === 'function' ? next(stubStates[i]) : next
      }
      return [stubStates[i], setter]
    },
    useEffect(fn) { effects.push(fn) },
    useRef: (value) => ({ current: value }),
    Fragment: 'Fragment',
  }

  const host = {
    __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
    getComputedStyle: () => ({ position: 'static', display: 'block' }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    open() { return null },
    focus() {},
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
  }
  const reply = (body, status) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json' },
  })
  const fetchStub = async (input, init) => {
    const url = String(input && input.url ? input.url : input)
    const method = String((init && init.method) || 'GET').toUpperCase()
    calls.push({ url, method, body: init && init.body ? String(init.body) : '' })
    const routePath = url.replace(/^https?:\/\/[^/]+\/?/, '')
    if (routePath.indexOf('dsh-temp-session.config') >= 0) return reply(CONFIG_BODY)
    if (routePath.indexOf('dsh-temp-session.status') >= 0) return reply(STATUS_BODY)
    if (routePath.indexOf('dsh-temp-session.list') >= 0) {
      return reply({ ok: true, ids: [], count: 0, maxKept: 20, entries: [] })
    }
    if (routePath.indexOf('update-check') >= 0) {
      return reply({ ok: true, current: '1.1.5', latest: '1.1.5', updateAvailable: false })
    }
    if (routePath.indexOf('focus-window') >= 0) return reply({ ok: true })
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
    get(name) { return name === 'configForms' ? configForms : undefined },
    inject(deps, cb) { if (typeof cb === 'function') cb({ slots, configForms }) },
    provide() {},
  }
  mod.apply(ctx)
  const configEntry = registered.find((r) => r.spec && r.spec.name === 'plugins.bundle.config')
  return {
    doc, configEntry, effects, calls, mutateCalls, controller,
    resetHooks() { hookIdx = 0 },
  }
}

async function main() {
  const m = mountDetail()
  const Component = m.configEntry && m.configEntry.component
  check('mount: the settings component registers', typeof Component === 'function')
  if (typeof Component !== 'function') {
    console.log('\n' + pass + ' passed, ' + fail + ' failed')
    process.exitCode = 1
    return
  }

  Component()
  for (const fn of m.effects.splice(0)) fn()
  await settle(); await tick()

  // ---- A. focus-test: click -> busy -> POST -> result exits busy ----------
  m.resetHooks()
  let rendered = Component()
  const focusTestBtn = findAll(rendered, (n) => n.type === 'button' &&
    n.props && n.props['data-dsbs-focus-test'] !== undefined)[0]
  check('focus-test: the test button renders', !!focusTestBtn)
  if (focusTestBtn) {
    check('focus-test: starts idle (not disabled)', focusTestBtn.props.disabled !== true)

    focusTestBtn.props.onClick()
    m.resetHooks()
    const busyRender = Component()
    const busyBtn = findAll(busyRender, (n) => n.type === 'button' &&
      n.props && n.props['data-dsbs-focus-test'] !== undefined)[0]
    check('focus-test: enters busy and disables on click', !!busyBtn && busyBtn.props.disabled === true)
    check('focus-test: busy state shows no result line',
      findAll(busyRender, (n) => n.props && n.props['data-dsbs-focus-result'] !== undefined).length === 0)
    check('focus-test: the focus-window POST fires',
      m.calls.some((c) => c.method === 'POST' && c.url.indexOf('focus-window') >= 0))

    await settle(); await tick()
    m.resetHooks()
    const afterRender = Component()
    const afterBtn = findAll(afterRender, (n) => n.type === 'button' &&
      n.props && n.props['data-dsbs-focus-test'] !== undefined)[0]
    const result = findAll(afterRender, (n) => n.props && n.props['data-dsbs-focus-result'] !== undefined)[0]
    check('focus-test: exits busy after the response', !!afterBtn && afterBtn.props.disabled !== true)
    check('focus-test: the ok result line appears', !!result && result.props['data-dsbs-focus-result'] === 'ok',
      result && String(result.props['data-dsbs-focus-result']))
  }

  // ---- B. update-check: click -> checking -> settled current -------------
  m.resetHooks()
  rendered = Component()
  const updateBtn = findAll(rendered, (n) => n.props && n.props['data-dsbs-update-check'] !== undefined)[0]
  check('update: the check button renders', !!updateBtn)
  if (updateBtn) {
    updateBtn.props.onClick()
    m.resetHooks()
    const busyRender = Component()
    const busyBtn = findAll(busyRender, (n) => n.props && n.props['data-dsbs-update-check'] !== undefined)[0]
    check('update: enters the checking state on click',
      !!busyBtn && busyBtn.props['data-dsbs-update-state'] === 'checking',
      busyBtn && String(busyBtn.props['data-dsbs-update-state']))
    check('update: the update-check request fires',
      m.calls.some((c) => c.url.indexOf('update-check') >= 0))

    await settle(); await tick()
    m.resetHooks()
    const afterRender = Component()
    const afterBtn = findAll(afterRender, (n) => n.props && n.props['data-dsbs-update-check'] !== undefined)[0]
    check('update: settles to current after the response',
      !!afterBtn && afterBtn.props['data-dsbs-update-state'] === 'current',
      afterBtn && String(afterBtn.props['data-dsbs-update-state']))
  }

  // ---- C. focus-on-launch toggle: mutate + pressed follows ----------------
  m.resetHooks()
  rendered = Component()
  const focusToggle = findAll(rendered, (n) => n.type === 'button' &&
    n.props && n.props['data-dsbs-focus-window'] !== undefined)[0]
  check('focus-window: the launch-focus toggle renders', !!focusToggle)
  if (focusToggle) {
    check('focus-window: starts off', focusToggle.props['aria-pressed'] === 'false')

    focusToggle.props.onClick()
    const writeOp = (m.mutateCalls.flat().filter((op) => op && Array.isArray(op.path)))
      .find((op) => op.path.join('.') === 'focusOnLaunch')
    check('focus-window: controller.mutate writes focusOnLaunch=true',
      !!writeOp && writeOp.value === true, JSON.stringify(m.mutateCalls))

    m.resetHooks()
    const afterRender = Component()
    const afterToggle = findAll(afterRender, (n) => n.type === 'button' &&
      n.props && n.props['data-dsbs-focus-window'] !== undefined)[0]
    check('focus-window: pressed state follows the flip',
      !!afterToggle && afterToggle.props['aria-pressed'] === 'true',
      afterToggle && String(afterToggle.props['aria-pressed']))
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
