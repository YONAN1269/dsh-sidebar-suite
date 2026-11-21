// dsh-sidebar-suite 0.8.3 — collapsed rail menu.
//
// The rail hides [data-dsbs-bar] and the Temp button. This suite drives the
// REAL client.js at 80px / 292px and proves that one menu survives, that its
// panel can always be closed, and that a wide column never gains a duplicate
// control. The DOM stub used by the rest of the suite is fixed at 292px, so
// the width is overridden here rather than changing the shared stub.
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { El, Doc, buildSidebar, matchSelector, sbTimeout, sbInterval } from './dom-stub.mjs'

void El; void Doc; void matchSelector

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const client = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')
const pkg = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8'))
const guide = fs.readFileSync(ROOT + '/使用说明.md', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// What a person actually sees: `hidden` sections are still in textContent, so
// a raw dump would claim the band panel carries the layout pills.
function visibleText(node) {
  if (!node) return ''
  if (typeof node.hasAttribute === 'function' && node.hasAttribute('hidden')) return ''
  if (!node.children || !node.children.length) return node.textContent || ''
  return node.children.map(visibleText).filter(Boolean).join(' · ')
}

function fakeConfigForms(initial) {
  const value = Object.assign({}, initial)
  const subs = []
  let revision = 1
  const calls = []
  const controller = {
    getSnapshot: () => ({ value: Object.assign({}, value), revision }),
    subscribe(fn) { subs.push(fn); return () => {} },
    mutate(ops) {
      calls.push(ops)
      for (const op of ops) value[op.path[0]] = op.value
      revision += 1
      for (const fn of subs) fn()
      return Promise.resolve({ ok: true })
    },
  }
  return { get: () => controller, calls }
}

function buildClient(width, configForms, opts = {}) {
  const tree = buildSidebar()
  const doc = tree.doc
  const storage = new Map()
  const created = []
  const observers = []
  const state = { width }
  const locale = { active: 'zh-CN', subs: [] }
  const deferred = { resolve: null }
  const ui = {
    createNamed: (args) => {
      created.push(args)
      if (opts.defer) return new Promise((resolve) => { deferred.resolve = resolve })
      return Promise.resolve('temp-' + created.length)
    },
    openSession() {},
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'w1', sessionIds: [] }] }) } },
    sessions: { list: { getSnapshot: () => ({ ids: [] }) } },
    mainReference: { sessionId: '' },
  }

  // The 100-170px band only exists when the host exposes a Temp seat: that seat
  // is what gets hidden and what the menu has to replace. Without a seat there
  // is nothing hidden, so the menu must stay away.
  let seatRow = null
  if (opts.seat) {
    seatRow = doc.createElement('div')
    const seat = doc.createElement('div')
    seat.setAttribute('data-dsbs-temp-anchor', '')
    seatRow.appendChild(seat)
    tree.region.appendChild(seatRow)
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
    fetch: async () => new Response('{"ok":true}', { status: 200 }),
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
  const ctx = {
    locale: {
      getSnapshot: () => ({ active: locale.active }),
      subscribe(fn) { locale.subs.push(fn); return () => {} },
      register() { return () => {} },
    },
    effect(fn) { return fn() },
    get(name) {
      if (name === 'configForms' && configForms) return configForms.get()
      if (name === 'uiWorkspace') return ui
      return undefined
    },
    inject(deps, callback) {
      if (typeof callback === 'function') callback({ slots: { inject() {}, register() { return () => {} } }, configForms: undefined })
    },
    provide(name, value) { published[name] = value },
  }
  // The rects must answer before the first paint: the temp seat is measured on
  // mount, and that measurement is what decides whether the button is hidden.
  const rect = () => ({
    top: 0, left: 0, right: state.width, bottom: 600,
    width: state.width, height: 600, x: 0, y: 0,
  })
  tree.root.getBoundingClientRect = rect
  if (seatRow) seatRow.getBoundingClientRect = rect

  mod.apply(ctx)

  return {
    tree, state, created, storage, observers, deferred,
    service: published.sidebarSuite || sandbox.window.__dshSidebarSuite,
    doc, sandbox,
    setLocale(lang) {
      locale.active = lang
      doc.documentElement.setAttribute('lang', lang)
      sandbox.navigator.language = lang
      for (const fn of locale.subs) fn()
    },
  }
}

// A width change alone is invisible to the client: the host normally fires a
// ResizeObserver. Drive the same observer the plugin installed, then settle.
async function resize(loop, width) {
  loop.state.width = width
  const observer = loop.observers.find((entry) => entry.targets.length)
  if (observer) observer.callback([])
  await settle()
  await settle()
}

async function main() {
  // ---- 0. source contracts ----------------------------------------------
  check('A0: rail menu is not a child of the bar',
    client.includes("menu.setAttribute('data-dsbs-rail-menu', '')") &&
    !/buildBar\([\s\S]{0,2200}rail-menu/.test(client))
  check('A0: wide mode hides the rail menu through its hidden attribute',
    /paintRailMenu\(state, !!pluginTab\)/.test(client) &&
    /if \(visible\) menu\.removeAttribute\('hidden'\)\s*else menu\.setAttribute\('hidden', ''\)/.test(client))
  check('A0: plugin tab also hides the rail menu',
    /var band = pluginTab === true \? '' : railMenuBand\(\)/.test(client) &&
    /html\[data-dsbs-ptab="true"\] \[data-dsbs-rail-menu\]\{display:none!important\}/.test(client))
  check('A0: the rail trigger is icon-only, like every other glyph button',
    /'\[data-dsbs-rail-menu\] > button\{[^']*font-size:0/.test(client) &&
    /'\[data-dsbs-rail-menu\] > button\{[^']*overflow:hidden/.test(client))
  check('A0: this suite is wired into npm test', /test_055\.mjs/.test(pkg.scripts.test || ''))
  check('A0: the guide explains the rail entry', /图标条/.test(guide) && /侧栏菜单/.test(guide))
  // 0.8.3 shipped the note above as if every build kept a narrow rail. The host
  // collapses to 0px on Windows desktop, so the guide has to say so — otherwise
  // Windows users go looking for a button that cannot exist.
  check('A0: the guide states the Windows desktop collapse is 0px, not a rail',
    /Windows 桌面版/.test(guide) && /整条消失/.test(guide) && /264–420px/.test(guide))

  const forms = fakeConfigForms({ mode: 'b', tab: 'ext', showQuickSwitch: false })
  const loop = buildClient(292, forms)
  await settle()
  const html = loop.doc.documentElement
  const menu = loop.tree.root.querySelector('[data-dsbs-rail-menu]')
  const trigger = menu && menu.querySelector('[data-dsbs-rail-trigger]')
  const panel = menu && menu.querySelector('[data-dsbs-rail-panel]')
  const bar = loop.tree.root.querySelector('[data-dsbs-bar]')

  check('A1: a 292px column renders the original bar, not the rail menu',
    !!bar && !bar.hasAttribute('hidden') && !!menu && menu.hasAttribute('hidden'))

  // ---- 1. the rail itself ------------------------------------------------
  await resize(loop, 80)
  check('A2: 80px sets the rail flag', html.getAttribute('data-dsbs-rail') === 'true')
  check('A2: the rail menu is back and starts closed',
    !menu.hasAttribute('hidden') && panel.hasAttribute('hidden') &&
    trigger.getAttribute('aria-expanded') === 'false')

  const modeButtons = panel.querySelectorAll('[data-dsbs-rail-mode]')
  const tempRow = panel.querySelector('[data-dsbs-rail-temp]')
  check('A3: the panel offers exactly the three layouts',
    modeButtons.length === 3 &&
    modeButtons.map((b) => b.getAttribute('data-dsbs-rail-mode')).join(',') === 'b,c,n' &&
    !!tempRow)
  // role=menu without arrow keys is a promise the panel does not keep, and
  // menuitemradio + aria-pressed is not a valid pair. The panel is a dialog and
  // the three layouts are radios that report aria-checked.
  check('A3: the panel uses dialog + radio semantics',
    panel.getAttribute('role') === 'dialog' &&
    panel.querySelector('[data-dsbs-rail-modes]').getAttribute('role') === 'radiogroup' &&
    modeButtons.every((b) => b.getAttribute('role') === 'radio' &&
      b.hasAttribute('aria-checked') && !b.hasAttribute('aria-pressed')))
  // 212px split three ways wrapped 「官方默认」 onto two lines in the real host;
  // the widest row needs ~228px, so the panel ships at 236 and never wraps.
  check('A3: the panel is wide enough for the longest layout label',
    /\[data-dsbs-rail-panel\]\{[^']*width:236px/.test(client) &&
    /\[data-dsbs-rail-panel\] \[data-dsbs-rail-mode\]\{[^']*white-space:nowrap/.test(client))

  let focused = 0
  trigger.focus = () => { focused += 1 }
  // A row inside a hidden panel cannot take focus, so opening has to reveal the
  // panel *before* it calls focus() on the first row.
  let focusHidden = null
  modeButtons[0].focus = () => { focusHidden = panel.hasAttribute('hidden') }
  trigger.click()
  await settle()
  check('A4: clicking the only trigger opens the panel',
    !panel.hasAttribute('hidden') && trigger.getAttribute('aria-expanded') === 'true')
  check('A4: the panel is revealed before focus moves into it',
    focusHidden === false, 'panel still hidden at focus time: ' + focusHidden)
  console.log('UI-SNAPSHOT rail-panel: ' + JSON.stringify(visibleText(panel).slice(0, 200)))

  // ---- 2. layout pick is session-only and closes the panel ---------------
  const nButton = modeButtons.filter((b) => b.getAttribute('data-dsbs-rail-mode') === 'n')[0]
  check('A5: a rail layout button exists for n', !!nButton)
  nButton.click()
  await settle()
  check('A5: picking n in the rail changes the layout', html.getAttribute('data-dsbs-mode') === 'n')
  check('A5: the picked layout reports aria-checked', nButton.getAttribute('aria-checked') === 'true')
  check('A5: the panel closes after the pick',
    panel.hasAttribute('hidden') && trigger.getAttribute('aria-expanded') === 'false')
  check('A6: a rail pick stays session-only (no config mutation)', forms.calls.length === 0)
  check('A6: a rail pick never writes local storage', !loop.storage.has('dsh-sidebar-suite:state'))

  // ---- 3. temp action is the relocated native action ---------------------
  trigger.click()
  await settle()
  tempRow.click()
  await settle()
  await settle()
  check('A7: the rail temp row calls the same host creation path once', loop.created.length === 1,
    'calls=' + loop.created.length)
  check('A7: the panel closes after creating a session', panel.hasAttribute('hidden'))

  // ---- 4. every close path is reachable ---------------------------------
  trigger.click()
  await settle()
  loop.doc.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true })
  await settle()
  check('A8: Escape closes the panel', panel.hasAttribute('hidden'))
  check('A8: Escape hands focus back to the trigger', focused > 0)

  trigger.click()
  await settle()
  loop.doc.dispatchEvent({ type: 'pointerdown', target: loop.tree.nav, bubbles: true })
  await settle()
  check('A9: an outside pointerdown closes the panel', panel.hasAttribute('hidden'))
  const focusAfterOutside = focused
  loop.doc.dispatchEvent({ type: 'pointerdown', target: loop.tree.nav, bubbles: true })
  await settle()
  check('A9: a second outside click does not steal focus', focused === focusAfterOutside)

  // ---- 4b. the trigger is the second close path -------------------------
  // Opening moves focus into the panel, so closing with the same button has to
  // hand it back; otherwise the browser drops it on <body> and the next Tab
  // restarts from the top of the page.
  const beforeToggle = focused
  trigger.click()
  await settle()
  trigger.click()
  await settle()
  check('A12: the trigger closes the panel', panel.hasAttribute('hidden'))
  check('A12: closing with the trigger hands focus back to it',
    focused === beforeToggle + 1, 'focus calls=' + (focused - beforeToggle))

  // ---- 5. a consumer tab still owns the column ---------------------------
  loop.service.registerTab({
    id: 'rail-probe',
    title: '探针',
    mount(container) { container.appendChild(loop.doc.createElement('div')) },
  })
  await settle()
  loop.service.activateTab('rail-probe')
  await settle()
  check('A10: a plugin tab hides the rail menu too', menu.hasAttribute('hidden'))
  check('A10: the tab strip remains the way back out',
    !loop.tree.root.querySelector('[data-dsbs-tabs]').hasAttribute('hidden'))
  loop.service.activateTab(null)
  await settle()
  check('A10: leaving the plugin tab restores the rail menu', !menu.hasAttribute('hidden'))

  // The tab path hides the menu without painting it, so an open panel must not
  // come back by itself once the tab is closed again.
  trigger.click()
  await settle()
  loop.service.activateTab('rail-probe')
  await settle()
  loop.service.activateTab(null)
  await settle()
  check('A10: closing the plugin tab does not resurrect the panel opened before it',
    panel.hasAttribute('hidden'))

  // ---- 6. leaving the rail cannot strand an open panel -------------------
  trigger.click()
  await settle()
  await resize(loop, 292)
  check('A11: widening closes the panel', panel.hasAttribute('hidden') && menu.hasAttribute('hidden'))
  check('A11: the layout picked inside the rail survives the widening',
    html.getAttribute('data-dsbs-mode') === 'n')
  await resize(loop, 80)
  check('A11: re-entering the rail does not resurrect the closed panel',
    panel.hasAttribute('hidden'))

  // A fresh column that was never touched still restores what it saved.
  {
    const fresh = buildClient(292)
    await settle()
    await resize(fresh, 80)
    const freshMenu = fresh.tree.root.querySelector('[data-dsbs-rail-menu]')
    freshMenu.querySelector('[data-dsbs-rail-trigger]').click()
    await settle()
    await resize(fresh, 292)
    check('A11: an untouched rail still restores the old layout',
      fresh.doc.documentElement.getAttribute('data-dsbs-mode') === 'b' &&
      freshMenu.querySelector('[data-dsbs-rail-panel]').hasAttribute('hidden'))
  }

  // ---- 7. the 100-170px band: only the Temp button is gone --------------
  // `[data-dsbs-temp-solo]` hides the whole Temp seat between 100 and 170px
  // while the bar is still usable. The menu has to appear for that one action
  // and must NOT repeat the layout pills that are still on screen.
  {
    const bandForms = fakeConfigForms({ mode: 'b', tab: 'ext', showQuickSwitch: false })
    const band = buildClient(292, bandForms, { seat: true })
    await settle()
    const bandHtml = band.doc.documentElement
    const bandMenu = band.tree.root.querySelector('[data-dsbs-rail-menu]')
    const bandTrigger = bandMenu && bandMenu.querySelector('[data-dsbs-rail-trigger]')
    const bandPanel = bandMenu && bandMenu.querySelector('[data-dsbs-rail-panel]')
    const bandHead = bandMenu && bandMenu.querySelector('[data-dsbs-rail-head]')
    const bandModes = bandMenu && bandMenu.querySelector('[data-dsbs-rail-modes]')
    const bandTemp = bandMenu && bandMenu.querySelector('[data-dsbs-rail-temp]')

    check('B1: a wide column with a Temp seat shows no rail menu',
      !!bandMenu && bandMenu.hasAttribute('hidden') &&
      bandHtml.getAttribute('data-dsbs-temp-solo') === null)

    await resize(band, 140)
    check('B2: 140px hides the Temp seat but is not the rail',
      bandHtml.getAttribute('data-dsbs-temp-solo') === 'true' &&
      bandHtml.getAttribute('data-dsbs-rail') !== 'true')
    check('B3: the menu still appears so the action stays reachable',
      !!bandMenu && !bandMenu.hasAttribute('hidden'))
    check('B3: the panel does not repeat the layout pills still in the bar',
      !!bandModes && bandModes.hasAttribute('hidden') &&
      !!bandHead && bandHead.hasAttribute('hidden'))
    check('B3: the panel keeps the temporary-session row',
      !!bandTemp && !bandTemp.hasAttribute('hidden'))

    bandTrigger.click()
    await settle()
    check('B4: the band panel opens and holds one action',
      !!bandPanel && !bandPanel.hasAttribute('hidden'))
    console.log('UI-SNAPSHOT band-panel: ' + JSON.stringify(visibleText(bandPanel).slice(0, 200)))
    bandTemp.click()
    await settle()
    await settle()
    check('B4: the band row creates exactly one session', band.created.length === 1,
      'calls=' + band.created.length)
    check('B4: the band panel closes after the pick', bandPanel.hasAttribute('hidden'))

    await resize(band, 292)
    check('B5: widening again retires the menu and restores the seat',
      bandMenu.hasAttribute('hidden') && bandHtml.getAttribute('data-dsbs-temp-solo') === null)

    // No seat at all: nothing was hidden, so nothing may be added.
    const bare = buildClient(140)
    await settle()
    const bareMenu = bare.tree.root.querySelector('[data-dsbs-rail-menu]')
    check('B6: without a Temp seat the band adds no entry',
      !!bareMenu && bareMenu.hasAttribute('hidden'))
  }

  // ---- 8. a create in flight must not look like a dead button -----------
  {
    const slowForms = fakeConfigForms({ mode: 'b', tab: 'ext', showQuickSwitch: false })
    const slow = buildClient(292, slowForms, { defer: true })
    await settle()
    await resize(slow, 80)
    const slowMenu = slow.tree.root.querySelector('[data-dsbs-rail-menu]')
    const slowTrigger = slowMenu.querySelector('[data-dsbs-rail-trigger]')
    const slowPanel = slowMenu.querySelector('[data-dsbs-rail-panel]')
    const slowTemp = slowMenu.querySelector('[data-dsbs-rail-temp]')
    slowTrigger.click()
    await settle()
    slowTemp.click()
    await settle()
    check('C1: the first click starts a create', slow.created.length === 1)
    slowTrigger.click()
    await settle()
    await settle()
    check('C2: while the create is in flight the row reports the busy state',
      slowTemp.hasAttribute('disabled') && /创建|Creating/.test(slowTemp.textContent || ''),
      JSON.stringify(slowTemp.textContent))
    slowTemp.click()
    await settle()
    check('C3: a click while busy creates nothing', slow.created.length === 1,
      'calls=' + slow.created.length)
    check('C3: a click while busy leaves the panel open instead of pretending',
      !slowPanel.hasAttribute('hidden'))
    if (typeof slow.deferred.resolve === 'function') slow.deferred.resolve('temp-1')
    await settle()
    await settle()
    check('C4: the busy state is released once the create settles',
      !slowTemp.hasAttribute('disabled') && slowTemp.textContent === '新建临时会话',
      JSON.stringify(slowTemp.textContent))
  }

  // ---- 9. the panel follows the UI language ------------------------------
  {
    const locForms = fakeConfigForms({ mode: 'b', tab: 'ext', showQuickSwitch: false })
    const loc = buildClient(292, locForms)
    await settle()
    await resize(loc, 80)
    const locMenu = loc.tree.root.querySelector('[data-dsbs-rail-menu]')
    const locTrigger = locMenu.querySelector('[data-dsbs-rail-trigger]')
    const locTemp = locMenu.querySelector('[data-dsbs-rail-temp]')
    const locBarButton = loc.tree.root.querySelector('[data-dsbs-bar] button[data-dsbs-label]')
    check('D1: the rail starts in the active language', locTrigger.textContent === '侧栏菜单',
      locTrigger.textContent)
    const barBefore = locBarButton && locBarButton.textContent
    loc.setLocale('en-US')
    await settle()
    await settle()
    check('D2: the bar follows a language switch',
      barBefore === '标签页' && !!locBarButton && locBarButton.textContent === 'Toggle',
      barBefore + ' -> ' + (locBarButton && locBarButton.textContent))
    check('D3: the rail trigger follows too', locTrigger.textContent === 'Sidebar menu',
      locTrigger.textContent)
    check('D3: the panel rows follow too', locTemp.textContent === 'New temporary session',
      locTemp.textContent)
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main().catch((error) => { console.error('test_055 crashed:', error); process.exitCode = 1 })
