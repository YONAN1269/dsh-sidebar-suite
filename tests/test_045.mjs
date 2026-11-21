// dsh-sidebar-suite 0.7.4 (unreleased) — detail-page host version / contract
// self-check badge.
//
// The badge must show the DSH desktop version from the existing status payload
// plus the three contracts the sidebar actually depends on (sidebar DOM,
// session-action slot, private API), with an explicit path when one fails.
// It must never be a decorative indicator that silently drifts from reality.
//
// Mounts the real client bundle against the shared DOM stub and a recording
// React stub, captures the `plugins.bundle.config` component and inspects the
// element tree it returns. No jsdom, no machine-specific paths.
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

const STATUS_OK = JSON.stringify({
  ok: true,
  env: { plugin: '0.7.3', dshClient: '0.2.2-rc.5', node: '24.9.0', platform: 'win32' },
  routes: { registered: 14, errors: [], paths: ['/api/dsh-temp-session.status', '/api/dsh-temp-session.list', '/api/dsh-temp-session.config', '/api/dsh-temp-session.track', '/api/dsh-temp-session.untrack', '/api/dsh-temp-session.keep-all', '/api/dsh-temp-session.remove', '/api/dsh-temp-session.purge', '/api/dsh-temp-session.probe', '/api/dsh-temp-session.paths', '/api/dsh-temp-session.trash', '/api/dsh-temp-session.trash-restore', '/api/dsh-temp-session.trash-delete', '/api/dsh-temp-session.trash-empty'] },
  tempCount: 2,
})

function mountDetail(options) {
  const opts = options || {}
  const statusBody = opts.statusBody === undefined ? STATUS_OK : opts.statusBody
  const tree = buildSidebar()
  const doc = tree.doc

  if (opts.noSidebar) {
    // Make resolveSidebar() fail while leaving the rest of the DOM intact.
    if (tree.workspaces && tree.workspaces.parentNode) tree.workspaces.parentNode.removeChild(tree.workspaces)
  }

  // Host New-session row plus the slot anchor: this is what makes the live
  // sidebar report tempSlotMode === 'slot' in the healthy scenario.
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
  if (!opts.noSlot) outlet.appendChild(seat)
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
  let fetchCalls = 0
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
  const fetchStub = async () => {
    fetchCalls += 1
    if (statusBody === null) return new Response('offline', { status: 503 })
    return new Response(statusBody, { status: 200, headers: { 'content-type': 'application/json' } })
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
    doc, tree, configEntry, stateOverrides, effects, ReactStub,
    resetStateIdx() { stateIdx = 0 },
    getFetchCalls() { return fetchCalls },
  }
}

function badgeOf(node) {
  return findAll(node, (n) => !!(n.props && n.props['data-dsbs-health']))[0] || null
}
function detailOf(node) {
  return findAll(node, (n) => !!(n.props && n.props['data-dsbs-health-detail']))[0] || null
}
function recheckOf(node) {
  return findAll(node, (n) => !!(n.props && n.props['data-dsbs-health-recheck']))[0] || null
}
function labelOf(badge) {
  return badge ? String((badge.children || [])[0] || '') : ''
}

async function main() {
  // ---- 0. source guards --------------------------------------------------
  check('source: bilingual health keys exist',
    SRC.includes("'health.label':") && SRC.includes("'health.sidebar.fail':") &&
    SRC.includes("'health.hint':"))
  check('source: badge reads the DSH version from the status payload',
    SRC.includes('env.dshClient') && SRC.includes('function readHealth()'))
  check('source: three contracts are evaluated',
    SRC.includes("key: 'sidebar'") && SRC.includes("key: 'slot'") && SRC.includes("key: 'api'"))
  check('source: recheck forces a fresh status request',
    SRC.includes('function loadDiagnostics(force)') && SRC.includes('loadDiagnostics(true)'))
  check('source: previously swallowed errors are now recorded',
    SRC.includes('var tempSeatError =') && SRC.includes('var tempStatusError ='))

  // ---- 1. healthy host: version shown, all contracts green --------------
  const good = mountDetail()
  check('mount: the config component was captured', !!good.configEntry)
  if (!good.configEntry) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exitCode = 1; return }
  const Component = good.configEntry.component
  let rendered = Component()
  let badge = badgeOf(rendered)
  check('badge: rendered at the top of the detail page', !!badge)
  check('badge: starts as pending before the status returns',
    !!badge && badge.props['data-dsbs-health-state'] === 'pending',
    badge && badge.props['data-dsbs-health-state'])
  check('badge: is a real button with a toggle title',
    !!badge && badge.type === 'button' && /health\.expand|展开运行自检/.test(String(badge.props.title)))

  for (const fn of good.effects.splice(0)) fn()
  await settle(); await tick()
  // 0.8.0: written as "some state holds a checks array" instead of a slot index.
  // A fixed index breaks every time a useState is added above (the trash section
  // added two), and the failure then looks like a badge regression.
  check('badge: status payload reached the component state',
    good.stateOverrides.some(function (value) {
      return !!value && typeof value === 'object' && !!value.env
    }))

  good.resetStateIdx()
  rendered = Component()
  badge = badgeOf(rendered)
  check('badge: shows the DSH desktop version', labelOf(badge).includes('0.2.2-rc.5'), labelOf(badge))
  check('badge: reports all three contracts passing', labelOf(badge).includes('3/3'), labelOf(badge))
  check('badge: healthy state is green', !!badge && badge.props['data-dsbs-health-state'] === 'ok',
    badge && badge.props['data-dsbs-health-state'])
  check('badge: collapsed by default (no detail panel)', !detailOf(rendered))

  // ---- 2. expanding gives real, actionable detail -----------------------
  badge.props.onClick()
  good.resetStateIdx()
  rendered = Component()
  const panel = detailOf(rendered)
  check('expand: clicking the badge opens the detail panel', !!panel)
  check('expand: ARIA state follows', badgeOf(rendered).props['aria-expanded'] === 'true')
  if (panel) {
    const texts = findAll(panel, (n) => typeof n.children === 'undefined' && typeof (n.type === 'string' ? '' : '') === 'string')
    const flat = JSON.stringify(panel)
    check('detail: lists the sidebar contract', flat.includes('health.sidebar') || flat.includes('侧栏结构'))
    check('detail: lists the slot contract', flat.includes('health.slot') || flat.includes('会话按钮插槽'))
    check('detail: lists the API contract', flat.includes('health.api') || flat.includes('私有接口'))
    check('detail: explains the colour semantics', flat.includes('health.legend') || flat.includes('绿=正常'))
    check('detail: tells the user where to go when it is red', flat.includes('health.hint') || flat.includes('重新检测'))
    void texts
  }
  const recheck = recheckOf(rendered)
  check('detail: a Recheck button exists', !!recheck)
  if (recheck) {
    const before = good.getFetchCalls()
    recheck.props.onClick()
    await settle(); await tick()
    check('detail: Recheck actually issues a fresh request', good.getFetchCalls() > before,
      'before=' + before + ' after=' + good.getFetchCalls())
  }

  // ---- 2b. a missing CRITICAL route is a red badge, not a green count ----
  // Regression for the review finding: eight healthy routes + one failed
  // registration used to report 3/3 while "Open session folder" was dead.
  const partialStatus = JSON.parse(STATUS_OK)
  partialStatus.routes.paths = partialStatus.routes.paths
    .filter((p) => !p.endsWith('/api/dsh-temp-session.paths'))
  const partial = mountDetail({ statusBody: JSON.stringify(partialStatus) })
  void partial.configEntry.component() // register useEffect before running it
  for (const fn of partial.effects.splice(0)) fn()
  await settle(); await tick()
  partial.resetStateIdx()
  const partialBadge = badgeOf(partial.configEntry.component())
  check('badge: missing critical route is not healthy',
    !!partialBadge && partialBadge.props['data-dsbs-health-state'] === 'fail',
    partialBadge && partialBadge.props['data-dsbs-health-state'])
  check('badge: missing critical route lowers the count to 2/3',
    !!partialBadge && labelOf(partialBadge).includes('2/3'), partialBadge && labelOf(partialBadge))
  partialBadge.props.onClick()
  partial.resetStateIdx()
  const partialDetail = detailOf(partial.configEntry.component())
  check('detail: names the missing route so it is actionable',
    !!partialDetail && JSON.stringify(partialDetail).includes('dsh-temp-session.paths'),
    partialDetail && JSON.stringify(partialDetail).slice(-200))

  // ---- 3. failed contracts are visible, not silent ----------------------
  const broken = mountDetail({ noSidebar: true, noSlot: true, statusBody: null })
  let brokenRender = broken.configEntry.component()
  for (const fn of broken.effects.splice(0)) fn()
  await settle(); await tick()
  broken.resetStateIdx()
  brokenRender = broken.configEntry.component()
  const brokenBadge = badgeOf(brokenRender)
  check('failure: a missing sidebar turns the badge red',
    !!brokenBadge && brokenBadge.props['data-dsbs-health-state'] === 'fail',
    brokenBadge && brokenBadge.props['data-dsbs-health-state'])
  check('failure: the pass count drops below 3/3', !labelOf(brokenBadge).includes('3/3'), labelOf(brokenBadge))
  brokenBadge.props.onClick()
  broken.resetStateIdx()
  brokenRender = broken.configEntry.component()
  const brokenDetail = JSON.stringify(detailOf(brokenRender) || {})
  check('failure: the reason text is present, not just a colour',
    brokenDetail.includes('health.sidebar.fail') || brokenDetail.includes('未识别'),
    brokenDetail.slice(0, 300))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
