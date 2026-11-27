// dsh-sidebar-suite 1.1.5 — settings page guards: CE-06 focus-test gate,
// CE-03 async teardown guards, CE-05 forced/ordinary diagnostic latch split.
//
// Drives the real client bundle in a VM on the shared DOM stub. The focus-test
// button branch is executed for real (both with and without a config service);
// the closure-internal async guards are pinned by source contract alongside.
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
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function findAll(node, pred, out) {
  const found = out || []
  if (node == null) return found
  if (typeof node !== 'object') { if (pred(node)) found.push(node); return found }
  if (Array.isArray(node)) { for (const item of node) findAll(item, pred, found); return found }
  if (pred(node)) found.push(node)
  if (node.children) findAll(node.children, pred, found)
  return found
}

function fakeForms(initial) {
  const value = Object.assign({ mode: 'b', tab: 'ext' }, initial || {})
  const controller = {
    getSnapshot: () => ({ value: Object.assign({}, value), revision: 1 }),
    subscribe() { return () => {} },
    mutate: () => Promise.resolve({ ok: true }),
  }
  return { controller, service: { get: () => controller } }
}

function mount(options = {}) {
  const opts = options || {}
  const tree = buildSidebar({ gridHost: true })
  const doc = tree.doc
  const storage = new Map()
  const warnings = []
  const forms = opts.noForms ? null : fakeForms(opts.initial)
  const registrations = []
  const effects = []
  const fetchCalls = []

  const ui = {
    createNamed: () => Promise.resolve('temp-1'),
    openSession() {},
    workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
    sessions: { list: { getSnapshot: () => ({ ids: [] }) } },
    mainReference: { sessionId: '' },
  }
  const slots = {
    inject(name, cb) { if (typeof cb === 'function') cb() },
    register(spec, component) { registrations.push({ spec, component }); return () => {} },
    entriesOfSlot() { return [] },
    subscribe() { return () => {} },
  }

  class MutationObserverStub { observe() {} disconnect() {} takeRecords() { return [] } }
  class ResizeObserverStub { observe() {} disconnect() {} }

  let hookIndex = 0
  const hookValues = []
  const ReactStub = {
    createElement(type, props) {
      return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
    },
    useState(initial) {
      const i = hookIndex++
      if (hookValues[i] === undefined) hookValues[i] = initial
      const setter = (next) => { hookValues[i] = typeof next === 'function' ? next(hookValues[i]) : next }
      return [hookValues[i], setter]
    },
    useEffect(fn) { effects.push(fn) },
    Fragment: 'Fragment',
  }

  const sandbox = {
    window: {
      __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
      getComputedStyle: () => ({ position: 'static', display: 'block' }),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
      open() { return null }, innerWidth: 1280, innerHeight: 800,
    },
    document: doc,
    navigator: { language: 'zh-CN', clipboard: { writeText: () => Promise.resolve() } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    fetch: async (input, init) => {
      const url = String((input && input.url) || input || '')
      fetchCalls.push({ url, method: (init && init.method) || 'GET', body: (init && init.body) || '' })
      if (url.indexOf('dsh-temp-session.status') >= 0) {
        return new Response(JSON.stringify({ ok: true, showButton: false, expandAllSessions: false }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: MutationObserverStub, ResizeObserver: ResizeObserverStub,
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
    requestAnimationFrame: (cb) => sbTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console: { log() {}, info() {}, debug() {}, warn: (...a) => warnings.push(a.map(String).join(' ')), error() {} },
  }
  sandbox.window.document = doc
  sandbox.window.localStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox, { filename: 'client.js' })

  const mod = sandbox.__entry.factory(() => ReactStub)
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe() { return () => {} }, register() { return () => {} } },
    effect(fn) { return fn() },
    get(name) {
      if (name === 'configForms') return forms ? forms.service : undefined
      if (name === 'uiWorkspace') return ui
      return undefined
    },
    inject(deps, callback) {
      if (typeof callback !== 'function') return
      const scope = { slots }
      if (forms) scope.configForms = forms.service
      callback(scope)
    },
    provide() {},
  }
  mod.apply(ctx)

  const configComponent = () => {
    const entry = registrations.find((r) => r.spec && r.spec.name === 'plugins.bundle.config')
    return entry ? entry.component : null
  }
  const renderConfig = () => {
    hookIndex = 0
    const component = configComponent()
    return component ? component({}) : null
  }
  return { doc, registrations, fetchCalls, warnings, renderConfig }
}

function focusTestButton(tree) {
  return findAll(tree, (n) => n && n.props && n.props['data-dsbs-focus-test'] !== undefined)[0] || null
}

async function main() {
  // ---- CE-06: focus-test gate follows busy state only --------------------
  {
    const h = mount()
    await settle()
    const tree = h.renderConfig()
    const btn = focusTestButton(tree)
    check('CE06: the focus-test button exists on the settings page', !!btn)
    check('CE06: it is enabled when the config service is present and idle',
      !!btn && btn.props.disabled === false, String(btn && btn.props.disabled))
  }

  {
    // Without a config service the layout/config pills stay gated, but the
    // focus test only calls the focus-window route — it must not follow that
    // availability gate.
    const h = mount({ noForms: true })
    await settle()
    const tree = h.renderConfig()
    const btn = focusTestButton(tree)
    check('CE06: the button is still enabled without a config service',
      !!btn && btn.props.disabled === false, String(btn && btn.props.disabled))
  }

  // ---- CE-03: async callbacks guard the panel teardown -------------------
  {
    check('CE03: the update-check callback returns after teardown',
      /checkForUpdate[\s\S]*?if \(!settingsAlive\) return[\s\S]*?catch\(function \(error\) \{\s*if \(!settingsAlive\) return/.test(SRC))
    check('CE03: the focus-test callbacks return after teardown',
      /testFocusNow[\s\S]*?\.then\(function \(data\) \{\s*if \(!settingsAlive\) return[\s\S]*?\.catch\(function \(error\) \{\s*if \(!settingsAlive\) return/.test(SRC))
    check('CE03: the effect cleanup clears the alive latch',
      /return function \(\) \{ alive = false; settingsAlive = false \}/.test(SRC))
  }

  // ---- CE-05: forced and ordinary in-flight requests stay split ----------
  {
    check('CE05: the pending latch is tagged with its force flag',
      /var diagPendingForce = false/.test(SRC) &&
      /if \(diagPending && diagPendingForce === !!force\) return diagPending/.test(SRC) &&
      /diagPendingForce = !!force/.test(SRC))
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
