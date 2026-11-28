// dsh-sidebar-suite 1.0.0 M2 — interaction audit (design §7, A1–A8).
//
// Every finding below is driven against the REAL client bundle on the shared
// DOM stub in a VM — no source-only conclusions, no screenshots. Each item
// reports either "confirmed normal" with the interaction that proves it, or a
// reproducible defect that gets its own red/green + mutation evidence.
//
// Element lookups use a FirstOrDefault-style helper; a missing node is a null
// assertion, never a chained dereference that would crash the audit itself.
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

/** FirstOrDefault: null when absent, never a throwing First(). */
function firstOrDefault(root, selector) {
  if (!root || typeof root.querySelector !== 'function') return null
  try { return root.querySelector(selector) || null } catch (error) { void error; return null }
}
function findAll(node, pred, out) {
  const found = out || []
  if (node == null) return found
  // Leaf strings are valid React children — they must reach the predicate.
  if (typeof node !== 'object') { if (pred(node)) found.push(node); return found }
  if (Array.isArray(node)) { for (const item of node) findAll(item, pred, found); return found }
  if (pred(node)) found.push(node)
  if (node.children) findAll(node.children, pred, found)
  return found
}

const STATUS = {
  ok: true,
  env: { plugin: '1.0.0', dshClient: '0.2.3-alpha.2', node: '22.22.2', platform: 'win32' },
  routes: {
    registered: 14, errors: [], paths: [
      'status', 'list', 'config', 'track', 'untrack', 'keep-all', 'remove', 'purge',
      'probe', 'paths', 'trash', 'trash-restore', 'trash-delete', 'trash-empty',
    ].map((name) => '/api/dsh-temp-session.' + name),
  },
  showButton: true, chatModePolicy: 'hide', buttonStyle: 'pair',
  expandAllSessions: true, rowMenu: true, deleteOnExit: true,
  scheduleDelete: false, scheduleTime: '03:00', schedule: { enabled: false },
  maxKept: 20, keepDeleted: true, keepDeletedDays: 7, rev: 1, tempCount: 0,
}

function fakeForms(initial) {
  const value = Object.assign({ mode: 'b', tab: 'ext' }, initial || {})
  const subs = []
  const calls = []
  let revision = 1
  const controller = {
    getSnapshot: () => ({ value: Object.assign({}, value), revision }),
    subscribe(fn) { subs.push(fn); return () => {} },
    mutate(ops) {
      calls.push({ ops: JSON.parse(JSON.stringify(ops)), revision })
      if (this.refuseNext > 0) { this.refuseNext -= 1; return false }
      for (const op of ops) value[op.path[0]] = op.value
      revision += 1
      for (const fn of subs) fn()
      return Promise.resolve({ ok: true })
    },
    refuseNext: 0,
  }
  // The host service shape is `{ get(entry) -> controller }`; the client reads
  // configForms through `service.get(ENTRY)`, not the controller directly.
  return {
    controller, calls, value: () => value, state: controller,
    service: { get: () => controller },
  }
}

function fakeMenus(options) {
  const opts = options || {}
  const opens = []
  const registrations = []
  const active = opts.thisDependent
    ? { tag: opts.activeTag === undefined ? null : opts.activeTag, getSnapshot() { return this.tag } }
    : { getSnapshot: () => (opts.activeTag === undefined ? null : opts.activeTag) }
  return {
    active, opens, registrations,
    register(contribution) { registrations.push(contribution); return () => {} },
    open(target, point) {
      opens.push({ target, point })
      if (opts.openThrows) throw new Error('popup unavailable')
      if (opts.activeTag !== undefined) active.getSnapshot = () => opts.activeTag
    },
  }
}

function mount(options = {}) {
  const opts = options || {}
  const tree = buildSidebar({ gridHost: opts.grid !== false })
  const doc = tree.doc
  const storage = new Map()
  const warnings = []
  const forms = fakeForms(opts.initial)
  const menus = opts.menus || null
  const published = {}
  const focusLog = []
  const delayed = []
  const fetchCalls = []
  const intervals = []
  let configFailures = opts.configFailures || 0
  const controlledInterval = (fn, ms) => {
    if (opts.manualIntervals) {
      intervals.push({ fn, ms })
      return { unref() {} }
    }
    return sbInterval(fn, ms)
  }

  // The host New-session row: the legacy Temp button's seat.
  const row = doc.createElement('div')
  const hostButton = doc.createElement('button')
  hostButton.className = 'wtg9ga_newSession'
  row.appendChild(hostButton)
  tree.root.appendChild(row)
  tree.root.getBoundingClientRect = () => ({
    top: 0, left: 0, right: opts.width || 292, bottom: 600,
    width: opts.width || 292, height: 600, x: 0, y: 0,
  })
  row.getBoundingClientRect = () => ({
    top: 0, left: 0, right: opts.seatWidth || 292, bottom: 48,
    width: opts.seatWidth || 292, height: 48, x: 0, y: 0,
  })

  if (opts.noSidebar && tree.workspaces && tree.workspaces.parentNode) {
    tree.workspaces.parentNode.removeChild(tree.workspaces)
  }

  // A controlled setTimeout: normal client timers still run; long arm-expiry
  // timers are captured so the audit can fire them deterministically.
  const controlledTimeout = (fn, ms, ...rest) => {
    if (typeof ms === 'number' && ms >= 5000) {
      delayed.push({ fn, ms, rest })
      return { unref() {} }
    }
    return sbTimeout(fn, ms, ...rest)
  }

  class MutationObserverStub { observe() {} disconnect() {} takeRecords() { return [] } }
  class ResizeObserverStub { observe() {} disconnect() {} }
  let hookIndex = 0
  const hookValues = []
  const hookEffects = []
  const ReactStub = {
    createElement(type, props) {
      return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
    },
    useState(initial) {
      const i = hookIndex++
      const value = hookValues[i] === undefined ? initial : hookValues[i]
      const setter = (next) => {
        hookValues[i] = typeof next === 'function' ? next(hookValues[i]) : next
      }
      return [value, setter]
    },
    useEffect(fn) { hookEffects.push(fn) },
    Fragment: 'Fragment',
  }

  const statusBody = opts.status === undefined ? STATUS : opts.status
  const ui = {
    createNamed: () => Promise.resolve('temp-1'),
    openSession() {},
    workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
    sessions: { list: { getSnapshot: () => ({ ids: opts.listIds || [] }) } },
    mainReference: { sessionId: '' },
  }
  const slots = {
    // The client registers its components INSIDE the inject callback.
    inject(name, cb) { if (typeof cb === 'function') cb() },
    register(spec, component) { registrations.push({ spec, component }); return () => {} },
    entriesOfSlot(name) {
      return name === 'sidebar.panellist.actions' && opts.nativeGroups ? [{ id: 'more' }] : []
    },
    subscribe() { return () => {} },
  }
  const registrations = []

  // 1.1.4 — probes for the two "quiet" guarantees: the expand sweep must not
  // run inside every sync, and the synthetic resize must be gated + coalesced.
  const probes = { resize: 0, overflowScans: 0 }
  const sandbox = {
    window: {
      __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
      getComputedStyle: () => ({ position: 'static', display: 'block' }),
      addEventListener() {}, removeEventListener() {},
      dispatchEvent(event) {
        if (event && event.type === 'resize') probes.resize += 1
      },
      setTimeout: controlledTimeout, clearTimeout, setInterval: controlledInterval, clearInterval,
      open() { return null },
      innerWidth: 1280, innerHeight: 800,
    },
    document: doc,
    navigator: {
      language: 'zh-CN',
      clipboard: { writeText: () => (opts.copyFails ? Promise.reject(new Error('no clipboard')) : Promise.resolve()) },
    },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    fetch: async (input, init) => {
      const url = String((input && input.url) || input || '')
      fetchCalls.push({
        url,
        method: (init && init.method) || (input && input.method) || 'GET',
        body: (init && init.body) || (input && input.body) || '',
      })
      if (url.indexOf('dsh-temp-session.status') >= 0) {
        if (opts.statusPending) return new Promise(() => {})
        return statusBody === null
          ? new Response('offline', { status: 503 })
          : new Response(JSON.stringify(statusBody), { status: 200 })
      }
      if (url.indexOf('dsh-temp-session.list') >= 0) {
        if (opts.listPending) return new Promise(() => {})
        return new Response(JSON.stringify({ ok: true, ids: opts.listIds || [] }), { status: 200 })
      }
      if (url.indexOf('dsh-temp-session.config') >= 0) {
        if (configFailures > 0) {
          configFailures -= 1
          return new Response('offline', { status: 503 })
        }
        return new Response(JSON.stringify(Object.assign({ ok: true }, opts.configBody || {})), { status: 200 })
      }
      if (url.indexOf('dsh-sidebar-suite.update-check') >= 0) {
        return new Response(JSON.stringify({
          ok: true, current: '1.1.4', latest: '1.1.5', updateAvailable: true,
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: MutationObserverStub, ResizeObserver: ResizeObserverStub,
    setTimeout: controlledTimeout, clearTimeout, setInterval: controlledInterval, clearInterval,
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
    locale: {
      getSnapshot: () => ({ active: 'zh-CN' }),
      subscribe() { return () => {} },
      register() { return () => {} },
    },
    effect(fn) { return fn() },
    get(name) {
      if (name === 'configForms') return forms.service
      if (name === 'uiWorkspace') return ui
      return undefined
    },
    inject(deps, callback) {
      if (typeof callback !== 'function') return
      const scope = { slots, configForms: forms.service }
      if (Array.isArray(deps) && deps.indexOf('contextMenus') >= 0 && menus) scope.contextMenus = menus
      callback(scope)
    },
    provide(name, value) { published[name] = value },
  }
  let applyError = null
  try { mod.apply(ctx) } catch (error) { applyError = error }
  // Give El.focus an observable side effect for focus-return assertions.
  const focus = (el) => { if (el && typeof el.focus === 'function') el.focus = () => focusLog.push(el) }
  for (const candidate of doc.querySelectorAll('button')) focus(candidate)

  return {
    doc, tree, mod, ctx, service: published.sidebarSuite, applyError, warnings,
    forms, menus, registrations, published, focusLog, delayed, ReactStub, hookValues, hookEffects, fetchCalls,
    intervals,
    probes,
    configComponent: () => {
      const entry = registrations.find((r) => r.spec && r.spec.name === 'plugins.bundle.config')
      return entry ? entry.component : null
    },
    renderConfig() {
      hookIndex = 0
      const component = this.configComponent()
      return component ? component({}) : null
    },
    click(selector) {
      const node = firstOrDefault(doc, selector)
      if (node && typeof node.click === 'function') { node.click(); return true }
      return false
    },
  }
}

function keyEvent(key) {
  return { type: 'keydown', key, preventDefault() {}, stopPropagation() {} }
}
function pointerEvent(target) {
  return { type: 'pointerdown', target, preventDefault() {}, stopPropagation() {} }
}

async function main() {
  // ---- A1 · layout switching: click = visible state, refused write = toast
  {
    const h = mount()
    await settle()
    h.click('[data-dsbs-bar] button[data-dsbs-btn="mode-c"]')
    await settle()
    check('A1a: clicking overlay paints the mode on <html>',
      h.doc.documentElement.getAttribute('data-dsbs-mode') === 'c')
    check('A1b: the clicked layout is the only selected pill',
      h.doc.querySelectorAll('[data-dsbs-bar] button[data-dsbs-btn^="mode-"]').filter(
        (b) => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true'
      ).length >= 1)
    h.click('[data-dsbs-bar] button[data-dsbs-btn="mode-n"]')
    await settle()
    check('A1c: the official-default choice is a real visible state, not a no-op',
      h.doc.documentElement.getAttribute('data-dsbs-mode') === 'n')
    const forms = mount({ initial: { tab: 'ws' } })
    await settle()
    forms.forms.state.refuseNext = 2
    forms.click('[data-dsbs-bar] button[data-dsbs-btn="tab-swap"]')
    await settle()
    await new Promise((r) => setTimeout(r, 900))
    await settle()
    const toast = firstOrDefault(forms.doc, '[data-dsbs-temp-toast]')
    check('A1d: two refused writes leave a toast, not a silent dead click',
      !!toast && String(toast.textContent || '').length > 0,
      toast ? String(toast.textContent) : 'no toast')
    check('A1h: a refused tab write rolls the visible group back to the last persisted tab',
      forms.doc.documentElement.getAttribute('data-dsbs-tab') === 'ws',
      'html tab=' + forms.doc.documentElement.getAttribute('data-dsbs-tab'))
    check('A1i: a refused tab write leaves the stored tab on the last persisted value',
      forms.forms.value().tab === 'ws',
      'stored tab=' + forms.forms.value().tab)

    // A successful write becomes the new rollback target. Turning the next
    // flip back must restore ext (the accepted value), not ws (the startup
    // value A1h/A1i started from).
    forms.forms.state.refuseNext = 0
    forms.click('[data-dsbs-bar] button[data-dsbs-btn="tab-swap"]')
    await new Promise((r) => setTimeout(r, 500))
    await settle()
    check('A1j: the accepted flip becomes the new persisted tab',
      forms.forms.value().tab === 'ext',
      'stored tab=' + forms.forms.value().tab)
    forms.forms.state.refuseNext = 2
    forms.click('[data-dsbs-bar] button[data-dsbs-btn="tab-swap"]')
    await new Promise((r) => setTimeout(r, 900))
    await settle()
    check('A1k: a later refusal rolls back to the last accepted tab, not the startup tab',
      forms.doc.documentElement.getAttribute('data-dsbs-tab') === 'ext'
      && forms.forms.value().tab === 'ext',
      'html tab=' + forms.doc.documentElement.getAttribute('data-dsbs-tab')
        + ', stored tab=' + forms.forms.value().tab)
  }

  // ---- A1e · a ⇄ burst costs one profile write, not one per click -------
  // 1.1.4: the flip used to call setField('tab') directly, so six quick
  // clicks meant six YAML rewrites queued behind each other. The view still
  // has to follow every click; the write collapses to a leading + trailing
  // pair, and the profile must end on the group the user last asked for.
  {
    const h = mount({ initial: { tab: 'ext' } })
    await settle()
    const before = h.forms.calls.length
    for (let i = 0; i < 6; i += 1) {
      h.click('[data-dsbs-bar] button[data-dsbs-btn="tab-swap"]')
      await new Promise((r) => setTimeout(r, 40))
    }
    await new Promise((r) => setTimeout(r, 500))
    await settle()
    const writes = h.forms.calls.length - before
    check('A1e: six rapid flips cost at most a leading and a trailing write',
      writes <= 3, 'writes=' + writes)
    check('A1f: the last flip is what got persisted', h.forms.value().tab === 'ext',
      'stored tab=' + h.forms.value().tab)
    check('A1g: the burst ends on the group the user last clicked',
      h.doc.documentElement.getAttribute('data-dsbs-tab') === 'ext',
      'html tab=' + h.doc.documentElement.getAttribute('data-dsbs-tab'))
  }

  // ---- A1l · an older echo mid-window must not repaint the flip ---------
  // Review fix: with three rapid clicks, the leading write's success push can
  // land between the last click's optimistic flip and its queued commit.
  // syncFromController() adopted the echoed (older) tab wholesale and the
  // column bounced back to the pre-click group until the trailing commit.
  {
    const h = mount({ initial: { tab: 'ext' } })
    await settle()
    // Click 1: the window is idle, so this is the leading write (ws).
    h.click('[data-dsbs-bar] button[data-dsbs-btn="tab-swap"]')
    await new Promise((r) => setTimeout(r, 60))
    await settle()
    check('A1l setup: the leading write persisted ws',
      h.forms.value().tab === 'ws', 'stored tab=' + h.forms.value().tab)
    // Click 2 inside the 300ms window: optimistic ext, write queued.
    h.click('[data-dsbs-bar] button[data-dsbs-btn="tab-swap"]')
    // An older echo (a duplicate of the leading write's success push) arrives
    // before the trailing commit. It carries ws — the pre-click group.
    h.forms.controller.mutate([{ op: 'set', path: ['tab'], value: 'ws' }])
    await settle()
    check('A1l: the optimistic tab survives an older echo mid-window',
      h.doc.documentElement.getAttribute('data-dsbs-tab') === 'ext',
      'html tab=' + h.doc.documentElement.getAttribute('data-dsbs-tab'))
    // The trailing commit lands and the clicked group is both visible and
    // persisted.
    await new Promise((r) => setTimeout(r, 500))
    await settle()
    check('A1m: the trailing commit persists the clicked tab',
      h.forms.value().tab === 'ext', 'stored tab=' + h.forms.value().tab)
    check('A1n: the visible tab agrees with the persisted tab after the commit',
      h.doc.documentElement.getAttribute('data-dsbs-tab') === 'ext',
      'html tab=' + h.doc.documentElement.getAttribute('data-dsbs-tab'))
  }

  // ---- A1o · the first push must not wipe a late session-mode pick ------
  // Review fix: configMode stays null until the controller's first snapshot
  // arrives (late configForms). A layout picked from the bar inside that
  // window was overwritten by the profile value on the first push, because
  // sessionMode was only re-applied when configMode already matched.
  {
    const h = mount({ initial: { mode: 'b' } })
    // The controller is not ready on the first read: make its very first
    // snapshot throw, so tryAdopt cannot set configMode at boot.
    const realSnapshot = h.forms.controller.getSnapshot.bind(h.forms.controller)
    let notReady = true
    h.forms.controller.getSnapshot = () => {
      if (notReady) throw new Error('config service not ready')
      return realSnapshot()
    }
    await settle()
    // The user picks a layout from the bar while the controller is down.
    h.click('[data-dsbs-bar] button[data-dsbs-btn="mode-c"]')
    await settle()
    check('A1o setup: the bar pick paints before the controller arrives',
      h.doc.documentElement.getAttribute('data-dsbs-mode') === 'c',
      'html mode=' + h.doc.documentElement.getAttribute('data-dsbs-mode'))
    // The controller comes up; its first push carries the profile value b.
    notReady = false
    h.forms.controller.mutate([{ op: 'set', path: ['mode'], value: 'b' }])
    await settle()
    check('A1o: the first push keeps the session pick over the profile value',
      h.doc.documentElement.getAttribute('data-dsbs-mode') === 'c',
      'html mode=' + h.doc.documentElement.getAttribute('data-dsbs-mode'))
    // A genuine external change (a different profile mode) still wins.
    h.forms.controller.mutate([{ op: 'set', path: ['mode'], value: 'n' }])
    await settle()
    check('A1p: a genuine external mode change still takes over',
      h.doc.documentElement.getAttribute('data-dsbs-mode') === 'n',
      'html mode=' + h.doc.documentElement.getAttribute('data-dsbs-mode'))
  }

  // ---- A3 · a repaint must not sweep the session list (1.1.4) -----------
  // The expand pass is a whole-document query plus one host click per folded
  // group, and every click re-renders the tree. It used to run inside every
  // sync(), so a repaint caused by nothing but a mode switch paid for a full
  // list sweep. Now it runs only when the tree changed or a group was just
  // revealed -- and even then off the frame, so the reveal itself is cheap.
  {
    const h = mount()
    await settle()
    await new Promise((r) => setTimeout(r, 400))
    const originalQuery = h.doc.querySelectorAll.bind(h.doc)
    h.doc.querySelectorAll = (selector) => {
      if (String(selector).indexOf('overflow:') >= 0) h.probes.overflowScans += 1
      return originalQuery(selector)
    }
    const before = h.probes.overflowScans
    h.click('[data-dsbs-bar] button[data-dsbs-btn="mode-c"]')
    await settle()
    check('A10a: a mode switch repaints without sweeping the session list',
      h.probes.overflowScans === before, 'scans=' + (h.probes.overflowScans - before))
    // ...but the group that just became visible still gets its sweep, just
    // later: "已展开的分组不再折成 5 条" must survive the optimisation.
    await new Promise((r) => setTimeout(r, 250))
    await settle()
    check('A10b: the revealed group still gets its deferred sweep',
      h.probes.overflowScans > before, 'scans=' + (h.probes.overflowScans - before))
    h.doc.querySelectorAll = originalQuery
  }

  // ---- A4 · the synthetic resize is gated to overlays, coalesced --------
  // It used to fire on every group that became visible: a fake `resize` for the
  // whole app, so every other plugin listening re-measured (and the host
  // recalced its layout) with nothing on screen to justify it.
  {
    const h = mount({ initial: { mode: 'b', tab: 'ext' } })
    await settle()
    await new Promise((r) => setTimeout(r, 200))
    const before = h.probes.resize
    h.click('[data-dsbs-bar] button[data-dsbs-btn="tab-swap"]')
    await settle()
    await new Promise((r) => setTimeout(r, 150))
    await settle()
    check('A10c: a plain tab flip broadcasts no synthetic resize',
      h.probes.resize === before, 'resize=' + (h.probes.resize - before))
  }
  {
    const h = mount({ initial: { mode: 'c', tab: 'ws' } })
    await settle()
    await new Promise((r) => setTimeout(r, 200))
    const before = h.probes.resize
    h.click('[data-dsbs-bar] button[data-dsbs-btn="pop"]')
    await settle()
    await new Promise((r) => setTimeout(r, 150))
    await settle()
    check('A10d: an open overlay still gets its single re-measure notice',
      h.probes.resize === before + 1, 'resize=' + (h.probes.resize - before))
  }

  // ---- A2 · overlay dismissal: host-rebuilt rows and Esc focus ----------
  {
    const h = mount({ initial: { mode: 'c' } })
    await settle()
    h.click('[data-dsbs-bar] button[data-dsbs-btn="pop"]')
    await settle()
    check('A2a: the pop button opens the overlay',
      h.doc.documentElement.getAttribute('data-dsbs-pop') === 'true')
    const rebuiltRow = h.doc.createElement('div')
    rebuiltRow.setAttribute('data-row-key', 'session:fresh')
    h.tree.nav.appendChild(rebuiltRow)
    h.doc.dispatchEvent(pointerEvent(rebuiltRow))
    await settle()
    check('A2b: clicking a host-rebuilt row inside nav does NOT dismiss the overlay',
      h.doc.documentElement.getAttribute('data-dsbs-pop') === 'true')
    h.doc.dispatchEvent(pointerEvent(h.doc.body))
    await settle()
    check('A2c: clicking outside closes the overlay',
      h.doc.documentElement.getAttribute('data-dsbs-pop') !== 'true')
  }
  {
    const h = mount({ initial: { mode: 'c' } })
    await settle()
    h.click('[data-dsbs-bar] button[data-dsbs-btn="pop"]')
    await settle()
    const trigger = firstOrDefault(h.doc, '[data-dsbs-bar] button[data-dsbs-btn="pop"]')
    if (trigger) h.focusLog.length = 0, trigger.focus = () => h.focusLog.push(trigger)
    h.doc.dispatchEvent(keyEvent('Escape'))
    await settle()
    check('A2d: Esc returns focus to the pop trigger',
      h.doc.documentElement.getAttribute('data-dsbs-pop') !== 'true' &&
      h.focusLog.indexOf(trigger) >= 0,
      'focusLog=' + h.focusLog.length)
  }

  // ---- A3 · narrow rail: icon band carries exactly one entry ------------
  {
    const rail = mount({ width: 80 })
    await settle()
    const menu = firstOrDefault(rail.doc, '[data-dsbs-rail-menu]')
    const railTrigger = menu ? firstOrDefault(menu, '[data-dsbs-rail-trigger]') : null
    check('A3a: the rail exposes a menu with an accessible name',
      !!menu && !menu.hasAttribute('hidden') && !!railTrigger &&
      !!railTrigger.getAttribute('aria-label'),
      menu ? 'trigger-label=' + (railTrigger && railTrigger.getAttribute('aria-label')) : 'no menu')
    const panel = menu ? firstOrDefault(menu, '[data-dsbs-rail-panel]') : null
    const modes = panel ? panel.querySelectorAll('[data-dsbs-rail-mode]') : []
    check('A3b: the rail band shows three distinct labelled layout modes',
      modes.length === 3 && modes.every((m) => !!m.getAttribute('aria-label') || !!m.title))
    check('A3c: the rail radiogroup keeps a single Tab stop',
      modes.filter((m) => m.getAttribute('tabindex') === '0').length === 1)
    check('A3d: rail glyphs are attribute-distinguishable without text width',
      modes.every((m) => !!m.getAttribute('data-dsbs-rail-mode')))
    // Esc closes and returns focus to the trigger.
    rail.click('[data-dsbs-rail-trigger]')
    await settle()
    const trigger = firstOrDefault(rail.doc, '[data-dsbs-rail-trigger]')
    if (trigger) { rail.focusLog.length = 0; trigger.focus = () => rail.focusLog.push(trigger) }
    rail.doc.dispatchEvent(keyEvent('Escape'))
    await settle()
    check('A3e: Esc closes the rail panel and restores trigger focus',
      rail.focusLog.indexOf(trigger) >= 0, 'focusLog=' + rail.focusLog.length)
  }
  {
    // 100–170px: the Temp band must not repeat the layout pills.
    const temp = mount({ width: 140, seatWidth: 140 })
    await settle()
    const panel = firstOrDefault(temp.doc, '[data-dsbs-rail-panel]')
    const modes = panel ? firstOrDefault(panel, '[data-dsbs-rail-modes]') : null
    check('A3f: the temp-only band hides the duplicate layout pills',
      temp.doc.documentElement.getAttribute('data-dsbs-rail') !== 'true' &&
      !!modes && modes.hasAttribute('hidden'))
  }

  // ---- A4 · temp row menu: one entrance, native or DOM ------------------
  {
    const menus = fakeMenus({ thisDependent: true, activeTag: null })
    const h = mount({ menus, listIds: ['t1'] })
    await settle()
    const row = h.doc.createElement('div')
    row.setAttribute('data-row-key', 'session:t1')
    row.textContent = 'temp row'
    h.tree.workspaces.appendChild(row)
    const label = firstOrDefault(row, 'div') || row
    h.doc.dispatchEvent({
      type: 'contextmenu', target: label, clientX: 30, clientY: 40,
      preventDefault() {}, stopPropagation() {},
    })
    await settle()
    check('A4a: native mode opens exactly one shared popup',
      menus.opens.length === 1 && !firstOrDefault(h.doc, '[data-dsbs-temp-menu]'),
      'opens=' + menus.opens.length)
  }
  {
    const menus = fakeMenus({ activeTag: { kind: 'session', value: { sessionId: 't1' } } })
    const h = mount({ menus, listIds: ['t1'] })
    await settle()
    const row = h.doc.createElement('div')
    row.setAttribute('data-row-key', 'session:t1')
    row.textContent = 'temp row'
    h.tree.workspaces.appendChild(row)
    h.doc.dispatchEvent({
      type: 'contextmenu', target: row, clientX: 30, clientY: 40,
      preventDefault() {}, stopPropagation() {},
    })
    await settle()
    check('A4b: a host-opened popup is not duplicated by ours',
      menus.opens.length === 0 && !firstOrDefault(h.doc, '[data-dsbs-temp-menu]'),
      'opens=' + menus.opens.length)
  }
  {
    const h = mount({ listIds: ['t1'] })
    await settle()
    const row = h.doc.createElement('div')
    row.setAttribute('data-row-key', 'session:t1')
    row.textContent = 'temp row'
    h.tree.workspaces.appendChild(row)
    h.doc.dispatchEvent({
      type: 'contextmenu', target: row, clientX: 30, clientY: 40,
      preventDefault() {}, stopPropagation() {},
    })
    await settle()
    const own = firstOrDefault(h.doc, '[data-dsbs-temp-menu]') ||
      firstOrDefault(h.doc.body, '[data-dsbs-temp-menu]')
    check('A4c: without a host service the DOM menu is the single entrance',
      !!own && !firstOrDefault(h.doc, '[data-dsbs-bar] [data-dsbs-temp-menu]'))
  }

  // ---- A5 · arm-then-confirm: hint, second click, deterministic expiry ---
  {
    const h = mount({ listIds: ['t1'] })
    await settle()
    // Render once to collect the stub's effects, fire them (temp list load),
    // then render again from the resulting state.
    const first = h.renderConfig()
    check('A5a: the settings page renders (React component captured)', !!first)
    for (const fn of h.hookEffects) fn()
    await new Promise((r) => setTimeout(r, 80))
    await settle()
    const tree1 = h.renderConfig()
    const list1 = findAll(tree1, (n) => n && n.props && n.props['data-dsbs-temp-list'] !== undefined)[0] || null
    const armButton = list1
      ? findAll(list1.children, (n) => n && n.props && typeof n.props.onClick === 'function' &&
          findAll(n.children, (c) => typeof c === 'string' && c.indexOf('立即删除') >= 0).length > 0)[0] || null
      : null
    check('A5b: a delete action exists on the settings page', !!armButton)
    if (armButton) {
      armButton.props.onClick({ preventDefault() {}, stopPropagation() {} })
      const tree2 = h.renderConfig()
      const list2 = findAll(tree2, (n) => n && n.props && n.props['data-dsbs-temp-list'] !== undefined)[0] || null
      const hinted = list2 &&
        findAll(list2.children, (c) => typeof c === 'string' && c.indexOf('5 秒') >= 0).length > 0
      check('A5c: the first click shows a visible confirm hint', !!hinted)
      check('A5d: the confirmation arms an expiring timer',
        h.delayed.some((d) => d.ms === 5000))
      // Fire every captured 5s expiry; the next render must be disarmed.
      for (const d of h.delayed.filter((x) => x.ms === 5000)) d.fn()
      const tree3 = h.renderConfig()
      const list3 = findAll(tree3, (n) => n && n.props && n.props['data-dsbs-temp-list'] !== undefined)[0] || null
      const stillHinted = list3 &&
        findAll(list3.children, (c) => typeof c === 'string' && c.indexOf('5 秒') >= 0).length > 0
      check('A5e: the arm clears itself after the timeout', !stillHinted)
    }
  }

  // ---- A6 · consumer tab way back: no dead column in any layout ---------
  for (const nativeGroups of [false, true]) {
    for (const mode of ['b', 'c', 'n']) {
      const h = mount({ nativeGroups, initial: { mode } })
      await settle()
      h.service.registerTab({ id: 'consumer.page', title: 'Consumer', mount() {} })
      await settle()
      h.service.activateTab('consumer.page')
      await settle()
      const strip = firstOrDefault(h.doc, '[data-dsbs-tabs]')
      check('A6: way back survives (native=' + nativeGroups + ', mode=' + mode + ')',
        !!strip && !strip.hasAttribute('hidden') &&
        h.doc.documentElement.getAttribute('data-dsbs-ptab') === 'true')
    }
  }

  // ---- A7 · feedback / diagnostics: dead sidebar still has an exit ------
  {
    const h = mount({ noSidebar: true })
    await settle()
    let tree = h.renderConfig()
    const health = findAll(tree, (n) => n && n.props && n.props['data-dsbs-health'] !== undefined)[0] || null
    check('A7a: a dead sidebar is reported as a failing health row',
      !!health && health.props['data-dsbs-health-state'] === 'fail',
      health ? 'state=' + health.props['data-dsbs-health-state'] : 'no health button')
    if (health && typeof health.props.onClick === 'function') health.props.onClick()
    tree = h.renderConfig()
    const detail = findAll(tree, (n) => n && n.props && n.props['data-dsbs-health-detail'] !== undefined)[0] || null
    const actionable = detail &&
      findAll(detail.children, (c) => typeof c === 'string' && c.indexOf('未识别') >= 0).length > 0
    check('A7b: the failing row carries an actionable detail', !!actionable,
      detail ? JSON.stringify(detail.children).slice(0, 200) : 'no detail')
  }
  {
    const h = mount({ copyFails: true })
    await settle()
    const tree = h.renderConfig()
    const copy = findAll(tree, (n) => n && n.props && n.props['data-dsbs-feedback-copy'] !== undefined)[0] || null
    check('A7c: a copy-failure control exists on the settings page', !!copy)
    if (copy) {
      copy.props.onClick({ preventDefault() {}, stopPropagation() {} })
      await settle(); await settle()
      const after = h.renderConfig()
      const failedText = findAll(after, (n) => n && n.props &&
        findAll(n.children, (c) => typeof c === 'string' && c.indexOf('复制被浏览器拒绝') >= 0).length > 0)
      check('A7d: a failed copy shows visible feedback', failedText.length > 0)
    }
  }

  // ---- A12 · a failed first settings read is retried by the poll ----------
  // The 2.5s interval used to be gated behind `loaded`, so one 503 on page
  // open stopped every later attempt until the user left and re-entered the
  // page. The next tick must read again and render the policy rows.
  {
    const h = mount({ manualIntervals: true, configFailures: 1 })
    await settle()
    h.renderConfig()
    for (const fn of h.hookEffects) fn()
    await new Promise((r) => setTimeout(r, 100))
    await settle()

    const firstTree = h.renderConfig()
    const unavailable = findAll(firstTree, (n) => n && n.props &&
      findAll(n.children, (c) => typeof c === 'string' && c.indexOf('读取不到清理设置') >= 0).length > 0)
    check('A12a: a failed first config read paints the unavailable state', unavailable.length > 0)
    const before = h.fetchCalls.filter((c) => c.method === 'GET' && c.url.indexOf('dsh-temp-session.config') >= 0).length
    check('A12b: the first read really failed', before === 1, 'config GETs=' + before)

    const timer = h.intervals.find((i) => i.ms === 2500)
    check('A12c: the settings poll was installed', !!timer)
    if (timer) {
      timer.fn()
      await new Promise((r) => setTimeout(r, 100))
      await settle()
    }
    const afterTree = h.renderConfig()
    const recovered = findAll(afterTree, (n) => n && n.props &&
      findAll(n.children, (c) => typeof c === 'string' && c.indexOf('会话默认全展开') >= 0).length > 0)
    check('A12d: the next poll retries and recovers the policy rows', recovered.length > 0)
    check('A12e: the retry issued a second config request',
      h.fetchCalls.filter((c) => c.method === 'GET' && c.url.indexOf('dsh-temp-session.config') >= 0).length >= 2)
  }

  // ---- A12b · a slow list request must not stack every 2.5s tick --------
  // The initial temp list load is still running; the poll must skip while it
  // is in flight, and neither tick may start a second list request.
  {
    const h = mount({ manualIntervals: true, listPending: true })
    await settle()
    h.renderConfig()
    for (const fn of h.hookEffects) fn()
    await new Promise((r) => setTimeout(r, 100))
    await settle()

    const listCalls = () => h.fetchCalls.filter((c) => c.url.indexOf('dsh-temp-session.list') >= 0).length
    const before = listCalls()
    check('A12f: the initial temp list request is in flight', before >= 1,
      'list requests=' + before)
    const timer = h.intervals.find((i) => i.ms === 2500)
    if (timer) {
      timer.fn()
      await settle()
      timer.fn()
      await settle()
    }
    check('A12g: a slow list poll does not stack requests', listCalls() === before,
      'before=' + before + ' after=' + listCalls())
  }

  // ---- A12c · the ordinary diagnostics read has a watchdog -------------
  // A status request that never settles used to leave the health badge on
  // "checking" until the page was remounted. The 10s timer must be armed for
  // the non-force read too, not only for the Recheck button.
  {
    const h = mount({ statusPending: true })
    await settle()
    h.renderConfig()
    for (const fn of h.hookEffects) fn()
    await new Promise((r) => setTimeout(r, 100))
    await settle()
    check('A12h: a hanging diagnostics read arms a 10s watchdog',
      h.delayed.some((d) => d.ms === 10000),
      'timers=' + h.delayed.map((d) => d.ms).join(','))
  }

  // ---- A8 · expand-all: switch is honoured, teardown clears the flag ----
  {
    const h = mount()
    await settle()
    check('A8a: expand-all is on by default with the host policy',
      h.doc.documentElement.getAttribute('data-dsbs-expand-all') === 'true')
    // The policy section loads asynchronously; collect effects, run them,
    // then render from the settled state.
    h.renderConfig()
    for (const fn of h.hookEffects) fn()
    await new Promise((r) => setTimeout(r, 80))
    await settle()
    const tree = h.renderConfig()
    // policyRow = <div><span>{label}</span><button onClick/></div>.
    const labeled = findAll(tree, (n) => n && n.props && Array.isArray(n.children) &&
      n.children.some((c) => c && c.props && Array.isArray(c.children) &&
        c.children.some((s) => typeof s === 'string' && s.indexOf('会话默认全展开') >= 0)) &&
      n.children.some((c) => c && c.props && typeof c.props.onClick === 'function'))[0] || null
    const toggle = labeled
      ? findAll(labeled.children, (n) => n && n.props && typeof n.props.onClick === 'function')[0] || null
      : null
    check('A8b: an expand-all switch is present', !!toggle)
  }
  {
    const h = mount({ status: Object.assign({}, STATUS, { expandAllSessions: false }) })
    await settle()
    check('A8c: turning expand-all off removes the rule that hides collapse buttons',
      h.doc.documentElement.getAttribute('data-dsbs-expand-all') !== 'true')
  }

  // ---- A9 · 1.1.3 window focus switch --------------------------------
  {
    const h = mount({ initial: { mode: 'b', tab: 'ext', focusOnLaunch: false } })
    await settle()
    const tree = h.renderConfig()
    const toggle = findAll(tree, (n) => n && n.props && n.props['data-dsbs-focus-window'] !== undefined)[0] || null
    check('A9a: the window-focus switch is on the settings page', !!toggle)
    check('A9b: it starts off when the profile says off',
      !!toggle && toggle.props['aria-pressed'] === 'false' &&
      findAll(toggle.children, (c) => typeof c === 'string' && c.indexOf('已关闭') >= 0).length > 0)
    if (toggle) {
      toggle.props.onClick({ preventDefault() {}, stopPropagation() {} })
      await settle()
      check('A9c: clicking it writes focusOnLaunch=true to the config form',
        h.forms.value().focusOnLaunch === true &&
        h.forms.calls.some((c) => c.ops.some((op) => op.path[0] === 'focusOnLaunch' && op.value === true)))
      const after = h.renderConfig()
      const on = findAll(after, (n) => n && n.props && n.props['data-dsbs-focus-window'] !== undefined)[0] || null
      check('A9d: the switch paints the saved state',
        !!on && on.props['aria-pressed'] === 'true' &&
        findAll(on.children, (c) => typeof c === 'string' && c.indexOf('已开启') >= 0).length > 0)
      await settle()
      check('A9e: turning it on asks the host to bring the window forward',
        h.fetchCalls.some((c) => c.method === 'POST' && c.url.indexOf('dsh-sidebar-suite.focus-window') >= 0))
    }
  }
  {
    const h = mount({ initial: { mode: 'b', tab: 'ext', focusOnLaunch: true } })
    await settle()
    check('A9f: an enabled profile is applied once at startup',
      h.fetchCalls.some((c) => c.method === 'POST' && c.url.indexOf('dsh-sidebar-suite.focus-window') >= 0))
  }

  // ---- A10 · 1.1.5 update check + manual focus test ---------------------
  {
    const h = mount({ initial: { mode: 'b', tab: 'ext', focusOnLaunch: false } })
    await settle()
    let tree = h.renderConfig()
    const updateButton = findAll(tree, (n) => n && n.props && n.props['data-dsbs-update-check'] !== undefined)[0] || null
    check('A11a: the settings page has an update-check button', !!updateButton)
    if (updateButton) {
      updateButton.props.onClick()
      await settle()
      tree = h.renderConfig()
      const resultButton = findAll(tree, (n) => n && n.props && n.props['data-dsbs-update-check'] !== undefined)[0] || null
      check('A11b: a newer npm version paints the available state',
        !!resultButton && resultButton.props['data-dsbs-update-state'] === 'available' &&
        h.fetchCalls.some((c) => c.method === 'GET' && c.url.indexOf('dsh-sidebar-suite.update-check') >= 0))
      const copyButton = findAll(tree, (n) => n && n.props && n.props['data-dsbs-update-copy'] !== undefined)[0] || null
      check('A11c: an update offers the one-line install command', !!copyButton)
    }
    const focusButton = findAll(tree, (n) => n && n.props && n.props['data-dsbs-focus-test'] !== undefined)[0] || null
    check('A11d: the window section has a test-now button', !!focusButton)
    if (focusButton) {
      focusButton.props.onClick()
      await settle()
      tree = h.renderConfig()
      const focusResult = findAll(tree, (n) => n && n.props && n.props['data-dsbs-focus-result'] !== undefined)[0] || null
      check('A11e: a successful focus test reports a visible ok result',
        !!focusResult && focusResult.props['data-dsbs-focus-result'] === 'ok',
        focusResult ? String(focusResult.props['data-dsbs-focus-result']) : 'missing')
    }
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })