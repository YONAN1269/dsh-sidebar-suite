// dsh-sidebar-suite 1.0.0 M1 — defensive adaptation for an UNKNOWN host shape.
//
// DSH 0.3.0 has not been published (the newest build is 0.2.3-alpha.2), so
// "unknown shape" here is a synthetic host the 0.2.x client cannot parse. It is
// NOT a claim about any real 0.3 build. Three escape routes are asserted:
//   A  no sidebar node  -> no bar, no observers, degraded once, host untouched
//   B  host services absent -> a click still produces visible feedback
//   C  host API throws  -> degraded recorded, the rest of the plugin keeps on
//
// The real client bundle is mounted on the shared DOM stub in a VM. Every
// element lookup uses a FirstOrDefault-style helper: a missing node is a null
// assertion, never a chained dereference that would crash the test itself.
import fs from 'node:fs'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { buildSidebar, UNKNOWN_HOST_PROFILE, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

// Ask the runner itself which suites it discovers, so wiring assertions do not
// go stale when suites are added or removed.
function suiteList() {
  const r = spawnSync(process.execPath, [ROOT + '/scripts/run-tests.mjs', '--list'], { encoding: 'utf8' })
  return (r.stdout || '').split(/\r?\n/).filter(Boolean)
}

const read = (p) => fs.readFileSync(ROOT + '/' + p, 'utf8')
const client = read('lib/client.js')
const pkg = JSON.parse(read('package.json'))
const hostIndex = read('lib/index.js')
const tempHost = read('lib/temp-session-host.mjs')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// The client schedules sync() from a Promise microtask. If a mutation removes a
// guard, that microtask rejects; contain it here so the suite fails by
// assertion (the "red must be clean" rule) instead of killing the process.
// C6 below asserts the shipped code produces none of these.
const microtaskErrors = []
process.on('unhandledRejection', (error) => { microtaskErrors.push(error) })

/** FirstOrDefault: returns null instead of throwing when the node is absent. */
function firstOrDefault(root, selector) {
  if (!root || typeof root.querySelector !== 'function') return null
  try { return root.querySelector(selector) || null } catch (error) { void error; return null }
}

const STATUS = {
  ok: true, showButton: true, chatModePolicy: 'hide', buttonStyle: 'pair',
  expandAllSessions: true, rowMenu: true, deleteOnExit: true,
  scheduleDelete: false, scheduleTime: '03:00',
  schedule: { enabled: false }, maxKept: 20, keepDeleted: true,
  keepDeletedDays: 7, rev: 1, tempCount: 0,
}

function buildClient(options = {}) {
  const opts = options || {}
  const serviceMissing = opts.serviceMissing === true
  // The profile describes an observable SHAPE, not a real DSH 0.3 release.
  const tree = buildSidebar(opts.unknownShape === true
    ? { unknownShape: UNKNOWN_HOST_PROFILE.unknownShape, throwOnQuery: opts.throwOnQuery === true }
    : { missingWorkspaces: opts.missingSidebar === true, throwOnQuery: opts.throwOnQuery === true })
  const doc = tree.doc
  const storage = new Map()
  const warnings = []
  const observers = []
  const published = {}
  const clientConsole = {
    log() {}, info() {}, debug() {},
    warn(...args) { warnings.push(args.map(String).join(' ')) },
    error(...args) { warnings.push(args.map(String).join(' ')) },
  }

  // A host New-session row so the legacy DOM Temp button has somewhere to go.
  if (opts.unknownShape !== true) {
    const row = doc.createElement('div')
    const hostButton = doc.createElement('button')
    hostButton.className = 'wtg9ga_newSession'
    row.appendChild(hostButton)
    tree.root.appendChild(row)
  }

  // A temporary-session row for the receiver-sensitive context-menu probe.
  if (opts.sessionRow && tree.workspaces) {
    const row = doc.createElement('div')
    row.setAttribute('data-row-key', 'session:' + opts.sessionRow)
    const label = doc.createElement('span')
    label.textContent = '临时会话'
    row.appendChild(label)
    tree.workspaces.appendChild(row)
  }

  // A mutation that removes a guard must fail an ASSERTION, not crash the test
  // process from an uncaught heartbeat callback ("red must be clean"). apply()
  // itself stays directly observable through applyError below.
  const guard = (fn) => function (...args) {
    try { return typeof fn === 'function' ? fn.apply(this, args) : undefined }
    catch (error) { void error }
  }
  const safeTimeout = (fn, ms, ...rest) => sbTimeout(guard(fn), ms, ...rest)
  const safeInterval = (fn, ms, ...rest) => sbInterval(guard(fn), ms, ...rest)

  class MutationObserverStub {
    observe(target) { observers.push(target) }
    disconnect() {}
    takeRecords() { return [] }
  }
  class ResizeObserverStub {
    observe(target) { observers.push(target) }
    disconnect() {}
  }

  const ui = {
    createNamed: () => Promise.resolve('temp-1'),
    openSession() {},
    workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
    sessions: { list: { getSnapshot: () => ({ ids: [] }) } },
    mainReference: { sessionId: '' },
  }
  const slots = {
    inject() {},
    register() { return () => {} },
    entriesOfSlot() { return [] },
    subscribe() { return () => {} },
  }
  const menus = opts.menus || null

  const sandbox = {
    window: {
      __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
      getComputedStyle: () => ({ position: 'static', display: 'block' }),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      setTimeout: safeTimeout, clearTimeout, setInterval: safeInterval, clearInterval,
      open() { return null },
    },
    document: doc,
    navigator: { language: 'zh-CN', clipboard: { writeText: () => Promise.resolve() } },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    fetch: async (input) => {
      const url = String((input && input.url) || input || '')
      if (url.indexOf('dsh-temp-session.list') >= 0) {
        return new Response(JSON.stringify({ ok: true, ids: opts.listIds || [] }), { status: 200 })
      }
      return new Response(JSON.stringify(STATUS), { status: 200 })
    },
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: MutationObserverStub, ResizeObserver: ResizeObserverStub,
    setTimeout: safeTimeout, clearTimeout, setInterval: safeInterval, clearInterval,
    requestAnimationFrame: (cb) => safeTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console: clientConsole,
  }
  sandbox.window.document = doc
  sandbox.window.localStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(client, sandbox, { filename: 'client.js' })

  const ReactStub = {
    createElement: () => null,
    useState: (initial) => [initial, () => {}],
    useEffect() {}, Fragment: 'Fragment',
  }
  const mod = sandbox.__entry.factory(() => ReactStub)
  const ctx = {
    locale: {
      getSnapshot: () => ({ active: 'zh-CN' }),
      subscribe() { return () => {} },
      register() { return () => {} },
    },
    effect(fn) { return fn() },
    get(name) {
      if (serviceMissing) return undefined
      return name === 'uiWorkspace' ? ui : undefined
    },
    inject(deps, callback) {
      if (typeof callback !== 'function') return
      // A missing host exposes no services at all; an ordinary one exposes
      // slots and contextMenus but deliberately no remote/configForms.
      if (serviceMissing) { callback({}); return }
      const scope = { slots }
      if (Array.isArray(deps) && deps.indexOf('contextMenus') >= 0) {
        scope.contextMenus = menus || { register() { return () => {} } }
      }
      callback(scope)
    },
    provide(name, value) { published[name] = value },
  }

  let applyError = null
  try { mod.apply(ctx) } catch (error) { applyError = error }
  return { doc, tree, mod, published, warnings, observers, applyError }
}

function hasDegradation(warnings, reason) {
  return warnings.some((line) => line.indexOf('degraded: ' + reason) >= 0)
}

async function main() {
  // ---- 0. source contracts that must never be loosened by M1 ------------
  check('D0: the unknown-profile descriptor says "unknown shape", not 0.3',
    /unknown shape/i.test(UNKNOWN_HOST_PROFILE.name) && !/0\.3/.test(UNKNOWN_HOST_PROFILE.name),
    UNKNOWN_HOST_PROFILE.name)
  check('D1: engines.dsh still excludes 0.3.0 (exact string)',
    pkg.engines.dsh === '>=0.2.2-rc.1 <0.3.0-0 || >=0.2.3-0 <0.3.0-0',
    String(pkg.engines.dsh))
  check('D2: this suite is wired into npm test',
    /scripts\/run-tests\.mjs/.test(pkg.scripts.test || '') &&
    suiteList().includes('test_062.mjs'))
  check('D3: client hosts the whole adaptation layer in one file',
    ['var KNOWN_SLOTS =', 'function hostRead(', 'function hostCall(',
      'function featureDetect(', 'function degrade(', 'var hostResolve = resolveSidebar',
      'function resolveSidebarImpl('].every((part) => client.indexOf(part) >= 0))
  check('D4: both resolver callers use the single gate',
    /var fx = hostResolve\(\)/.test(client))
  check('D5: index.js keeps the static connection inject',
    /export const inject = \['connection'\]/.test(hostIndex))
  check('D6: temp host exposes its degradation reason in status()',
    /degraded: state\.degraded \|\| undefined/.test(tempHost))
  // M1 deliberately did not bump the version; T03 now ships 1.0.0, so the
  // durable guard is that the embedded VERSION tracks package.json.
  check('D7: the embedded VERSION tracks package.json',
    new RegExp("var VERSION = '" + pkg.version.replace(/\./g, '\\.') + "'").test(client),
    pkg.version)

  // ---- A. sidebar node missing -----------------------------------------
  {
    const rejectionsBefore = microtaskErrors.length
    const host = buildClient({ unknownShape: true })
    await settle()
    check('A1: an unknown shape does not throw out of apply()',
      host.applyError === null, String(host.applyError && host.applyError.message))
    // Own the async verdict here: "paint ignored null" must fail THIS group,
    // not only the suite-final C6 net.
    check('A1b: no unhandled rejection escapes the paint/sync cycle',
      microtaskErrors.length === rejectionsBefore,
      microtaskErrors.slice(rejectionsBefore).map(String).join(' | '))
    check('A2: no control bar is mounted into an unknown host',
      firstOrDefault(host.doc, '[data-dsbs-bar]') === null)
    check('A3: no rail menu is mounted into an unknown host',
      firstOrDefault(host.doc, '[data-dsbs-rail-menu]') === null)
    const hostColumn = firstOrDefault(host.doc, '.future-host-column')
    const hostColumnHidden = !!hostColumn && (
      hostColumn.hasAttribute('hidden') ||
      /display\s*:\s*none/.test(hostColumn.getAttribute('style') || '') ||
      !!(hostColumn.style && /none/.test(String(hostColumn.style.display || '')))
    )
    check('A4: the host is never hidden by a stale ptab rule',
      host.doc.documentElement.getAttribute('data-dsbs-ptab') !== 'true' && !hostColumnHidden,
      'ptab=' + host.doc.documentElement.getAttribute('data-dsbs-ptab') + ' hidden=' + hostColumnHidden)
    check('A5: the reason is recorded once',
      hasDegradation(host.warnings, 'layout:sidebar-unresolved') &&
      host.warnings.filter((line) => line.indexOf('sidebar-unresolved') >= 0).length === 1,
      JSON.stringify(host.warnings))
    check('A6: no DOM observer is registered without a sidebar',
      host.observers.length === 0, String(host.observers.length))
    check('A7: the host DOM is left as it was found',
      !!hostColumn && !hostColumnHidden,
      hostColumn ? 'hidden=' + hostColumnHidden : 'no host column')
    const service = host.published.sidebarSuite
    check('A8: the public service still exists (core layout kept)',
      !!service && typeof service.getLayout === 'function')
  }

  // A host that kept the nav but renamed only the workspaces slot: the null
  // ref used to be dereferenced by paint(). Same degradation, no crash.
  {
    const host = buildClient({ missingSidebar: true })
    await settle()
    check('A9: a renamed workspaces slot still degrades without throwing',
      host.applyError === null && firstOrDefault(host.doc, '[data-dsbs-bar]') === null &&
      hasDegradation(host.warnings, 'layout:sidebar-unresolved'))
    check('A10: the remaining host rows are untouched',
      !!firstOrDefault(host.doc, 'button[class*="newSession"]'))
  }

  // ---- B. host services missing ----------------------------------------
  {
    const host = buildClient({ serviceMissing: true })
    await settle()
    const button = firstOrDefault(host.doc, '[data-dsbs-btn="temp"]')
    check('B1: the Temp entry exists on a legacy host', !!button)
    check('B2: core layout is kept when only services are missing',
      !!firstOrDefault(host.doc, '[data-dsbs-bar]'))
    check('B3: missing services are recorded, not silently swallowed',
      hasDegradation(host.warnings, 'settings:slots-service-missing') &&
      hasDegradation(host.warnings, 'slots:slot-probe-missing'),
      JSON.stringify(host.warnings))
    if (button) {
      button.click()
      await settle()
      const toast = firstOrDefault(host.doc, '[data-dsbs-temp-toast]')
      const text = toast ? toast.textContent : ''
      check('B4: a click on a dead service still gives visible feedback',
        !!toast && String(text).length > 0 && toast.getAttribute('role') === 'alert',
        String(text))
      check('B5: the unusable service is recorded on the click path',
        hasDegradation(host.warnings, 'temp:uiworkspace-missing'),
        JSON.stringify(host.warnings))
    } else {
      check('B4: a click on a dead service still gives visible feedback', false,
        'no button to click')
      check('B5: the unusable service is recorded on the click path', false,
        'no button to click')
    }
  }

  // ---- C. host API throws ----------------------------------------------
  {
    const host = buildClient({ throwOnQuery: true })
    await settle()
    check('C1: a throwing host API does not escape apply()',
      host.applyError === null, String(host.applyError && host.applyError.message))
    check('C2: no controls are mounted when the resolver cannot read the DOM',
      firstOrDefault(host.doc, '[data-dsbs-bar]') === null)
    check('C3: the exception is recorded as a degradation reason',
      hasDegradation(host.warnings, 'layout:sidebar-resolve-failed'),
      JSON.stringify(host.warnings))
    check('C4: the reason is logged only once',
      host.warnings.filter((line) => line.indexOf('sidebar-resolve-failed') >= 0).length === 1)
    check('C5: the rest of the plugin keeps working',
      !!host.published.sidebarSuite &&
      typeof host.published.sidebarSuite.getTabs === 'function' &&
      typeof host.published.sidebarSuite.getLayout === 'function')
  }

  // ---- E. a host getter that reads `this` ------------------------------
  // Before the fix, hostRead() invoked getSnapshot()/get() with no receiver,
  // so a host method like `getSnapshot() { return this.tag }` threw and the
  // client wrongly opened its own menu on top of an already-open host popup.
  {
    const opens = []
    const menus = {
      active: {
        tag: 'x',
        getSnapshot() { return this.tag },
      },
      register() { return () => {} },
      open(target, point) { opens.push({ target, point }) },
    }
    const host = buildClient({
      menus,
      sessionRow: 'this-dependent',
      listIds: ['this-dependent'],
    })
    await settle()
    const rowLabel = firstOrDefault(host.doc, '[data-row-key="session:this-dependent"] span')
    check('E0: the temporary row reaches the menu probe', !!rowLabel)
    if (rowLabel) {
      const event = {
        type: 'contextmenu', target: rowLabel, clientX: 40, clientY: 60,
        preventDefault() { event.prevented = true },
        stopPropagation() { event.stopped = true },
      }
      host.doc.dispatchEvent(event)
      await settle()
      check('E1: a this-dependent getSnapshot keeps its receiver',
        opens.length === 0 && event.prevented !== true,
        JSON.stringify({ opens: opens.length, prevented: event.prevented }))
    } else {
      check('E1: a this-dependent getSnapshot keeps its receiver', false, 'no row')
    }
  }

  // Final net, after every asynchronous scenario: no group may leave a
  // rejection behind for the next one (A1b owns the A-group verdict).
  check('C6: the shipped code leaves no unhandled microtask rejection',
    microtaskErrors.length === 0,
    microtaskErrors.map(String).join(' | '))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
