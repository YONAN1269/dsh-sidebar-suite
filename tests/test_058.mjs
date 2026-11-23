// dsh-sidebar-suite 0.8.7 — host adaptation for DSH 0.2.3-alpha.2.
//
// Two behaviours were only visible against a real 0.2.3-alpha.2 host:
//
//   B. The shared row menu stopped opening from a right-click. Registering a
//      native contribution still SUCCEEDS there, so the old code dropped its
//      own menu and the two temp rows actions became unreachable. The client
//      now keeps its listener, probes the host popup and opens the shared menu
//      itself when the gesture produced none.
//   C. Creating a temp session never moved the tooltip counter, because only
//      the status payload and the id-list replies wrote `tempCountKnown`.
//
// Both are asserted here against the real client bundle mounted on the shared
// DOM stub, plus the shapes that must stay true (host already opened its popup,
// a failing shared open, and no service at all).
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { buildSidebar, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const client = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function fakeContextMenus(options) {
  const opts = options || {}
  const calls = []
  const state = { active: null }
  let unregistered = 0
  const service = {
    active: { getSnapshot: () => state.active },
    register(contribution) {
      calls.push({ kind: 'register', contribution })
      return () => { unregistered += 1 }
    },
    open(target, point) {
      calls.push({ kind: 'open', target, point })
      if (opts.openThrows) throw new Error('shared popup unavailable')
      state.active = target
    },
  }
  return {
    service, calls, state,
    opens: () => calls.filter((c) => c.kind === 'open'),
    unregistered: () => unregistered,
  }
}

function buildClient(options) {
  const opts = options || {}
  const tree = buildSidebar()
  const doc = tree.doc
  const storage = new Map()
  const created = []
  const observers = []
  const state = { width: 292 }
  const locale = { active: 'zh-CN', subs: [] }

  // The hosted session row this suite right-clicks. The badge code finds rows
  // through `[data-row-key^="session:"]`, so the same selector drives both.
  const row = doc.createElement('div')
  row.setAttribute('data-row-key', 'session:temp-1')
  const rowLabel = doc.createElement('span')
  rowLabel.textContent = '临时会话标题'
  row.appendChild(rowLabel)
  tree.region.appendChild(row)

  // The host renders this seat inside its own New-session row on rc.3+; the
  // client puts the Temp button there instead of its own bar.
  const seatRow = doc.createElement('div')
  const seat = doc.createElement('div')
  seat.setAttribute('data-dsbs-temp-anchor', '')
  seatRow.appendChild(seat)
  tree.region.appendChild(seatRow)

  const ui = {
    createNamed: () => { created.push(1); return Promise.resolve('temp-1') },
    openSession() {},
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'w1', sessionIds: [] }] }) } },
    sessions: {
      list: {
        getSnapshot: () => ({
          ids: ['temp-1'],
          byId: { 'temp-1': { displayTitle: '宿主的会话标题' } },
        }),
      },
    },
    mainReference: { sessionId: '' },
  }

  class MutationObserverStub {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this) }
    observe(target) { this.targets.push(target) }
    disconnect() { this.targets = [] }
    takeRecords() { return [] }
  }
  class ResizeObserverStub {
    constructor(callback) { this.callback = callback }
    observe() {}
    disconnect() {}
  }

  const statusPayload = {
    ok: true, showButton: true, chatModePolicy: 'hide', buttonStyle: 'pair',
    expandAllSessions: true, rowMenu: true, deleteOnExit: true,
    scheduleDelete: false, scheduleTime: '03:00',
    schedule: { enabled: false, at: '03:00', nextRunAt: null, lastRunAt: null, retryAt: null, managed: true },
    maxKept: 20, keepDeleted: true, keepDeletedDays: 7, rev: 1, tempCount: 0,
  }
  const fetchCalls = []
  const listIds = opts.listIds || []
  const fetchStub = async (url) => {
    const path = String(url)
    fetchCalls.push(path)
    const body = path.includes('dsh-temp-session.status') ? statusPayload
      : path.includes('dsh-temp-session.list') ? { ok: true, ids: listIds }
        : path.includes('dsh-temp-session.track') ? { ok: true }
          : { ok: true }
    return new Response(JSON.stringify(body), { status: 200 })
  }

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
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    fetch: fetchStub,
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: MutationObserverStub,
    ResizeObserver: ResizeObserverStub,
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

  const ReactStub = { createElement: () => null, useState: (value) => [value, () => {}], useEffect() {}, Fragment: 'Fragment' }
  const mod = sandbox.__entry.factory(() => ReactStub)
  const published = {}
  const menus = opts.menus || null
  const ctx = {
    locale: {
      getSnapshot: () => ({ active: locale.active }),
      subscribe(fn) { locale.subs.push(fn); return () => {} },
      register() { return () => {} },
    },
    effect(fn) { return fn() },
    get(name) {
      if (name === 'uiWorkspace') return ui
      return undefined
    },
    inject(deps, callback) {
      if (typeof callback !== 'function') return
      const scope = { slots: { inject() {}, register() { return () => {} } } }
      if (Array.isArray(deps) && deps.indexOf('contextMenus') >= 0 && menus) scope.contextMenus = menus.service
      callback(scope)
    },
    provide(name, value) { published[name] = value },
  }
  const rect = () => ({
    top: 0, left: 0, right: state.width, bottom: 600,
    width: state.width, height: 600, x: 0, y: 0,
  })
  tree.root.getBoundingClientRect = rect

  mod.apply(ctx)

  return {
    tree, doc, row, rowLabel, created, sandbox, fetchCalls,
    service: published.sidebarSuite || sandbox.window.__dshSidebarSuite,
    tempButton: doc.querySelector('[data-dsbs-btn="temp"]'),
    contextMenu(extra) {
      const event = {
        type: 'contextmenu',
        target: rowLabel,
        clientX: 40,
        clientY: 60,
        prevented: false,
        stopped: false,
        preventDefault() { event.prevented = true },
        stopPropagation() { event.stopped = true },
        ...(extra || {}),
      }
      doc.dispatchEvent(event)
      return event
    },
  }
}

async function main() {
  // ---- 0. source contract ------------------------------------------------
  // The listener must survive a successful native registration: that success
  // is exactly the state in which 0.2.3-alpha.2 shows no popup at all.
  check('B0: the row-menu listener is not skipped in native mode',
    !/if \(tempMenuUnmount \|\| tempMenuMode === 'native'\) return/.test(client))

  // semver excludes prereleases unless a comparator carries the same
  // major.minor.patch tuple, so `>=0.2.2-rc.1 <0.3.0-0` rejects every
  // 0.2.3-alpha/rc build — the exact host this release was verified on. The
  // second clause exists only for that; do not "simplify" it away.
  const pkg = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8'))
  check('A1: engines admits 0.2.3 prereleases, not just 0.2.2 ones',
    />=0\.2\.2-rc\.1/.test(pkg.engines.dsh) &&
    />=0\.2\.3-0 <0\.3\.0-0/.test(pkg.engines.dsh) &&
    /<0\.3\.0-0/.test(pkg.engines.dsh),
    String(pkg.engines.dsh))

  // ---- C. tooltip counter follows a creation -----------------------------
  {
    const loop = buildClient({})
    await wait(30)
    const before = loop.tempButton && loop.tempButton.title
    check('C1: the tooltip starts from the host count',
      !!before && /0 active/.test(before), String(before))
    loop.tempButton.click()
    await wait(60)
    const after = loop.tempButton.title
    check('C2: creating a temp session moves the tooltip count',
      /1 active/.test(after) && /1 个临时会话/.test(after), String(after))
  }

  // ---- B. right-click reaches the shared menu ----------------------------
  {
    const menus = fakeContextMenus()
    const loop = buildClient({ menus, listIds: ['temp-1'] })
    await wait(30)
    const registered = menus.calls.filter((c) => c.kind === 'register')
    check('B1: the client registers its two actions on rc.3+ hosts',
      registered.length === 1 &&
      registered[0].contribution.target === 'session' &&
      typeof registered[0].contribution.resolve === 'function',
      JSON.stringify(registered.map((c) => c.contribution && c.contribution.target)))

    const event = loop.contextMenu()
    await wait(20)
    const opens = menus.opens()
    check('B2: a right-click with no host popup opens the shared menu itself',
      opens.length === 1 &&
      opens[0].target && opens[0].target.kind === 'session' &&
      opens[0].target.value && opens[0].target.value.sessionId === 'temp-1',
      JSON.stringify(opens.map((c) => c.target)))
    check('B3: the opened popup is anchored at the pointer',
      !!opens[0] && opens[0].point && opens[0].point.x === 40 && opens[0].point.y === 60,
      JSON.stringify(opens[0] && opens[0].point))
    // A synthetic target must not look different from a host row's: the title
    // comes from the session store, not from the row's rendered text.
    check('B3b: the synthetic target carries the host display title',
      !!opens[0] && opens[0].target.value.displayTitle === '宿主的会话标题',
      JSON.stringify(opens[0] && opens[0].target.value))
    check('B4: the gesture is claimed so no second menu follows',
      event.prevented === true && event.stopped === true)
    check('B5: our own DOM menu stays out of the way when the host menu opens',
      !loop.tree.root.querySelector('[data-dsbs-temp-menu]'))
  }

  // A keyboard gesture (ContextMenu key / Shift+F10) fires `contextmenu` with
  // no coordinates. Taking 0,0 literally pinned the menu to the window corner;
  // both paths must anchor to the row instead.
  {
    const menus = fakeContextMenus()
    const loop = buildClient({ menus, listIds: ['temp-1'] })
    await wait(30)
    loop.row.__rect = { left: 120, top: 316, bottom: 340, right: 292 }
    loop.contextMenu({ clientX: 0, clientY: 0 })
    await wait(20)
    const opens = menus.opens()
    check('B10: a keyboard gesture anchors the shared menu to the row',
      opens.length === 1 && opens[0].point && opens[0].point.x === 120 && opens[0].point.y === 340,
      JSON.stringify(opens[0] && opens[0].point))
  }

  // Same gesture, no service: the DOM menu takes the same anchored point.
  {
    const loop = buildClient({ listIds: ['temp-1'] })
    await wait(30)
    loop.row.__rect = { left: 120, top: 316, bottom: 340, right: 292 }
    // The stub reports every element as 600px tall, which would push the menu
    // into the flip-near-the-edge branch and hide the anchor. Give this one
    // case a viewport the assertion can reason about.
    loop.sandbox.window.innerWidth = 1024
    loop.sandbox.window.innerHeight = 4000
    loop.contextMenu({ clientX: 0, clientY: 0 })
    await wait(20)
    const menu = loop.doc.body.querySelector('[data-dsbs-temp-menu]')
    const where = menu ? menu.style.left + ' / ' + menu.style.top : 'no menu'
    check('B11: a keyboard gesture anchors our own menu to the row',
      !!menu && menu.style.left === '120px' && menu.style.top === '340px', where)
  }

  // Host already opened its popup (a host that wires the gesture itself).
  {
    const menus = fakeContextMenus()
    const loop = buildClient({ menus, listIds: ['temp-1'] })
    await wait(30)
    menus.state.active = { kind: 'session', value: { sessionId: 'temp-1', displayTitle: 'x' } }
    loop.contextMenu()
    await wait(20)
    check('B6: a popup the host already opened is left alone',
      menus.opens().length === 0)
  }

  // The shared open refuses: the user must still get a menu.
  {
    const menus = fakeContextMenus({ openThrows: true })
    const loop = buildClient({ menus, listIds: ['temp-1'] })
    await wait(30)
    loop.contextMenu()
    await wait(20)
    check('B7: a failing shared open falls back to our own menu',
      !!loop.tree.root.querySelector('[data-dsbs-temp-menu]') ||
      !!loop.doc.body.querySelector('[data-dsbs-temp-menu]'))
  }

  // No service at all (rc.1/rc.2 shapes): the DOM menu is the only path.
  {
    const loop = buildClient({ listIds: ['temp-1'] })
    await wait(30)
    loop.contextMenu()
    await wait(20)
    check('B8: without the service our own menu still opens',
      !!loop.tree.root.querySelector('[data-dsbs-temp-menu]') ||
      !!loop.doc.body.querySelector('[data-dsbs-temp-menu]'))
  }

  // Rows that are not temporary belong to the host.
  {
    const menus = fakeContextMenus()
    const loop = buildClient({ menus, listIds: ['temp-1'] })
    await wait(30)
    const other = loop.doc.createElement('div')
    other.setAttribute('data-row-key', 'session:someone-else')
    const label = loop.doc.createElement('span')
    label.textContent = '普通会话'
    other.appendChild(label)
    loop.tree.region.appendChild(other)
    const event = {
      type: 'contextmenu', target: label, clientX: 10, clientY: 10,
      preventDefault() { event.prevented = true },
      stopPropagation() { event.stopped = true },
    }
    loop.doc.dispatchEvent(event)
    await wait(20)
    check('B9: a normal session row keeps the host menu untouched',
      menus.opens().length === 0 && event.prevented !== true && event.stopped !== true)
  }

  await settle()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

await main()
