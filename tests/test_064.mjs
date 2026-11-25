// dsh-sidebar-suite 1.1.0 — three-page switch (Agent / DeepSeek Chat / API).
//
// The switch is a DOM row, but the thing it actually controls is the host's
// global `main` panel selection. This suite drives the real client bundle on
// the shared DOM stub with a fake layout service, so a regression that only
// relabels a button without selecting a panel is caught here.
//
// The login-snapshot host is checked separately: validation is a pure function,
// and the credential/file seam is driven through its public page API.
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { buildSidebar, sbTimeout } from './dom-stub.mjs'
import {
  createWebLoginHost,
  normalizeWebLoginEntries,
  webLoginCredentialKey,
  isWebLoginPage,
} from '../lib/web-login-host.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const client = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function buildClient(options = {}) {
  const desktop = options.desktop !== false
  const tree = buildSidebar()
  const doc = tree.doc
  const storage = new Map()
  const mainFactories = []
  const registrations = []
  const selectCalls = []
  const listeners = []
  let activePanelId = null

  const layout = {
    panelInfo: {
      getSnapshot: () => ({ activePanelId }),
      subscribe(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1) } },
    },
    selectPanel(id) {
      selectCalls.push(id)
      activePanelId = id
      for (const fn of listeners.slice()) fn()
    },
  }
  const slots = {
    inject(name, factory) {
      if (name === 'main') mainFactories.push(factory)
      return () => {}
    },
    register(meta, component) {
      registrations.push({ meta, component })
      return () => {
        const i = registrations.findIndex((entry) => entry.meta.key === meta.key)
        if (i >= 0) registrations.splice(i, 1)
      }
    },
    entriesOfSlot() { return [] },
    subscribe() { return () => {} },
  }

  class MutationObserverStub {
    observe() {}
    disconnect() {}
    takeRecords() { return [] }
  }
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }

  const sandbox = {
    window: {
      __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
      getComputedStyle: () => ({ position: 'static', display: 'block' }),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      setTimeout: sbTimeout, clearTimeout, setInterval: sbTimeout, clearInterval,
      open() { return null },
    },
    document: doc,
    navigator: { language: 'zh-CN', clipboard: { writeText: () => Promise.resolve() } },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type) { Object.assign(this, { type }, arguments[1]) } },
    MouseEvent: class { constructor(type) { Object.assign(this, { type }, arguments[1]) } },
    MutationObserver: MutationObserverStub,
    ResizeObserver: ResizeObserverStub,
    setTimeout: sbTimeout, clearTimeout, setInterval: sbTimeout, clearInterval,
    requestAnimationFrame: (cb) => sbTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
  }
  if (desktop) {
    sandbox.window.dshDesktop = {
      browser: {
        acquire: () => Promise.resolve({ lease: 'lease-1', partition: 'dsh-sidebar-browser-test' }),
        release() {},
      },
    }
  }
  sandbox.window.document = doc
  sandbox.window.localStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(client, sandbox, { filename: 'client.js' })

  const ReactStub = {
    createElement: () => null,
    useState: (value) => [value, () => {}],
    useRef: (value) => ({ current: value }),
    useEffect() {},
    Fragment: 'Fragment',
  }
  const mod = sandbox.__entry.factory(() => ReactStub)
  const published = {}
  const ctx = {
    locale: {
      getSnapshot: () => ({ active: 'zh-CN' }),
      subscribe() { return () => {} },
      register() { return () => {} },
    },
    effect(fn) { return fn() },
    get() { return undefined },
    inject(deps, callback) {
      if (typeof callback !== 'function') return
      const scope = { slots }
      if (Array.isArray(deps) && deps.indexOf('layout') >= 0) scope.layout = layout
      callback(scope)
    },
    provide(name, value) { published[name] = value },
  }
  mod.apply(ctx)

  // A real host calls the main-slot factory when the slot mounts. Invoke it by
  // hand here; before this call the page row is deliberately hidden/disabled.
  const mountMain = () => {
    const factory = mainFactories[0]
    if (typeof factory !== 'function') return null
    return factory()
  }
  return { doc, tree, layout, mainFactories, registrations, selectCalls, published, mountMain }
}

function pageButtons(doc) {
  return Array.from(doc.querySelectorAll('button[data-dsbs-page]'))
}

async function main() {
  // ---- 1. the three-page row: labels, order, readiness -------------------
  {
    const h = buildClient()
    await settle()
    const bar = h.doc.querySelector('[data-dsbs-pages]')
    check('R1: the page row exists', !!bar)
    const buttons = pageButtons(h.doc)
    check('R2: exactly three page buttons', buttons.length === 3, String(buttons.length))
    check('R3: buttons are Agent / Chat / API in that order',
      buttons.map((b) => b.getAttribute('data-dsbs-page')).join(',') === 'agent,chat,api',
      buttons.map((b) => b.getAttribute('data-dsbs-page')).join(','))
    check('R4: every button carries aria-pressed=false', buttons.every((b) => b.getAttribute('aria-pressed') === 'false'))
    check('R5: the labels are the zh-CN strings',
      buttons.map((b) => b.textContent).join('|') === '对话|Chat|API',
      buttons.map((b) => b.textContent).join('|'))

    // Before the main slot mounts there are no panels to select: the row must
    // not promise something the host cannot deliver.
    check('R6: the row is hidden until the main panels register', bar.hasAttribute('hidden'))

    h.mountMain()
    await settle()
    check('R7: the row appears after the panels register', !bar.hasAttribute('hidden'))

    const rows = h.doc.querySelectorAll('[data-dsbs-pages] button[data-dsbs-page]')
    check('R8: the row was inserted exactly once', rows.length === 3, String(rows.length))
    check('R9: the row prefers the sidebar logo row',
      client.includes("querySelector('[class*=\"logoRow\"]')"))
    check('R10: the brand only shrinks while the row really sits there',
      client.includes('[data-dsbs-brand="compact"]{zoom:.78}') &&
      client.includes('runtime.pageBar.parentNode === row'))
    check('R11: the row goes before the panel toggle',
      client.includes('row.insertBefore(pageBar, toggle)'))
  }

  // ---- 2. clicking selects the host panel ------------------------------
  {
    const h = buildClient()
    await settle()
    h.mountMain()
    await settle()
    const buttons = pageButtons(h.doc)

    buttons[1].click()
    await settle()
    check('S1: Chat selects dsbs-deepseek-chat',
      h.selectCalls[h.selectCalls.length - 1] === 'dsbs-deepseek-chat',
      String(h.selectCalls[h.selectCalls.length - 1]))
    check('S2: Chat is the pressed button',
      buttons[1].getAttribute('aria-pressed') === 'true' && buttons[0].getAttribute('aria-pressed') === 'false')
    check('S3: the html marker follows the page', h.doc.documentElement.getAttribute('data-dsbs-page') === 'chat')

    buttons[2].click()
    await settle()
    check('S4: API selects dsbs-deepseek-api', h.selectCalls[h.selectCalls.length - 1] === 'dsbs-deepseek-api')
    check('S5: API is the pressed button', buttons[2].getAttribute('aria-pressed') === 'true')

    buttons[0].click()
    await settle()
    check('S6: Agent selects null (the Conversation panel)', h.selectCalls[h.selectCalls.length - 1] === null)
    check('S7: Agent is the pressed button', buttons[0].getAttribute('aria-pressed') === 'true')

    // A host-side navigation (clicking a session, opening Plugins) is the
    // source of truth: the row follows layout.panelInfo, it does not fight it.
    h.layout.selectPanel('dsbs-deepseek-api')
    await settle()
    check('S8: an external API selection repaints the row',
      buttons[2].getAttribute('aria-pressed') === 'true')
    h.layout.selectPanel(null)
    await settle()
    check('S9: returning to the host conversation repaints Agent',
      buttons[0].getAttribute('aria-pressed') === 'true')
  }

  // ---- 3. panels registered with the right contracts --------------------
  {
    const h = buildClient()
    await settle()
    check('P1: no panel is registered before the main slot mounts', h.registrations.length === 0)
    h.mountMain()
    await settle()
    check('P2: two main panels are registered', h.registrations.length === 2, String(h.registrations.length))
    check('P3: panel keys are the ones the switch selects',
      h.registrations.map((entry) => entry.meta.key).sort().join(',') === 'dsbs-deepseek-api,dsbs-deepseek-chat',
      h.registrations.map((entry) => entry.meta.key).sort().join(','))
    check('P4: both panels are main-slot React components',
      h.registrations.every((entry) => entry.meta.name === 'main' && typeof entry.component === 'function'))
    // A webview left at about:blank#<lease> passes every DOM test and still
    // shows a blank page in production. The body must be ref-attached so the
    // effect can find the element, and the effect must navigate it.
    check('P5: the panel body is ref-attached for the guest effect',
      /'data-dsbs-webpage-body': '', ref: hostRef/.test(client))
    check('P6: the guest is navigated to its real URL after attach',
      /frame\.loadURL\(def\.url\)/.test(client))
    check('P7: a blank guest navigates only after its dom-ready',
      /if \(isBlank\(\)\) \{ navigate\(\); return \}/.test(client)
      && !/frame\.addEventListener\('did-navigate-in-page', onNavigate\)\n            navigate\(\)/.test(client))
    check('P8: navigation is issued at most once per guest',
      /var navigated = false/.test(client) && /if \(navigated\) return/.test(client))
  }

  // ---- 4. a third-party tab owns the column ----------------------------
  {
    const h = buildClient()
    await settle()
    h.mountMain()
    await settle()
    const bar = h.doc.querySelector('[data-dsbs-pages]')
    const service = h.published.sidebarSuite
    check('T1: the public service exposes tab mode', !!service && typeof service.registerTab === 'function')
    if (service) {
      const dispose = service.registerTab({
        id: 'page-test-tab',
        title: 'Page test',
        mount(container) { container.appendChild(h.doc.createElement('div')) },
      })
      service.activateTab('page-test-tab')
      await settle()
      check('T2: an active third-party tab hides the page row', bar.hasAttribute('hidden'))
      dispose()
      service.activateTab(null)
      await settle()
      check('T3: leaving the tab brings the page row back', !bar.hasAttribute('hidden'))
    }
  }

  // ---- 5. no desktop bridge => no switch ------------------------------
  {
    const h = buildClient({ desktop: false })
    await settle()
    h.mountMain()
    await settle()
    const bar = h.doc.querySelector('[data-dsbs-pages]')
    check('W1: the row is hidden when no desktop guest bridge exists', bar.hasAttribute('hidden'))
    check('W2: hiding does not remove it (the host may gain the bridge later)',
      !!h.doc.querySelector('[data-dsbs-pages]'))
  }

  // ---- 6. login snapshot host -----------------------------------------
  {
    check('H1: only chat/api are valid pages', isWebLoginPage('chat') && isWebLoginPage('api') && !isWebLoginPage('other'))
    check('H2: credential keys are namespaced',
      webLoginCredentialKey('chat') === 'dsh-sidebar-suite/web-login-chat'
      && webLoginCredentialKey('api') === 'dsh-sidebar-suite/web-login-api')

    const good = normalizeWebLoginEntries({ userToken: 't', __appKit_userInfo: '{"a":1}', 'deepseek-device-id:chat': 'd' })
    check('H3: ordinary tokens are accepted', good.ok && Object.keys(good.entries).length === 3, JSON.stringify(good))
    check('H4: __proto__ is never copied',
      !Object.prototype.hasOwnProperty.call(normalizeWebLoginEntries({ __proto__: 'x', userToken: 't' }).entries || {}, '__proto__'))
    check('H5: non-string values are dropped',
      normalizeWebLoginEntries({ userToken: 1, sessionId: 's' }).ok
      && Object.keys(normalizeWebLoginEntries({ userToken: 1, sessionId: 's' }).entries).join(',') === 'sessionId')
    check('H6: an empty map is rejected', normalizeWebLoginEntries({}).ok === false)
    check('H7: an array is rejected', normalizeWebLoginEntries([]).ok === false)

    const records = new Map()
    const credentials = {
      async readRecord(key) { return records.get(key) || null },
      async modifyRecord(key, mutate) {
        const next = await mutate(records.get(key))
        records.set(key, next)
        return next
      },
      async deleteRecord(key) { records.delete(key) },
    }
    const host = createWebLoginHost({ get(name) { return name === 'credentials' ? credentials : null } })
    const saved = await host.savePage('chat', { userToken: 't', __appKit_userInfo: '{"a":1}' })
    check('H8: save writes a credential grant', saved.ok && saved.source === 'credentials', JSON.stringify(saved))
    check('H9: the grant key is chat-specific', records.has('dsh-sidebar-suite/web-login-chat'))
    const read = await host.readPage('chat')
    check('H10: read returns the same entries',
      read.ok && read.found && read.entries.userToken === 't' && read.entries.__appKit_userInfo === '{"a":1}',
      JSON.stringify(read))
    const cleared = await host.clearPage('chat')
    check('H11: clear removes the grant', cleared.ok && !records.has('dsh-sidebar-suite/web-login-chat'))
    check('H12: a cleared page reads as not found', (await host.readPage('chat')).found === false)

    let routes = 0
    const connection = { fetch: { register() { routes += 1 } } }
    const routeHost = createWebLoginHost({ get() { return connection } })
    routeHost.register()
    check('H13: the host registers exactly three web-login routes', routes === 3, String(routes))
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
