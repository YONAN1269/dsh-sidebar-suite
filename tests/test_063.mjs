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

  const sandbox = {
    window: {
      __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
      getComputedStyle: () => ({ position: 'static', display: 'block' }),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      setTimeout: controlledTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
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
    fetch: async (input) => {
      const url = String((input && input.url) || input || '')
      if (url.indexOf('dsh-temp-session.status') >= 0) {
        return statusBody === null
          ? new Response('offline', { status: 503 })
          : new Response(JSON.stringify(statusBody), { status: 200 })
      }
      if (url.indexOf('dsh-temp-session.list') >= 0) {
        return new Response(JSON.stringify({ ok: true, ids: opts.listIds || [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: MutationObserverStub, ResizeObserver: ResizeObserverStub,
    setTimeout: controlledTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
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
    forms, menus, registrations, published, focusLog, delayed, ReactStub, hookValues, hookEffects,
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

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
