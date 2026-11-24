// dsh-sidebar-suite 0.8.10 — a review pass over the toolbar, the tab strip,
// the toast and the shipped locales.
//
// Five of the six fixes here are cosmetic-or-worse in the sense that nothing
// crashed: a 4px kink in the sidebar gutter, a divider that drifted to the
// middle of the column when Cycle was on, a tablist the keyboard could not
// drive, a live region that announced failures too late, and an English locale
// that shipped Chinese. Those are exactly the kind of thing a source regex
// cannot really check, so the strip and the toast are driven through the real
// bundle here; only the two CSS rules are asserted as text (there is no layout
// engine in this harness).
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { buildSidebar, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const read = (p) => fs.readFileSync(ROOT + '/' + p, 'utf8')
const client = read('lib/client.js')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

// ---------------------------------------------------------------- harness
function buildClient(options) {
  const settings = options || {}
  const tree = buildSidebar()
  const doc = tree.doc
  const storage = new Map()

  // The Temp button only exists once it has somewhere to sit: either the host's
  // `sidebar.session.action` seat or its own New-session button. The stub tree
  // has neither, so give it the button the bundle looks for.
  if (settings.nativeNewSession !== false) {
    const native = doc.createElement('button')
    native.className = 'wtg9ga_newSession'
    native.textContent = '新会话'
    tree.root.appendChild(native)
  }

  class MutationObserverStub {
    constructor(callback) { this.callback = callback }
    observe() {}
    disconnect() {}
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
    fetch: settings.fetch || (async () => new Response('{}', { status: 404 })),
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
    locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe() { return () => {} }, register() { return () => {} } },
    effect(fn) { return fn() },
    get(name) {
      if (settings.services && Object.prototype.hasOwnProperty.call(settings.services, name)) return settings.services[name]
      return undefined
    },
    inject(deps, callback) {
      if (typeof callback === 'function') callback({ slots: { inject() {}, register() { return () => {} } }, configForms: undefined })
    },
    provide(name, value) { published[name] = value },
  }
  mod.apply(ctx)
  return { tree, service: published.sidebarSuite || sandbox.window.__dshSidebarSuite, doc, sandbox }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// ---------------------------------------------------------------- 1. gutter
// The host's own rows use `margin: 0 calc(var(--dsh-sidebar-paint-inset) + 1px)`.
// The bar is injected one box further out (scrollRegion), so without that same
// inline margin the pill sat 4 CSS px left of the New-session button — measured
// as 36px vs 46px at 250% scaling, i.e. a visible kink in a straight gutter.
const barRule = (client.split('[data-dsbs-bar]{display:flex;flex-wrap:wrap')[1] || '').split('}')[0]
check('gutter: the bar repeats the host row\'s inline margin expression',
  barRule.includes('margin:0 calc(var(--dsh-sidebar-paint-inset,3px) + 1px)'), barRule.slice(0, 120))
check('gutter: the margin keeps a literal fallback for hosts without the variable',
  barRule.includes('var(--dsh-sidebar-paint-inset,3px)'))

// ---------------------------------------------------------------- 2. divider
// `[data-dsbs-bar]>span{margin-left:auto}` is what pushes the action group to
// the right edge. Cycle carried a second auto margin, and two auto margins
// split the free space: the divider ended up mid-column, the button at the far
// right, with a hole between them. Only the divider may claim that space.
const quickRule = (client.split('[data-dsbs-bar] button[data-dsbs-btn="quick"]{')[1] || '').split('}')[0]
const sepRule = (client.split('[data-dsbs-bar]>span{margin-left:auto')[1] || '').split('}')[0]
check('divider: the divider still owns the auto margin',
  /\[data-dsbs-bar\]>span\{margin-left:auto/.test(client), sepRule.slice(0, 60))
check('divider: Cycle no longer competes for it',
  !quickRule.includes('margin-left:auto'), quickRule)
check('divider: Cycle keeps its own colour and padding',
  quickRule.includes('padding:2px 6px') && quickRule.includes('label-tertiary'))

// ---------------------------------------------------------------- 3. tablist keyboard
async function main() {
  const app = buildClient()
  const { root } = app.tree
  const service = app.service
  await settle()

  service.registerTab({ id: 'demo', title: { zh: '演示页', en: 'Demo' }, order: 10, mount() {} })
  service.registerTab({ id: 'notes', title: { zh: '便签', en: 'Notes' }, order: 20, mount() {} })
  await settle()

  const strip = root.querySelector('[data-dsbs-tabs]')
  const buttons = strip.children.filter((child) => child.getAttribute('role') === 'tab')
  check('tablist: four tabs are painted (two built-ins, two consumers)', buttons.length === 4,
    'n=' + buttons.length)

  const roving = buttons.filter((button) => button.getAttribute('tabindex') === '0')
  check('tablist: exactly one tab is in the Tab order', roving.length === 1, 'n=' + roving.length)
  check('tablist: the roving stop starts on the selected tab',
    roving.length === 1 && roving[0].getAttribute('aria-selected') === 'true')
  check('tablist: every other tab is arrows-only',
    buttons.filter((button) => button.getAttribute('tabindex') === '-1').length === 3)

  const byId = (id) => buttons.filter((button) => button.getAttribute('data-dsbs-tabid') === id)[0]
  const key = (target, name) => {
    const event = { type: 'keydown', key: name, target, prevented: false, preventDefault() { this.prevented = true } }
    strip.dispatchEvent(event)
    return event
  }

  // Manual activation: moving focus must NOT mount the neighbour's page.
  const before = service.getActiveTab()
  const right = key(byId('ext'), 'ArrowRight')
  await settle()
  check('tablist: ArrowRight moves the roving stop to the next tab',
    byId('ws').getAttribute('tabindex') === '0' && byId('ext').getAttribute('tabindex') === '-1')
  check('tablist: ArrowRight is consumed, so the list underneath cannot scroll', right.prevented === true)
  check('tablist: moving focus does not open the tab it lands on',
    service.getActiveTab() === before, 'activeTab=' + String(service.getActiveTab()))

  key(byId('ext'), 'ArrowLeft')
  check('tablist: ArrowLeft wraps backwards to the last tab',
    byId('notes').getAttribute('tabindex') === '0')

  key(byId('demo'), 'End')
  check('tablist: End lands on the last tab', byId('notes').getAttribute('tabindex') === '0')
  key(byId('demo'), 'Home')
  check('tablist: Home lands on the first tab', byId('ext').getAttribute('tabindex') === '0')

  const unrelated = key(byId('ext'), 'a')
  check('tablist: an ordinary key is left to the browser', unrelated.prevented === false)

  // Enter is the button's own activation, which is why arrows alone are enough.
  byId('notes').click()
  await settle()
  check('tablist: clicking a focused tab still opens it', service.getActiveTab() === 'notes')

  // -------------------------------------------------------------- 4. toast live region
  // Error path: no uiWorkspace in this sandbox, so Temp reports "the native
  // service is missing" — an error, announced assertively.
  const errApp = buildClient()
  await settle()
  errApp.tree.root.querySelector('[data-dsbs-btn="temp"]').click()
  await settle()
  const errToast = errApp.doc.querySelector('[data-dsbs-temp-toast]')
  check('toast: a failure is announced as an alert',
    !!errToast && errToast.getAttribute('role') === 'alert',
    errToast ? errToast.getAttribute('role') : 'no toast')
  check('toast: a failure is assertive, not queued behind the screen reader',
    !!errToast && errToast.getAttribute('aria-live') === 'assertive')

  // Success path: a full fake uiWorkspace, so the track call answers ok.
  const fakeUi = {
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'w1', sessionIds: ['s0'] }] }) } },
    mainReference: { sessionId: 's0' },
    sessions: { list: { getSnapshot: () => ({ ids: ['s0'], byId: { s0: { projectionValues: { agentPreset: 'standard' } } } }) } },
    createNamed: () => Promise.resolve('sess-new'),
    openSession() {},
  }
  const okApp = buildClient({
    services: { uiWorkspace: fakeUi },
    fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  })
  await settle()
  okApp.tree.root.querySelector('[data-dsbs-btn="temp"]').click()
  await settle()
  await settle()
  const okToast = okApp.doc.querySelector('[data-dsbs-temp-toast]')
  check('toast: a confirmation stays a polite status',
    !!okToast && okToast.getAttribute('role') === 'status',
    okToast ? okToast.getAttribute('role') : 'no toast')
  check('toast: a confirmation is polite', !!okToast && okToast.getAttribute('aria-live') === 'polite')

  // -------------------------------------------------------------- 5. locales
  const zh = JSON.parse(read('locale/zh.json'))
  const en = JSON.parse(read('locale/en.json'))
  // The one-liner is deliberately bilingual in both files (test_025 guards
  // that); the TITLE is what a user in an English UI reads on the card, and it
  // was Chinese in both files. The host's own bundles ship an English title in
  // locale/en.json and a Chinese one in locale/zh.json.
  check('locale: the English title carries no CJK', !/[\u4e00-\u9fff]/.test(en.meta.title), en.meta.title)
  check('locale: the Chinese title still does', /[\u4e00-\u9fff]/.test(zh.meta.title), zh.meta.title)
  check('locale: the bilingual one-liner is untouched in both',
    zh.meta.description === en.meta.description && en.meta.description.includes('A plugin dedicated to'))
  check('locale: both still point at the detail document',
    zh.meta.detail === 'DETAIL.md' && en.meta.detail === 'DETAIL.md')

  // -------------------------------------------------------------- 6. busy release
  // Both arms of the final continuation release the Temp button. A throw inside
  // the catch (a toast touching a DOM the host just tore down) used to skip the
  // success-only continuation and leave the button disabled for 20 s.
  check('busy: the create chain releases on success AND on a late throw',
    /\}, releaseTempBusy\)/.test(client) && /releaseTempBusy\(\)/.test(client))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('HARNESS ERROR', error)
  process.exitCode = 1
})
