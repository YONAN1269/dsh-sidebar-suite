// dsh-sidebar-suite 0.7.4 — rc.1/2 integration round:
//   #2 row context menu via ctx.contextMenus.register (DOM menu stays fallback)
//   #3 self-built tab strip yields to the host's native "More" grouping
//   #4 "Open session folder" row action via remote.openWorkspacePath
//   #5 health badge reports the menu / tab strategy as informational rows
//
// Mounts the real client bundle against the shared DOM stub. Everything is
// local: no CDP, no machine-specific paths, no live DSH.
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { buildSidebar, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const SRC = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')
const HOST_SRC = fs.readFileSync(ROOT + '/lib/temp-session-host.mjs', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}
const settle = () => new Promise((r) => setTimeout(r, 0))

function findAll(node, pred, out) {
  const found = out || []
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const item of node) findAll(item, pred, found)
    return found
  }
  if (pred(node)) found.push(node)
  for (const key of ['children', 'props']) {
    if (node[key]) findAll(node[key], pred, found)
  }
  return found
}

const STATUS_OK = JSON.stringify({
  ok: true,
  env: { plugin: '0.7.4', dshClient: '0.2.2-rc.5', node: '24.9.0', platform: 'win32' },
  routes: { registered: 9, errors: [], paths: ['/api/dsh-temp-session.status', '/api/dsh-temp-session.list', '/api/dsh-temp-session.config', '/api/dsh-temp-session.track', '/api/dsh-temp-session.untrack', '/api/dsh-temp-session.remove', '/api/dsh-temp-session.purge', '/api/dsh-temp-session.probe', '/api/dsh-temp-session.paths'] },
  tempCount: 1,
})

function mountClient(options) {
  const opts = options || {}
  const tree = buildSidebar()
  const doc = tree.doc
  const storage = new Map()

  // A temporary session row so the DOM menu path can be exercised.
  const row = doc.createElement('div')
  row.setAttribute('data-row-key', 'session:sess-x')
  row.textContent = '会话 sess-x'
  tree.workspaces.appendChild(row)

  class MutationObserverStub { observe() {} disconnect() {} takeRecords() { return [] } }
  class ResizeObserverStub { observe() {} disconnect() {} }
  let stateIdx = 0
  const stateOverrides = []
  const reactEffects = []
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
    useEffect(fn) { reactEffects.push(fn) },
    Fragment: 'Fragment',
  }
  // Observe the DOM fallback lifecycle rather than trusting source text.
  let contextMenuListeners = 0
  const origAdd = doc.addEventListener.bind(doc)
  const origRemove = doc.removeEventListener.bind(doc)
  doc.addEventListener = function (type, fn, opts) {
    if (type === 'contextmenu') contextMenuListeners += 1
    return origAdd(type, fn, opts)
  }
  doc.removeEventListener = function (type, fn, opts) {
    if (type === 'contextmenu') contextMenuListeners = Math.max(0, contextMenuListeners - 1)
    return origRemove(type, fn, opts)
  }
  const fetchCalls = []
  const fetchStub = async (url) => {
    fetchCalls.push(String(url))
    const u = String(url)
    if (u.includes('api/dsh-temp-session.paths')) {
      return new Response(JSON.stringify({
        ok: true, id: 'sess-x',
        paths: opts.paths === undefined ? ['C:\\Users\\me\\.dsh\\sessions\\ws\\sess-x'] : opts.paths,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.includes('api/dsh-temp-session.status')) {
      return new Response(STATUS_OK, { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.includes('api/dsh-temp-session.list')) {
      return new Response(JSON.stringify({ ok: true, ids: ['sess-x'] }), { status: 200 })
    }
    return new Response(JSON.stringify({ ok: true, ids: ['sess-x'] }), { status: 200 })
  }
  const reveals = []
  const remoteSession = {
    openWorkspacePath(req, signal) {
      reveals.push({ req, signal })
      return Promise.resolve({ ok: opts.revealOk === false ? false : true })
    },
  }
  const host = {
    __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
    getComputedStyle: () => ({ position: 'static', display: 'block' }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    open() { return null },
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
    openDialog(){},
  }
  const sandbox = {
    window: host,
    document: doc,
    navigator: {
      language: 'zh-CN',
      clipboard: { writeText: () => (opts.copyFails ? Promise.reject(new Error('blocked')) : Promise.resolve()) },
    },
    AbortController: class { constructor() { this.signal = { aborted: false } } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    fetch: fetchStub, Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: MutationObserverStub, ResizeObserver: ResizeObserverStub,
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
  const slotRegistrations = []
  const services = []
  const effects = []
  const menuDisposers = []
  const nativeGroupingRef = { value: opts.nativeGrouping !== false }
  const slotListeners = {}
  const slots = {
    inject(name, cb) { if (typeof cb === 'function') cb() },
    register(spec, component) { slotRegistrations.push({ spec, component }); return () => {} },
    entriesOfSlot(name) {
      return name === 'sidebar.panellist.actions' && nativeGroupingRef.value ? [{ id: 'more' }] : []
    },
    subscribe(name, fn) {
      if (!slotListeners[name]) slotListeners[name] = []
      slotListeners[name].push(fn)
      return () => { slotListeners[name] = slotListeners[name].filter((f) => f !== fn) }
    },
  }
  const contextMenus = {
    register(contribution) {
      services.push(contribution)
      return () => { menuDisposers.push(contribution.id) }
    },
  }
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe() { return () => {} }, register() { return () => {} } },
    effect(fn) { effects.push(fn); return fn() },
    get() { return undefined },
    inject(deps, cb) {
      if (typeof cb !== 'function') return
      const scope = { slots, configForms: undefined, contextMenus, remote: { session: remoteSession } }
      cb(scope)
    },
    provide() {},
  }
  mod.apply(ctx)
  return {
    doc, tree, mod, ctx, window: host, slotRegistrations, services, effects, fetchCalls, reveals,
    stateOverrides, reactEffects, menuDisposers, nativeGroupingRef, slotListeners,
    contextMenuListeners: () => contextMenuListeners,
    resetStateIdx() { stateIdx = 0 },
  }
}

async function main() {
  // ---- source guards ----------------------------------------------------
  check('src: native context menu targets sessions',
    /target:\s*'session'/.test(SRC) && /ctx\.inject\(\['contextMenus'\]/.test(SRC))
  check('src: the row menu actions are defined once',
    (SRC.match(/function tempMenuActions\(/g) || []).length === 1 &&
    /tempMenuActions\(target\.sessionId\)/.test(SRC))
  check('src: the DOM menu consumes the same action list',
    /var actions = tempMenuActions\(id\)/.test(SRC))
  check('src: folder action uses the host remote reveal API with a signal',
    /openWorkspacePath\(\{ path: target, action: 'reveal' \}, signal\)/.test(SRC) &&
    /ctx\.inject\(\['remote\.session'\]/.test(SRC))
  check('src: reveal falls back to copying the path',
    /copyText\(target\)/.test(SRC))
  check('src: tab strip yields to native grouping (but keeps a way back for an active page)',
    /if \(!hasPlugin \|\| \(nativeTabsAvailable && !activePlugin\)\)/.test(SRC) &&
    /entriesOfSlot\('sidebar\.panellist\.actions'\)/.test(SRC))
  check('src: stale active tab is cleared when native grouping appears',
    /if \(runtime\.activeTab\)/.test(SRC) &&
    /slots\.subscribe\('sidebar\.panellist\.actions', checkNativeTabs\)/.test(SRC) &&
    /disposeAllTabPanels\(\)/.test(SRC))
  check('src: health badge keeps 3 core contracts plus 2 info rows',
    /c\.state !== 'info'/.test(SRC) && /key: 'menu'/.test(SRC) && /key: 'tabs'/.test(SRC))
  check('host: paths route is read-only and guarded by the tracked list',
    /\/api\/dsh-temp-session\.paths', \['GET'\]/.test(HOST_SRC) &&
    /const tracked = state\.tracked\.includes\(sessionId\)/.test(HOST_SRC) &&
    /linkedWorkspaceDirs\(sessionId\)\.map/.test(HOST_SRC))

  // ---- native menu registration ----------------------------------------
  const healthy = mountClient()
  await settle()
  await settle()
  check('menu: registers exactly one native contribution',
    healthy.services.length === 1, String(healthy.services.length))
  const contribution = healthy.services[0]
  check('menu: contribution id and order are stable',
    contribution && contribution.id === 'dsh-sidebar-suite.temp-session' && contribution.order === 400,
    contribution && contribution.id)
  const actions = contribution.resolve({ sessionId: 'sess-x', displayTitle: '会话 sess-x' })
  check('menu: resolve maps the shared actions with a run callback',
    actions.length > 0 && actions.every((a) => typeof a.run === 'function'))
  check('menu: three actions are offered on a temporary session',
    actions.length === 3, JSON.stringify(actions.map((a) => a.id)))
  check('menu: actions keep the shared ids',
    actions.map((a) => a.id).join(',') === 'keep,delete,openDir',
    actions.map((a) => a.id).join(','))
  check('menu: delete is marked danger, reveal is not',
    actions[1].danger === true && actions[2].danger !== true)
  check('menu: a non-temporary session gets no actions',
    contribution.resolve({ sessionId: 'other', displayTitle: 'x' }).length === 0)
  const detail = healthy.slotRegistrations.find((r) => r.spec.name === 'plugins.bundle.config')
  check('detail-page component was captured', !!detail)
  if (detail) {
    for (const fn of healthy.reactEffects.splice(0)) fn()
    await settle(); await settle()
    healthy.resetStateIdx()
    let rendered = detail.component()
    const badgeNode = findAll(rendered, (n) => !!(n.props && n.props['data-dsbs-health']))[0]
    check('menu: native mode health badge was rendered', !!badgeNode)
    if (badgeNode) {
      badgeNode.props.onClick()
      healthy.resetStateIdx()
      rendered = detail.component()
      const panel = findAll(rendered, (n) => !!(n.props && n.props['data-dsbs-health-detail']))[0]
      check('menu: native mode is reported by the health detail',
        !!panel && JSON.stringify(panel).includes('宿主统一菜单'),
        panel ? JSON.stringify(panel).slice(0, 180) : 'no detail panel')
    }
  }
  // 0.8.7 — a successful registration is not proof that the host opens the
  // popup: 0.2.3-alpha.2 registers it and keeps the gesture unbound. The
  // listener therefore stays, and it is what opens the shared menu there.
  check('menu: native mode keeps exactly one listener to probe the popup',
    healthy.contextMenuListeners() === 1, String(healthy.contextMenuListeners()))
  check('menu: native menu has not been disposed before teardown',
    healthy.menuDisposers.length === 0, JSON.stringify(healthy.menuDisposers))

  // ---- tab strip yields on native grouping -----------------------------
  check('tabs: strip is hidden when the host has native grouping and no page is active',
    /if \(!hasPlugin \|\| \(nativeTabsAvailable && !activePlugin\)\)/.test(SRC))
  const legacy = mountClient({ nativeGrouping: false })
  check('tabs: both contexts mount without errors',
    !!legacy.mod && !!healthy.mod)
  const groupingListeners = legacy.slotListeners['sidebar.panellist.actions'] || []
  check('tabs: subscribes to the native grouping slot',
    groupingListeners.length === 1, String(groupingListeners.length))
  legacy.nativeGroupingRef.value = true
  for (const fn of groupingListeners) fn()
  await settle()
  const legacyStrip = legacy.doc.querySelector('[data-dsbs-tabs]')
  check('tabs: strip actually hides when grouping appears after mount',
    !!legacyStrip && legacyStrip.getAttribute('hidden') === '',
    legacyStrip ? String(legacyStrip.getAttribute('hidden')) : 'no strip')

  // ---- open session folder ---------------------------------------------
  await settle()
  // Drive the reveal through the shared action (the native menu's run callback).
  const revealAction = actions[2]
  revealAction.run()
  await settle()
  await settle()
  check('folder: asks the host for the session paths',
    healthy.fetchCalls.some((u) => u.includes('api/dsh-temp-session.paths?sessionId=sess-x')),
    healthy.fetchCalls.join(' | '))
  check('folder: calls the public reveal remote with the absolute path',
    healthy.reveals.length === 1 && healthy.reveals[0].req.path === 'C:\\Users\\me\\.dsh\\sessions\\ws\\sess-x'
      && healthy.reveals[0].req.action === 'reveal',
    JSON.stringify(healthy.reveals))
  check('folder: passes an AbortSignal (the host Remote requires one)',
    healthy.reveals.length === 1 && !!healthy.reveals[0].signal
      && healthy.reveals[0].signal.aborted === false,
    JSON.stringify(healthy.reveals))

  const noFolder = mountClient({ paths: [] })
  await settle()
  await settle()
  const noFolderActions = noFolder.services[0].resolve({ sessionId: 'sess-x' })
  noFolderActions[2].run()
  await settle()
  await settle()
  check('folder: a missing directory does not call reveal',
    noFolder.reveals.length === 0, JSON.stringify(noFolder.reveals))

  const failedReveal = mountClient({ revealOk: false })
  await settle()
  await settle()
  const failedActions = failedReveal.services[0].resolve({ sessionId: 'sess-x' })
  failedActions[2].run()
  await settle()
  await settle()
  check('folder: a failed reveal still calls the remote once (copy fallback is contained)',
    failedReveal.reveals.length === 1, JSON.stringify(failedReveal.reveals))
  const copied = failedReveal.doc.querySelector('[data-dsbs-temp-toast]')
  check('folder: a copy fallback tells the user the path was copied',
    !!copied && copied.textContent.includes('目录路径已复制'),
    copied && copied.textContent)

  const copyFails = mountClient({ revealOk: false, copyFails: true })
  await settle(); await settle()
  copyFails.services[0].resolve({ sessionId: 'sess-x' })[2].run()
  await settle(); await settle()
  const notCopied = copyFails.doc.querySelector('[data-dsbs-temp-toast]')
  check('folder: a failed copy does NOT claim success',
    !!notCopied && notCopied.textContent.includes('无法自动复制目录路径')
      && notCopied.getAttribute('data-dsbs-temp-toast-error') === 'true',
    notCopied ? notCopied.textContent + ' / ' + notCopied.getAttribute('data-dsbs-temp-toast-error') : 'no toast')

  // ---- health info rows -------------------------------------------------
  check('health: menu and tabs are informational, not pass/fail contracts',
    /state: 'info'/.test(SRC) && /key: 'tabs', label: t\('health\.tabs'\), state: 'info'/.test(SRC))
  check('health: core count excludes info rows',
    /coreChecks\.filter\(function \(c\) \{ return c\.state === 'ok' \}\)/.test(SRC))
  check('health: badge label uses the core total',
    /health\.okCount \+ '\/' \+ health\.total/.test(SRC))

  // ---- hot reload: unregister before a second apply registers again ------
  const owner = healthy.window.__dshSidebarSuiteOwner
  check('menu: this run claimed an owner', !!owner && typeof owner.teardown === 'function')
  if (owner) {
    owner.teardown()
    const afterFirst = healthy.menuDisposers.length
    owner.teardown()
    check('menu: teardown unregisters the native contribution exactly once',
      afterFirst === 1 && healthy.menuDisposers.length === 1,
      JSON.stringify(healthy.menuDisposers))
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
