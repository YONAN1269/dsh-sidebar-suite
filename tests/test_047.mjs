// dsh-sidebar-suite 0.7.4 — repeatable host contract matrix.
//
// Replaces the one-off manual CDP verification of rc.2 (Grid sidebar) and
// rc.3 (sidebar.session.action slot) with a table-driven suite. Each profile
// describes a host's *observable shape* (DOM classes, declared slots, native
// services). The real client bundle is mounted against it and the resulting
// behaviour is asserted. Adding a future host = adding one row here, no CDP.
//
// Profiles are intentionally named after the DSH versions they model so a
// regression names the host it would break on.
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
const settle = () => new Promise((r) => setTimeout(r, 0))

function findAll(node, pred, out) {
  const found = out || []
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) { for (const n of node) findAll(n, pred, found); return found }
  if (pred(node)) found.push(node)
  if (node.children) findAll(node.children, pred, found)
  return found
}

// ---- host profiles ------------------------------------------------------
// grid: rc.2+ sidebar root lives in a flex scrollRegion (two-level tree).
// slot: rc.3+ declares sidebar.session.action inside the New-session row.
// contextMenu / nativeGroups: rc.1 / rc.2 respectively; absent on older hosts.
const PROFILES = [
  { name: 'rc.1 (pre-grid, pre-slot)', grid: false, slot: false, contextMenu: false, nativeGroups: false, remote: false },
  { name: 'rc.2 (grid, no slot)', grid: true, slot: false, contextMenu: true, nativeGroups: true, remote: true },
  { name: 'rc.3 (grid + session slot)', grid: true, slot: true, contextMenu: true, nativeGroups: true, remote: true, shape: 'grid-slot-native' },
  { name: 'rc.4 (same client contracts as rc.3)', grid: true, slot: true, contextMenu: true, nativeGroups: true, remote: true, shape: 'grid-slot-native' },
  { name: 'rc.5 (current, unpacked app)', grid: true, slot: true, contextMenu: true, nativeGroups: true, remote: true, shape: 'grid-slot-native', packaging: 'resources/app' },
  // 0.8.7 — the nightly channel moved the host back into app.asar (rc.5 shipped
  // it unpacked) and stopped binding the right-click gesture on session rows.
  // Neither changes the client contract, so it is the same shape with new facts.
  // The installer carries an app.asar that the desktop updater unpacks into
  // resources/app on first launch, so both forms exist for this version; the
  // field records what the package ships, the layout check below covers both.
  { name: '0.2.3-alpha.2 (nightly, app.asar installer, no row gesture)', grid: true, slot: true, contextMenu: true, nativeGroups: true, remote: true, shape: 'grid-slot-native', packaging: 'resources/app.asar' },
]

const STATUS_OK = JSON.stringify({
  ok: true,
  env: { plugin: '0.7.4', dshClient: '0.2.2-rc.x', node: '24.9.0', platform: 'win32' },
  routes: { registered: 9, errors: [], paths: ['/api/dsh-temp-session.status', '/api/dsh-temp-session.list', '/api/dsh-temp-session.config', '/api/dsh-temp-session.track', '/api/dsh-temp-session.untrack', '/api/dsh-temp-session.remove', '/api/dsh-temp-session.purge', '/api/dsh-temp-session.probe', '/api/dsh-temp-session.paths'] },
  tempCount: 1,
})

function mountProfile(profile) {
  const tree = buildSidebar({ gridHost: profile.grid })
  const doc = tree.doc
  const storage = new Map()

  // New-session row with (rc.3+) or without the official action slot.
  const newRow = doc.createElement('div')
  newRow.setAttribute('class', 'wtg9ga_newSessionRow')
  const hostButton = doc.createElement('button')
  hostButton.setAttribute('class', 'wtg9ga_newSession')
  newRow.appendChild(hostButton)
  if (profile.slot) {
    const outlet = doc.createElement('div')
    outlet.setAttribute('data-slot', 'sidebar.session.action')
    newRow.appendChild(outlet)
  }
  tree.root.appendChild(newRow)

  // A temporary session row so both menu paths have a target.
  const row = doc.createElement('div')
  row.setAttribute('data-row-key', 'session:sess-x')
  row.textContent = '会话 sess-x'
  tree.workspaces.appendChild(row)

  class MutationObserverStub { observe() {} disconnect() {} takeRecords() { return [] } }
  class ResizeObserverStub { observe() {} disconnect() {} }
  const ReactStub = {
    createElement(type, props) { return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) } },
    useState(initial) { return [initial, () => {}] }, useEffect() {}, Fragment: 'Fragment',
  }
  const slotRegistered = []
  const nativeMenus = []
  let copyCalls = 0
  let copiedText = ''
  const remoteCalls = []
  const fetchStub = async (url) => {
    const u = String(url)
    if (u.includes('api/dsh-temp-session.status')) {
      return new Response(STATUS_OK, { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.includes('api/dsh-temp-session.paths')) {
      return new Response(JSON.stringify({ ok: true, id: 'sess-x', paths: ['C:\\dsbs-test\\sessions\\proj\\sess-x'] }), { status: 200 })
    }
    if (u.includes('api/dsh-temp-session.list')) {
      return new Response(JSON.stringify({ ok: true, ids: ['sess-x'] }), { status: 200 })
    }
    return new Response(JSON.stringify({ ok: true, ids: ['sess-x'] }), { status: 200 })
  }
  const host = {
    __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
    getComputedStyle: () => ({ position: 'static', display: 'block' }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    open() { return null }, setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
  }
  const sandbox = {
    window: host, document: doc,
    navigator: {
      language: 'zh-CN',
      clipboard: {
        writeText: (text) => { copyCalls += 1; copiedText = String(text); return Promise.resolve() },
      },
    },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k),
    },
    fetch: fetchStub, Request, Response, URL, URLSearchParams, AbortController,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: MutationObserverStub, ResizeObserver: ResizeObserverStub,
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
    requestAnimationFrame: (cb) => sbTimeout(cb, 0), cancelAnimationFrame: (id) => clearTimeout(id),
    console, require(name) { return name === 'react' ? ReactStub : null },
  }
  sandbox.window.document = doc
  sandbox.window.localStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox, { filename: 'client.js' })

  const mod = sandbox.__entry.factory(() => ReactStub)
  const slots = {
    inject(name, cb) { if (typeof cb === 'function') cb() },
    register(spec, component) {
      // The real host throws when registering into an undeclared slot; that
      // throw is what drives the plugin's legacy fallback. Model it here.
      if (spec && spec.name === 'sidebar.session.action' && !profile.slot) {
        throw new Error('slot not declared: sidebar.session.action')
      }
      slotRegistered.push({ spec, component }); return () => {}
    },
    entriesOfSlot(name) {
      if (name === 'sidebar.panellist.actions') return profile.nativeGroups ? [{ id: 'more' }] : []
      return []
    },
    subscribe() { return () => {} },
  }
  const contextMenus = { register(c) { nativeMenus.push(c); return () => {} } }
  const remoteSession = {
    openWorkspacePath(request, signal) {
      remoteCalls.push({ request, signal })
      return Promise.resolve({ ok: true })
    },
  }
  const injectedScope = () => {
    const scope = { slots, configForms: undefined }
    if (profile.remote) scope.remote = { session: remoteSession }
    return scope
  }
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe() { return () => {} }, register() { return () => {} } },
    effect(fn) { return fn() }, get() { return undefined }, provide() {},
    inject(deps, cb) {
      if (typeof cb !== 'function') return
      const scope = injectedScope()
      if (profile.contextMenu) scope.contextMenus = contextMenus
      cb(scope)
    },
  }
  // Older hosts have no contextMenus service: simulate by removing it from
  // the injected scope for those profiles.
  if (!profile.contextMenu) {
    ctx.inject = function (deps, cb) {
      if (typeof cb !== 'function') return
      cb(injectedScope())
    }
  }
  mod.apply(ctx)
  return {
    doc, tree, mod, slotRegistered, nativeMenus,
    copyInfo: () => ({ calls: copyCalls, text: copiedText }),
    remoteCalls,
  }
}

async function main() {
  // The matrix itself must stay the single source of truth for the profiles.
  check('matrix: covers rc.1, rc.2, rc.3, rc.4 and current',
    PROFILES.length === 6 && ['rc.1', 'rc.2', 'rc.3', 'rc.4', 'rc.5', '0.2.3']
      .every((v) => PROFILES.map((p) => p.name).join('|').includes(v)))

  const results = []
  for (const profile of PROFILES) {
    const m = mountProfile(profile)
    await settle()

    // Contract 1: sidebar structure resolved on every profile.
    const barExists = m.doc.querySelectorAll('[data-dsbs-bar]').length > 0
    results.push({
      profile: profile.name,
      bar: barExists,
      slot: !!m.slotRegistered.find((r) => r.spec.name === 'sidebar.session.action'),
      menu: m.nativeMenus.length > 0,
    })
    check(profile.name + ': sidebar resolved and control bar mounted', barExists)
    check(profile.name + ': client applied without throwing', !!m.mod && typeof m.mod.apply === 'function')

    // Contract 2: session-action slot only requested on hosts that declare it.
    const seat = !!m.slotRegistered.find((r) => r.spec.name === 'sidebar.session.action')
    check(profile.name + ': session slot registration matches host declaration', seat === profile.slot,
      'got ' + seat + ', want ' + profile.slot)

    // Contract 3: native context menu only registered where the service exists.
    const nativeMenu = m.nativeMenus.length > 0
    check(profile.name + ': native row menu matches host capability', nativeMenu === profile.contextMenu,
      'got ' + nativeMenu + ', want ' + profile.contextMenu)

    // Contract 4: the injected bar sits outside the grid's row on rc.2+.
    if (profile.grid) {
      const scrollRegion = m.tree.scrollRegion
      const bar = m.doc.querySelector('[data-dsbs-bar]')
      check(profile.name + ': control bar is in the flex scrollRegion, not the grid',
        !!scrollRegion && !!bar && bar.parentElement === scrollRegion,
        bar && bar.parentElement && bar.parentElement.className)
    }

    // Contract 5: "Open session folder" really takes the path this host has.
    // rc.1 has no Remote session service, so it must copy the path locally
    // instead of silently doing nothing. rc.2+ must call the public Remote
    // with a cancellation signal — not just define a menu row.
    const openDir = nativeMenu && m.nativeMenus[0]
      .resolve({ sessionId: 'sess-x', displayTitle: 'sess-x' })
      .find((a) => a.id === 'openDir')
    if (nativeMenu) {
      check(profile.name + ': native menu exposes openDir', !!openDir && typeof openDir.run === 'function')
      if (openDir) await openDir.run()
      await settle()
      check(profile.name + ': reveal used the public Remote with a signal',
        m.remoteCalls.length === 1 && !!m.remoteCalls[0].signal
          && m.remoteCalls[0].request.action === 'reveal',
        JSON.stringify(m.remoteCalls.map((c) => ({ action: c.request.action, signal: !!c.signal }))))
      check(profile.name + ': no clipboard fallback on a Remote-capable host',
        m.copyInfo().calls === 0, String(m.copyInfo().calls))
    } else {
      const row = m.doc.querySelector('[data-row-key="session:sess-x"]')
      m.doc.dispatchEvent({
        type: 'contextmenu', target: row, clientX: 40, clientY: 60,
        preventDefault() {}, stopPropagation() {},
      })
      await settle()
      const menu = m.doc.querySelector('[data-dsbs-temp-menu]')
      const fallbackAction = menu && Array.from(menu.querySelectorAll('button[data-dsbs-temp-action]'))
        .find((b) => b.getAttribute('data-dsbs-temp-action') === 'openDir')
      check(profile.name + ': DOM fallback still offers openDir', !!fallbackAction)
      if (fallbackAction) fallbackAction.dispatchEvent({ type: 'click', bubbles: true, preventDefault() {} })
      await settle(); await settle()
      check(profile.name + ': no Remote service means local path copy',
        m.copyInfo().calls === 1 && m.copyInfo().text.includes('sess-x')
          && m.remoteCalls.length === 0,
        JSON.stringify(m.copyInfo()))
    }
  }

  // Cross-profile invariants: the code paths are shared, so a profile-specific
  // regression must never fork into a second implementation.
  check('matrix: one sidebar resolver for all profiles',
    (SRC.match(/function resolveSidebar\(/g) || []).length === 1)
  check('matrix: one control-bar builder for all profiles',
    (SRC.match(/function buildBar\(/g) || []).length === 1)
  check('matrix: one DOM context-menu fallback for all profiles',
    (SRC.match(/function onTempContextMenu\(/g) || []).length === 1)
  check('matrix: one health badge reader for all profiles',
    (SRC.match(/function readHealth\(/g) || []).length === 1)

  // rc.3, rc.4 and rc.5 really do expose the same CLIENT contract — the rc.5
  // difference is packaging (app.asar -> resources/app), which is checked
  // against the smoke tool rather than pretending it changes the sidebar.
  const shaped = PROFILES.filter((p) => p.shape)
  check('matrix: rc.3/rc.4/rc.5/0.2.3 share one client contract by design',
    shaped.length === 4 && new Set(shaped.map((p) => p.shape)).size === 1,
    shaped.map((p) => p.name + ':' + p.shape).join(' | '))
  const SMOKE_SRC = fs.readFileSync(ROOT + '/scripts/smoke-l5.mjs', 'utf8')
  // Both packaging layouts are live in the field: an install may sit at
  // `resources/app.asar`, or the updater may have unpacked it to
  // `resources/app` — which is what the 0.2.3 nightly does on first launch.
  check('matrix: both packaging layouts are covered by the smoke tool',
    PROFILES.find((p) => p.name.includes('rc.5')).packaging === 'resources/app'
      && PROFILES.find((p) => p.name.includes('0.2.3')).packaging === 'resources/app.asar'
      && SMOKE_SRC.includes('resources/app.asar') && SMOKE_SRC.includes("'resources/app'"))

  // Guard the matrix table itself against silent narrowing.
  check('matrix: results recorded for every profile', results.length === PROFILES.length)
  console.log('\nHost contract matrix:')
  for (const r of results) {
    console.log('  ' + r.profile.padEnd(28) + ' bar=' + (r.bar ? 'yes' : 'no')
      + '  slot=' + (r.slot ? 'yes' : 'no') + '  nativeMenu=' + (r.menu ? 'yes' : 'no'))
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
