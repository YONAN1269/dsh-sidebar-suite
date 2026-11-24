// dsh-sidebar-suite 0.8.11 — second review round: dead ends, keyboard and
// a stale dictionary key.
//
// Six findings, all confirmed against the real bundle / host source:
//   A  on rc.2+ hosts a consumer tab owns the column with every way back hidden
//   B  the collapsed-rail radiogroup cannot be driven by arrow keys
//   C  a lost concurrent setField write rolls back over a newer value
//   D  the create watchdog and the track POST share one 20s deadline
//   E  the zh dictionary never got temp.countSuffix, so Chinese users see English
//   F  two docs still describe a single engine range and "9 config keys"
//
// The three behavioural ones (A/B/C) run the real client against the DOM stub.
// D/E/F are shape checks: a timer budget, a dictionary pair and prose, none of
// which the harness can render.
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { buildSidebar, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const read = (p) => fs.readFileSync(ROOT + '/' + p, 'utf8')
const client = read('lib/client.js')
const pkg = JSON.parse(read('package.json'))
const detail = read('DETAIL.md')
const readme = read('README.md')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}
const settle = () => new Promise((r) => setTimeout(r, 0))

function fakeConfigForms(initial, mode) {
  const value = Object.assign({}, initial)
  const subs = []
  let revision = 1
  const calls = []
  const controller = {
    getSnapshot: () => ({ value: Object.assign({}, value), revision }),
    subscribe(fn) { subs.push(fn); return () => {} },
    mutate(ops) {
      calls.push({ ops: JSON.parse(JSON.stringify(ops)), revision })
      if (mode && mode.refuseNext > 0) {
        mode.refuseNext -= 1
        // The real host resolves the revision in its queue and answers false.
        return false
      }
      for (const op of ops) value[op.path[0]] = op.value
      revision += 1
      for (const fn of subs) fn()
      return Promise.resolve({ ok: true })
    },
  }
  return { get: () => controller, calls, value: () => value }
}

// A host with native "More" grouping: the strip is redundant there, which is
// exactly what makes a consumer-activated page a dead end if nothing survives.
function buildClient(options) {
  const opts = options || {}
  const tree = buildSidebar()
  const doc = tree.doc
  const storage = new Map()
  const created = []
  const forms = opts.forms || fakeConfigForms({ mode: 'b', tab: 'ext' })
  const nativeGrouping = opts.nativeGrouping !== false
  const slotListeners = {}
  const tabs = []
  const width = opts.width || 292

  class MutationObserverStub { observe() {} disconnect() {} takeRecords() { return [] } }
  class ResizeObserverStub { observe() {} disconnect() {} }

  const sandbox = {
    window: {
      __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
      getComputedStyle: () => ({ position: 'static', display: 'block' }),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
      open() { return null },
    },
    document: doc,
    navigator: { language: 'zh-CN', clipboard: { writeText: () => Promise.resolve() } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    fetch: async () => new Response('{"ok":true,"ids":[]}', { status: 200 }),
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: MutationObserverStub, ResizeObserver: ResizeObserverStub,
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
    requestAnimationFrame: (cb) => sbTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console,
  }
  sandbox.window.document = doc
  sandbox.window.localStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(client, sandbox, { filename: 'client.js' })

  const ReactStub = { createElement: () => null, useState: (v) => [v, () => {}], useEffect() {}, Fragment: 'Fragment' }
  const mod = sandbox.__entry.factory(() => ReactStub)
  const published = {}
  const slots = {
    inject() {},
    register() { return () => {} },
    entriesOfSlot(name) {
      return name === 'sidebar.panellist.actions' && nativeGrouping ? [{ id: 'more' }] : []
    },
    subscribe(name, fn) {
      if (!slotListeners[name]) slotListeners[name] = []
      slotListeners[name].push(fn)
      return () => { slotListeners[name] = slotListeners[name].filter((f) => f !== fn) }
    },
  }
  const ui = {
    createNamed: (args) => { created.push(args); return Promise.resolve('temp-1') },
    openSession() {},
    workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
    sessions: { list: { getSnapshot: () => ({ ids: [] }) } },
    mainReference: { sessionId: '' },
  }
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe() { return () => {} }, register() { return () => {} } },
    effect(fn) { return fn() },
    get(name) {
      if (name === 'configForms') return forms.get()
      if (name === 'uiWorkspace') return ui
      return undefined
    },
    inject(deps, cb) {
      if (typeof cb === 'function') cb({ slots, configForms: forms.get(), contextMenus: { register() { return () => {} } } })
    },
    provide(name, value) { published[name] = value },
  }
  tree.root.getBoundingClientRect = () => ({
    top: 0, left: 0, right: width, bottom: 600,
    width, height: 600, x: 0, y: 0,
  })
  mod.apply(ctx)
  return {
    tree, doc, service: published.sidebarSuite, slots, slotListeners, forms, created,
    register(desc) { const dispose = mod && published.sidebarSuite.registerTab(desc); tabs.push(dispose); return dispose },
  }
}

async function main() {
  check('A0: this suite is wired into npm test', /test_061\.mjs/.test(pkg.scripts.test || ''))

  // ---- A. a consumer tab must never hide every way back ----------------
  const host = buildClient({ nativeGrouping: true })
  await settle()
  host.register({ id: 'consumer.page', title: 'Consumer', mount() {} })
  await settle()
  const strip = host.doc.querySelector('[data-dsbs-tabs]')
  const bar = host.doc.querySelector('[data-dsbs-bar]')
  const html = host.doc.documentElement
  check('A1: a native-grouping host starts with the redundant strip hidden',
    !!strip && strip.hasAttribute('hidden'))

  const activated = host.service.activateTab('consumer.page')
  await settle()
  check('A2: activating a consumer tab succeeds even on a native host', activated === true)
  check('A3: a consumer tab owns the column', html.getAttribute('data-dsbs-ptab') === 'true')
  // This is the regression: with the strip, bar AND rail all hidden, the user
  // is standing on a page with no control to click back to the session list.
  check('A4: the way back survives — the strip is shown while a plugin tab owns the column',
    !!strip && !strip.hasAttribute('hidden'),
    'strip hidden=' + (strip && strip.hasAttribute('hidden')))

  // The host can populate the native grouping later; an already-open page must
  // be released then (the existing rule), not become a second dead end.
  for (const fn of (host.slotListeners['sidebar.panellist.actions'] || [])) fn()
  await settle()
  check('A5: the strip still yields to native grouping once the consumer page is closed',
    host.service.activateTab(null) === true)
  await settle()
  check('A5: no active tab means the strip is hidden on a native host',
    !!strip && strip.hasAttribute('hidden'))

  // ---- B. the collapsed rail radiogroup is keyboard-complete ------------
  const rail = buildClient({ width: 80, nativeGrouping: false })
  await settle()
  const menu = rail.doc.querySelector('[data-dsbs-rail-menu]')
  const trigger = menu && menu.querySelector('[data-dsbs-rail-trigger]')
  const panel = menu && menu.querySelector('[data-dsbs-rail-panel]')
  const modes = panel && Array.from(panel.querySelectorAll('[data-dsbs-rail-mode]'))
  check('B0: the rail renders a three-option radiogroup', !!panel && modes.length === 3)

  // Only the selected option may be a Tab stop; the others are arrow-reachable.
  check('B1: the selected option is the only Tab stop',
    !!modes && modes.filter((b) => b.getAttribute('tabindex') === '0').length === 1,
    modes && modes.map((b) => b.getAttribute('tabindex')).join(','))
  check('B2: unselected options are out of the Tab order',
    !!modes && modes.filter((b) => b.getAttribute('tabindex') === '-1').length === 2)

  const focused = []
  modes.forEach((b, i) => { b.focus = () => { focused.push(i) } })
  const group = panel.querySelector('[data-dsbs-rail-modes]')
  // The handler listens on the radiogroup and reads event.target to locate the
  // focused radio. Dispatch from the selected radio so target is that button.
  const selected = modes.findIndex((b) => b.getAttribute('aria-checked') === 'true')
  const key = (k) => {
    const ev = { type: 'keydown', key: k, target: modes[selected] }
    ev.preventDefault = () => {}
    ev.stopPropagation = () => {}
    group.dispatchEvent(ev)
  }
  key('ArrowRight')
  check('B3: ArrowRight moves focus to the next layout', focused.length === 1 && focused[0] === (selected + 1) % modes.length,
    JSON.stringify(focused))
  key('Home')
  check('B4: Home moves focus to the first layout', focused.length === 2 && focused[1] === 0)
  key('End')
  check('B5: End moves focus to the last layout', focused.length === 3 && focused[2] === modes.length - 1)

  // ---- C. a rejected write must not roll back over a newer value --------
  // Two writes to the SAME field can overlap: the first is refused twice by
  // the host revision queue while a later click lands. A conditional on the
  // *value* cannot tell those apart (both carry the second value), so the
  // guard has to be a monotonically increasing write sequence. Assert the
  // structure rather than fake a race the DOM stub cannot schedule.
  check('C1: setField gives every write a sequence number',
    /var writeSeq = 0/.test(client) && /var seq = \+\+writeSeq/.test(client))
  check('C2: the rollback only fires for the newest write',
    /if \(!failed && seq === writeSeq\)/.test(client) ||
    /if \(seq === writeSeq\)/.test(client))
  check('C3: the failure toast still names the control',
    /toast\(t\('policy\.failed'\)/.test(client) && /fieldLabel\(field\)/.test(client))

  // ---- D. two watchdogs must not both shout at 20s ----------------------
  const watchdogBody = (client.match(/tempWatchdog = setTimeout\(function \(\) \{[\s\S]{0,400}?\}, ([^)]+)\)/) || [])[1] || ''
  check('D1: the watchdog budget is derived from the request budget, not a bare 20000',
    /WRITE_TIMEOUT_MS \+ \d+/.test(watchdogBody) && !/^\d+$/.test(watchdogBody),
    watchdogBody)

  // ---- E. both dictionaries carry the live temp count -------------------
  const dictBlock = client.slice(client.indexOf('var DICTS = {'), client.indexOf('function detectLand'))
  const enBlock = client.slice(client.indexOf('en: {'), client.indexOf('zh: {'))
  const zhBlock = client.slice(client.indexOf('zh: {'), client.indexOf('function detectLang'))
  check('E0: both dictionaries are present', !!enBlock && !!zhBlock)
  check('E1: the English dictionary carries temp.countSuffix',
    enBlock.includes("'temp.countSuffix':"))
  check('E2: the Chinese dictionary carries temp.countSuffix',
    zhBlock.includes("'temp.countSuffix':"))
  const zhSuffix = (zhBlock.match(/'temp\.countSuffix':\s*'([^']*)'/) || [])[1] || ''
  check('E3: the Chinese suffix is Chinese, not the English fallback',
    zhSuffix.includes('{n}') && /[\u4e00-\u9fa5]/.test(zhSuffix) && !/active/i.test(zhSuffix),
    zhSuffix)
  void dictBlock

  // ---- F. shipped docs describe the shipped contracts ------------------
  const engineLine = (detail.match(/engines\.dsh = "[^"]+"/) || [])[0] || ''
  check('F1: DETAIL.md shows the two-range engine requirement',
    engineLine.includes('||') && engineLine.includes('0.2.3'),
    engineLine)
  check('F2: README no longer claims nine config keys',
    !/全部 9 项/.test(readme) && !/全部 9 项/.test(client))
  check('F3: the package description no longer claims nine config keys',
    !/全部 9 项/.test(pkg.description || ''))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
