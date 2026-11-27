// dsh-sidebar-suite 1.1.5 — web panel behavior: R-04 reload rejection guard,
// R-16 two-step "clear saved login" action.
//
// Drives the real client bundle in a VM on the shared DOM stub. The panel
// closure is rendered through a hand-built React stub with persistent hooks,
// so the reload rejection branches and the arm/confirm flow are exercised for
// real rather than matched against source text.
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
  if (typeof node !== 'object') return found
  if (Array.isArray(node)) { for (const item of node) findAll(item, pred, found); return found }
  if (pred(node)) found.push(node)
  if (node.children) findAll(node.children, pred, found)
  return found
}

const CHAT_KEY = 'dsbs-deepseek-chat'

function mount(options = {}) {
  const opts = options || {}
  const tree = buildSidebar({ gridHost: true })
  const doc = tree.doc
  const storage = new Map()
  const mainFactories = []
  const registrations = []
  const fetchCalls = []

  const layout = {
    panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe() { return () => {} } },
    selectPanel() {},
  }
  const slots = {
    inject(name, factory) { if (name === 'main') mainFactories.push(factory); return () => {} },
    register(meta, component) { registrations.push({ meta, component }); return () => {} },
    entriesOfSlot() { return [] },
    subscribe() { return () => {} },
  }

  class MutationObserverStub { observe() {} disconnect() {} takeRecords() { return [] } }
  class ResizeObserverStub { observe() {} disconnect() {} }

  const stubStates = []
  const refs = []
  let hookIdx = 0
  let refIdx = 0
  const ReactStub = {
    createElement(type, props) {
      return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
    },
    useState(initial) {
      const i = hookIdx++
      if (stubStates[i] === undefined) stubStates[i] = typeof initial === 'function' ? initial() : initial
      const setter = (next) => { stubStates[i] = typeof next === 'function' ? next(stubStates[i]) : next }
      return [stubStates[i], setter]
    },
    useRef(value) {
      const i = refIdx++
      if (refs[i] === undefined) refs[i] = { current: value }
      return refs[i]
    },
    useEffect() {},
    Fragment: 'Fragment',
  }
  const resetHooks = () => { hookIdx = 0; refIdx = 0 }

  const sandbox = {
    window: {
      __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
      getComputedStyle: () => ({ position: 'static', display: 'block' }),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
      open() { return null }, innerWidth: 1280, innerHeight: 800,
      dshDesktop: { browser: { acquire: () => Promise.resolve({ lease: 'l1', partition: 'p' }), release() {} } },
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
      return new Response(JSON.stringify(opts.fetchResponse || { ok: true }), { status: 200 })
    },
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: MutationObserverStub, ResizeObserver: ResizeObserverStub,
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
    requestAnimationFrame: (cb) => sbTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
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
    get() { return undefined },
    inject(deps, callback) {
      if (typeof callback !== 'function') return
      const scope = { slots }
      if (Array.isArray(deps) && deps.indexOf('layout') >= 0) scope.layout = layout
      callback(scope)
    },
    provide() {},
  }
  mod.apply(ctx)
  if (typeof mainFactories[0] === 'function') mainFactories[0]()

  const chatRegistration = registrations.find((r) => r.meta && r.meta.key === CHAT_KEY)
  const renderPanel = () => {
    resetHooks()
    return chatRegistration ? chatRegistration.component() : null
  }
  return { doc, registrations, fetchCalls, stubStates, refs, renderPanel }
}

function fakeFrame(rejectReason) {
  return {
    getURL: () => 'https://chat.deepseek.com/',
    reload: () => Promise.reject(rejectReason),
    loadURL: () => Promise.resolve(),
    addEventListener() {}, removeEventListener() {}, focus() {},
    executeJavaScript: () => Promise.resolve({}),
  }
}

function actionsOf(vnode) {
  return findAll(vnode, (n) => n.props && n.props['data-dsbs-webpage-actions'] !== undefined)[0] || null
}
function clearLoginButton(vnode) {
  return findAll(vnode, (n) => n.props && n.props['data-dsbs-webpage-clear-login'] !== undefined)[0] || null
}

async function main() {
  // ---- R-04: reload rejection mirrors navigate() -------------------------
  // Aborted navigations (ERR_ABORTED / code -3) must not paint an error; a
  // genuine rejection does.
  {
    const h = mount()
    h.refs[1] = { current: { frame: fakeFrame({ code: 'ERR_ABORTED' }) } }
    const vnode = h.renderPanel()
    const actions = actionsOf(vnode)
    check('R04: the chat panel renders its action bar', !!actions)
    actions.children[0].props.onClick({ stopPropagation() {}, preventDefault() {} })
    await settle(); await settle()
    check('R04: ERR_ABORTED keeps the loading state', h.stubStates[1] === 'loading', String(h.stubStates[1]))
    check('R04: ERR_ABORTED leaves no error text', h.stubStates[2] === '', String(h.stubStates[2]))
  }

  {
    const h = mount()
    h.refs[1] = { current: { frame: fakeFrame({ code: -3 }) } }
    const vnode = h.renderPanel()
    actionsOf(vnode).children[0].props.onClick({ stopPropagation() {}, preventDefault() {} })
    await settle(); await settle()
    check('R04: code -3 keeps the loading state', h.stubStates[1] === 'loading', String(h.stubStates[1]))
    check('R04: code -3 leaves no error text', h.stubStates[2] === '', String(h.stubStates[2]))
  }

  {
    const h = mount()
    h.refs[1] = { current: { frame: fakeFrame(new Error('boom')) } }
    const vnode = h.renderPanel()
    actionsOf(vnode).children[0].props.onClick({ stopPropagation() {}, preventDefault() {} })
    await settle(); await settle()
    check('R04: a real rejection paints the error state', h.stubStates[1] === 'error', String(h.stubStates[1]))
    check('R04: the real rejection message is preserved', h.stubStates[2] === 'boom', String(h.stubStates[2]))
  }

  // ---- R-16: two-step clear-saved-login, honest outcome -------------------
  {
    const h = mount({ fetchResponse: { ok: true } })
    let vnode = h.renderPanel()
    const btn = clearLoginButton(vnode)
    check('R16: the clear-login button renders on the panel', !!btn)

    // First click arms the confirm; no route call yet.
    btn.props.onClick({ stopPropagation() {}, preventDefault() {} })
    check('R16: the first click arms the confirm state', h.stubStates[4] === true, String(h.stubStates[4]))
    check('R16: arming makes no login-clear call',
      !h.fetchCalls.some((c) => c.url.indexOf('web-login-clear') >= 0), JSON.stringify(h.fetchCalls))

    // Re-render with the armed state, then confirm.
    vnode = h.renderPanel()
    const armedBtn = clearLoginButton(vnode)
    armedBtn.props.onClick({ stopPropagation() {}, preventDefault() {} })
    await settle(); await settle()

    const clearCall = h.fetchCalls.find((c) => c.url.indexOf('web-login-clear') >= 0)
    check('R16: confirm calls the existing web-login-clear route', !!clearCall)
    check('R16: the request body carries the page id',
      clearCall && JSON.parse(clearCall.body).page === 'chat', clearCall && clearCall.body)

    const toast = h.doc.querySelector('[data-dsbs-temp-toast]')
    check('R16: success shows the success toast',
      !!toast && toast.textContent === '已清除本机登录状态。', toast && toast.textContent)
    check('R16: the success toast is not an error toast',
      !!toast && toast.getAttribute('data-dsbs-temp-toast-error') !== 'true', toast && toast.getAttribute('data-dsbs-temp-toast-error'))
  }

  {
    const h = mount({ fetchResponse: { ok: false } })
    let vnode = h.renderPanel()
    clearLoginButton(vnode).props.onClick({ stopPropagation() {}, preventDefault() {} })
    vnode = h.renderPanel()
    clearLoginButton(vnode).props.onClick({ stopPropagation() {}, preventDefault() {} })
    await settle(); await settle()

    const clearCall = h.fetchCalls.find((c) => c.url.indexOf('web-login-clear') >= 0)
    check('R16: a failed clear still reaches the route', !!clearCall)
    const toast = h.doc.querySelector('[data-dsbs-temp-toast]')
    check('R16: failure shows the failure toast',
      !!toast && toast.textContent === '清除本机登录状态失败。', toast && toast.textContent)
    check('R16: the failure toast is flagged as an error',
      !!toast && toast.getAttribute('data-dsbs-temp-toast-error') === 'true', toast && toast.getAttribute('data-dsbs-temp-toast-error'))
  }

  {
    // Host reports `removed:false`: the route wrote a tombstone but there was
    // no saved login on this device. The panel must report the empty state,
    // not the "cleared" success wording.
    const h = mount({ fetchResponse: { ok: true, removed: false } })
    let vnode = h.renderPanel()
    clearLoginButton(vnode).props.onClick({ stopPropagation() {}, preventDefault() {} })
    vnode = h.renderPanel()
    clearLoginButton(vnode).props.onClick({ stopPropagation() {}, preventDefault() {} })
    await settle(); await settle()

    const clearCall = h.fetchCalls.find((c) => c.url.indexOf('web-login-clear') >= 0)
    check('R16: an empty saved-login still reaches the clear route', !!clearCall)
    const toast = h.doc.querySelector('[data-dsbs-temp-toast]')
    check('R16: removed:false reports the empty-login message',
      !!toast && toast.textContent === '本机没有已保存的登录。', toast && toast.textContent)
    check('R16: the empty-login message is not flagged as an error',
      !!toast && toast.getAttribute('data-dsbs-temp-toast-error') !== 'true',
      toast && toast.getAttribute('data-dsbs-temp-toast-error'))
  }

  {
    // Host reports `removed:true`: a real saved login was cleared, so the
    // existing success wording stays.
    const h = mount({ fetchResponse: { ok: true, removed: true } })
    let vnode = h.renderPanel()
    clearLoginButton(vnode).props.onClick({ stopPropagation() {}, preventDefault() {} })
    vnode = h.renderPanel()
    clearLoginButton(vnode).props.onClick({ stopPropagation() {}, preventDefault() {} })
    await settle(); await settle()

    const clearCall = h.fetchCalls.find((c) => c.url.indexOf('web-login-clear') >= 0)
    check('R16: removed:true still reaches the clear route', !!clearCall)
    const toast = h.doc.querySelector('[data-dsbs-temp-toast]')
    check('R16: removed:true keeps the success toast',
      !!toast && toast.textContent === '已清除本机登录状态。', toast && toast.textContent)
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
